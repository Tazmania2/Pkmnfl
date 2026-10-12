import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createInitialState } from './state';
import {
  SCORING_POINTS,
  classifyScoringOutcome,
  hasReachedOpponentEndZone,
  isInOwnEndZone,
  resolvePositionalScoring,
  scoreFieldGoal,
  scoreExtraPoint,
  scoreSafety,
  scoreTouchdown,
  scoreTwoPointConversion,
} from './fsm';
import { FIELD_LENGTH_YARDS } from './state';
import type { GameState, Team } from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test de posição da bola e eventos de pontuação coerentes (Task 12.6).
 *
 * // Feature: pfl-simulation-engine, Property 10: Posição da bola e eventos de
 * pontuação coerentes
 *
 * **Validates: Requirements 3.3, 3.5, 3.7**
 *
 * A posição da bola relativa às goal lines determina, de forma puramente
 * geométrica, o evento de pontuação posicional de uma jogada de ataque regular:
 *
 * - `ballOn >= FIELD_LENGTH_YARDS` (100) ⇒ touchdown: `classifyScoringOutcome`
 *   = `TOUCHDOWN` e `resolvePositionalScoring` credita 6 pontos ao time em posse,
 *   com fase `Touchdown` e `ScoringEntry` do tipo `TD` para o time em posse (R3.3).
 * - `ballOn <= 0` ⇒ safety: classificação `SAFETY` e `resolvePositionalScoring`
 *   credita 2 pontos ao **adversário** do time em posse, com fase `Safety` e
 *   `ScoringEntry` do tipo `SAFETY` para o adversário (R3.5).
 * - `0 < ballOn < 100` ⇒ `NONE`: `resolvePositionalScoring` devolve `null`; não
 *   há evento de pontuação posicional e o fluxo segue pelo down/distância (R3.7).
 *
 * Toda função é pura e imutável: o `GameState` de entrada nunca é mutado, e a
 * `ScoringEntry` carimba tipo, time beneficiado e quarto de forma coerente. A
 * **posse física legal** (nunca manipulação remota, R8.8/R10.7) é pré-condição
 * verificada a montante pelo pipeline; esta camada decide apenas a geometria,
 * então os geradores cobrem livremente `ballOn` dentro, nas bordas e além dos
 * limites do campo.
 */

/** Clima arbitrário para montar um `GameState` inicial válido. */
const weatherArb = fc.constantFrom(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
) as fc.Arbitrary<GameState['weather']>;

/** Time em posse arbitrário. */
const teamArb = fc.constantFrom('home', 'away') as fc.Arbitrary<Team>;

/** Quarto arbitrário (1..4). */
const quarterArb = fc.integer({ min: 1, max: 4 });

/**
 * `ballOn` arbitrário cobrindo além dos limites do campo (negativo e > 100),
 * nas bordas (0 e 100) e dentro de campo, para exercitar as três faixas da
 * classificação posicional.
 */
const ballOnAnyArb = fc.integer({ min: -20, max: 120 });

/** `ballOn` estritamente dentro de campo (sem pontuação posicional). */
const ballOnInFieldArb = fc.integer({ min: 1, max: FIELD_LENGTH_YARDS - 1 });

/** `ballOn` na/depois da end zone adversária (touchdown). */
const ballOnEndZoneArb = fc.integer({ min: FIELD_LENGTH_YARDS, max: 150 });

/** `ballOn` na/dentro da própria end zone (safety). */
const ballOnOwnEndZoneArb = fc.integer({ min: -50, max: 0 });

/** Snapshot do placar para checar imutabilidade. */
function scoreOf(state: GameState): { home: number; away: number } {
  return { home: state.score.home, away: state.score.away };
}

/** Monta um `GameState` com os campos relevantes para a propriedade. */
function makeState(
  weather: GameState['weather'],
  possession: Team,
  ballOn: number,
  quarter: number,
): GameState {
  return {
    ...createInitialState({ weather, possession }),
    ballOn,
    quarter,
  };
}

describe('Posição da bola e eventos de pontuação coerentes (Property 10)', () => {
  it('ballOn >= 100 ⇒ TOUCHDOWN: TD de 6 pts ao time em posse, fase Touchdown (R3.3)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        teamArb,
        ballOnEndZoneArb,
        quarterArb,
        (weather, possession, ballOn, quarter) => {
          const state = makeState(weather, possession, ballOn, quarter);

          expect(hasReachedOpponentEndZone(state)).toBe(true);
          expect(classifyScoringOutcome(state)).toBe('TOUCHDOWN');

          const result = resolvePositionalScoring(state);
          expect(result).not.toBeNull();
          if (result === null) return;

          // 6 pontos ao time em posse (R3.3).
          expect(result.points).toBe(SCORING_POINTS.TD);
          expect(result.points).toBe(6);
          expect(result.state.phase).toBe('Touchdown');

          // ScoringEntry coerente: tipo TD, time em posse, quarto corrente.
          expect(result.entry).toEqual({
            type: 'TD',
            team: possession,
            quarter,
          });

          // O placar do time em posse cresce exatamente 6; o adversário intacto.
          const opponent: Team = possession === 'home' ? 'away' : 'home';
          expect(result.state.score[possession]).toBe(
            state.score[possession] + 6,
          );
          expect(result.state.score[opponent]).toBe(state.score[opponent]);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('ballOn <= 0 ⇒ SAFETY: 2 pts ao ADVERSÁRIO, fase Safety (R3.5)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        teamArb,
        ballOnOwnEndZoneArb,
        quarterArb,
        (weather, possession, ballOn, quarter) => {
          const state = makeState(weather, possession, ballOn, quarter);
          const opponent: Team = possession === 'home' ? 'away' : 'home';

          expect(isInOwnEndZone(state)).toBe(true);
          expect(classifyScoringOutcome(state)).toBe('SAFETY');

          const result = resolvePositionalScoring(state);
          expect(result).not.toBeNull();
          if (result === null) return;

          // 2 pontos ao adversário do time em posse (R3.5).
          expect(result.points).toBe(SCORING_POINTS.SAFETY);
          expect(result.points).toBe(2);
          expect(result.state.phase).toBe('Safety');

          // ScoringEntry credita o adversário.
          expect(result.entry).toEqual({
            type: 'SAFETY',
            team: opponent,
            quarter,
          });

          // Placar: +2 ao adversário; time em posse intacto.
          expect(result.state.score[opponent]).toBe(
            state.score[opponent] + 2,
          );
          expect(result.state.score[possession]).toBe(
            state.score[possession],
          );
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('0 < ballOn < 100 ⇒ NONE: resolvePositionalScoring devolve null (R3.7)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        teamArb,
        ballOnInFieldArb,
        quarterArb,
        (weather, possession, ballOn, quarter) => {
          const state = makeState(weather, possession, ballOn, quarter);

          expect(hasReachedOpponentEndZone(state)).toBe(false);
          expect(isInOwnEndZone(state)).toBe(false);
          expect(classifyScoringOutcome(state)).toBe('NONE');
          expect(resolvePositionalScoring(state)).toBeNull();
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('classificação e resolução são coerentes em todo o domínio de ballOn (R3.3, R3.5, R3.7)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        teamArb,
        ballOnAnyArb,
        quarterArb,
        (weather, possession, ballOn, quarter) => {
          const state = makeState(weather, possession, ballOn, quarter);
          const outcome = classifyScoringOutcome(state);
          const result = resolvePositionalScoring(state);

          // Precedência: end zone adversária domina a própria; faixas exclusivas.
          if (ballOn >= FIELD_LENGTH_YARDS) {
            expect(outcome).toBe('TOUCHDOWN');
            expect(result?.entry.type).toBe('TD');
          } else if (ballOn <= 0) {
            expect(outcome).toBe('SAFETY');
            expect(result?.entry.type).toBe('SAFETY');
          } else {
            expect(outcome).toBe('NONE');
            expect(result).toBeNull();
          }

          // resolvePositionalScoring devolve algo sse e somente se há pontuação.
          expect(result !== null).toBe(outcome !== 'NONE');
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('todos os eventos de pontuação creditam o time e o valor corretos, imutavelmente (R3.3, R3.5)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        teamArb,
        fc.integer({ min: 0, max: FIELD_LENGTH_YARDS }),
        quarterArb,
        (weather, possession, ballOn, quarter) => {
          const state = makeState(weather, possession, ballOn, quarter);
          const before = scoreOf(state);
          const opponent: Team = possession === 'home' ? 'away' : 'home';

          const td = scoreTouchdown(state);
          const fg = scoreFieldGoal(state);
          const safety = scoreSafety(state);
          const pat = scoreExtraPoint(state);
          const twoPt = scoreTwoPointConversion(state);

          // Valores conforme a edição NFL 2026 (R3.3–R3.6, R3.8).
          expect(td.points).toBe(6);
          expect(fg.points).toBe(3);
          expect(safety.points).toBe(2);
          expect(pat.points).toBe(1);
          expect(twoPt.points).toBe(2);

          // Time beneficiado: posse para TD/FG/PAT/2pt; adversário no safety.
          expect(td.entry.team).toBe(possession);
          expect(fg.entry.team).toBe(possession);
          expect(pat.entry.team).toBe(possession);
          expect(twoPt.entry.team).toBe(possession);
          expect(safety.entry.team).toBe(opponent);

          // Quarto carimbado coerente em todas as entradas.
          for (const r of [td, fg, safety, pat, twoPt]) {
            expect(r.entry.quarter).toBe(quarter);
          }

          // Imutabilidade: o estado de entrada permanece intacto.
          expect(scoreOf(state)).toEqual(before);
          expect(state.phase).toBe('Kickoff');
          expect(state.ballOn).toBe(ballOn);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
