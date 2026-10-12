import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  getAvailableAbilities,
  getLearnableMoveIds,
  type AvailableAbility,
} from './eligibility';

/**
 * Teste de propriedade da projeção de elegibilidade por espécie permitida
 * (Task 13.4).
 *
 * // Feature: pfl-data-catalog, Property 17: Projeção de elegibilidade por espécie permitida
 *
 * **Validates: Requirements 12.2, 12.3**
 *
 * *Para toda* espécie com `is_allowed = true`, a `Camada_Leitura` retorna
 * exatamente o conjunto de `move_id` de suas relações de golpe aprendível
 * (`getLearnableMoveIds`) e exatamente o conjunto de `ability_id` (com o
 * respectivo `is_hidden`) de suas relações de habilidade disponível
 * (`getAvailableAbilities`).
 *
 * Como corolário da semântica de presença/ausência (R12.6), uma espécie com
 * `is_allowed = false` ou um `pokemon_id` inexistente produz `{ found: false }`
 * em ambas as consultas.
 *
 * A propriedade injeta um dublê em memória do cliente Supabase via
 * `deps.client`, suportando apenas as três cadeias exercidas por
 * `eligibility.ts`:
 * - `from('species').select(...).eq('pokemon_id', id).maybeSingle()`
 * - `from('pokemon_learnable_moves').select('move_id').eq('pokemon_id', id)`
 * - `from('pokemon_abilities').select('ability_id, is_hidden').eq('pokemon_id', id)`
 * Nenhum I/O real é realizado.
 */

/** Linha de espécie mantida pelo repositório em memória. */
interface FakeSpeciesRow {
  readonly pokemon_id: number;
  readonly is_allowed: boolean;
}

/** Par (pokemon_id, move_id) da relação de golpes aprendíveis. */
interface FakeLearnableMoveRow {
  readonly pokemon_id: number;
  readonly move_id: number;
}

/** Par de habilidade disponível por espécie. */
interface FakePokemonAbilityRow {
  readonly pokemon_id: number;
  readonly ability_id: number;
  readonly is_hidden: boolean;
}

/** Mundo gerado: espécies + relações consistentes com elas. */
interface World {
  readonly species: FakeSpeciesRow[];
  readonly learnableMoves: FakeLearnableMoveRow[];
  readonly pokemonAbilities: FakePokemonAbilityRow[];
}

/**
 * Dublê em memória do cliente Supabase. Modela as três cadeias de leitura
 * usadas por `eligibility.ts`, filtrando as linhas por `pokemon_id` e,
 * para `species`, respondendo `maybeSingle` com a primeira correspondência
 * (ou `null`). Sempre devolve `error: null`.
 */
function createInMemoryClient(world: World) {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, id: number) {
              if (table === 'species') {
                const match =
                  world.species.find((s) => s.pokemon_id === id) ?? null;
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: match
                        ? { pokemon_id: match.pokemon_id, is_allowed: match.is_allowed }
                        : null,
                      error: null,
                    });
                  },
                };
              }

              if (table === 'pokemon_learnable_moves') {
                const data = world.learnableMoves
                  .filter((r) => r.pokemon_id === id)
                  .map((r) => ({ move_id: r.move_id }));
                return Promise.resolve({ data, error: null });
              }

              if (table === 'pokemon_abilities') {
                const data = world.pokemonAbilities
                  .filter((r) => r.pokemon_id === id)
                  .map((r) => ({ ability_id: r.ability_id, is_hidden: r.is_hidden }));
                return Promise.resolve({ data, error: null });
              }

              throw new Error(`tabela inesperada na leitura: ${table}`);
            },
          };
        },
      };
    },
  };
}

/**
 * Oráculo independente: conjunto esperado de `move_id` de uma espécie,
 * deduplicado preservando a ordem de primeira aparição (como a implementação).
 */
function expectedMoveIds(world: World, pokemonId: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of world.learnableMoves) {
    if (r.pokemon_id === pokemonId && !seen.has(r.move_id)) {
      seen.add(r.move_id);
      out.push(r.move_id);
    }
  }
  return out;
}

/**
 * Oráculo independente: conjunto esperado de habilidades de uma espécie,
 * deduplicado por `ability_id` preservando a ordem de primeira aparição.
 */
function expectedAbilities(world: World, pokemonId: number): AvailableAbility[] {
  const seen = new Set<number>();
  const out: AvailableAbility[] = [];
  for (const r of world.pokemonAbilities) {
    if (r.pokemon_id === pokemonId && !seen.has(r.ability_id)) {
      seen.add(r.ability_id);
      out.push({ ability_id: r.ability_id, is_hidden: r.is_hidden === true });
    }
  }
  return out;
}

/**
 * Gera um mundo coerente: um conjunto de espécies (permitidas ou não) e
 * relações cujos `pokemon_id` provêm desse conjunto. As relações podem
 * conter pares duplicados (para exercitar a deduplicação) e podem apontar
 * para espécies permitidas ou não.
 */
function worldArb(): fc.Arbitrary<World> {
  const pokemonIdArb = fc.integer({ min: 1, max: 151 });

  return fc
    .uniqueArray(
      fc.record({
        pokemon_id: pokemonIdArb,
        is_allowed: fc.boolean(),
      }),
      { selector: (s) => s.pokemon_id, minLength: 1, maxLength: 12 },
    )
    .chain((species) => {
      const idArb = fc.constantFrom(...species.map((s) => s.pokemon_id));

      const learnableMovesArb = fc.array(
        fc.record({
          pokemon_id: idArb,
          move_id: fc.integer({ min: 1, max: 50 }),
        }),
        { maxLength: 30 },
      );

      const pokemonAbilitiesArb = fc.array(
        fc.record({
          pokemon_id: idArb,
          ability_id: fc.integer({ min: 1, max: 20 }),
          is_hidden: fc.boolean(),
        }),
        { maxLength: 20 },
      );

      return fc.record({
        species: fc.constant(species),
        learnableMoves: learnableMovesArb,
        pokemonAbilities: pokemonAbilitiesArb,
      });
    });
}

describe('Feature: pfl-data-catalog, Property 17: Projeção de elegibilidade por espécie permitida', () => {
  it('espécie permitida projeta exatamente seus move_id e abilities (R12.2, R12.3)', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb(), async (world) => {
        const client = createInMemoryClient(world);

        for (const sp of world.species) {
          const movesResult = await getLearnableMoveIds(sp.pokemon_id, {
            client: client as never,
          });
          const abilitiesResult = await getAvailableAbilities(sp.pokemon_id, {
            client: client as never,
          });

          if (sp.is_allowed) {
            // Espécie permitida: projeção exata (R12.2, R12.3).
            expect(movesResult.found).toBe(true);
            expect(abilitiesResult.found).toBe(true);
            if (movesResult.found) {
              // Conjunto deduplicado, ordem de primeira aparição.
              expect(movesResult.value).toEqual(
                expectedMoveIds(world, sp.pokemon_id),
              );
              // Igualdade de conjuntos (independente da ordem).
              expect([...movesResult.value].sort((a, b) => a - b)).toEqual(
                [...new Set(expectedMoveIds(world, sp.pokemon_id))].sort(
                  (a, b) => a - b,
                ),
              );
            }
            if (abilitiesResult.found) {
              expect(abilitiesResult.value).toEqual(
                expectedAbilities(world, sp.pokemon_id),
              );
            }
          } else {
            // Espécie não permitida: ausência em ambas as consultas (R12.6).
            expect(movesResult.found).toBe(false);
            expect(abilitiesResult.found).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('pokemon_id inexistente retorna found:false em ambas as consultas (R12.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        worldArb(),
        fc.integer({ min: 200, max: 999 }),
        async (world, missingId) => {
          // `missingId` está fora do intervalo 1..151 usado pelos geradores,
          // logo nunca existe no mundo.
          const client = createInMemoryClient(world);

          const movesResult = await getLearnableMoveIds(missingId, {
            client: client as never,
          });
          const abilitiesResult = await getAvailableAbilities(missingId, {
            client: client as never,
          });

          expect(movesResult.found).toBe(false);
          expect(abilitiesResult.found).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
