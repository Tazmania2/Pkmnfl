// Feature: pfl-data-catalog, Property 11: Validação de contagens e elegibilidade
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { EXCLUDED_POKEMON_IDS } from './allowed-species';
import {
  EXPECTED_ABILITIES_COUNT,
  EXPECTED_ALLOWED_COUNT,
  EXPECTED_MOVES_COUNT,
  EXPECTED_SPECIES_COUNT,
  checkCounts,
  checkEligibility,
  type ActualCounts,
  type EligibilityState,
} from './validate';

/**
 * Teste de propriedade da validação de contagens e elegibilidade (Task 7.3).
 *
 * **Feature: pfl-data-catalog, Property 11: Validação de contagens e elegibilidade**
 *
 * _Validates: Requirements 8.1, 8.2_
 *
 * Property 11 (biconditionais universais):
 * - `checkCounts` aprova (retorna `[]`) se e somente se as três contagens
 *   observadas coincidirem com os alvos: espécies = 146, golpes = 591 e
 *   habilidades = 113 (Req. 8.1).
 * - `checkEligibility` aprova (retorna `[]`) se e somente se houver exatamente
 *   146 espécies com `is_allowed = true` E cada id excluído
 *   {144,145,146,150,151} estiver confirmado com `is_allowed = false`
 *   (presente no mapa e `false`) (Req. 8.2).
 */

/** Ids excluídos como array, para alimentar os geradores. */
const EXCLUDED_IDS: readonly number[] = [...EXCLUDED_POKEMON_IDS];

describe('Feature: pfl-data-catalog, Property 11: Validação de contagens e elegibilidade', () => {
  it('checkCounts(actual) === [] ⇔ species=146 ∧ moves=591 ∧ abilities=113 (Req. 8.1)', () => {
    fc.assert(
      fc.property(
        // Gera contagens arbitrárias cobrindo os alvos e vizinhanças, além de
        // valores claramente fora para exercitar o lado "reprova".
        fc.record({
          species: fc.oneof(
            fc.constant(EXPECTED_SPECIES_COUNT),
            fc.integer({ min: 0, max: 300 }),
          ),
          moves: fc.oneof(
            fc.constant(EXPECTED_MOVES_COUNT),
            fc.integer({ min: 0, max: 800 }),
          ),
          abilities: fc.oneof(
            fc.constant(EXPECTED_ABILITIES_COUNT),
            fc.integer({ min: 0, max: 300 }),
          ),
        }),
        (actual: ActualCounts) => {
          const allMatch =
            actual.species === EXPECTED_SPECIES_COUNT &&
            actual.moves === EXPECTED_MOVES_COUNT &&
            actual.abilities === EXPECTED_ABILITIES_COUNT;

          const issues = checkCounts(actual);
          // Biconditional: aprovado (sem issues) se e somente se tudo bate.
          expect(issues.length === 0).toBe(allMatch);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkEligibility(state) === [] ⇔ allowedCount=146 ∧ todas as exclusões = false (Req. 8.2)', () => {
    fc.assert(
      fc.property(
        // allowedCount arbitrário cobrindo o alvo e valores em volta.
        fc.oneof(
          fc.constant(EXPECTED_ALLOWED_COUNT),
          fc.integer({ min: 0, max: 200 }),
        ),
        // Para cada id excluído, decide o estado observado em isAllowedById:
        //  - undefined → ausente do mapa (não confirma false)
        //  - true/false → presente com esse valor
        fc.array(
          fc.constantFrom<boolean | undefined>(true, false, undefined),
          { minLength: EXCLUDED_IDS.length, maxLength: EXCLUDED_IDS.length },
        ),
        // Alguns ids não-excluídos no mapa, para garantir que não influenciam.
        fc.array(
          fc.tuple(fc.integer({ min: 1, max: 143 }), fc.boolean()),
          { maxLength: 10 },
        ),
        (allowedCount, excludedStates, extraEntries) => {
          const isAllowedById = new Map<number, boolean>();

          // Entradas irrelevantes (ids não excluídos).
          for (const [id, flag] of extraEntries) {
            isAllowedById.set(id, flag);
          }

          // Estados dos ids excluídos conforme o gerador.
          EXCLUDED_IDS.forEach((excludedId, index) => {
            const state = excludedStates[index];
            if (state !== undefined) {
              isAllowedById.set(excludedId, state);
            }
          });

          const state: EligibilityState = { allowedCount, isAllowedById };

          // Oráculo independente: aprovado sse contagem bate E toda exclusão
          // está presente e marcada como false.
          const allExclusionsFalse = EXCLUDED_IDS.every(
            (id) => isAllowedById.get(id) === false,
          );
          const shouldPass =
            allowedCount === EXPECTED_ALLOWED_COUNT && allExclusionsFalse;

          const issues = checkEligibility(state);
          expect(issues.length === 0).toBe(shouldPass);
        },
      ),
      { numRuns: 100 },
    );
  });
});
