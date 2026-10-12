import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `writer.ts` e `persist.ts` iniciam com `import 'server-only'`, que lança
 * fora de um contexto de servidor Next/RSC. Sob Vitest esse contexto não
 * existe, então neutralizamos a guarda de importação com um stub vazio — sem
 * alterar o comportamento sob teste, que recebe um cliente injetado via
 * `deps.client`.
 */
vi.mock('server-only', () => ({}));

import {
  ABILITIES_CONFLICT_TARGET,
  DESIGN_BASELINE_CONFLICT_TARGET,
  LEARNABLE_MOVES_CONFLICT_TARGET,
  MOVES_CONFLICT_TARGET,
  POKEMON_ABILITIES_CONFLICT_TARGET,
  SPECIES_CONFLICT_TARGET,
  upsertAbilities,
  upsertDesignBaseline,
  upsertLearnableMoves,
  upsertMoves,
  upsertPokemonAbilities,
  upsertSpecies,
} from './writer';
import type {
  AbilityRow,
  DesignBaselineRow,
  LearnableMoveRow,
  MoveRow,
  PokemonAbilityRow,
  SpeciesRow,
} from './types';
import {
  NFL_MATCHUP_CONFLICT_TARGET,
  upsertNflMatchups,
} from '../nfl/persist';
import type { NflMatchupRow } from '../nfl/types';

/**
 * Property test de idempotência do upsert (Task 5.4).
 *
 * // Feature: pfl-data-catalog, Property 6: Idempotência do upsert
 *
 * **Validates: Requirements 7.2, 7.3, 10.3, 11.4**
 *
 * Para qualquer conjunto de registros e qualquer tabela com chave de
 * conciliação (`move_id`, `ability_id`, `pokemon_id`, par de relação
 * `(pokemon_id, move_id)`/`(pokemon_id, ability_id)`, `natural_key` do NFL,
 * `(version, kind)` do baseline), aplicar o upsert uma vez e aplicá-lo N
 * vezes (N arbitrário >= 2) produz o mesmo estado final, campo a campo, e
 * preserva as contagens-alvo sem criar duplicatas.
 *
 * A propriedade usa um repositório em memória (dublê do cliente Supabase)
 * cujo *store* é indexado exatamente pela chave de `ON CONFLICT` de cada
 * escrita — espelhando a semântica de PK/chave natural do banco. Como a
 * última escrita de uma mesma chave sobrescreve a anterior, aplicar 1x e Nx
 * convergem para o mesmo *snapshot*: igualdade de tamanho (sem duplicatas) e
 * igualdade registro a registro.
 */

// ---------------------------------------------------------------------------
// Fake de Supabase em memória, keyed pelo conflict target.
//
// Suporta as duas cadeias exercidas pelos escritores:
//  - escrita:  from(table).upsert(rows,{onConflict}).select(target)
//  - leitura:  from(table).select(col).in(col, values)  (ids base de FK)
//
// Cada `upsert` grava por chave composta derivada de `onConflict`, de modo que
// reaplicar o mesmo registro atualiza em vez de duplicar — exatamente como a
// restrição UNIQUE/PK do banco.
// ---------------------------------------------------------------------------

function keyOf(onConflict: string, row: Record<string, unknown>): string {
  return onConflict
    .split(',')
    .map((c) => String(row[c]))
    .join('::');
}

function makeFakeClient(baseIds?: {
  readonly species?: ReadonlySet<number>;
  readonly moves?: ReadonlySet<number>;
  readonly abilities?: ReadonlySet<number>;
}): {
  client: SupabaseClient;
  stores: Map<string, Map<string, Record<string, unknown>>>;
} {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const base: Record<string, ReadonlySet<number>> = {
    species: baseIds?.species ?? new Set<number>(),
    moves: baseIds?.moves ?? new Set<number>(),
    abilities: baseIds?.abilities ?? new Set<number>(),
  };

  function storeFor(table: string): Map<string, Record<string, unknown>> {
    let store = stores.get(table);
    if (store === undefined) {
      store = new Map<string, Record<string, unknown>>();
      stores.set(table, store);
    }
    return store;
  }

  const client = {
    from(table: string) {
      return {
        select(_column: string) {
          return {
            in(col: string, values: number[]) {
              const existing = base[table] ?? new Set<number>();
              const data = values
                .filter((v) => existing.has(v))
                .map((v) => ({ [col]: v }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
        upsert(
          rows: Record<string, unknown>[],
          opts: { onConflict: string },
        ) {
          const store = storeFor(table);
          for (const row of rows) {
            store.set(keyOf(opts.onConflict, row), row);
          }
          return {
            select() {
              return Promise.resolve({
                data: rows.map(() => ({})),
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, stores };
}

/** Snapshot determinístico do store de uma tabela (ordenado por chave). */
function snapshot(
  store: Map<string, Record<string, unknown>> | undefined,
): Array<[string, Record<string, unknown>]> {
  if (store === undefined) {
    return [];
  }
  return [...store.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Oráculo genérico da Property 6: aplicar `run` uma vez vs. N vezes (N >= 2)
 * sobre um store em memória leva ao mesmo snapshot, sem duplicatas.
 *
 * @param table Nome da tabela observada no store.
 * @param run Executa o upsert sob teste contra o cliente injetado.
 * @param repeats N arbitrário (>= 2) de reaplicações.
 */
async function assertIdempotent(
  table: string,
  run: (client: SupabaseClient) => Promise<unknown>,
  repeats: number,
): Promise<void> {
  const once = makeFakeClient();
  await run(once.client);
  const onceSnap = snapshot(once.stores.get(table));

  const many = makeFakeClient();
  for (let i = 0; i < repeats; i += 1) {
    await run(many.client);
  }
  const manySnap = snapshot(many.stores.get(table));

  // Mesma cardinalidade (contagens-alvo preservadas, sem duplicatas) e mesmo
  // conteúdo campo a campo.
  expect(manySnap.length).toBe(onceSnap.length);
  expect(manySnap).toEqual(onceSnap);
}

const repeatsArb = fc.integer({ min: 2, max: 6 });

// ---------------------------------------------------------------------------
// Geradores das linhas por entidade. Chaves de conciliação são finitas e
// válidas; colunas não-chave variam para que a convergência campo a campo seja
// significativa (o "último vence" por chave).
// ---------------------------------------------------------------------------

const idArb = fc.integer({ min: 1, max: 60 });

function moveRowArb(): fc.Arbitrary<MoveRow> {
  return fc.record({
    move_id: idArb,
    name: fc.string({ maxLength: 16 }),
    raw_data: fc.jsonValue(),
  });
}

function abilityRowArb(): fc.Arbitrary<AbilityRow> {
  return fc.record({
    ability_id: idArb,
    name: fc.string({ maxLength: 16 }),
    raw_data: fc.jsonValue(),
  });
}

function speciesRowArb(): fc.Arbitrary<SpeciesRow> {
  return fc.record({
    pokemon_id: idArb,
    slug: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ''),
    types: fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
    hp: fc.nat({ max: 255 }),
    attack: fc.nat({ max: 255 }),
    defense: fc.nat({ max: 255 }),
    special_attack: fc.nat({ max: 255 }),
    special_defense: fc.nat({ max: 255 }),
    speed: fc.nat({ max: 255 }),
    height: fc.nat({ max: 1000 }),
    weight: fc.nat({ max: 10000 }),
    is_allowed: fc.boolean(),
    raw_data: fc.jsonValue(),
  });
}

function learnableMoveRowArb(): fc.Arbitrary<LearnableMoveRow> {
  return fc.record({
    pokemon_id: idArb,
    move_id: idArb,
    version_details: fc.jsonValue(),
  });
}

function pokemonAbilityRowArb(): fc.Arbitrary<PokemonAbilityRow> {
  return fc.record({
    pokemon_id: idArb,
    ability_id: idArb,
    is_hidden: fc.boolean(),
    slot: fc.integer({ min: 1, max: 3 }),
  });
}

function designBaselineRowArb(): fc.Arbitrary<DesignBaselineRow> {
  return fc.record({
    version: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ''),
    kind: fc.constantFrom('matchups_36' as const, 'simulation_parameters' as const),
    status: fc.string({ minLength: 1, maxLength: 20 }),
    payload: fc.jsonValue(),
  });
}

function nflMatchupRowArb(): fc.Arbitrary<NflMatchupRow> {
  return fc.record({
    natural_key: fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s.trim() !== ''),
    offense_scheme: fc.string({ maxLength: 10 }),
    defense_scheme: fc.string({ maxLength: 10 }),
    payload: fc.jsonValue(),
    // `captured_at` fixo + relógio determinístico garantem que a única fonte de
    // variação entre execuções é o conteúdo das linhas, não o carimbo.
    captured_at: fc.constant('2026-01-01T00:00:00.000Z'),
    source: fc.oneof(
      fc.constant(''),
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ''),
    ),
  }) as unknown as fc.Arbitrary<NflMatchupRow>;
}

describe('Feature: pfl-data-catalog, Property 6: Idempotência do upsert', () => {
  it('upsertMoves: 1x e Nx convergem por move_id, sem duplicatas (R7.2, R7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(moveRowArb(), { maxLength: 25 }),
        repeatsArb,
        async (rows, repeats) => {
          await assertIdempotent(
            'moves',
            (client) => upsertMoves(rows, { client }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('upsertAbilities: 1x e Nx convergem por ability_id, sem duplicatas (R7.2, R7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(abilityRowArb(), { maxLength: 25 }),
        repeatsArb,
        async (rows, repeats) => {
          await assertIdempotent(
            'abilities',
            (client) => upsertAbilities(rows, { client }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('upsertSpecies: 1x e Nx convergem por pokemon_id, sem duplicatas (R7.2, R7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(speciesRowArb(), { maxLength: 25 }),
        repeatsArb,
        async (rows, repeats) => {
          await assertIdempotent(
            'species',
            (client) => upsertSpecies(rows, { client }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('upsertLearnableMoves: 1x e Nx convergem por (pokemon_id, move_id), sem duplicatas (R7.2, R7.3)', async () => {
    const known = { species: new Set([...Array(60)].map((_, i) => i + 1)), moves: new Set([...Array(60)].map((_, i) => i + 1)) };
    await fc.assert(
      fc.asyncProperty(
        fc.array(learnableMoveRowArb(), { maxLength: 25 }),
        repeatsArb,
        async (rows, repeats) => {
          await assertIdempotent(
            'pokemon_learnable_moves',
            (client) =>
              upsertLearnableMoves(rows, {
                client,
                knownPokemonIds: known.species,
                knownMoveIds: known.moves,
              }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('upsertPokemonAbilities: 1x e Nx convergem por (pokemon_id, ability_id), sem duplicatas (R7.2, R7.3)', async () => {
    const known = {
      species: new Set([...Array(60)].map((_, i) => i + 1)),
      abilities: new Set([...Array(60)].map((_, i) => i + 1)),
    };
    await fc.assert(
      fc.asyncProperty(
        fc.array(pokemonAbilityRowArb(), { maxLength: 25 }),
        repeatsArb,
        async (rows, repeats) => {
          await assertIdempotent(
            'pokemon_abilities',
            (client) =>
              upsertPokemonAbilities(rows, {
                client,
                knownPokemonIds: known.species,
                knownAbilityIds: known.abilities,
              }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('upsertDesignBaseline: 1x e Nx convergem por (version, kind), sem duplicatas (R11.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(designBaselineRowArb(), { maxLength: 20 }),
        repeatsArb,
        async (rows, repeats) => {
          await assertIdempotent(
            'design_baseline',
            (client) => upsertDesignBaseline(rows, { client }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('upsertNflMatchups: 1x e Nx convergem por natural_key, sem duplicatas (R10.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(nflMatchupRowArb(), { maxLength: 20 }),
        repeatsArb,
        async (rows, repeats) => {
          // Relógio determinístico: o default de `captured_at` nunca varia
          // entre execuções, isolando a convergência ao conteúdo das linhas.
          const fixedNow = () => new Date('2026-01-01T00:00:00.000Z');
          await assertIdempotent(
            'nfl_matchup_data',
            (client) => upsertNflMatchups([...rows], { client, now: fixedNow }),
            repeats,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('as chaves de conciliação observadas correspondem aos ON CONFLICT dos escritores', () => {
    expect(MOVES_CONFLICT_TARGET).toBe('move_id');
    expect(ABILITIES_CONFLICT_TARGET).toBe('ability_id');
    expect(SPECIES_CONFLICT_TARGET).toBe('pokemon_id');
    expect(LEARNABLE_MOVES_CONFLICT_TARGET).toBe('pokemon_id,move_id');
    expect(POKEMON_ABILITIES_CONFLICT_TARGET).toBe('pokemon_id,ability_id');
    expect(DESIGN_BASELINE_CONFLICT_TARGET).toBe('version,kind');
    expect(NFL_MATCHUP_CONFLICT_TARGET).toBe('natural_key');
  });
});
