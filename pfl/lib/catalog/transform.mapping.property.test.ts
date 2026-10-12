import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  toSpeciesRow,
  toMoveRow,
  toAbilityRow,
  toPokemonAbilityRows,
} from './transform';
import type {
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  AbilityOption,
  LearnableMove,
  StatName,
} from './types';

/**
 * Teste de propriedade de mapeamento de colunas por entidade (Task 3.4).
 *
 * // Feature: pfl-data-catalog, Property 1: Mapeamento fiel de colunas por entidade
 *
 * **Validates: Requirements 1.2, 2.2, 3.2, 5.2**
 *
 * Para toda ficha de espécie, golpe ou habilidade válidos, a linha de banco
 * produzida pela transformação tem suas colunas de identidade e atributos
 * iguais aos campos correspondentes da origem:
 * - espécie: `pokemon_id`, `slug`, `types`, as seis stats, altura (de
 *   `height_dm`) e peso (de `weight_hg`) do bloco `official`, observando a
 *   renomeação `special-attack` → `special_attack` e
 *   `special-defense` → `special_defense`;
 * - golpe: `move_id = id`, `name`;
 * - habilidade: `ability_id = id`, `name`;
 * - relação de habilidade: `is_hidden`, `slot`.
 */

// ---------------------------------------------------------------------------
// Geradores de registros válidos de origem
// ---------------------------------------------------------------------------

/** Inteiro não negativo plausível para stats, altura e peso. */
const statValueArb = fc.integer({ min: 0, max: 1000 });

/** Registro completo das seis stats base com chaves hifenizadas. */
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
    'ice',
    'fighting',
    'poison',
    'ground',
    'flying',
    'psychic',
    'bug',
    'rock',
    'ghost',
    'dragon',
  ),
  { minLength: 1, maxLength: 2 },
);

const abilityOptionArb: fc.Arbitrary<AbilityOption> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }),
  id: fc.integer({ min: 1, max: 10000 }),
  is_hidden: fc.boolean(),
  slot: fc.integer({ min: 1, max: 3 }),
});

const learnableMoveArb: fc.Arbitrary<LearnableMove> = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  version_details: fc.array(
    fc.record({ level_learned_at: fc.integer({ min: 0, max: 100 }) }),
    { maxLength: 3 },
  ),
});

const fichaArb: fc.Arbitrary<FichaEspecie> = fc.record({
  // Faixa ampla, incluindo ids fora de 1..151, pois a Property 1 trata apenas
  // de mapeamento de colunas de identidade/atributos (não de elegibilidade).
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
    ability_options: fc.array(abilityOptionArb, { maxLength: 4 }),
    learnable_moves: fc.array(learnableMoveArb, { maxLength: 5 }),
  }),
});

const golpeArb: fc.Arbitrary<GolpeEnriquecido> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  // Propriedades extras de curadoria/PokéAPI que não afetam as colunas de
  // identidade mas devem conviver com o mapeamento.
  power: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  accuracy: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
});

const habilidadeArb: fc.Arbitrary<HabilidadeEnriquecida> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  effect: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
});

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Property 1: Mapeamento fiel de colunas por entidade', () => {
  it('toSpeciesRow mapeia identidade/atributos do bloco official (R1.2)', () => {
    fc.assert(
      fc.property(fichaArb, (ficha) => {
        const row = toSpeciesRow(ficha);
        const { official } = ficha;

        expect(row.pokemon_id).toBe(ficha.pokemon_id);
        expect(row.slug).toBe(ficha.slug);
        expect(row.types).toEqual(official.types);

        expect(row.hp).toBe(official.stats.hp);
        expect(row.attack).toBe(official.stats.attack);
        expect(row.defense).toBe(official.stats.defense);
        // Renomeação das chaves hifenizadas da PokéAPI para colunas underscore.
        expect(row.special_attack).toBe(official.stats['special-attack']);
        expect(row.special_defense).toBe(official.stats['special-defense']);
        expect(row.speed).toBe(official.stats.speed);

        expect(row.height).toBe(official.height_dm);
        expect(row.weight).toBe(official.weight_hg);
      }),
      { numRuns: 100 },
    );
  });

  it('toMoveRow mapeia move_id=id e name (R2.2)', () => {
    fc.assert(
      fc.property(golpeArb, (golpe) => {
        const row = toMoveRow(golpe);
        expect(row.move_id).toBe(golpe.id);
        expect(row.name).toBe(golpe.name);
      }),
      { numRuns: 100 },
    );
  });

  it('toAbilityRow mapeia ability_id=id e name (R3.2)', () => {
    fc.assert(
      fc.property(habilidadeArb, (habilidade) => {
        const row = toAbilityRow(habilidade);
        expect(row.ability_id).toBe(habilidade.id);
        expect(row.name).toBe(habilidade.name);
      }),
      { numRuns: 100 },
    );
  });

  it('toPokemonAbilityRows preserva is_hidden e slot por par (R5.2)', () => {
    fc.assert(
      fc.property(
        // Fichas com ability_options cujos ids são únicos dentro de cada ficha,
        // para que cada par (pokemon_id, ability_id) tenha mapeamento único e
        // comparável sem ambiguidade de deduplicação.
        fc.array(
          fc
            .record({
              pokemon_id: fc.integer({ min: -50, max: 1200 }),
              options: fc.uniqueArray(abilityOptionArb, {
                selector: (opt) => opt.id,
                maxLength: 4,
              }),
            })
            .map(({ pokemon_id, options }) => ({ pokemon_id, options })),
          { maxLength: 6 },
        ),
        (specs) => {
          // Garante pokemon_ids distintos entre fichas para chaves únicas.
          const fichas: FichaEspecie[] = specs.map((spec, index) => ({
            pokemon_id: spec.pokemon_id + index * 10000,
            slug: `slug-${index}`,
            name_display: `name-${index}`,
            eligible: true,
            source_uri: 'https://example.com/a',
            species_source_uri: 'https://example.com/s',
            official: {
              types: ['normal'],
              stats: {
                hp: 1,
                attack: 1,
                defense: 1,
                'special-attack': 1,
                'special-defense': 1,
                speed: 1,
              },
              height_dm: 1,
              weight_hg: 1,
              ability_options: spec.options,
              learnable_moves: [],
            },
          }));

          const rows = toPokemonAbilityRows(fichas);

          // Oráculo: para cada (pokemon_id, ability_id), is_hidden/slot devem
          // igualar a opção de origem correspondente.
          const sourceByKey = new Map<string, AbilityOption>();
          for (const ficha of fichas) {
            for (const option of ficha.official.ability_options) {
              sourceByKey.set(`${ficha.pokemon_id}:${option.id}`, option);
            }
          }

          for (const row of rows) {
            const source = sourceByKey.get(
              `${row.pokemon_id}:${row.ability_id}`,
            );
            expect(source).toBeDefined();
            expect(row.is_hidden).toBe(source!.is_hidden);
            expect(row.slot).toBe(source!.slot);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
