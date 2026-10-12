import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { reconcile } from './reconcile';
import type { IndiceReverso } from './types';

// Feature: pfl-data-catalog, Property 7: Conciliação é igualdade de conjuntos

/**
 * Teste de propriedade da conciliação como igualdade de conjuntos (Task 4.2).
 *
 * **Feature: pfl-data-catalog, Property 7: Conciliação é igualdade de conjuntos**
 *
 * _Validates: Requirements 4.3, 5.3_
 *
 * Para todo `move_id` (e todo `ability_id`), quando as fichas (gravação
 * derivada, `derived`) e o índice reverso correspondente (`reverseIndex`)
 * derivam da **mesma fonte**, o conjunto de `pokemon_id` gravados é igual ao
 * conjunto declarado no índice reverso e, portanto, a conciliação não reporta
 * divergência: `reconcile(derived, reverseIndex)` retorna `[]`.
 */

/**
 * Fonte comum: um mapa `id → conjunto de pokemon_id`. Tanto a gravação derivada
 * (`derived`) quanto o índice reverso (`reverseIndex`) são projetados a partir
 * desta mesma estrutura, modelando a hipótese "derivam da mesma fonte".
 */
type SourceEntry = { id: number; pokemonIds: number[] };

/**
 * Gera uma fonte de relações: uma lista de ids distintos, cada um associado a
 * um conjunto (possivelmente vazio) de `pokemon_id`. Ids e pokemon_ids são
 * inteiros positivos, condizentes com `move_id`/`ability_id`/`pokemon_id`.
 */
const sourceArbitrary = fc
  .uniqueArray(fc.integer({ min: 1, max: 1000 }), { maxLength: 30 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc
          .uniqueArray(fc.integer({ min: 1, max: 151 }), { maxLength: 20 })
          .map((pokemonIds): SourceEntry => ({ id, pokemonIds })),
      ),
    ),
  );

/** Projeta a fonte comum na gravação derivada (`Map<number, Set<number>>`). */
function toDerived(source: SourceEntry[]): Map<number, Set<number>> {
  const derived = new Map<number, Set<number>>();
  for (const { id, pokemonIds } of source) {
    derived.set(id, new Set(pokemonIds));
  }
  return derived;
}

/** Projeta a mesma fonte comum no índice reverso (`IndiceReverso`). */
function toReverseIndex(source: SourceEntry[]): IndiceReverso {
  const index: IndiceReverso = {};
  for (const { id, pokemonIds } of source) {
    // A ordem no índice pode diferir da gravação; conciliação é por conjunto.
    index[String(id)] = [...pokemonIds].reverse();
  }
  return index;
}

describe('Feature: pfl-data-catalog, Property 7: Conciliação é igualdade de conjuntos', () => {
  it('reconcile(derived, reverseIndex) === [] quando ambos derivam da mesma fonte (R4.3, R5.3)', () => {
    fc.assert(
      fc.property(sourceArbitrary, (source) => {
        const derived = toDerived(source);
        const reverseIndex = toReverseIndex(source);

        expect(reconcile(derived, reverseIndex)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
