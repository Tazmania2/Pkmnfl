/**
 * Testes unitários das regras de pontuação e posição da bola (Task 12.2).
 *
 * Cobrem os valores de pontos da NFL 2026 (R3.3–R3.6), a leitura da posição da
 * bola relativa às goal lines para touchdown/safety (R3.7) e a imutabilidade /
 * composição com as transições de 12.1. Property tests (12.6, 13.9) são tasks
 * separadas; aqui ficam exemplos e bordas.
 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import {
  SCORING_POINTS,
  classifyScoringOutcome,
  enterExtraPointPhase,
  hasReachedOpponentEndZone,
  isInOwnEndZone,
  resolvePositionalScoring,
  scoreExtraPoint,
  scoreFieldGoal,
  scoreSafety,
  scoreTouchdown,
  scoreTwoPointConversion,
} from './fsm';
import type { GameState } from './types';

function stateWith(patch: Partial<GameState>): GameState {
  return { ...createInitialState({ weather: 'CLEAR' }), ...patch };
}

describe('SCORING_POINTS (NFL 2026, R3.3–R3.6, R3.8)', () => {
  it('usa os valores oficiais por tipo', () => {
    expect(SCORING_POINTS).toEqual({ TD: 6, FG: 3, SAFETY: 2, PAT: 1, TWO_PT: 2 });
  });
});

describe('posição da bola relativa às goal lines (R3.7)', () => {
  it('detecta touchdown quando ballOn >= 100', () => {
    expect(hasReachedOpponentEndZone(stateWith({ ballOn: 100 }))).toBe(true);
    expect(hasReachedOpponentEndZone(stateWith({ ballOn: 99 }))).toBe(false);
  });

  it('detecta safety quando ballOn <= 0', () => {
    expect(isInOwnEndZone(stateWith({ ballOn: 0 }))).toBe(true);
    expect(isInOwnEndZone(stateWith({ ballOn: 1 }))).toBe(false);
  });

  it('classifica TOUCHDOWN, SAFETY e NONE pela posição', () => {
    expect(classifyScoringOutcome(stateWith({ ballOn: 100 }))).toBe('TOUCHDOWN');
    expect(classifyScoringOutcome(stateWith({ ballOn: 0 }))).toBe('SAFETY');
    expect(classifyScoringOutcome(stateWith({ ballOn: 50 }))).toBe('NONE');
  });
});

describe('touchdown (6) e habilitação de PAT/2pt (R3.3)', () => {
  it('credita 6 ao time em posse e entra em Touchdown', () => {
    const base = stateWith({ possession: 'home', ballOn: 100, quarter: 2 });
    const result = scoreTouchdown(base);
    expect(result.points).toBe(6);
    expect(result.state.score).toEqual({ home: 6, away: 0 });
    expect(result.state.phase).toBe('Touchdown');
    expect(result.entry).toEqual({ type: 'TD', team: 'home', quarter: 2 });
    // imutabilidade: estado de entrada intacto
    expect(base.score).toEqual({ home: 0, away: 0 });
    expect(base.phase).toBe('Kickoff');
  });

  it('habilita ExtraPointPhase após o touchdown', () => {
    const td = scoreTouchdown(stateWith({ possession: 'away', ballOn: 100 }));
    expect(enterExtraPointPhase(td.state).phase).toBe('ExtraPointPhase');
  });
});

describe('field goal (3) — R3.4', () => {
  it('credita 3 ao time que chutou e vai a Kickoff', () => {
    const result = scoreFieldGoal(stateWith({ possession: 'away' }));
    expect(result.points).toBe(3);
    expect(result.state.score).toEqual({ home: 0, away: 3 });
    expect(result.state.phase).toBe('Kickoff');
    expect(result.entry.type).toBe('FG');
    expect(result.entry.team).toBe('away');
  });
});

describe('safety (2 ao adversário) — R3.5', () => {
  it('credita 2 ao adversário do time em posse e entra em Safety', () => {
    const result = scoreSafety(stateWith({ possession: 'home', ballOn: 0 }));
    expect(result.points).toBe(2);
    // posse era home → safety beneficia away
    expect(result.state.score).toEqual({ home: 0, away: 2 });
    expect(result.state.phase).toBe('Safety');
    expect(result.entry).toMatchObject({ type: 'SAFETY', team: 'away' });
  });
});

describe('ponto extra (1) e conversão de 2 pontos (2) — R3.6', () => {
  it('PAT credita 1 ao time que marcou e vai a Kickoff', () => {
    const result = scoreExtraPoint(stateWith({ possession: 'home', phase: 'ExtraPointPhase' }));
    expect(result.points).toBe(1);
    expect(result.state.score).toEqual({ home: 1, away: 0 });
    expect(result.state.phase).toBe('Kickoff');
    expect(result.entry.type).toBe('PAT');
  });

  it('conversão de 2 pontos credita 2 ao time que marcou', () => {
    const result = scoreTwoPointConversion(
      stateWith({ possession: 'away', phase: 'ExtraPointPhase' }),
    );
    expect(result.points).toBe(2);
    expect(result.state.score).toEqual({ home: 0, away: 2 });
    expect(result.state.phase).toBe('Kickoff');
    expect(result.entry.type).toBe('TWO_PT');
  });
});

describe('resolvePositionalScoring — integração com 12.1', () => {
  it('resolve touchdown quando a bola alcança a end zone adversária', () => {
    const result = resolvePositionalScoring(stateWith({ possession: 'home', ballOn: 100 }));
    expect(result?.entry.type).toBe('TD');
    expect(result?.state.phase).toBe('Touchdown');
  });

  it('resolve safety quando a bola está morta na própria end zone', () => {
    const result = resolvePositionalScoring(stateWith({ possession: 'away', ballOn: 0 }));
    expect(result?.entry.type).toBe('SAFETY');
    expect(result?.entry.team).toBe('home');
    expect(result?.state.phase).toBe('Safety');
  });

  it('devolve null quando a bola está dentro de campo', () => {
    expect(resolvePositionalScoring(stateWith({ ballOn: 42 }))).toBeNull();
  });
});
