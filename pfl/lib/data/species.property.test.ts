import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getAllowedSpecies, SPECIES_TABLE } from './species';
import type { SpeciesSummary } from '../catalog/types';

/**
 * Teste de propriedade da consulta de espécies permitidas (Task 13.2).
 *
 * // Feature: pfl-data-catalog, Property 18: Consulta de espécies permitidas filtra corretamente
 *
 * **Validates: Requirements 12.1**
 *
 * Para qualquer estado do banco, `getAllowedSpecies` retorna exatamente as
 * espécies com `is_allowed = true`, cada uma projetada em `pokemon_id`,
 * `slug`, `types` e as seis estatísticas base — e nenhuma espécie com
 * `is_allowed = false`.
 *
 * A estratégia usa um dublê de SupabaseClient em memória que guarda um conjunto
 * gerado de linhas (mistura de `is_allowed` true/false) e implementa a cadeia
 * `from('species').select(...).eq('is_allowed', true).order('pokemon_id', ...)`
 * exatamente como consumida pela implementação, sem qualquer I/O real.
 */

/** Linha completa de `species` no dublê, antes da projeção. */
interface FakeSpeciesRow {
  pokemon_id: number;
  slug: string;
  types: string[];
  hp: number;
  attack: number;
  defense: number;
  special_attack: number;
  special_defense: number;
  speed: number;
  // Colunas que NÃO devem aparecer no SpeciesSummary projetado.
  is_allowed: boolean;
  height: number;
  weight: number;
  raw_data: unknown;
}

/**
 * Constrói um dublê de SupabaseClient que resolve a cadeia usada por
 * `getAllowedSpecies`. Aplica o filtro `.eq('is_allowed', value)` e a
 * ordenação `.order(column, { ascending })` sobre o conjunto `rows`,
 * devolvendo apenas as colunas do contrato de projeção (nunca `raw_data`,
 * `is_allowed`, `height` ou `weight`).
 */
function makeFakeClient(rows: FakeSpeciesRow[]): SupabaseClient {
  const from = (table: string) => {
    const builder = {
      _table: table,
      _eqColumn: null as keyof FakeSpeciesRow | null,
      _eqValue: undefined as unknown,
      select() {
        return builder;
      },
      eq(column: keyof FakeSpeciesRow, value: unknown) {
        builder._eqColumn = column;
        builder._eqValue = value;
        return builder;
      },
      order(column: keyof FakeSpeciesRow, opts?: { ascending?: boolean }) {
        const ascending = opts?.ascending ?? true;

        if (builder._table !== SPECIES_TABLE) {
          return Promise.resolve({ data: [], error: null });
        }

        let result = rows;
        if (builder._eqColumn !== null) {
          const col = builder._eqColumn;
          const val = builder._eqValue;
          result = result.filter((row) => row[col] === val);
        }

        const sorted = [...result].sort((a, b) => {
          const av = a[column] as number;
          const bv = b[column] as number;
          return ascending ? av - bv : bv - av;
        });

        // Supabase devolve apenas as colunas do `select(...)`. Projetamos as
        // nove colunas do contrato — e nada mais.
        const data = sorted.map((row) => ({
          pokemon_id: row.pokemon_id,
          slug: row.slug,
          types: row.types,
          hp: row.hp,
          attack: row.attack,
          defense: row.defense,
          special_attack: row.special_attack,
          special_defense: row.special_defense,
          speed: row.speed,
        }));

        return Promise.resolve({ data, error: null });
      },
    };
    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

/** Gerador de uma estatística base (não negativa, limitada). */
const statArb = fc.integer({ min: 0, max: 255 });

/** Gerador de uma linha de espécie com `pokemon_id` único garantido pelo chamador. */
function speciesRowArb(pokemonId: number): fc.Arbitrary<FakeSpeciesRow> {
  return fc.record({
    slug: fc.string({ minLength: 1, maxLength: 20 }),
    types: fc.array(
      fc.constantFrom('normal', 'fire', 'water', 'grass', 'electric', 'psychic', 'flying'),
      { minLength: 1, maxLength: 2 },
    ),
    hp: statArb,
    attack: statArb,
    defense: statArb,
    special_attack: statArb,
    special_defense: statArb,
    speed: statArb,
    is_allowed: fc.boolean(),
    height: fc.integer({ min: 0, max: 1000 }),
    weight: fc.integer({ min: 0, max: 10000 }),
    raw_data: fc.object(),
  }).map((partial) => ({ pokemon_id: pokemonId, ...partial }));
}

/** Gerador de um conjunto de linhas com `pokemon_id` distintos (mistura de is_allowed). */
const speciesSetArb: fc.Arbitrary<FakeSpeciesRow[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 40 })
  .chain((ids) => fc.tuple(...ids.map((id) => speciesRowArb(id))));

/** Projeção de referência: exatamente o SpeciesSummary esperado para uma linha. */
function toSummary(row: FakeSpeciesRow): SpeciesSummary {
  return {
    pokemon_id: row.pokemon_id,
    slug: row.slug,
    types: row.types,
    hp: row.hp,
    attack: row.attack,
    defense: row.defense,
    special_attack: row.special_attack,
    special_defense: row.special_defense,
    speed: row.speed,
  };
}

describe('Feature: pfl-data-catalog, Property 18: Consulta de espécies permitidas filtra corretamente', () => {
  it('getAllowedSpecies retorna exatamente as espécies is_allowed=true, projetadas (R12.1)', async () => {
    await fc.assert(
      fc.asyncProperty(speciesSetArb, async (rows) => {
        const client = makeFakeClient(rows);

        const result = await getAllowedSpecies({ client });

        // Oráculo: subconjunto is_allowed=true, projetado ao contrato.
        const expected = rows
          .filter((row) => row.is_allowed === true)
          .map(toSummary);

        // Comparação por conjunto (independente de ordem): mesmos pokemon_id.
        const resultIds = result.map((s) => s.pokemon_id).sort((a, b) => a - b);
        const expectedIds = expected.map((s) => s.pokemon_id).sort((a, b) => a - b);
        expect(resultIds).toEqual(expectedIds);

        // Nenhuma espécie com is_allowed=false aparece no resultado.
        const disallowedIds = new Set(
          rows.filter((row) => row.is_allowed === false).map((row) => row.pokemon_id),
        );
        for (const summary of result) {
          expect(disallowedIds.has(summary.pokemon_id)).toBe(false);
        }

        // Cada item retornado é a projeção fiel da linha de origem...
        const byId = new Map(expected.map((s) => [s.pokemon_id, s]));
        for (const summary of result) {
          expect(summary).toEqual(byId.get(summary.pokemon_id));
          // ...e não vaza colunas fora do contrato (raw_data, is_allowed, height, weight).
          expect(Object.keys(summary).sort()).toEqual(
            [
              'attack',
              'defense',
              'hp',
              'pokemon_id',
              'slug',
              'special_attack',
              'special_defense',
              'speed',
              'types',
            ],
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
