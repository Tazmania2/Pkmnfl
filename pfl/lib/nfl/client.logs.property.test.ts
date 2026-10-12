import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createSanitizedLogger,
  fetchWithRetry,
  sanitizeLogMessage,
  NFL_DEFAULT_BASE_DELAY_MS,
  NFL_DEFAULT_MAX_DELAY_MS,
  NFL_REDACTED_PLACEHOLDER,
  type FetchFn,
  type FetchResponseLike,
  type NflClientConfig,
  type NflLogger,
} from './client';

/**
 * Teste de propriedade de sanitização de logs do cliente NFL (Task 11.4).
 *
 * // Feature: pfl-data-catalog, Property 14: Logs nunca expõem a credencial
 *
 * **Validates: Requirements 9.6**
 *
 * Para qualquer valor de `Chave_API_NFL` (apiKey) e qualquer caminho de
 * execução que emita diagnóstico ou erro, nenhuma mensagem de log produzida
 * contém o valor da credencial. A verificação cobre tanto a função pura
 * {@link sanitizeLogMessage} e o {@link createSanitizedLogger} quanto o
 * caminho real de logging de {@link fetchWithRetry} (rate limit, erro HTTP,
 * timeout, erro de rede).
 */

/**
 * Gera valores de credencial arbitrários mas não vazios, incluindo caracteres
 * que teriam significado especial em regex (`.`, `*`, `+`, `?`, etc.) para
 * garantir que a sanitização literal cubra todos os formatos possíveis.
 *
 * Credenciais degeneradas que sejam substring do próprio marcador de redação
 * ({@link NFL_REDACTED_PLACEHOLDER}, ex.: a letra "R" de "REDACTED") são
 * excluídas: nesse caso o texto substituto reintroduziria o fragmento, o que
 * é um artefato do marcador e não um vazamento real da credencial. Chaves de
 * API reais são tokens longos e aleatórios, não caracteres isolados que
 * colidam com o marcador; o espaço de entrada relevante da propriedade é esse.
 */
const arbApiKey = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)
  .filter((s) => !NFL_REDACTED_PLACEHOLDER.includes(s));

/**
 * Monta uma mensagem arbitrária que pode (ou não) embutir a credencial em
 * posições quaisquer, simulando as diversas mensagens que o cliente poderia
 * produzir ao concatenar endpoints, status e detalhes de erro.
 */
function arbMessageEmbedding(apiKey: string): fc.Arbitrary<string> {
  return fc
    .array(fc.oneof(fc.string({ maxLength: 20 }), fc.constant(apiKey)), {
      maxLength: 8,
    })
    .map((parts) => parts.join(' '));
}

/** Configuração base de produção; `apiKey` é sobrescrita por teste. */
function makeConfig(apiKey: string): NflClientConfig {
  return {
    baseUrl: 'https://nfl.balldontlie.io',
    apiKey,
    timeoutMs: 30_000,
    maxRetries: 3,
    baseDelayMs: NFL_DEFAULT_BASE_DELAY_MS,
    maxDelayMs: NFL_DEFAULT_MAX_DELAY_MS,
  };
}

/** Logger que captura todas as mensagens emitidas, sem sanitizar. */
function makeCapturingSink(): { sink: NflLogger; messages: string[] } {
  const messages: string[] = [];
  const sink: NflLogger = {
    info: (m) => messages.push(m),
    warn: (m) => messages.push(m),
    error: (m) => messages.push(m),
  };
  return { sink, messages };
}

/** `sleep` instantâneo para evitar esperas reais de backoff nos testes. */
const noSleep = (): Promise<void> => Promise.resolve();

describe('Feature: pfl-data-catalog, Property 14: Logs nunca expõem a credencial', () => {
  it('sanitizeLogMessage remove toda ocorrência da credencial (R9.6)', () => {
    fc.assert(
      fc.property(
        arbApiKey.chain((apiKey) =>
          arbMessageEmbedding(apiKey).map((message) => ({ apiKey, message })),
        ),
        ({ apiKey, message }) => {
          const sanitized = sanitizeLogMessage(message, apiKey);
          expect(sanitized.includes(apiKey)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('createSanitizedLogger nunca emite a credencial em info/warn/error (R9.6)', () => {
    fc.assert(
      fc.property(
        arbApiKey.chain((apiKey) =>
          arbMessageEmbedding(apiKey).map((message) => ({ apiKey, message })),
        ),
        ({ apiKey, message }) => {
          const { sink, messages } = makeCapturingSink();
          const logger = createSanitizedLogger(apiKey, sink);
          logger.info(message);
          logger.warn(message);
          logger.error(message);
          for (const emitted of messages) {
            expect(emitted.includes(apiKey)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fetchWithRetry nunca registra a credencial em nenhum caminho de execução (R9.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbApiKey,
        // 0: rate limit (429, repetível até esgotar) | 1: erro HTTP definitivo
        // 2: timeout (AbortError) | 3: erro de rede
        fc.integer({ min: 0, max: 3 }),
        async (apiKey, pathKind) => {
          const cfg = makeConfig(apiKey);
          const { sink, messages } = makeCapturingSink();
          // Logger sanitizado real (padrão de produção), com sink capturado.
          const logger = createSanitizedLogger(cfg.apiKey, sink);

          const fetchFn: FetchFn = async () => {
            switch (pathKind) {
              case 0:
                return rateLimitResponse();
              case 1:
                return httpErrorResponse();
              case 2: {
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
              }
              default:
                throw new Error('network down');
            }
          };

          const outcome = await fetchWithRetry(
            // endpoint arbitrário, incluindo a credencial para forçar o pior caso
            `/resource?token=${apiKey}`,
            cfg,
            { fetchFn, sleep: noSleep, logger },
          );

          expect(outcome.ok).toBe(false);
          // Nenhuma mensagem emitida pode conter o valor da credencial,
          // mesmo quando o endpoint embute a própria chave.
          for (const emitted of messages) {
            expect(emitted.includes(apiKey)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** Resposta simulada de rate limit (429). */
function rateLimitResponse(): FetchResponseLike {
  return {
    ok: false,
    status: 429,
    json: () => Promise.resolve({}),
  };
}

/** Resposta simulada de erro HTTP definitivo (503). */
function httpErrorResponse(): FetchResponseLike {
  return {
    ok: false,
    status: 503,
    json: () => Promise.resolve({}),
  };
}
