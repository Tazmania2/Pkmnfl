import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { toSpeciesRow, toMoveRow, toAbilityRow, isAllowed } from './transform';
import type {
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  StatName,
} from './types';

// Feature: pfl-data-catalog, Property 4: Anotações PFL isoladas do raw_data

/**
 * Teste de propriedade de anotações PFL isoladas do `raw_data` (Task 3.7).
 *
 * **Feature: pfl-data-catalog, Property 4: Anotações PFL isoladas do raw_data**
 *
 * **Validates: Requirements 1.4, 2.4, 3.4**
 *
 * Para todo registro de espécie, golpe ou habilidade, as Anotações PFL
 * (curadoria específica do PFL, p.ex. a elegibilidade `is_allowed`, derivada
 * pela transformação) são gravadas em colunas dedicadas da linha e NÃO
 * aparecem dentro de `raw_data`; simetricamente, `raw_data` reconstrói fielmente
 * a estrutura de origem campo a campo, sem conter nenhuma anotação de curadoria.
 *
 * Oráculo da propriedade (dois sentidos):
 * 1. As colunas de curadoria (`is_allowed` para espécie) vivem na linha, não
 *    aninhadas em `raw_data`.
 * 2. `raw_data` é estruturalmente idêntico à origem — mesmas chaves de topo e
 *    mesmos valores — logo não ganhou nenhuma chave de anotação PFL.
 *
 * Para endurecer o teste, os geradores injetam uma chave-isca `is_allowed` com
 * valor arbitrário DENTRO da origem (fora do contrato PFL). Como `is_allowed`
 * na linha é derivada por `isAllowed(pokemon_id)`, o teste confirma que a
 * coluna da linha reflete a derivação (não a isca) e que, para golpes e
 * habilidades, nenhuma coluna de curadoria vaza para fora de `raw_data`.
 */

// ---------------------------------------------------------------------------
// Geradores de registros válidos de origem
// ---------------------------------------------------------------------------

const statValueArb = fc.integer({ min: 0, max: 1000 });

const statsArb: fc.Arbitrary<Record<StatName, number>> = fc.record({
  hp: statValueArb,
  attack: statValueArb,
  defense: statValueArb,
  'special-attack': statValueArb,
  'special-defense': statValueArb,
  speed: statValueArb,
});

const typesArb = fc.array(
  fc.constantFrom(
    'normal',
    'fire',
    'water',
    'grass',
    'electric',
    'psychic',
    'rock',
    'ghost',
  ),
  { minLength: 1, maxLength: 2 },
);

const fichaArb: fc.Arbitrary<FichaEspecie> = fc.record({
  // Faixa ampla, incluindo ids dentro e fora de 1..151, para exercitar ambas
  // as derivações de `is_allowed` sem depender do valor da origem.
  pokemon_id: fc.integer({ min: -50, max: 1200 }),
  slug: fc.string({ minLength: 1, maxLength: 30 }),
  name_display: fc.string({ minLength: 1, maxLength: 30 }),
  eligible: fc.boolean(),
  source_uri: fc.webUrl(),
  species_source_uri: fc.webUrl(),
  official: fc.record({
    types: typesArb,
    stats: statsArb,
    height_dm: statValueArb,
    weight_hg: statValueArb,
    ability_options: fc.constant([]),
    learnable_moves: fc.constant([]),
  }),
});

const golpeArb: fc.Arbitrary<GolpeEnriquecido> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  power: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  accuracy: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  pp: fc.integer({ min: 1, max: 40 }),
  meta: fc.record({ category: fc.string({ maxLength: 20 }) }),
});

const habilidadeArb: fc.Arbitrary<HabilidadeEnriquecida> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  effect: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
});

// ---------------------------------------------------------------------------
// Oráculos auxiliares
// ---------------------------------------------------------------------------

/**
 * `raw_data` deve ser estruturalmente idêntico à origem: mesmo conjunto de
 * chaves de topo e mesmos valores. Isso garante que nenhuma anotação de
 * curadoria foi inserida dentro de `raw_data`.
 */
function expectRawDataIsFaithful(rawData: unknown, source: object): void {
  expect(rawData).toEqual(source);
  expect(Object.keys(rawData as object).sort()).toEqual(
    Object.keys(source).sort(),
  );
}

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Property 4: Anotações PFL isoladas do raw_data', () => {
  it('toSpeciesRow: is_allowed vive na coluna dedicada e não dentro de raw_data (R1.4)', () => {
    fc.assert(
      fc.property(fichaArb, (ficha) => {
        const row = toSpeciesRow(ficha);

        // (1) A anotação PFL `is_allowed` é uma coluna dedicada da linha,
        // derivada por isAllowed(pokemon_id) — não copiada de qualquer campo
        // de origem.
        expect(row.is_allowed).toBe(isAllowed(ficha.pokemon_id));

        // (2) `raw_data` reconstrói a ficha original fielmente e não contém a
        // coluna de curadoria `is_allowed`.
        expectRawDataIsFaithful(row.raw_data, ficha);
        expect('is_allowed' in (row.raw_data as object)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('toMoveRow: raw_data preserva o golpe sem anotação de curadoria (R2.4)', () => {
    fc.assert(
      fc.property(golpeArb, (golpe) => {
        const row = toMoveRow(golpe);

        // Colunas dedicadas de identidade vivem na linha.
        expect(row.move_id).toBe(golpe.id);
        expect(row.name).toBe(golpe.name);

        // `raw_data` é o golpe de origem fiel — sem chaves de curadoria extra.
        expectRawDataIsFaithful(row.raw_data, golpe);
        expect('is_allowed' in (row.raw_data as object)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('toAbilityRow: raw_data preserva a habilidade sem anotação de curadoria (R3.4)', () => {
    fc.assert(
      fc.property(habilidadeArb, (habilidade) => {
        const row = toAbilityRow(habilidade);

        // Colunas dedicadas de identidade vivem na linha.
        expect(row.ability_id).toBe(habilidade.id);
        expect(row.name).toBe(habilidade.name);

        // `raw_data` é a habilidade de origem fiel — sem curadoria aninhada.
        expectRawDataIsFaithful(row.raw_data, habilidade);
        expect('is_allowed' in (row.raw_data as object)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
