import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEFAULT_DISTANCE_YARDS,
  DOWNS_PER_SET,
  FIELD_LENGTH_YARDS,
  advancePossession,
  classifyDownOutcome,
} from './fsm';
import { createInitialState, opponentOf } from './state';
import type { PlayResolution } from './state';
import type { GameState, Team } from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test de downs, distância e troca de posse (Task 12.5).
 *
 * // Feature: pfl-simulation-engine, Property 9: Downs, distância e troca de posse
 *
 * **Validates: Requirements 3.1, 3.2**
 *
 * Para toda sequência de ganhos de jardas em um drive:
 * - alcançar a `Distancia` necessária (`yardsGained >= distance`) classifica o
 *   desfecho como `FIRST_DOWN` e `advancePossession` reinicia o conjunto para
 *   1º & 10, preservando a posse (R3.1);
 * - não alcançá-la em um down anterior ao 4º classifica como `NEXT_DOWN`,
 *   incrementando o down e reduzindo a distância restante, sem trocar a posse;
 * - não alcançá-la no 4º down classifica como `TURNOVER_ON_DOWNS` e
 *   `advancePossession` transfere a posse ao adversário na posição corrente da
 *   bola (`ballOn` espelhado para `100 - ballOn`), com 1º & 10 para o novo
 *   ataque (R3.2);
 * - uma jogada que troca a posse por fumble/INT (`possessionChanges = true`)
 *   troca a posse independentemente de down/distância.
 *
 * A propriedade é verificável integralmente aqui porque `classifyDownOutcome` e
 * `advancePossession` são transições puras `(GameState, yards/PlayResolution) →
 * ...` sem RNG: dado qualquer `GameState` arbitrário (down 1..4, distância,
 * `ballOn` 0..100, posse) e qualquer `yardsGained`, o desfecho é totalmente
 * determinado pelas regras de down/distância da NFL.
 */

// ---------------------------------------------------------------------------
// Arbitrários sobre um GameState em drive e as jardas ganhas
// ---------------------------------------------------------------------------

const weatherArb = fc.constantFrom(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
) as fc.Arbitrary<GameState['weather']>;

const teamArb = fc.constantFrom('home', 'away') as fc.Arbitrary<Team>;

/** Down corrente no intervalo legal 1..DOWNS_PER_SET. */
const downArb = fc.integer({ min: 1, max: DOWNS_PER_SET });

/** Distância a conquistar: 1..20 jardas (cobre curtas e longas). */
const distanceArb = fc.integer({ min: 1, max: 20 });

/** Posição da bola relativa às goal lines, dentro do campo. */
const ballOnArb = fc.integer({ min: 0, max: FIELD_LENGTH_YARDS });

/** Jardas líquidas ganhas: de perdas a ganhos amplos. */
const yardsGainedArb = fc.integer({ min: -10, max: 40 });

/**
 * Monta um `GameState` em fase `Drive` a partir dos campos arbitrários,
 * reutilizando o estado inicial canônico para os demais campos.
 */
function driveState(fields: {
  readonly down: number;
  readonly distance: number;
  readonly ballOn: number;
  readonly possession: Team;
  readonly weather: GameState['weather'];
}): GameState {
  const base = createInitialState({
    weather: fields.weather,
    possession: fields.possession,
  });
  return {
    ...base,
    phase: 'Drive',
    down: fields.down,
    distance: fields.distance,
    ballOn: fields.ballOn,
  };
}

const stateArb: fc.Arbitrary<GameState> = fc
  .record({
    down: downArb,
    distance: distanceArb,
    ballOn: ballOnArb,
    possession: teamArb,
    weather: weatherArb,
  })
  .map(driveState);

describe('Downs, distância e troca de posse (Property 9)', () => {
  it('ganho >= distância classifica FIRST_DOWN e concede novo conjunto 1º & 10, preservando a posse (R3.1)', () => {
    fc.assert(
      fc.property(stateArb, yardsGainedArb, (state, rawYards) => {
        // Força o ganho a alcançar a distância.
        const yardsGained = state.distance + Math.max(0, rawYards);

        expect(classifyDownOutcome(state, yardsGained)).toBe('FIRST_DOWN');

        const resolution: PlayResolution = { yardsGained };
        const next = advancePossession(state, resolution);

        // Novo conjunto de downs: 1º & 10, mesma posse, fase Drive.
        expect(next.down).toBe(1);
        expect(next.distance).toBe(DEFAULT_DISTANCE_YARDS);
        expect(next.possession).toBe(state.possession);
        expect(next.phase).toBe('Drive');
        // Esta transição não espelha a bola (sem troca de posse).
        expect(next.ballOn).toBe(state.ballOn);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('ganho < distância em down < 4 classifica NEXT_DOWN: incrementa o down, reduz a distância, mantém a posse', () => {
    fc.assert(
      fc.property(
        fc
          .record({
            down: fc.integer({ min: 1, max: DOWNS_PER_SET - 1 }),
            distance: distanceArb,
            ballOn: ballOnArb,
            possession: teamArb,
            weather: weatherArb,
          })
          .map(driveState),
        yardsGainedArb,
        (state, rawYards) => {
          // Força o ganho a NÃO alcançar a distância.
          const yardsGained = Math.min(rawYards, state.distance - 1);

          expect(classifyDownOutcome(state, yardsGained)).toBe('NEXT_DOWN');

          const next = advancePossession(state, { yardsGained });

          // Down incrementa; distância reduz pelo ganho (nunca < 0); posse igual.
          expect(next.down).toBe(state.down + 1);
          expect(next.distance).toBe(
            Math.max(0, state.distance - yardsGained),
          );
          expect(next.distance).toBeGreaterThanOrEqual(0);
          expect(next.possession).toBe(state.possession);
          expect(next.phase).toBe('Drive');
          // Sem troca de posse: a bola não é espelhada por esta transição.
          expect(next.ballOn).toBe(state.ballOn);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('ganho < distância no 4º down classifica TURNOVER_ON_DOWNS: troca a posse, espelha ballOn, reinicia 1º & 10 (R3.2)', () => {
    fc.assert(
      fc.property(
        fc
          .record({
            down: fc.constant(DOWNS_PER_SET),
            distance: distanceArb,
            ballOn: ballOnArb,
            possession: teamArb,
            weather: weatherArb,
          })
          .map(driveState),
        yardsGainedArb,
        (state, rawYards) => {
          const yardsGained = Math.min(rawYards, state.distance - 1);

          expect(classifyDownOutcome(state, yardsGained)).toBe(
            'TURNOVER_ON_DOWNS',
          );

          const next = advancePossession(state, { yardsGained });

          // Posse transferida ao adversário na posição corrente (espelhada).
          expect(next.possession).toBe(opponentOf(state.possession));
          expect(next.ballOn).toBe(FIELD_LENGTH_YARDS - state.ballOn);
          // Novo ataque começa em 1º & 10.
          expect(next.down).toBe(1);
          expect(next.distance).toBe(DEFAULT_DISTANCE_YARDS);
          expect(next.phase).toBe('ChangePossession');
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('possessionChanges = true (fumble/INT) troca a posse independentemente de down/distância', () => {
    fc.assert(
      fc.property(stateArb, yardsGainedArb, (state, yardsGained) => {
        const resolution: PlayResolution = {
          yardsGained,
          possessionChanges: true,
        };
        const next = advancePossession(state, resolution);

        // Troca de posse com bola espelhada e novo conjunto 1º & 10.
        expect(next.possession).toBe(opponentOf(state.possession));
        expect(next.ballOn).toBe(FIELD_LENGTH_YARDS - state.ballOn);
        expect(next.down).toBe(1);
        expect(next.distance).toBe(DEFAULT_DISTANCE_YARDS);
        expect(next.phase).toBe('ChangePossession');
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a classificação é exaustiva e coerente com as regras de down/distância para qualquer estado e ganho', () => {
    fc.assert(
      fc.property(stateArb, yardsGainedArb, (state, yardsGained) => {
        const outcome = classifyDownOutcome(state, yardsGained);

        if (yardsGained >= state.distance) {
          expect(outcome).toBe('FIRST_DOWN');
        } else if (state.down < DOWNS_PER_SET) {
          expect(outcome).toBe('NEXT_DOWN');
        } else {
          expect(outcome).toBe('TURNOVER_ON_DOWNS');
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
