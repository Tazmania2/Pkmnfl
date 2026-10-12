import { describe, expect, it, vi } from 'vitest';

/**
 * `ingest.ts` importa transitivamente `persist.ts`, que inicia com
 * `import 'server-only'` — guarda que lança fora de um contexto de servidor
 * Next/RSC. Sob Vitest esse contexto não existe, então o módulo é substituído
 * por um stub vazio; apenas a guarda de importação é neutralizada.
 */
vi.mock('server-only', () => ({}));

import {
  createDefaultIngestionDeps,
  formatIngestionReport,
  runNflIngestion,
  type NflEndpoint,
  type NflIngestionDeps,
} from './ingest';
import { MissingNflApiKeyError, NFL_ENV_VARS, type FetchOutcome, type NflClientConfig, type NflLogger } from './client';
import type { NflMatchupRow } from './types';
import type { UpsertResult } from '../catalog/types';

/**
 * Testes de exemplo/edge do orquestrador de ingestão NFL (`runNflIngestion`,
 * Task 12.3).
 *
 * _Requirements: 9.5, 10.1, 10.2, 10.3_
 *
 * Os testes injetam `fetch`, `persist` e `logger` para exercitar sucesso,
 * falha definitiva de endpoint (que não interrompe o pipeline), mapeamento com
 * erro, rejeições parciais de persistência e confidencialidade da credencial —
 * sem rede nem Supabase reais.
 */

const TEST_CFG: NflClientConfig = {
  baseUrl: 'https://nfl.balldontlie.io',
  apiKey: 'secret-key-123',
  timeoutMs: 30_000,
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/** Linha de matchup mínima para os testes. */
function row(key: string): NflMatchupRow {
  return {
    natural_key: key,
    offense_scheme: 'spread',
    defense_scheme: 'cover2',
    payload: { key },
    captured_at: '',
    source: 'https://nfl.balldontlie.io',
  };
}

/** Resultado de upsert bem-sucedido com `inserted` linhas e nenhuma rejeição. */
function okUpsert(inserted: number): UpsertResult {
  return { inserted, updated: 0, rejected: [] };
}

/** Coleta mensagens de log em um array para asserções de confidencialidade. */
function recordingLogger(): { logger: NflLogger; lines: string[] } {
  const lines: string[] = [];
  const logger: NflLogger = {
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  };
  return { logger, lines };
}

/** Monta `deps` com padrões sobrescrevíveis. */
function makeDeps(overrides: Partial<NflIngestionDeps>): NflIngestionDeps {
  return {
    config: TEST_CFG,
    fetch: async () => ({ ok: true, data: [] }),
    persist: async () => okUpsert(0),
    logger: recordingLogger().logger,
    ...overrides,
  };
}

describe('runNflIngestion — sucesso e persistência (R10.1, R10.3)', () => {
  it('mapeia a resposta e persiste cada endpoint bem-sucedido', async () => {
    const persist = vi.fn<(rows: NflMatchupRow[]) => Promise<UpsertResult>>(async (rows) =>
      okUpsert(rows.length),
    );
    const pipeline: NflEndpoint[] = [
      { name: 'matchups', path: '/matchups', map: () => [row('a'), row('b')] },
    ];

    const report = await runNflIngestion(pipeline, makeDeps({ persist }));

    expect(report.ok).toBe(true);
    expect(report.totalEndpoints).toBe(1);
    expect(report.failures).toHaveLength(0);
    expect(report.persisted).toEqual([
      { name: 'matchups', inserted: 2, updated: 0, rejected: [] },
    ]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]![0]).toHaveLength(2);
  });
});

describe('runNflIngestion — falha definitiva não interrompe o pipeline (R9.5)', () => {
  it('registra o endpoint que falha e prossegue persistindo os demais', async () => {
    const persist = vi.fn<(rows: NflMatchupRow[]) => Promise<UpsertResult>>(async (rows) =>
      okUpsert(rows.length),
    );
    const fetch = vi
      .fn<(endpoint: string, cfg: NflClientConfig) => Promise<FetchOutcome<unknown>>>()
      .mockImplementation(async (endpoint) => {
        if (endpoint === '/down') {
          return { ok: false, endpoint, reason: 'network', attempts: 5 };
        }
        return { ok: true, data: [] };
      });

    const pipeline: NflEndpoint[] = [
      { name: 'first', path: '/down', map: () => [row('x')] },
      { name: 'second', path: '/ok', map: () => [row('y')] },
    ];

    const report = await runNflIngestion(pipeline, makeDeps({ fetch, persist }));

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([
      { name: 'first', path: '/down', reason: 'network', attempts: 5 },
    ]);
    // O segundo endpoint foi persistido apesar da falha do primeiro.
    expect(report.persisted).toEqual([
      { name: 'second', inserted: 1, updated: 0, rejected: [] },
    ]);
    // persist nunca foi chamado para o endpoint que falhou (dados inalterados).
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('não vaza a credencial nas mensagens de falha (R9.6-análogo)', async () => {
    const { logger, lines } = recordingLogger();
    const fetch = async (endpoint: string): Promise<FetchOutcome<unknown>> => ({
      ok: false,
      endpoint,
      reason: 'timeout',
      attempts: 5,
    });
    const pipeline: NflEndpoint[] = [
      { name: 'ep', path: '/x', map: () => [] },
    ];

    await runNflIngestion(pipeline, makeDeps({ fetch, logger }));

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(TEST_CFG.apiKey);
    }
  });
});

describe('runNflIngestion — mapeamento com erro é tratado como falha parcial', () => {
  it('captura exceção do map, registra falha e prossegue', async () => {
    const persist = vi.fn<(rows: NflMatchupRow[]) => Promise<UpsertResult>>(async (rows) =>
      okUpsert(rows.length),
    );
    const pipeline: NflEndpoint[] = [
      {
        name: 'bad',
        path: '/bad',
        map: () => {
          throw new Error('formato inesperado');
        },
      },
      { name: 'good', path: '/good', map: () => [row('z')] },
    ];

    const report = await runNflIngestion(pipeline, makeDeps({ persist }));

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]!.name).toBe('bad');
    expect(report.persisted).toHaveLength(1);
    expect(report.persisted[0]!.name).toBe('good');
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('runNflIngestion — rejeições parciais da persistência', () => {
  it('agrega rejeições e marca o relatório como não-ok', async () => {
    const persist = async (): Promise<UpsertResult> => ({
      inserted: 1,
      updated: 0,
      rejected: [{ kind: 'nfl_matchup_data', key: null, reason: 'natural_key ausente' }],
    });
    const pipeline: NflEndpoint[] = [
      { name: 'ep', path: '/x', map: () => [row('a'), row('b')] },
    ];

    const report = await runNflIngestion(pipeline, makeDeps({ persist }));

    expect(report.ok).toBe(false);
    expect(report.persisted[0]!.rejected).toHaveLength(1);
    expect(report.failures).toHaveLength(0);
  });
});

describe('formatIngestionReport', () => {
  it('resume sucessos e falhas de forma legível', () => {
    const text = formatIngestionReport({
      ok: false,
      totalEndpoints: 2,
      persisted: [{ name: 'ok-ep', inserted: 3, updated: 0, rejected: [] }],
      failures: [{ name: 'bad-ep', path: '/bad', reason: 'rate_limit', attempts: 5 }],
    });

    expect(text).toContain('FALHAS PARCIAIS');
    expect(text).toContain('[ok] ok-ep: 3 gravada(s)');
    expect(text).toContain('[falha] bad-ep (/bad): rate_limit após 5 tentativa(s)');
  });
});

describe('createDefaultIngestionDeps — guarda de credencial (R9.2)', () => {
  it('propaga MissingNflApiKeyError quando NFL_API_KEY está ausente', () => {
    const original = process.env[NFL_ENV_VARS.API_KEY];
    delete process.env[NFL_ENV_VARS.API_KEY];
    try {
      expect(() => createDefaultIngestionDeps()).toThrow(MissingNflApiKeyError);
    } finally {
      if (original !== undefined) {
        process.env[NFL_ENV_VARS.API_KEY] = original;
      }
    }
  });
});
