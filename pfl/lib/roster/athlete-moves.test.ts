import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  REQUIRED_MOVE_COUNT,
  assignMovesIsValid,
} from './athlete-moves';

/**
 * Teste de propriedade da regra "exatamente 4 golpes distintos" (Task 10.6).
 *
 * **Feature: pfl-foundation, Property 4: Atleta tem exatamente quatro golpes distintos**
 *
 * Validates: Requirements 12.6, 12.7, 12.8 (decisão D-2, Correctness Property P-4).
 *
 * SUT equivalente in-memory ao enforcement do banco (migration
 * `20261009000004_init_athlete_moves.sql`): `UNIQUE(athlete_id, move_id)` para
 * distinção (R12.8) + constraint trigger de cardinalidade = 4 (R12.7). Para
 * todo conjunto de golpes atribuído, a atribuição é aceita se e somente se
 * contém exatamente quatro `move_id` e todos distintos entre si.
 */

/**
 * Oráculo independente da regra, escrito de forma distinta da implementação
 * sob teste (laço explícito acumulando duplicatas em vez de `Set`), para
 * servir de referência da equivalência.
 */
function referenceIsValid(moveIds: readonly number[]): boolean {
  if (moveIds.length !== REQUIRED_MOVE_COUNT) {
    return false;
  }
  for (let i = 0; i < moveIds.length; i++) {
    for (let j = i + 1; j < moveIds.length; j++) {
      if (moveIds[i] === moveIds[j]) {
        return false;
      }
    }
  }
  return true;
}

describe('Feature: pfl-foundation, Property 4: Atleta tem exatamente quatro golpes distintos', () => {
  it('aceita a atribuição ⇔ há exatamente 4 move_id e todos distintos (R12.7/R12.8)', () => {
    fc.assert(
      fc.property(
        // Listas de tamanho arbitrário (0..8) com move_id possivelmente
        // repetidos, cobrindo count != 4, count == 4 com duplicatas e
        // count == 4 todos distintos.
        fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 0, maxLength: 8 }),
        (moveIds) => {
          expect(assignMovesIsValid(moveIds)).toBe(referenceIsValid(moveIds));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('aceita todo conjunto de exatamente 4 golpes distintos', () => {
    fc.assert(
      fc.property(
        // Conjunto de 4 move_id garantidamente distintos.
        fc
          .uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
            minLength: REQUIRED_MOVE_COUNT,
            maxLength: REQUIRED_MOVE_COUNT,
          }),
        (moveIds) => {
          expect(assignMovesIsValid(moveIds)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejeita qualquer contagem diferente de 4, mesmo com todos distintos (R12.7)', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
            minLength: 0,
            maxLength: 12,
          })
          .filter((moveIds) => moveIds.length !== REQUIRED_MOVE_COUNT),
        (moveIds) => {
          expect(assignMovesIsValid(moveIds)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejeita 4 golpes que não são todos distintos (R12.8)', () => {
    fc.assert(
      fc.property(
        // Gera 4 valores a partir de um pool pequeno e exige ao menos uma
        // repetição, garantindo count == 4 com duplicata.
        fc
          .array(fc.integer({ min: 1, max: 3 }), {
            minLength: REQUIRED_MOVE_COUNT,
            maxLength: REQUIRED_MOVE_COUNT,
          })
          .filter((moveIds) => new Set(moveIds).size < REQUIRED_MOVE_COUNT),
        (moveIds) => {
          expect(assignMovesIsValid(moveIds)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
