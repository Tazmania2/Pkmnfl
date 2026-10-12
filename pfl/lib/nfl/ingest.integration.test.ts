import { describe, expect, it, vi } from 'vitest';

/**
 * `persist.ts` (importado transitivamente por `ingest.ts` e usado aqui
 * diretamente) começa com `import 'server-only'`, uma guarda que lança fora de
 * um contexto de servidor Next/RSC. Sob Vitest esse contexto não existe, então
 * o módulo `server-only` é substituído por um stub vazio: apenas a guarda de
 * importação é neutralizada, sem alterar o comportamento sob teste.
 */
vi.mock('server-only', () => ({}));

import { runNflIngestion, type NflEndpoint, type NflIngestionDeps } from './ingest';
import {
  fetchWithRetry,
  type FetchResponseLike,
  type FetchFn,
  type NflClientConfig,
  type NflLogger,
} from './client';
import { NFL_MATCHUP_SOURCE, NFL_MATCHUP_TABLE, upsertNflMatchups } from './persist';
import { mapMatchups } from './pipeline';
import type { NflMatchupRow } from './types';

/**
 * Teste de integração da ingestão NFL com servidor mock (Task 12.4).
 *
 * _Requirements: 10.1, 10.5_
 *
 * Diferente dos testes de exemplo de `ingest.test.ts` (que injetam `fetch` e
 * `persist` como dublês de alto nível), este teste integra os módulos reais do
 * pipeline — `runNflIngestion` → {@link fetchWithRetry} → {@link mapMatchups} →
 * {@link upsertNflMatchups} — substituindo apenas as duas fronteiras de I/O:
 *
 * 1. a camada HTTP, via um `fetchFn` mock (servidor fake que programa respostas
 *    429 / timeout / sucesso por URL) **sem consumir a API real**; e
 * 2. o cliente Supabase, via um dublê em memória que registra em quais tabelas
 *    houve escrita.
 *
 * As asserções garantem que:
 * - respostas de sucesso são persistidas em `nfl_matchup_data` (R10.1);
 * - nenhuma escrita jamais atinge `species` ou qualquer tabela de
 *   roster/atleta (R10.1, R10.5);
 * - 429 e timeout são tratados pela política de resiliência (retry com backoff)
 *   usando um `sleep` injetado para não haver espera real.
 */

const TEST_CFG: NflClientConfig = {
  baseUrl: 'https://nfl.balldontlie.io',
  apiKey: 'secret-key-xyz',
  timeoutMs: 30_000,
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/** Tabelas que jamais podem ser tocadas pela ingestão NFL (R10.1, R10.5). */
const FORBIDDEN_TABLES = [
  'species',
  'moves',
  'abilities',
  'learnable_moves',
  'pokemon_abilities',
  'teams',
  'team_athletes',
  'athletes',
  'athlete_moves',
  'rosters',
  'roster_slots',
  'lineups',
];

/** Resposta JSON de sucesso para o `fetchFn` mock. */
function okResponse(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

/** Resposta HTTP 429 (rate limit) para o `fetchFn` mock. */
function rateLimitResponse(): FetchResponseLike {
  return {
    ok: false,
    status: 429,
    json: async () => ({}),
  };
}

/** Erro de abort (timeout) para o `fetchFn` mock. */
function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Cliente Supabase em memória que registra toda tabela escrita e captura as
 * linhas enviadas ao `upsert`. Reusa o padrão de `persist.property.test.ts`.
 *
 * Expõe `tablesTouched` para que o teste comprove que apenas
 * `nfl_matchup_data` foi alvo de escrita (R10.1, R10.5).
 */
function createInMemoryClient() {
  const captured: NflMatchupRow[] = [];
  const tablesTouched = new Set<string>();

  const client = {
    from(table: string) {
      tablesTouched.add(table);
      return {
        upsert(rows: NflMatchupRow[]) {
          for (const row of rows) {
            captured.push(row);
          }
          return {
            select(_cols: string) {
              return Promise.resolve({
                data: rows.map((r) => ({ natural_key: r.natural_key })),
                error: null,
              });
            },
          };
        },
      };
    },
  };

  return { client, captured, tablesTouched };
}

/** Coleta mensagens de log para asserções de confidencialidade/resiliência. */
function recordingLogger(): { logger: NflLogger; lines: string[] } {
  const lines: string[] = [];
  const logger: NflLogger = {
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  };
  return { logger, lines };
}

/**
 * Servidor HTTP mock programável por URL. Cada URL recebe uma fila de respostas
 * (sucesso ou falha); cada chamada consome a próxima da fila. Isso permite
 * modelar "falha nas N primeiras tentativas, sucesso na seguinte" exercitando
 * o retry real de {@link fetchWithRetry}.
 *
 * `calls` registra cada requisição vista pelo servidor para asserções de que a
 * API real nunca foi consumida (todas as chamadas passam por aqui) e de contagem
 * de tentativas.
 */
type MockResult =
  | { kind: 'ok'; body: unknown }
  | { kind: 'rate_limit' }
  | { kind: 'timeout' };

function createMockServer(routes: Record<string, MockResult[]>) {
  const calls: { url: string }[] = [];
  const headersSeen: Record<string, string>[] = [];

  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ url: input });
    headersSeen.push(init.headers);

    // Encontra a rota cujo nome é sufixo da URL resolvida.
    const matchKey = Object.keys(routes).find((path) => input.endsWith(path));
    const queue = matchKey ? routes[matchKey] : undefined;
    const next = queue && queue.length > 0 ? queue.shift()! : { kind: 'ok' as const, body: { data: [] } };

    switch (next.kind) {
      case 'ok':
        return okResponse(next.body);
      case 'rate_limit':
        return rateLimitResponse();
      case 'timeout':
        // Simula o aborto por timeout lançando um AbortError, como faria o
        // `fetch` global quando o AbortController dispara.
        throw abortError();
    }
  };

  return { fetchFn, calls, headersSeen };
}

/**
 * Monta as `deps` de {@link runNflIngestion} integrando os módulos reais:
 * `fetch` liga {@link fetchWithRetry} ao `fetchFn` mock + `sleep` instantâneo;
 * `persist` liga {@link upsertNflMatchups} ao cliente em memória.
 */
function makeIntegratedDeps(
  server: ReturnType<typeof createMockServer>,
  memory: ReturnType<typeof createInMemoryClient>,
  logger: NflLogger,
  sleep: (ms: number) => Promise<void>,
): NflIngestionDeps {
  return {
    config: TEST_CFG,
    fetch: (endpoint, cfg) =>
      fetchWithRetry(endpoint, cfg, { fetchFn: server.fetchFn, sleep, logger }),
    persist: (rows) => upsertNflMatchups(rows, { client: memory.client as never }),
    logger,
  };
}

/** Payload de resposta de matchups no formato paginado da API_NFL. */
function matchupsBody(): unknown {
  return {
    data: [
      { offense_scheme: 'spread', defense_scheme: 'cover2', season: '2024' },
      { offense_scheme: 'west_coast', defense_scheme: 'man', season: '2024' },
    ],
  };
}

describe('Ingestão NFL (integração com servidor mock) — sucesso persiste em nfl_matchup_data (R10.1)', () => {
  it('mapeia e persiste matchups de sucesso somente na tabela de regras', async () => {
    const server = createMockServer({ '/matchups': [{ kind: 'ok', body: matchupsBody() }] });
    const memory = createInMemoryClient();
    const { logger } = recordingLogger();
    const sleep = vi.fn(async () => {});

    const pipeline: NflEndpoint[] = [{ name: 'matchups', path: '/matchups', map: mapMatchups }];
    const report = await runNflIngestion(pipeline, makeIntegratedDeps(server, memory, logger, sleep));

    // Persistência de sucesso (R10.1).
    expect(report.ok).toBe(true);
    expect(report.failures).toHaveLength(0);
    expect(report.persisted).toHaveLength(1);
    expect(report.persisted[0]!.inserted).toBe(2);

    // Linhas realmente capturadas pelo cliente em memória, com carimbo/fonte.
    expect(memory.captured).toHaveLength(2);
    for (const row of memory.captured) {
      expect(row.source).toBe(NFL_MATCHUP_SOURCE);
      expect(row.captured_at.endsWith('Z')).toBe(true);
    }

    // Escrita exclusiva em nfl_matchup_data (R10.1, R10.5).
    expect([...memory.tablesTouched]).toEqual([NFL_MATCHUP_TABLE]);

    // Sem consumo da API real: toda requisição passou pelo servidor mock.
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]!.url).toBe('https://nfl.balldontlie.io/matchups');
  });

  it('nunca escreve em species/roster/atleta em nenhum endpoint de sucesso (R10.5)', async () => {
    const server = createMockServer({
      '/matchups': [{ kind: 'ok', body: matchupsBody() }],
      '/extra': [{ kind: 'ok', body: matchupsBody() }],
    });
    const memory = createInMemoryClient();
    const { logger } = recordingLogger();
    const sleep = vi.fn(async () => {});

    const pipeline: NflEndpoint[] = [
      { name: 'matchups', path: '/matchups', map: mapMatchups },
      { name: 'extra', path: '/extra', map: mapMatchups },
    ];
    await runNflIngestion(pipeline, makeIntegratedDeps(server, memory, logger, sleep));

    for (const forbidden of FORBIDDEN_TABLES) {
      expect(memory.tablesTouched.has(forbidden)).toBe(false);
    }
    expect([...memory.tablesTouched]).toEqual([NFL_MATCHUP_TABLE]);
  });
});

describe('Ingestão NFL (integração) — resiliência a 429 e timeout (R9.3/R9.4) sem perder R10.1/R10.5', () => {
  it('retenta após 429 e persiste quando a tentativa seguinte tem sucesso', async () => {
    // Duas respostas 429 seguidas e então sucesso: exercita o retry real.
    const server = createMockServer({
      '/matchups': [
        { kind: 'rate_limit' },
        { kind: 'rate_limit' },
        { kind: 'ok', body: matchupsBody() },
      ],
    });
    const memory = createInMemoryClient();
    const { logger, lines } = recordingLogger();
    const sleep = vi.fn(async (_ms: number) => {}); // backoff instantâneo, sem espera real

    const pipeline: NflEndpoint[] = [{ name: 'matchups', path: '/matchups', map: mapMatchups }];
    const report = await runNflIngestion(pipeline, makeIntegratedDeps(server, memory, logger, sleep));

    // Sucesso após as retentativas: persistiu em nfl_matchup_data (R10.1).
    expect(report.ok).toBe(true);
    expect(report.persisted[0]!.inserted).toBe(2);
    expect([...memory.tablesTouched]).toEqual([NFL_MATCHUP_TABLE]);

    // 3 requisições (2 falhas + 1 sucesso) e 2 backoffs aplicados.
    expect(server.calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // Backoff exponencial: 1000ms, depois 2000ms.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1_000, 2_000]);
    // A credencial jamais aparece nos logs de rate limit.
    for (const line of lines) {
      expect(line).not.toContain(TEST_CFG.apiKey);
    }
  });

  it('esgota as tentativas em timeout persistente: registra falha e não escreve nada (R10.5)', async () => {
    // Timeout em todas as tentativas (5): falha definitiva, nenhuma persistência.
    const server = createMockServer({
      '/matchups': [
        { kind: 'timeout' },
        { kind: 'timeout' },
        { kind: 'timeout' },
        { kind: 'timeout' },
        { kind: 'timeout' },
      ],
    });
    const memory = createInMemoryClient();
    const { logger } = recordingLogger();
    const sleep = vi.fn(async () => {});

    const pipeline: NflEndpoint[] = [{ name: 'matchups', path: '/matchups', map: mapMatchups }];
    const report = await runNflIngestion(pipeline, makeIntegratedDeps(server, memory, logger, sleep));

    // Falha definitiva por timeout registrada no relatório.
    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]!.reason).toBe('timeout');
    expect(report.failures[0]!.attempts).toBe(5);

    // Nenhuma escrita ocorreu — nem em nfl_matchup_data, nem em species/roster.
    expect(memory.captured).toHaveLength(0);
    expect([...memory.tablesTouched]).toHaveLength(0);

    // 5 tentativas e 4 backoffs (não espera após a última).
    expect(server.calls).toHaveLength(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it('endpoint com timeout persistente não impede a persistência de endpoints saudáveis (R9.5 + R10.1)', async () => {
    const server = createMockServer({
      '/down': [
        { kind: 'timeout' },
        { kind: 'timeout' },
        { kind: 'timeout' },
        { kind: 'timeout' },
        { kind: 'timeout' },
      ],
      '/ok': [{ kind: 'ok', body: matchupsBody() }],
    });
    const memory = createInMemoryClient();
    const { logger } = recordingLogger();
    const sleep = vi.fn(async () => {});

    const pipeline: NflEndpoint[] = [
      { name: 'down', path: '/down', map: mapMatchups },
      { name: 'ok', path: '/ok', map: mapMatchups },
    ];
    const report = await runNflIngestion(pipeline, makeIntegratedDeps(server, memory, logger, sleep));

    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => f.name)).toEqual(['down']);
    expect(report.persisted.map((p) => p.name)).toEqual(['ok']);
    expect(report.persisted[0]!.inserted).toBe(2);

    // A persistência do endpoint saudável atingiu apenas nfl_matchup_data.
    expect([...memory.tablesTouched]).toEqual([NFL_MATCHUP_TABLE]);
    expect(memory.captured).toHaveLength(2);
  });
});
