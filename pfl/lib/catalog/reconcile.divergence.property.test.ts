import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { reconcile } from './reconcile';
import type { IndiceReverso } from './types';

// Feature: pfl-data-catalog, Property 8: Divergência de conciliação produz diferença exata

/**
 * Teste de propriedade de divergência exata da conciliação (Task 4.3).
 *
 * **Feature: pfl-data-catalog, Property 8: Divergência de conciliação produz diferença exata**
 *
 * **Validates: Requirements 4.4**
 *
 * Para qualquer divergência introduzida entre o conjunto gravado (derivado das
 * fichas) e o índice reverso de um `move_id`/`ability_id`, a conciliação reporta,
 * para aquele id, exatamente os `pokemon_id` presentes apenas na gravação
 * (`only_in_db`) e exatamente os presentes apenas no índice (`only_in_index`).
 *
 * Estratégia: para cada id, gera-se uma base de `pokemon_id` e, a partir dela,
 * um conjunto gravado e um conjunto de índice obtidos por adições/remoções
 * controladas. As diferenças de conjunto esperadas são calculadas de forma
 * independente da implementação (apenas com operações de conjunto) e comparadas,
 * ordenadas, com o que a conciliação reporta.
 */

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

const idArb = fc.integer({ min: 1, max: 200 });
const pokemonIdArb = fc.integer({ min: 1, max: 300 });

/**
 * Cenário por id: um conjunto base de `pokemon_id` e, derivados dele por
 * adições/remoções, o conjunto gravado (`db`) e o conjunto do índice (`index`).
 */
interface IdScenario {
  readonly id: number;
  readonly db: number[];
  readonly index: number[];
}

/** Gera um cenário divergente ou não para um id. */
const scenarioArb: fc.Arbitrary<IdScenario> = fc
  .record({
    id: idArb,
    base: fc.uniqueArray(pokemonIdArb, { maxLength: 12 }),
    // pokemon_ids presentes só na gravação (adicionados ao db).
    onlyDb: fc.uniqueArray(pokemonIdArb, { maxLength: 6 }),
    // pokemon_ids presentes só no índice (adicionados ao index).
    onlyIndex: fc.uniqueArray(pokemonIdArb, { maxLength: 6 }),
  })
  .map(({ id, base, onlyDb, onlyIndex }) => {
    const baseSet = new Set(base);
    // Garante disjunção: onlyDb e onlyIndex não compartilham a base nem entre si.
    const dbExtra = onlyDb.filter((p) => !baseSet.has(p));
    const dbExtraSet = new Set(dbExtra);
    const indexExtra = onlyIndex.filter(
      (p) => !baseSet.has(p) && !dbExtraSet.has(p),
    );

    const db = [...base, ...dbExtra];
    const index = [...base, ...indexExtra];
    return { id, db, index };
  });

/** Diferenças de conjunto esperadas, calculadas independentemente. */
function expectedDiff(scenario: IdScenario): {
  onlyInDb: number[];
  onlyInIndex: number[];
} {
  const dbSet = new Set(scenario.db);
  const indexSet = new Set(scenario.index);
  const onlyInDb = scenario.db
    .filter((p) => !indexSet.has(p))
    .sort((a, b) => a - b);
  const onlyInIndex = scenario.index
    .filter((p) => !dbSet.has(p))
    .sort((a, b) => a - b);
  return { onlyInDb, onlyInIndex };
}

// ---------------------------------------------------------------------------
// Propriedade
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Property 8: Divergência de conciliação produz diferença exata', () => {
  it('reporta por id exatamente only_in_db e only_in_index da divergência (R4.4)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(scenarioArb, {
          minLength: 1,
          maxLength: 20,
          selector: (s) => s.id,
        }),
        (scenarios) => {
          const derived = new Map<number, Set<number>>();
          const reverseIndex: IndiceReverso = {};
          for (const s of scenarios) {
            derived.set(s.id, new Set(s.db));
            reverseIndex[String(s.id)] = [...s.index];
          }

          const diffs = reconcile(derived, reverseIndex);

          // Resultado esperado: um ReconDiff por id com divergência real.
          const expected = scenarios
            .map((s) => ({ id: s.id, ...expectedDiff(s) }))
            .filter((e) => e.onlyInDb.length > 0 || e.onlyInIndex.length > 0)
            .sort((a, b) => a.id - b.id);

          // Mesmos ids divergentes, na mesma ordem.
          expect(diffs.map((d) => d.id)).toEqual(expected.map((e) => e.id));

          // Para cada id divergente, as diferenças são exatas.
          for (let i = 0; i < expected.length; i += 1) {
            expect(diffs[i]!.id).toBe(expected[i]!.id);
            expect(diffs[i]!.only_in_db).toEqual(expected[i]!.onlyInDb);
            expect(diffs[i]!.only_in_index).toEqual(expected[i]!.onlyInIndex);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isola a divergência ao id afetado, sem contaminar ids concordantes (R4.4)', () => {
    fc.assert(
      fc.property(
        // Um id concordante (db == index) e um id divergente garantido.
        fc.record({
          agreeId: fc.integer({ min: 1, max: 100 }),
          divergeId: fc.integer({ min: 101, max: 200 }),
          agreeSet: fc.uniqueArray(pokemonIdArb, { maxLength: 10 }),
          dbExclusive: fc.uniqueArray(pokemonIdArb, {
            minLength: 1,
            maxLength: 5,
          }),
          indexExclusive: fc.uniqueArray(pokemonIdArb, {
            minLength: 1,
            maxLength: 5,
          }),
        }),
        ({ agreeId, divergeId, agreeSet, dbExclusive, indexExclusive }) => {
          // Torna dbExclusive e indexExclusive disjuntos.
          const dbSet = new Set(dbExclusive);
          const idxExclusive = indexExclusive.filter((p) => !dbSet.has(p));
          // Exige que a divergência seja real neste cenário.
          fc.pre(dbExclusive.length > 0 || idxExclusive.length > 0);

          const derived = new Map<number, Set<number>>([
            [agreeId, new Set(agreeSet)],
            [divergeId, new Set(dbExclusive)],
          ]);
          const reverseIndex: IndiceReverso = {
            [String(agreeId)]: [...agreeSet],
            [String(divergeId)]: [...idxExclusive],
          };

          const diffs = reconcile(derived, reverseIndex);

          // O id concordante nunca aparece; apenas o divergente é reportado.
          expect(diffs.map((d) => d.id)).toEqual([divergeId]);
          expect(diffs[0]!.only_in_db).toEqual(
            [...dbExclusive].sort((a, b) => a - b),
          );
          expect(diffs[0]!.only_in_index).toEqual(
            [...idxExclusive].sort((a, b) => a - b),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reporta id presente só na gravação ou só no índice como divergência total (R4.4)', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: idArb,
          pokemons: fc.uniqueArray(pokemonIdArb, {
            minLength: 1,
            maxLength: 10,
          }),
          side: fc.constantFrom<'db' | 'index'>('db', 'index'),
        }),
        ({ id, pokemons, side }) => {
          const derived = new Map<number, Set<number>>();
          const reverseIndex: IndiceReverso = {};
          if (side === 'db') {
            derived.set(id, new Set(pokemons));
          } else {
            reverseIndex[String(id)] = [...pokemons];
          }

          const diffs = reconcile(derived, reverseIndex);
          const sorted = [...pokemons].sort((a, b) => a - b);

          expect(diffs).toHaveLength(1);
          expect(diffs[0]!.id).toBe(id);
          if (side === 'db') {
            expect(diffs[0]!.only_in_db).toEqual(sorted);
            expect(diffs[0]!.only_in_index).toEqual([]);
          } else {
            expect(diffs[0]!.only_in_db).toEqual([]);
            expect(diffs[0]!.only_in_index).toEqual(sorted);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
