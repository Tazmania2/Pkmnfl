/**
 * Property test — empate ao fim do tempo regulamentar vira pendência (R2.5).
 *
 * Feature: pfl-simulation-engine, Property 8
 *
 * Property 8: Ao fim do tempo regulamentar (4º quarto, relógio zerado), um
 * placar empatado produz uma `Decisao_Produto_Pendente` de prolongamento
 * (`OVERTIME_NOT_IN_MVP`); um placar decidido não produz pendência. Em ambos os
 * casos o `Score` é final e a fase do estado é `EndOfGame`. `resolveClockBoundary`
 * no 4º quarto com relógio zerado é consistente com `finalizeGame`.
 *
 * Validates: Requirements 2.5
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { finalizeGame, resolveClockBoundary } from './fsm';
import { createInitialState } from './state';
import { TOTAL_QUARTERS } from './clock';
import { PBT_NUM_RUNS } from './test-setup';
import type { GameState } from './types';

/**
 * Monta um `GameState` no fim do tempo regulamentar: 4º quarto, relógio zerado e
 * placar informado. Parte do estado inicial canônico e sobrescreve apenas os
 * campos relevantes para a propriedade.
 */
function atRegulationEnd(home: number, away: number): GameState {
  const base = createInitialState({ weather: 'CLEAR' });
  return {
    ...base,
    quarter: TOTAL_QUARTERS,
    gameClockDeci: 0,
    score: { home, away },
  };
}

/** Pontuação arbitrária plausível de uma partida (0..70). */
const scoreArb = fc.integer({ min: 0, max: 70 });

describe('Property 8 — empate ao fim do tempo regulamentar vira pendência (R2.5)', () => {
  it('empate (home === away) → pendência OVERTIME_NOT_IN_MVP, Score final, EndOfGame', () => {
    fc.assert(
      fc.property(scoreArb, (points) => {
        const result = finalizeGame(atRegulationEnd(points, points));

        expect(result.score.tie).toBe(true);
        expect(result.score.final).toBe(true);
        expect(result.state.phase).toBe('EndOfGame');
        expect(result.pendingDecision).toBeDefined();
        expect(result.pendingDecision?.reason).toBe('OVERTIME_NOT_IN_MVP');
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('placar decidido (home !== away) → sem pendência, Score final não empatado', () => {
    fc.assert(
      fc.property(scoreArb, scoreArb, (home, away) => {
        fc.pre(home !== away);
        const result = finalizeGame(atRegulationEnd(home, away));

        expect(result.pendingDecision).toBeUndefined();
        expect(result.score.tie).toBe(false);
        expect(result.score.final).toBe(true);
        expect(result.state.phase).toBe('EndOfGame');
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('resolveClockBoundary no 4º quarto com relógio zerado é consistente com finalizeGame', () => {
    fc.assert(
      fc.property(scoreArb, scoreArb, (home, away) => {
        const state = atRegulationEnd(home, away);
        const boundary = resolveClockBoundary(state);
        const expected = finalizeGame(state);

        // Fim de jogo: há um desfecho `end` consistente com finalizeGame.
        expect(boundary.end).toBeDefined();
        expect(boundary.end?.score).toEqual(expected.score);
        expect(boundary.state.phase).toBe('EndOfGame');

        if (home === away) {
          expect(boundary.end?.pendingDecision).toBeDefined();
          expect(boundary.end?.pendingDecision?.reason).toBe(
            'OVERTIME_NOT_IN_MVP',
          );
        } else {
          expect(boundary.end?.pendingDecision).toBeUndefined();
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
