import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  computeBackoffDelay,
  NFL_DEFAULT_BASE_DELAY_MS,
  NFL_DEFAULT_MAX_DELAY_MS,
  type NflClientConfig,
} from './client';

/**
 * Teste de propriedade do backoff exponencial limitado do cliente NFL
 * (Task 11.2).
 *
 * // Feature: pfl-data-catalog, Property 13: Backoff exponencial limitado
 *
 * **Validates: Requirements 9.3, 9.4**
 *
 * Para toda tentativa `n` em 1..5, o atraso aplicado antes da repetição é
 * `min(30000ms, 1000ms * 2^(n-1))`, com atraso base de 1000ms e teto de
 * 30000ms (R9.3, R9.4). A mesma política vale para rate limit, timeout e erro
 * de rede, portanto depende apenas de `n` e da configuração de atraso.
 */

/**
 * Configuração base com os padrões de produção da política de backoff
 * (`base = 1000ms`, `teto = 30000ms`). Os demais campos são irrelevantes para
 * {@link computeBackoffDelay} e recebem valores de preenchimento.
 */
const DEFAULT_CFG: NflClientConfig = {
  baseUrl: 'https://nfl.balldontlie.io',
  apiKey: 'test-key',
  timeoutMs: 30_000,
  maxRetries: 5,
  baseDelayMs: NFL_DEFAULT_BASE_DELAY_MS,
  maxDelayMs: NFL_DEFAULT_MAX_DELAY_MS,
};

/**
 * Oráculo independente da fórmula de backoff, escrito de forma distinta da
 * implementação sob teste, para servir de referência da equivalência.
 */
function referenceBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const n = attempt < 1 ? 1 : Math.floor(attempt);
  const exponential = baseDelayMs * Math.pow(2, n - 1);
  return exponential > maxDelayMs ? maxDelayMs : exponential;
}

describe('Feature: pfl-data-catalog, Property 13: Backoff exponencial limitado', () => {
  it('delay(n) = min(30000, 1000 * 2^(n-1)) para n em 1..5 (R9.3, R9.4)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        const expected = Math.min(
          NFL_DEFAULT_MAX_DELAY_MS,
          NFL_DEFAULT_BASE_DELAY_MS * 2 ** (n - 1),
        );
        expect(computeBackoffDelay(n, DEFAULT_CFG)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('nunca excede o teto de 30000ms para n em 1..5 (R9.4)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        const delay = computeBackoffDelay(n, DEFAULT_CFG);
        expect(delay).toBeLessThanOrEqual(NFL_DEFAULT_MAX_DELAY_MS);
        expect(delay).toBeGreaterThanOrEqual(NFL_DEFAULT_BASE_DELAY_MS);
      }),
      { numRuns: 100 },
    );
  });

  it('coincide com o oráculo para qualquer base/teto e n em 1..5 (R9.3, R9.4)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        (n, baseDelayMs, maxDelayMs) => {
          const cfg: NflClientConfig = {
            ...DEFAULT_CFG,
            baseDelayMs,
            maxDelayMs,
          };
          expect(computeBackoffDelay(n, cfg)).toBe(
            referenceBackoff(n, baseDelayMs, maxDelayMs),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('corresponde à sequência esperada 1s, 2s, 4s, 8s, 16s (R9.3)', () => {
    const expectedSequence = [1_000, 2_000, 4_000, 8_000, 16_000];
    for (let n = 1; n <= 5; n++) {
      expect(computeBackoffDelay(n, DEFAULT_CFG)).toBe(expectedSequence[n - 1]);
    }
  });
});
