import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  type RosterState,
  emptyRoster,
  hasInstance,
  insertAthlete,
} from './instance-id';

/**
 * Teste de propriedade da unicidade de `instance_id` por time (Task 10.7).
 *
 * **Feature: pfl-foundation, Property 7: Unicidade de instance_id por time**
 *
 * Validates: Requirements 12.2, 12.3
 *
 * Modela, in-memory, o invariante imposto pela restrição
 * `UNIQUE (team_id, instance_id)` da tabela de atletas (migration
 * `20261009000003_init_teams.sql`). Para toda sequência de inserções:
 * - dentro de um mesmo time, nunca há dois registros com o mesmo
 *   `instance_id`;
 * - uma inserção com `instance_id` já presente no mesmo time é rejeitada e o
 *   registro existente é preservado;
 * - times diferentes podem reutilizar o mesmo `instance_id`.
 */

/** Uma instrução de inserção gerada pelo fast-check. */
interface InsertCommand {
  readonly teamId: string;
  readonly instanceId: number;
  readonly payload: number;
}

/** Chave composta para checagens de referência. */
function key(teamId: string, instanceId: number): string {
  return `${teamId}#${instanceId}`;
}

describe('Feature: pfl-foundation, Property 7: Unicidade de instance_id por time', () => {
  it('nenhum time tem instance_id duplicado; duplicata é rejeitada e o registro existente é preservado (R12.2, R12.3)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 0, maxLength: 40 }),
        (seeds) => {
          // Materializa comandos; cada posição recebe um payload distinto
          // (o próprio índice) para detectar qualquer sobrescrita indevida.
          const commands: InsertCommand[] = seeds.map((seed, index) => ({
            teamId: (['team-A', 'team-B', 'team-C'] as const)[seed % 3]!,
            instanceId: (seed % 6) + 1,
            payload: index,
          }));

          let state: RosterState = emptyRoster();

          // Oráculo independente: primeiro payload aceito por chave composta.
          const firstPayloadByKey = new Map<string, number>();

          for (const cmd of commands) {
            const k = key(cmd.teamId, cmd.instanceId);
            const existedBefore = hasInstance(
              state,
              cmd.teamId,
              cmd.instanceId,
            );

            const result = insertAthlete(
              state,
              cmd.teamId,
              cmd.instanceId,
              cmd.payload,
            );

            if (existedBefore) {
              // Já havia o par: deve ser rejeitado.
              expect(result.ok).toBe(false);
              if (result.ok === false) {
                expect(result.reason).toBe('duplicate_instance_id');
              }
              // Estado inalterado: mesma referência de array interno.
              expect(result.state).toBe(state);
            } else {
              // Par inédito: deve ser aceito.
              expect(result.ok).toBe(true);
              firstPayloadByKey.set(k, cmd.payload);
            }

            state = result.state;
          }

          // Invariante central: unicidade de (teamId, instanceId).
          const seen = new Set<string>();
          for (const athlete of state.athletes) {
            const k = key(athlete.teamId, athlete.instanceId);
            expect(seen.has(k)).toBe(false);
            seen.add(k);
          }

          // Preservação: o payload final de cada chave é o do primeiro aceito.
          for (const athlete of state.athletes) {
            const k = key(athlete.teamId, athlete.instanceId);
            expect(athlete.payload).toBe(firstPayloadByKey.get(k));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('times diferentes podem reutilizar o mesmo instance_id (R12.2)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (instanceId, teamA, teamB) => {
          fc.pre(teamA !== teamB);

          let state = emptyRoster();
          const r1 = insertAthlete(state, teamA, instanceId, 'a');
          expect(r1.ok).toBe(true);
          state = r1.state;

          // Mesmo instanceId, time diferente: deve ser aceito.
          const r2 = insertAthlete(state, teamB, instanceId, 'b');
          expect(r2.ok).toBe(true);
          state = r2.state;

          expect(state.athletes).toHaveLength(2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('exemplo: segunda inserção do mesmo (time, instance_id) é rejeitada e preserva a primeira', () => {
    let state = emptyRoster();
    const first = insertAthlete(state, 'team-A', 7, 'original');
    expect(first.ok).toBe(true);
    state = first.state;

    const second = insertAthlete(state, 'team-A', 7, 'intruso');
    expect(second.ok).toBe(false);
    if (second.ok === false) {
      expect(second.reason).toBe('duplicate_instance_id');
    }
    state = second.state;

    expect(state.athletes).toHaveLength(1);
    expect(state.athletes[0]?.payload).toBe('original');
  });
});
