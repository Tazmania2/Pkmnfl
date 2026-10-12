import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { gerarSeedRng, parseSeedRng } from './seed-rng';

/**
 * Testes unitários e de propriedade de geração/validação do `Seed_RNG`
 * (`lib/match/seed-rng.ts`) — spec `pfl-gameday-result-ui`, Task 2.4.
 *
 * Cobrem a faixa uint64, os limites `0` e `2^64 − 1`, e a rejeição de entradas
 * inválidas (vazia, só espaços, negativa, com sinal, overflow, não numérica,
 * ponto flutuante, notação científica, hexadecimal e zeros à esquerda).
 *
 * **Validates: Requirements 6.2**
 */

/** `2^64 − 1` como string decimal canônica (uint64 máximo). */
const UINT64_MAX_STR = '18446744073709551615';
/** `2^64` — primeiro valor acima do teto (overflow). */
const UINT64_OVERFLOW_STR = '18446744073709551616';
/** `2^64 − 1` como `bigint`, para checagem de faixa. */
const UINT64_MAX = (1n << 64n) - 1n;

describe('parseSeedRng', () => {
  describe('aceita decimais canônicos dentro da faixa uint64', () => {
    it('aceita o limite inferior "0"', () => {
      expect(parseSeedRng('0')).toBe('0');
    });

    it('aceita o limite superior 2^64 − 1', () => {
      expect(parseSeedRng(UINT64_MAX_STR)).toBe(UINT64_MAX_STR);
    });

    it('aceita um valor intermediário canônico', () => {
      expect(parseSeedRng('42')).toBe('42');
    });

    it('aceita um valor próximo ao teto (2^64 − 2)', () => {
      const quaseTeto = (UINT64_MAX - 1n).toString(10);
      expect(parseSeedRng(quaseTeto)).toBe(quaseTeto);
    });
  });

  describe('rejeita (null) entradas inválidas', () => {
    it('rejeita string vazia', () => {
      expect(parseSeedRng('')).toBeNull();
    });

    it('rejeita string só com espaços', () => {
      expect(parseSeedRng('  ')).toBeNull();
    });

    it('rejeita valor negativo "-1"', () => {
      expect(parseSeedRng('-1')).toBeNull();
    });

    it('rejeita sinal explícito "+5"', () => {
      expect(parseSeedRng('+5')).toBeNull();
    });

    it('rejeita overflow acima de 2^64 − 1', () => {
      expect(parseSeedRng(UINT64_OVERFLOW_STR)).toBeNull();
    });

    it('rejeita não numérico "abc"', () => {
      expect(parseSeedRng('abc')).toBeNull();
    });

    it('rejeita ponto flutuante "1.5"', () => {
      expect(parseSeedRng('1.5')).toBeNull();
    });

    it('rejeita notação científica "1e3"', () => {
      expect(parseSeedRng('1e3')).toBeNull();
    });

    it('rejeita hexadecimal "0x10"', () => {
      expect(parseSeedRng('0x10')).toBeNull();
    });

    it('rejeita zeros à esquerda "007"', () => {
      expect(parseSeedRng('007')).toBeNull();
    });

    it('rejeita espaços internos "12 34"', () => {
      expect(parseSeedRng('12 34')).toBeNull();
    });

    it('rejeita espaços nas bordas " 5 "', () => {
      expect(parseSeedRng(' 5 ')).toBeNull();
    });
  });
});

describe('gerarSeedRng', () => {
  it('retorna uma string decimal que parseSeedRng aceita (round-trip)', () => {
    const seed = gerarSeedRng();
    expect(typeof seed).toBe('string');
    expect(parseSeedRng(seed)).toBe(seed);
  });

  it('retorna um valor dentro da faixa uint64 [0, 2^64 − 1]', () => {
    const valor = BigInt(gerarSeedRng());
    expect(valor >= 0n).toBe(true);
    expect(valor <= UINT64_MAX).toBe(true);
  });

  it('produz valores em faixa ao longo de muitas chamadas', () => {
    for (let i = 0; i < 1000; i += 1) {
      const seed = gerarSeedRng();
      // Forma canônica aceita pela validação.
      expect(parseSeedRng(seed)).toBe(seed);
      // Dentro da faixa uint64 (BigInt preserva o valor exato).
      const valor = BigInt(seed);
      expect(valor >= 0n && valor <= UINT64_MAX).toBe(true);
    }
  });
});

describe('propriedade de round-trip de geração', () => {
  it('todo Seed_RNG gerado é revalidado por parseSeedRng e fica em faixa', () => {
    // Propriedade: `gerarSeedRng()` sempre produz um decimal canônico em
    // [0, 2^64 − 1] que `parseSeedRng` aceita idempotentemente.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 }), () => {
        const seed = gerarSeedRng();
        const valor = BigInt(seed);
        return (
          parseSeedRng(seed) === seed &&
          valor >= 0n &&
          valor <= UINT64_MAX
        );
      }),
      { numRuns: 500 },
    );
  });

  it('todo decimal canônico em faixa é aceito e devolvido inalterado', () => {
    // Propriedade dual sobre `parseSeedRng`: qualquer uint64 serializado de
    // forma canônica é aceito e retornado idêntico.
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: UINT64_MAX }), (valor) => {
        const canonico = valor.toString(10);
        return parseSeedRng(canonico) === canonico;
      }),
      { numRuns: 500 },
    );
  });
});
