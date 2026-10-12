import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWithRetry,
  loadNflClientConfig,
  MissingNflApiKeyError,
  NFL_DEFAULT_BASE_URL,
  NFL_DEFAULT_BASE_DELAY_MS,
  NFL_DEFAULT_MAX_DELAY_MS,
  NFL_DEFAULT_MAX_RETRIES,
  NFL_DEFAULT_TIMEOUT_MS,
  NFL_ENV_VARS,
  type FetchFn,
  type FetchResponseLike,
  type NflClientConfig,
} from './client';

/**
 * Testes de exemplo de resiliência e configuração do cliente NFL (Task 11.5).
 *
 * Cobertura por requisito:
 * - R9.1: a configuração vem exclusivamente de variáveis de ambiente e o
 *   código-fonte não contém literal de credencial (smoke test + verificação
 *   estática do arquivo-fonte).
 * - R9.2: credencial ausente/vazia encerra sem realizar requisições, com um
 *   espião de HTTP (`vi.fn`) comprovando que `fetchFn` nunca foi chamado.
 * - R9.5: uma falha persistente/definitiva de um endpoint retorna
 *   `{ ok: false }` sem lançar, de modo que um pipeline possa seguir com os
 *   demais endpoints.
 *
 * _Requirements: 9.1, 9.2, 9.5_
 */

/** Resposta de status arbitrário usada para simular falha de endpoint. */
function statusResponse(status: number): FetchResponseLike {
  return { ok: false, status, json: async () => ({}) };
}

/** Sleep instantâneo para não introduzir esperas reais nos testes. */
async function noopSleep(): Promise<void> {
  // Resolve imediatamente; os atrasos de backoff não são exercitados aqui.
}

/** Configuração de teste com os padrões de produção de resiliência. */
const TEST_CFG: NflClientConfig = {
  baseUrl: NFL_DEFAULT_BASE_URL,
  apiKey: 'secret-key-xyz',
  timeoutMs: NFL_DEFAULT_TIMEOUT_MS,
  maxRetries: NFL_DEFAULT_MAX_RETRIES,
  baseDelayMs: NFL_DEFAULT_BASE_DELAY_MS,
  maxDelayMs: NFL_DEFAULT_MAX_DELAY_MS,
};

describe('loadNflClientConfig — configuração só por env (R9.1)', () => {
  const originalBaseUrl = process.env[NFL_ENV_VARS.BASE_URL];
  const originalApiKey = process.env[NFL_ENV_VARS.API_KEY];

  afterEach(() => {
    // Restaura o ambiente para não vazar estado entre testes.
    if (originalBaseUrl === undefined) {
      delete process.env[NFL_ENV_VARS.BASE_URL];
    } else {
      process.env[NFL_ENV_VARS.BASE_URL] = originalBaseUrl;
    }
    if (originalApiKey === undefined) {
      delete process.env[NFL_ENV_VARS.API_KEY];
    } else {
      process.env[NFL_ENV_VARS.API_KEY] = originalApiKey;
    }
  });

  it('lê apiKey e baseUrl exclusivamente das variáveis de ambiente', () => {
    process.env[NFL_ENV_VARS.API_KEY] = 'env-provided-key';
    process.env[NFL_ENV_VARS.BASE_URL] = 'https://example.test/nfl';

    const cfg = loadNflClientConfig();

    expect(cfg.apiKey).toBe('env-provided-key');
    expect(cfg.baseUrl).toBe('https://example.test/nfl');
  });

  it('usa a baseUrl padrão quando NFL_API_BASE_URL não é definida', () => {
    process.env[NFL_ENV_VARS.API_KEY] = 'env-provided-key';
    delete process.env[NFL_ENV_VARS.BASE_URL];

    const cfg = loadNflClientConfig();

    expect(cfg.baseUrl).toBe(NFL_DEFAULT_BASE_URL);
  });

  it('o código-fonte do cliente não contém literal de credencial (R9.1)', () => {
    // Verificação estática: lê o próprio módulo-fonte e assegura que não há
    // atribuição de apiKey a partir de um literal — a credencial só pode vir
    // de process.env[NFL_API_KEY].
    const sourcePath = fileURLToPath(new URL('./client.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');

    // Toda leitura da credencial deve passar por process.env.
    expect(source).toContain('process.env[NFL_ENV_VARS.API_KEY]');

    // Não deve existir uma atribuição literal de apiKey (ex.: apiKey: 'xxx' ou
    // apiKey = "xxx"). Interfaces/documentação com `apiKey:` tipo/descrição
    // não casam este padrão porque exigem aspas após o valor.
    const literalApiKeyAssignment = /apiKey\s*[:=]\s*['"][^'"]+['"]/;
    expect(literalApiKeyAssignment.test(source)).toBe(false);
  });
});

describe('fetchWithRetry — key ausente encerra sem requisição (R9.2)', () => {
  it('não realiza nenhuma requisição quando a key é vazia (espião de HTTP)', async () => {
    const httpSpy = vi.fn<FetchFn>();
    const cfg: NflClientConfig = { ...TEST_CFG, apiKey: '' };

    await expect(
      fetchWithRetry('/matchups', cfg, { fetchFn: httpSpy, sleep: noopSleep }),
    ).rejects.toBeInstanceOf(MissingNflApiKeyError);

    expect(httpSpy).not.toHaveBeenCalled();
  });

  it('a mensagem/erro identifica pelo nome a env var faltante (R9.2)', async () => {
    const httpSpy = vi.fn<FetchFn>();
    const cfg: NflClientConfig = { ...TEST_CFG, apiKey: '   ' };

    await expect(
      fetchWithRetry('/matchups', cfg, { fetchFn: httpSpy, sleep: noopSleep }),
    ).rejects.toMatchObject({ missing: NFL_ENV_VARS.API_KEY });

    expect(httpSpy).not.toHaveBeenCalled();
  });
});

describe('fetchWithRetry — falha persistente não interrompe o pipeline (R9.5)', () => {
  it('retorna ok:false sem lançar quando o endpoint falha de forma persistente', async () => {
    const httpSpy = vi.fn<FetchFn>().mockResolvedValue(statusResponse(503));

    const outcome = await fetchWithRetry('/down-endpoint', TEST_CFG, {
      fetchFn: httpSpy,
      sleep: noopSleep,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.endpoint).toBe('/down-endpoint');
      expect(outcome.reason).toBe('http_error');
    }
  });

  it('um pipeline sequencial segue para os demais endpoints após uma falha definitiva', async () => {
    // Simula três endpoints: o segundo falha de forma persistente (429 esgota
    // todas as tentativas); os outros dois têm sucesso. O pipeline não deve
    // ser interrompido pela falha do segundo.
    const httpSpy = vi.fn<FetchFn>().mockImplementation(async (url) => {
      if (url.includes('/broken')) {
        return statusResponse(429);
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    });

    const endpoints = ['/alpha', '/broken', '/omega'];
    const outcomes: Array<{ endpoint: string; ok: boolean }> = [];

    for (const endpoint of endpoints) {
      // Nenhuma chamada deve lançar: o pipeline captura o FetchOutcome e segue.
      const outcome = await fetchWithRetry(endpoint, TEST_CFG, {
        fetchFn: httpSpy,
        sleep: noopSleep,
      });
      outcomes.push({ endpoint, ok: outcome.ok });
    }

    // Todos os endpoints foram processados, inclusive os posteriores à falha.
    expect(outcomes.map((o) => o.endpoint)).toEqual(endpoints);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
  });

  it('a falha persistente mantém-se isolada: endpoints de sucesso retornam seus dados', async () => {
    const httpSpy = vi.fn<FetchFn>().mockImplementation(async (url) => {
      if (url.includes('/broken')) {
        return statusResponse(429);
      }
      return { ok: true, status: 200, json: async () => ({ endpoint: url }) };
    });

    const broken = await fetchWithRetry('/broken', TEST_CFG, {
      fetchFn: httpSpy,
      sleep: noopSleep,
    });
    const healthy = await fetchWithRetry<{ endpoint: string }>('/healthy', TEST_CFG, {
      fetchFn: httpSpy,
      sleep: noopSleep,
    });

    expect(broken.ok).toBe(false);
    expect(healthy.ok).toBe(true);
    if (healthy.ok) {
      expect(healthy.data.endpoint).toContain('/healthy');
    }
  });
});
