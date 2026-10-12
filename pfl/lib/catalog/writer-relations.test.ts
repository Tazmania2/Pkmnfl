import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O escritor inicia com `import 'server-only'`, que lança fora de um contexto
 * de servidor Next/RSC. Sob Vitest neutralizamos essa guarda com um stub, sem
 * alterar o comportamento testado (as escritas recebem um cliente injetado).
 */
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  LEARNABLE_MOVES_TABLE,
  POKEMON_ABILITIES_TABLE,
  upsertLearnableMoves,
  upsertPokemonAbilities,
} from './writer';
import type { LearnableMoveRow, PokemonAbilityRow } from './types';

/**
 * Testes de exemplo e de propriedade para as escritas de relação com validação
 * de FK (Task 5.2).
 *
 * _Requirements: 4.5, 5.4, 7.1, 7.2_
 *
 * As escritas validam que cada par referencia um `pokemon_id` existente em
 * `species` e um `move_id`/`ability_id` existente na tabela base, rejeitando
 * pares órfãos sem interromper os demais. A idempotência é da chave composta.
 */

// ---------------------------------------------------------------------------
// Fake de Supabase em memória: suporta `from().upsert().select()` (grava por
// chave composta) e `from().select().in()` (consulta ids base). Não é usado
// pelos testes que injetam `knownIds`, mas cobre o caminho de consulta.
// ---------------------------------------------------------------------------

interface FakeTables {
  readonly [table: string]: Map<string, Record<string, unknown>>;
}

function makeFakeClient(baseIds: {
  readonly species?: readonly number[];
  readonly moves?: readonly number[];
  readonly abilities?: readonly number[];
}): { client: SupabaseClient; tables: FakeTables } {
  const base: Record<string, Set<number>> = {
    species: new Set(baseIds.species ?? []),
    moves: new Set(baseIds.moves ?? []),
    abilities: new Set(baseIds.abilities ?? []),
  };

  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    [LEARNABLE_MOVES_TABLE]: new Map(),
    [POKEMON_ABILITIES_TABLE]: new Map(),
  };

  const client = {
    from(table: string) {
      return {
        // Caminho de leitura: select(col).in(col, values) -> ids existentes.
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
        // Caminho de escrita: upsert(rows,{onConflict}).select(target).
        upsert(
          rows: Record<string, unknown>[],
          opts: { onConflict: string },
        ) {
          const keyCols = opts.onConflict.split(',');
          const store = tables[table] as Map<string, Record<string, unknown>>;
          for (const row of rows) {
            const key = keyCols.map((c) => String(row[c])).join(':');
            store.set(key, row);
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

  return { client, tables };
}

describe('upsertLearnableMoves — validação de FK (R4.5, R7.1, R7.2)', () => {
  const base = {
    knownPokemonIds: new Set([1, 4, 7]),
    knownMoveIds: new Set([10, 20, 30]),
  };

  it('grava pares com FK válida e rejeita os órfãos sem interromper os demais', async () => {
    const rows: LearnableMoveRow[] = [
      { pokemon_id: 1, move_id: 10, version_details: [] }, // válido
      { pokemon_id: 4, move_id: 999, version_details: [] }, // move órfão
      { pokemon_id: 999, move_id: 20, version_details: [] }, // pokemon órfão
      { pokemon_id: 7, move_id: 30, version_details: [] }, // válido
    ];

    const result = await upsertLearnableMoves(rows, {
      ...base,
      client: makeFakeClient({}).client,
    });

    expect(result.inserted).toBe(2);
    expect(result.rejected).toHaveLength(2);
    const reasons = result.rejected.map((r) => r.reason).join(' | ');
    expect(reasons).toContain('move_id=999');
    expect(reasons).toContain('pokemon_id=999');
  });

  it('rejeita linhas com chave estrutural ausente (ids não finitos)', async () => {
    const rows = [
      { pokemon_id: Number.NaN, move_id: 10, version_details: [] },
      { pokemon_id: 1, move_id: Number.NaN, version_details: [] },
    ] as unknown as LearnableMoveRow[];

    const result = await upsertLearnableMoves(rows, {
      ...base,
      client: makeFakeClient({}).client,
    });

    expect(result.inserted).toBe(0);
    expect(result.rejected).toHaveLength(2);
    for (const r of result.rejected) {
      expect(r.reason).toContain('ausente ou inválida');
    }
  });

  it('consulta os ids base no cliente quando os conjuntos não são injetados', async () => {
    const { client } = makeFakeClient({ species: [1], moves: [10] });
    const rows: LearnableMoveRow[] = [
      { pokemon_id: 1, move_id: 10, version_details: [] },
      { pokemon_id: 1, move_id: 11, version_details: [] }, // move 11 inexistente
    ];

    const result = await upsertLearnableMoves(rows, { client });

    expect(result.inserted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('move_id=11');
  });

  it('é idempotente: reaplicar os mesmos pares não duplica (chave composta)', async () => {
    const { client, tables } = makeFakeClient({ species: [1], moves: [10] });
    const rows: LearnableMoveRow[] = [
      { pokemon_id: 1, move_id: 10, version_details: [] },
    ];

    await upsertLearnableMoves(rows, { client });
    await upsertLearnableMoves(rows, { client });

    expect(tables[LEARNABLE_MOVES_TABLE]?.size).toBe(1);
  });
});

describe('upsertPokemonAbilities — validação de FK (R5.4, R7.1, R7.2)', () => {
  const base = {
    knownPokemonIds: new Set([1, 4]),
    knownAbilityIds: new Set([65, 66]),
  };

  it('grava pares válidos e rejeita habilidade/pokemon órfãos', async () => {
    const rows: PokemonAbilityRow[] = [
      { pokemon_id: 1, ability_id: 65, is_hidden: false, slot: 1 }, // válido
      { pokemon_id: 1, ability_id: 777, is_hidden: true, slot: 3 }, // ability órfã
      { pokemon_id: 888, ability_id: 66, is_hidden: false, slot: 1 }, // pokemon órfão
    ];

    const result = await upsertPokemonAbilities(rows, {
      ...base,
      client: makeFakeClient({}).client,
    });

    expect(result.inserted).toBe(1);
    expect(result.rejected).toHaveLength(2);
    const reasons = result.rejected.map((r) => r.reason).join(' | ');
    expect(reasons).toContain('ability_id=777');
    expect(reasons).toContain('pokemon_id=888');
  });
});

// ---------------------------------------------------------------------------
// Property test: toda linha é gravada SE E SOMENTE SE ambas as FKs existem; os
// demais pares são rejeitados sem afetar os válidos (invariante de validação).
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Validação de FK em relações (R4.5, R5.4)', () => {
  it('aceita um par se e somente se pokemon_id e move_id existem nas bases', () => {
    const idArb = fc.integer({ min: 1, max: 40 });
    const pairArb = fc.record({
      pokemon_id: idArb,
      move_id: idArb,
    });

    fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1 }),
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1 }),
        fc.array(pairArb, { maxLength: 25 }),
        async (speciesIds, moveIds, pairs) => {
          const knownPokemonIds = new Set(speciesIds);
          const knownMoveIds = new Set(moveIds);

          // Deduplica pela chave composta (igual ao destino ON CONFLICT) para
          // alinhar a contagem esperada ao número de linhas efetivamente
          // gravadas pelo upsert idempotente.
          const uniquePairs = new Map<string, LearnableMoveRow>();
          for (const p of pairs) {
            uniquePairs.set(`${p.pokemon_id}:${p.move_id}`, {
              pokemon_id: p.pokemon_id,
              move_id: p.move_id,
              version_details: [],
            });
          }
          const rows = [...uniquePairs.values()];

          const expectedValid = rows.filter(
            (r) => knownPokemonIds.has(r.pokemon_id) && knownMoveIds.has(r.move_id),
          ).length;
          const expectedRejected = rows.length - expectedValid;

          const result = await upsertLearnableMoves(rows, {
            knownPokemonIds,
            knownMoveIds,
            client: makeFakeClient({}).client,
          });

          expect(result.inserted).toBe(expectedValid);
          expect(result.rejected).toHaveLength(expectedRejected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
