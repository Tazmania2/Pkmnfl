import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { toLearnableMoveRows, toPokemonAbilityRows } from './transform';
import type {
  FichaEspecie,
  AbilityOption,
  LearnableMove,
} from './types';

/**
 * Teste de propriedade de contagem por deduplicação de pares de relação
 * (Task 3.9).
 *
 * // Feature: pfl-data-catalog, Property 5: Contagem por deduplicação de pares de relação
 *
 * **Validates: Requirements 4.1, 4.6, 5.1, 5.5**
 *
 * Para qualquer conjunto de fichas, o número de relações gravadas — golpe
 * aprendível (`toLearnableMoveRows`) e habilidade disponível
 * (`toPokemonAbilityRows`) — é igual ao número de pares distintos
 * `(pokemon_id, move_id)` e `(pokemon_id, ability_id)` derivados das fichas,
 * mesmo quando o mesmo par ocorre múltiplas vezes na fonte: duplicado dentro de
 * uma mesma ficha e/ou repartido entre fichas distintas que compartilham o
 * mesmo `pokemon_id`.
 */

// ---------------------------------------------------------------------------
// Geradores que produzem intencionalmente pares duplicados
// ---------------------------------------------------------------------------

/**
 * Faixa pequena e proposital de ids: ao restringir `pokemon_id`, `move_id` e
 * `ability_id` a poucos valores, forçamos colisões frequentes de pares — tanto
 * dentro de uma ficha quanto entre fichas — exercitando o caminho de
 * deduplicação em vez de gerar quase sempre pares únicos.
 */
const pokemonIdArb = fc.integer({ min: 1, max: 4 });
const moveIdArb = fc.integer({ min: 1, max: 5 });
const abilityIdArb = fc.integer({ min: 1, max: 5 });

const learnableMoveArb: fc.Arbitrary<LearnableMove> = moveIdArb.map((id) => ({
  id,
  name: `move-${id}`,
  version_details: [{ level_learned_at: id }],
}));

const abilityOptionArb: fc.Arbitrary<AbilityOption> = fc.record({
  id: abilityIdArb,
  name: abilityIdArb.map((id) => `ability-${id}`),
  is_hidden: fc.boolean(),
  slot: fc.integer({ min: 1, max: 3 }),
});

/**
 * Ficha com `pokemon_id` numa faixa estreita (colisões entre fichas) e listas
 * de golpes/habilidades que admitem repetição do mesmo id (colisões dentro da
 * ficha). `minLength` em 0 cobre fichas sem relações.
 */
const fichaArb: fc.Arbitrary<FichaEspecie> = fc.record({
  pokemon_id: pokemonIdArb,
  slug: fc.string({ minLength: 1, maxLength: 10 }),
  name_display: fc.string({ minLength: 1, maxLength: 10 }),
  eligible: fc.boolean(),
  source_uri: fc.webUrl(),
  species_source_uri: fc.webUrl(),
  official: fc.record({
    types: fc.constant(['normal']),
    stats: fc.constant({
      hp: 1,
      attack: 1,
      defense: 1,
      'special-attack': 1,
      'special-defense': 1,
      speed: 1,
    }),
    height_dm: fc.constant(1),
    weight_hg: fc.constant(1),
    ability_options: fc.array(abilityOptionArb, { minLength: 0, maxLength: 6 }),
    learnable_moves: fc.array(learnableMoveArb, { minLength: 0, maxLength: 6 }),
  }),
});

const fichasArb = fc.array(fichaArb, { minLength: 0, maxLength: 8 });

// ---------------------------------------------------------------------------
// Oráculos: cardinalidade e conjunto de chaves distintas
// ---------------------------------------------------------------------------

function distinctLearnableKeys(fichas: FichaEspecie[]): Set<string> {
  const keys = new Set<string>();
  for (const ficha of fichas) {
    for (const move of ficha.official.learnable_moves) {
      keys.add(`${ficha.pokemon_id}:${move.id}`);
    }
  }
  return keys;
}

function distinctAbilityKeys(fichas: FichaEspecie[]): Set<string> {
  const keys = new Set<string>();
  for (const ficha of fichas) {
    for (const ability of ficha.official.ability_options) {
      keys.add(`${ficha.pokemon_id}:${ability.id}`);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Property 5: Contagem por deduplicação de pares de relação', () => {
  it('toLearnableMoveRows produz uma linha por par (pokemon_id, move_id) distinto (R4.1, R4.6)', () => {
    fc.assert(
      fc.property(fichasArb, (fichas) => {
        const rows = toLearnableMoveRows(fichas);
        const expectedKeys = distinctLearnableKeys(fichas);

        // Contagem: tantas linhas quantos pares distintos.
        expect(rows.length).toBe(expectedKeys.size);

        // Sem duplicatas entre as linhas emitidas.
        const emittedKeys = new Set(
          rows.map((r) => `${r.pokemon_id}:${r.move_id}`),
        );
        expect(emittedKeys.size).toBe(rows.length);

        // O conjunto de chaves emitidas é exatamente o conjunto de pares
        // distintos derivados das fichas.
        expect(emittedKeys).toEqual(expectedKeys);
      }),
      { numRuns: 100 },
    );
  });

  it('toPokemonAbilityRows produz uma linha por par (pokemon_id, ability_id) distinto (R5.1, R5.5)', () => {
    fc.assert(
      fc.property(fichasArb, (fichas) => {
        const rows = toPokemonAbilityRows(fichas);
        const expectedKeys = distinctAbilityKeys(fichas);

        expect(rows.length).toBe(expectedKeys.size);

        const emittedKeys = new Set(
          rows.map((r) => `${r.pokemon_id}:${r.ability_id}`),
        );
        expect(emittedKeys.size).toBe(rows.length);

        expect(emittedKeys).toEqual(expectedKeys);
      }),
      { numRuns: 100 },
    );
  });
});
