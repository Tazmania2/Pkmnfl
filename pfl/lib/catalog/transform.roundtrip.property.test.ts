import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  toSpeciesRow,
  toMoveRow,
  toAbilityRow,
  toLearnableMoveRows,
} from './transform';
import type {
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
} from './types';

// Feature: pfl-data-catalog, Property 2: Round-trip de preservação em raw_data e metadados

/**
 * Property test de round-trip de preservação (Task 3.5).
 *
 * **Feature: pfl-data-catalog, Property 2: Round-trip de preservação em raw_data e metadados**
 *
 * **Validates: Requirements 1.3, 2.3, 3.3, 4.2, 11.1, 11.3, 12.5**
 *
 * Para todo registro de origem (ficha, golpe, habilidade) ou relação
 * (`version_details`), serializar para a coluna estruturada
 * (`raw_data`/`version_details`) e lê-la de volta reconstrói o conteúdo
 * original campo a campo, sem perda. O oráculo é o round-trip JSON canônico:
 * `JSON.parse(JSON.stringify(coluna))` deve ser deep-equal ao conteúdo de
 * origem.
 *
 * Observação de escopo: os transformadores de baseline (`payload`) são
 * introduzidos em tarefas posteriores (5.3); esta fatia cobre os
 * transformadores já implementados — `toSpeciesRow`/`toMoveRow`/`toAbilityRow`
 * (`raw_data`) e `toLearnableMoveRows` (`version_details`).
 */

/** Valor JSON arbitrário (recursivo), para encher campos livres de origem. */
const jsonValueArb: fc.Arbitrary<unknown> = fc.jsonValue();

/** Gera o nome canônico de uma stat base como chave de `Record<StatName,…>`. */
const statsArb = fc.record({
  hp: fc.integer({ min: 0, max: 255 }),
  attack: fc.integer({ min: 0, max: 255 }),
  defense: fc.integer({ min: 0, max: 255 }),
  'special-attack': fc.integer({ min: 0, max: 255 }),
  'special-defense': fc.integer({ min: 0, max: 255 }),
  speed: fc.integer({ min: 0, max: 255 }),
});

const abilityOptionArb = fc.record({
  name: fc.string(),
  id: fc.integer({ min: 1, max: 400 }),
  is_hidden: fc.boolean(),
  slot: fc.integer({ min: 1, max: 3 }),
});

/** Metadados de versão de aprendizado: estrutura livre preservada fielmente. */
const versionDetailsArb = fc.array(jsonValueArb, { maxLength: 5 });

const learnableMoveArb = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  name: fc.string(),
  version_details: versionDetailsArb,
});

const fichaArb: fc.Arbitrary<FichaEspecie> = fc.record({
  pokemon_id: fc.integer({ min: 1, max: 151 }),
  slug: fc.string(),
  name_display: fc.string(),
  eligible: fc.boolean(),
  source_uri: fc.webUrl(),
  species_source_uri: fc.webUrl(),
  official: fc.record({
    types: fc.array(fc.string(), { maxLength: 2 }),
    stats: statsArb,
    height_dm: fc.integer({ min: 0, max: 200 }),
    weight_hg: fc.integer({ min: 0, max: 10000 }),
    ability_options: fc.array(abilityOptionArb, { maxLength: 3 }),
    learnable_moves: fc.array(learnableMoveArb, { maxLength: 5 }),
  }),
}) as fc.Arbitrary<FichaEspecie>;

/** Golpe enriquecido: `id`/`name` fixos + campos livres arbitrários. */
const golpeArb: fc.Arbitrary<GolpeEnriquecido> = fc
  .tuple(
    fc.integer({ min: 1, max: 1000 }),
    fc.string(),
    fc.dictionary(
      fc.string().filter((k) => k !== 'id' && k !== 'name'),
      jsonValueArb,
      { maxKeys: 6 },
    ),
  )
  .map(([id, name, extra]) => ({ ...extra, id, name }));

/** Habilidade enriquecida: `id`/`name` fixos + campos livres arbitrários. */
const habilidadeArb: fc.Arbitrary<HabilidadeEnriquecida> = fc
  .tuple(
    fc.integer({ min: 1, max: 400 }),
    fc.string(),
    fc.dictionary(
      fc.string().filter((k) => k !== 'id' && k !== 'name'),
      jsonValueArb,
      { maxKeys: 6 },
    ),
  )
  .map(([id, name, extra]) => ({ ...extra, id, name }));

/** Round-trip JSON canônico: serializar e ler de volta. */
function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('Feature: pfl-data-catalog, Property 2: Round-trip de preservação em raw_data e metadados', () => {
  it('toSpeciesRow preserva a ficha original fiel em raw_data (R1.3)', () => {
    fc.assert(
      fc.property(fichaArb, (ficha) => {
        const row = toSpeciesRow(ficha);
        expect(jsonRoundTrip(row.raw_data)).toEqual(jsonRoundTrip(ficha));
      }),
      { numRuns: 100 },
    );
  });

  it('toMoveRow preserva o golpe original fiel em raw_data (R2.3)', () => {
    fc.assert(
      fc.property(golpeArb, (golpe) => {
        const row = toMoveRow(golpe);
        expect(jsonRoundTrip(row.raw_data)).toEqual(jsonRoundTrip(golpe));
      }),
      { numRuns: 100 },
    );
  });

  it('toAbilityRow preserva a habilidade original fiel em raw_data (R3.3)', () => {
    fc.assert(
      fc.property(habilidadeArb, (habilidade) => {
        const row = toAbilityRow(habilidade);
        expect(jsonRoundTrip(row.raw_data)).toEqual(jsonRoundTrip(habilidade));
      }),
      { numRuns: 100 },
    );
  });

  it('toLearnableMoveRows preserva version_details fiel por par (R4.2)', () => {
    fc.assert(
      fc.property(fc.array(fichaArb, { maxLength: 4 }), (fichas) => {
        const rows = toLearnableMoveRows(fichas);

        // Oráculo: primeira ocorrência de cada par (pokemon_id, move_id).
        const expected = new Map<string, unknown>();
        for (const ficha of fichas) {
          for (const move of ficha.official.learnable_moves) {
            const key = `${ficha.pokemon_id}:${move.id}`;
            if (!expected.has(key)) {
              expected.set(key, move.version_details);
            }
          }
        }

        for (const row of rows) {
          const key = `${row.pokemon_id}:${row.move_id}`;
          expect(expected.has(key)).toBe(true);
          expect(jsonRoundTrip(row.version_details)).toEqual(
            jsonRoundTrip(expected.get(key)),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
