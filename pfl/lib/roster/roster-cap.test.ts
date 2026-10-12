import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ROSTER_CAP,
  emptyRoster,
  insertAthlete,
  rosterCount,
  type RosterState,
} from './roster-cap';

/**
 * Teste de propriedade do teto do Roster (Task 10.5).
 *
 * **Feature: pfl-foundation, Property 3: Teto do roster nunca excedido**
 *
 * Validates: Requirements 13.1, 13.2, 13.3 (decisão D-3, Correctness Property
 * P-3).
 *
 * Para toda sequência de inserções de atletas em um mesmo `team_id`, a
 * contagem de atletas do time após as operações nunca excede 53, e toda
 * inserção que levaria o total acima de 53 é rejeitada preservando o estado
 * anterior do roster. O modelo in-memory (`insertAthlete`) é um SUT
 * equivalente ao trigger `BEFORE INSERT` da migration de roster_cap.
 */

/** Aplica uma sequência de inserções, retornando o estado final. */
function applyInsertions(
  initial: RosterState,
  teamIds: readonly string[],
): RosterState {
  let state = initial;
  for (const teamId of teamIds) {
    const result = insertAthlete(state, teamId);
    state = result.state;
  }
  return state;
}

describe('Feature: pfl-foundation, Property 3: Teto do roster nunca excedido', () => {
  it('a contagem de qualquer time nunca excede 53 após uma sequência de inserções (R13.1)', () => {
    fc.assert(
      fc.property(
        // Sequências de inserções sobre um pequeno conjunto de times, com
        // comprimento suficiente para ultrapassar o teto de muitos times.
        fc.array(
          fc.constantFrom('team-a', 'team-b', 'team-c'),
          { minLength: 0, maxLength: 200 },
        ),
        (teamIds) => {
          const finalState = applyInsertions(emptyRoster(), teamIds);
          for (const count of finalState.values()) {
            expect(count).toBeLessThanOrEqual(ROSTER_CAP);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('toda inserção acima de 53 é rejeitada e preserva o estado anterior (R13.2, R13.3)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('team-a', 'team-b', 'team-c'),
        // Começa com um time já no teto ou acima, para exercitar a rejeição.
        fc.integer({ min: ROSTER_CAP, max: ROSTER_CAP + 20 }),
        (teamId, startCount) => {
          const prior: RosterState = new Map([[teamId, startCount]]);
          const result = insertAthlete(prior, teamId);

          // A inserção é rejeitada quando o time já atingiu o teto.
          expect(result.accepted).toBe(false);
          // O estado anterior é preservado: contagem inalterada.
          expect(rosterCount(result.state, teamId)).toBe(startCount);
          // Nenhuma mutação do estado original (mesma referência preservada).
          expect(result.state).toBe(prior);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a 54ª inserção num time vazio é a primeira a ser rejeitada (R13.1, R13.3)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('team-a', 'team-b', 'team-c'),
        (teamId) => {
          let state = emptyRoster();
          // As primeiras 53 inserções são aceitas.
          for (let i = 0; i < ROSTER_CAP; i++) {
            const result = insertAthlete(state, teamId);
            expect(result.accepted).toBe(true);
            state = result.state;
          }
          expect(rosterCount(state, teamId)).toBe(ROSTER_CAP);

          // A 54ª é rejeitada e o estado permanece em 53.
          const rejected = insertAthlete(state, teamId);
          expect(rejected.accepted).toBe(false);
          expect(rosterCount(rejected.state, teamId)).toBe(ROSTER_CAP);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('inserções em um time não afetam a contagem de outros times', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('team-a', 'team-b', 'team-c'),
          { minLength: 0, maxLength: 200 },
        ),
        (teamIds) => {
          const finalState = applyInsertions(emptyRoster(), teamIds);
          // A contagem de cada time é exatamente min(aparições, 53).
          for (const teamId of ['team-a', 'team-b', 'team-c']) {
            const appearances = teamIds.filter((t) => t === teamId).length;
            const expected = Math.min(appearances, ROSTER_CAP);
            expect(rosterCount(finalState, teamId)).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
