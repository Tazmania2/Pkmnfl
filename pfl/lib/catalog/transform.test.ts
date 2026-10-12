// Feature: pfl-data-catalog, Property 9: Elegibilidade coincide com o conjunto permitido
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ALLOWED_IDS, isAllowed } from './transform';

/**
 * Teste de propriedade da elegibilidade de espécies (Task 3.2).
 *
 * **Feature: pfl-data-catalog, Property 9: Elegibilidade coincide com o conjunto permitido**
 *
 * _Validates: Requirements 6.1, 6.3_ (design.md Correctness Property 9).
 *
 * Property 9 tem duas facetas:
 *
 * 1. *Para todo* `pokemon_id`, `isAllowed(id)` é verdadeiro se e somente se o
 *    id pertence a `{1..151} \ {144,145,146,150,151}` (Req. 6.1).
 * 2. A cardinalidade de `ALLOWED_IDS` — o conjunto permitido do catálogo
 *    completo — é exatamente 146 (Req. 6.3).
 */

/**
 * Oráculo independente da regra de elegibilidade, escrito de forma distinta da
 * implementação sob teste (lista explícita de exclusões em vez de reuso do
 * predicado puro), para servir como referência da equivalência.
 */
function referenceIsAllowed(pokemonId: number): boolean {
  if (!Number.isInteger(pokemonId)) {
    return false;
  }
  const excluded =
    pokemonId === 144 ||
    pokemonId === 145 ||
    pokemonId === 146 ||
    pokemonId === 150 ||
    pokemonId === 151;
  return pokemonId >= 1 && pokemonId <= 151 && !excluded;
}

describe('Feature: pfl-data-catalog, Property 9: Elegibilidade coincide com o conjunto permitido', () => {
  it('isAllowed(id) ⇔ id ∈ {1..151} \\ {144,145,146,150,151} (R6.1)', () => {
    fc.assert(
      fc.property(
        // Faixa ampla cobrindo negativos, zero, o intervalo válido e > 151.
        fc.integer({ min: -1000, max: 1000 }),
        (pokemonId) => {
          expect(isAllowed(pokemonId)).toBe(referenceIsAllowed(pokemonId));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('pertinência a ALLOWED_IDS coincide com isAllowed para todo id (R6.1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (pokemonId) => {
        expect(ALLOWED_IDS.has(pokemonId)).toBe(isAllowed(pokemonId));
      }),
      { numRuns: 100 },
    );
  });

  it('a cardinalidade de ALLOWED_IDS para o catálogo completo é 146 (R6.3)', () => {
    expect(ALLOWED_IDS.size).toBe(146);
  });
});
