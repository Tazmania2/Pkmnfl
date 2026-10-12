import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { toMoveRow } from './transform';
import type { GolpeEnriquecido } from './types';

// Feature: pfl-data-catalog, Property 3: Power preservado sem conversão

/**
 * Teste de propriedade de `power` sem conversão (Task 3.6).
 *
 * **Feature: pfl-data-catalog, Property 3: Power preservado sem conversão**
 *
 * Validates: Requirements 2.3
 *
 * Para todo golpe, o valor de `power` lido de `raw_data` (produzido por
 * `toMoveRow`) é idêntico ao `power` de origem, sem qualquer transformação em
 * interpretação de força física. Isso inclui explicitamente `power` nulo — na
 * PokéAPI, golpes de status têm `power: null` — que deve ser preservado como
 * `null`, nunca convertido para 0 ou qualquer outro valor.
 */

/** Gerador do campo `power` de origem: inteiros válidos ou `null`. */
const powerArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant<number | null>(null),
  fc.integer({ min: 0, max: 250 }),
);

/**
 * Gerador de um `GolpeEnriquecido` com `power` possivelmente nulo e um conjunto
 * representativo de propriedades originais da PokéAPI em volta, para garantir
 * que `power` é preservado mesmo coexistindo com outros campos.
 */
const golpeArb: fc.Arbitrary<GolpeEnriquecido> = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  name: fc.string(),
  power: powerArb,
  type: fc.string(),
  damage_class: fc.constantFrom('physical', 'special', 'status'),
  accuracy: fc.oneof(fc.constant<number | null>(null), fc.integer({ min: 0, max: 100 })),
  pp: fc.integer({ min: 1, max: 40 }),
  priority: fc.integer({ min: -7, max: 5 }),
});

describe('Feature: pfl-data-catalog, Property 3: Power preservado sem conversão', () => {
  it('o power lido de raw_data é idêntico ao power de origem, incluindo null (R2.3)', () => {
    fc.assert(
      fc.property(golpeArb, (golpe) => {
        const row = toMoveRow(golpe);
        const rawPower = (row.raw_data as GolpeEnriquecido).power;

        // Identidade estrita: null permanece null; inteiros permanecem iguais.
        // `Object.is` distingue sem coerção e trata null/0 corretamente.
        expect(Object.is(rawPower, golpe.power)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('golpes de status (power null) nunca são convertidos para 0 ou outro valor (R2.3)', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.integer({ min: 1, max: 10000 }),
          name: fc.string(),
          power: fc.constant<number | null>(null),
          damage_class: fc.constant('status'),
        }),
        (golpe) => {
          const row = toMoveRow(golpe as GolpeEnriquecido);
          expect((row.raw_data as GolpeEnriquecido).power).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
