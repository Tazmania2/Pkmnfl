import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isAllowedSpecies } from './allowed-species';

/**
 * Teste de propriedade do predicado de Especies_Permitidas (Task 8.2).
 *
 * **Feature: pfl-foundation, Property 1: Equivalência do conjunto de espécies permitidas**
 *
 * _Validates: Requirements 6.5_ (decisão D-4, Correctness Property P-1).
 *
 * Para todo `pokemon_id` inteiro, o predicado deve retornar verdadeiro se e
 * somente se `1 ≤ pokemon_id ≤ 151` e `pokemon_id ∉ {144,145,146,150,151}`.
 */

/**
 * Referência independente da regra, escrita de forma distinta da
 * implementação sob teste (lista explícita em vez de Set), para servir como
 * oráculo da equivalência.
 */
function referenceIsAllowed(pokemonId: number): boolean {
  if (!Number.isInteger(pokemonId)) {
    return false;
  }
  const excluded = pokemonId === 144 ||
    pokemonId === 145 ||
    pokemonId === 146 ||
    pokemonId === 150 ||
    pokemonId === 151;
  return pokemonId >= 1 && pokemonId <= 151 && !excluded;
}

describe('Feature: pfl-foundation, Property 1: Equivalência do conjunto de espécies permitidas', () => {
  it('isAllowedSpecies(id) ⇔ 1 ≤ id ≤ 151 ∧ id ∉ {144,145,146,150,151} (R6.5)', () => {
    fc.assert(
      fc.property(
        // Faixa ampla cobrindo negativos, zero, o intervalo válido e > 151.
        fc.integer({ min: -1000, max: 1000 }),
        (pokemonId) => {
          expect(isAllowedSpecies(pokemonId)).toBe(
            referenceIsAllowed(pokemonId),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejeita valores não-inteiros (NaN e frações)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc
            .double({ noDefaultInfinity: true, noNaN: true })
            .filter((n) => !Number.isInteger(n)),
          fc.constant(Number.NaN),
        ),
        (value) => {
          expect(isAllowedSpecies(value)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
