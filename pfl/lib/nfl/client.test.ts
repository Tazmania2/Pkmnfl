import { describe, expect, it, vi } from 'vitest';

import {
  createSanitizedLogger,
  fetchWithRetry,
  loadNflClientConfig,
  MissingNflApiKeyError,
  NFL_DEFAULT_BASE_URL,
  NFL_ENV_VARS,
  NFL_REDACTED_PLACEHOLDER,
  sanitizeLogMessage,
  type FetchFn,
  type FetchResponseLike,
  type NflClientConfig,
  type NflLogger,
} from './client';

/**
 * Testes de exemplo/edge para `fetchWithRetry` e o logger sanitizado
 * (Task 11.3).
 *
 * _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_
 *
 * Os testes injetam `fetchFn`, `sleep` e `logger` para evitar I/O real e
 * esperas de tempo reais, exercitando sucesso, rate limit, timeout, rede,
 * erro HTTP definitivo e a confidencialidade da credencial.
 */

/** Configuração de teste com delays pequenos (o sleep real é substituído). */
const TEST_CFG: NflClientConfig = {
  baseUrl: NFL_DEFAULT_BASE_URL,
  apiKey: 'secret-key-123',
  timeoutMs: 30_000,
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/** Resposta bem-sucedida com um corpo JSON. */
function okResponse(body: unknown): FetchResponseLike {
  return { ok: true, status: 200, json: async () => body };
}

/** Resposta de status arbitrário sem corpo relevante. */
function statusResponse(status: number): FetchResponseLike {
  return { ok: false, status, json: async () => ({}) };
}

/** Sleep que resolve imediatamente, registrando os delays solicitados. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

describe('fetchWithRetry — guarda de credencial (R9.2)', () => {
  it('lança MissingNflApiKeyError sem realizar requisições quando a key é vazia', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const cfg = { ...TEST_CFG, apiKey: '' };

    await expect(fetchWithRetry('/pokemon', cfg, { fetchFn })).rejects.toBeInstanceOf(
      MissingNflApiKeyError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('trata key só com espaços como ausente e nomeia a env var faltante', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const cfg = { ...TEST_CFG, apiKey: '   ' };

    await expect(fetchWithRetry('/pokemon', cfg, { fetchFn })).rejects.toMatchObject({
      missing: NFL_ENV_VARS.API_KEY,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('fetchWithRetry — sucesso e cabeçalho de autorização (R9.4)', () => {
  it('retorna { ok:true, data } em 200 e envia Authorization Bearer', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(okResponse({ hello: 'world' }));

    const outcome = await fetchWithRetry<{ hello: string }>('/pokemon', TEST_CFG, {
      fetchFn,
    });

    expect(outcome).toEqual({ ok: true, data: { hello: 'world' } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const call = fetchFn.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![1].headers.Authorization).toBe('Bearer secret-key-123');
  });

  it('resolve URL relativa contra a baseUrl', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(okResponse({}));

    await fetchWithRetry('/teams', TEST_CFG, { fetchFn });

    const call = fetchFn.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toBe(`${NFL_DEFAULT_BASE_URL}/teams`);
  });
});

describe('fetchWithRetry — retry em 429 com backoff (R9.3)', () => {
  it('repete até 5 vezes e, ao esgotar, retorna ok:false com reason rate_limit', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(statusResponse(429));
    const { sleep, delays } = recordingSleep();

    const outcome = await fetchWithRetry('/matchups', TEST_CFG, { fetchFn, sleep });

    expect(outcome).toEqual({
      ok: false,
      endpoint: '/matchups',
      reason: 'rate_limit',
      attempts: 5,
    });
    expect(fetchFn).toHaveBeenCalledTimes(5);
    // Backoff entre tentativas: 1s, 2s, 4s, 8s (4 esperas entre 5 tentativas).
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('recupera quando um 429 é seguido de 200', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(statusResponse(429))
      .mockResolvedValueOnce(okResponse({ ok: 1 }));
    const { sleep, delays } = recordingSleep();

    const outcome = await fetchWithRetry<{ ok: number }>('/matchups', TEST_CFG, {
      fetchFn,
      sleep,
    });

    expect(outcome).toEqual({ ok: true, data: { ok: 1 } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1_000]);
  });
});

describe('fetchWithRetry — timeout e erro de rede (R9.4)', () => {
  it('classifica abort como timeout e repete até esgotar', async () => {
    const fetchFn = vi.fn<FetchFn>().mockImplementation(async (_url, init) => {
      // Simula o abort disparado pelo AbortController.
      const err = new Error('aborted');
      err.name = 'AbortError';
      // Marca o signal como abortado via o próprio controller não é possível
      // aqui, então lançamos AbortError que o classificador reconhece.
      void init;
      throw err;
    });
    const { sleep } = recordingSleep();

    const outcome = await fetchWithRetry('/stats', TEST_CFG, { fetchFn, sleep });

    expect(outcome).toEqual({
      ok: false,
      endpoint: '/stats',
      reason: 'timeout',
      attempts: 5,
    });
  });

  it('classifica erro genérico como network', async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new Error('ECONNRESET'));
    const { sleep } = recordingSleep();

    const outcome = await fetchWithRetry('/stats', TEST_CFG, { fetchFn, sleep });

    expect(outcome).toMatchObject({ ok: false, reason: 'network', attempts: 5 });
  });
});

describe('fetchWithRetry — erro HTTP definitivo (R9.5)', () => {
  it('não repete em 4xx/5xx que não seja 429', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(statusResponse(500));
    const { sleep, delays } = recordingSleep();

    const outcome = await fetchWithRetry('/broken', TEST_CFG, { fetchFn, sleep });

    expect(outcome).toEqual({
      ok: false,
      endpoint: '/broken',
      reason: 'http_error',
      attempts: 1,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});

describe('sanitizeLogMessage / createSanitizedLogger — confidencialidade (R9.6)', () => {
  it('remove toda ocorrência do valor da credencial da mensagem', () => {
    const msg = 'falha com key=secret-key-123 e novamente secret-key-123';
    const sanitized = sanitizeLogMessage(msg, 'secret-key-123');

    expect(sanitized).not.toContain('secret-key-123');
    expect(sanitized).toBe(
      `falha com key=${NFL_REDACTED_PLACEHOLDER} e novamente ${NFL_REDACTED_PLACEHOLDER}`,
    );
  });

  it('não altera a mensagem quando a key é vazia', () => {
    expect(sanitizeLogMessage('sem credencial aqui', '')).toBe('sem credencial aqui');
  });

  it('o logger sanitizado jamais emite o valor da credencial', () => {
    const captured: string[] = [];
    const sink: NflLogger = {
      info: (m) => captured.push(m),
      warn: (m) => captured.push(m),
      error: (m) => captured.push(m),
    };
    const logger = createSanitizedLogger('secret-key-123', sink);

    logger.info('info com secret-key-123');
    logger.warn('warn com secret-key-123');
    logger.error('error com secret-key-123');

    expect(captured).toHaveLength(3);
    for (const line of captured) {
      expect(line).not.toContain('secret-key-123');
      expect(line).toContain(NFL_REDACTED_PLACEHOLDER);
    }
  });

  it('o logger padrão de fetchWithRetry não vaza a key nos avisos de retry', async () => {
    const captured: string[] = [];
    const sink: NflLogger = {
      info: (m) => captured.push(m),
      warn: (m) => captured.push(m),
      error: (m) => captured.push(m),
    };
    const logger = createSanitizedLogger(TEST_CFG.apiKey, sink);
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(statusResponse(429));
    const { sleep } = recordingSleep();

    await fetchWithRetry('/matchups', TEST_CFG, { fetchFn, sleep, logger });

    expect(captured.length).toBeGreaterThan(0);
    for (const line of captured) {
      expect(line).not.toContain(TEST_CFG.apiKey);
    }
  });
});

describe('loadNflClientConfig — integração com fetchWithRetry (R9.1, R9.2)', () => {
  it('mantém MissingNflApiKeyError quando a env var está ausente', () => {
    const original = process.env[NFL_ENV_VARS.API_KEY];
    delete process.env[NFL_ENV_VARS.API_KEY];
    try {
      expect(() => loadNflClientConfig()).toThrow(MissingNflApiKeyError);
    } finally {
      if (original !== undefined) {
        process.env[NFL_ENV_VARS.API_KEY] = original;
      }
    }
  });
});
