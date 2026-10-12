/**
 * Property test — special teams acionados por estado, não por acaso
 * (`lib/sim/fsm.specialteams.test.ts`).
 *
 * Feature: pfl-simulation-engine, Property 34
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4
 *
 * Property 34 verifica que a seleção de special teams é uma **função pura e
 * determinística do estado do jogo** (fase + decisão explícita de 4º down),
 * nunca sorteada: o par (ofensiva ST, defensiva ST) é inteiramente determinado
 * pela `SpecialTeamsSituation` classificada a partir do estado, segundo a tabela
 * canônica `SPECIAL_TEAMS_TRIGGERS`.
 *
 * - R11.1: fase `Kickoff` → `KICKOFF` → `ST_O_KICKOFF` + `ST_D_KICK_RETURN`.
 * - R11.2: decisão de punt no 4º down → `PUNT` → `ST_O_PUNT` + `ST_D_PUNT_RETURN`.
 * - R11.3: tentativa de FG / ponto extra → `FIELD_GOAL` → `ST_O_FIELD_GOAL`
 *   + `ST_D_KICK_BLOCK`.
 * - R11.4: fases regulares de scrimmage → `NONE` → `selectSpecialTeams` = `null`;
 *   e determinismo (mesmo `(state, choice)` → mesmo resultado, sem RNG — as
 *   funções não recebem argumento `Rng`, determinismo em nível de assinatura).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  classifySpecialTeamsSituation,
  selectSpecialTeams,
  isSpecialTeamsState,
  SPECIAL_TEAMS_TRIGGERS,
  type FourthDownChoice,
} from './fsm';
import { createInitialState } from './state';
import type { GamePhase, Weather } from './types';
import { PBT_NUM_RUNS } from './test-setup';

// Todas as fases da FSM (espelha `GamePhase` em types.ts).
const ALL_PHASES: readonly GamePhase[] = [
  'Kickoff',
  'Drive',
  'FourthDownDecision',
  'Punt',
  'FieldGoalAtt',
  'Touchdown',
  'ExtraPointPhase',
  'Safety',
  'Turnover',
  'ChangePossession',
  'EndOfQuarter',
  'EndOfGame',
];

// Fases que NÃO acionam special teams por si só (R11.4). `FourthDownDecision`
// fica de fora porque depende da `choice` (pode acionar punt ou FG).
const NON_ST_PHASES: readonly GamePhase[] = [
  'Drive',
  'Touchdown',
  'Safety',
  'Turnover',
  'ChangePossession',
  'EndOfQuarter',
  'EndOfGame',
];

const ALL_CHOICES: readonly (FourthDownChoice | undefined)[] = [
  'PUNT',
  'FIELD_GOAL',
  'GO_FOR_IT',
  undefined,
];

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];

const phaseArb = fc.constantFrom(...ALL_PHASES);
const choiceArb = fc.constantFrom(...ALL_CHOICES);
const weatherArb = fc.constantFrom(...WEATHERS);
const possessionArb = fc.constantFrom('home' as const, 'away' as const);

/** Constrói um GameState via o construtor canônico, sobrescrevendo a fase. */
function stateWithPhase(
  phase: GamePhase,
  weather: Weather,
  possession: 'home' | 'away',
) {
  return { ...createInitialState({ weather, possession }), phase };
}

describe('Property 34 — special teams acionados por estado, não por acaso', () => {
  it('R11.1: fase Kickoff → KICKOFF → ST_O_KICKOFF + ST_D_KICK_RETURN', () => {
    fc.assert(
      fc.property(weatherArb, possessionArb, choiceArb, (w, p, choice) => {
        const state = stateWithPhase('Kickoff', w, p);
        expect(classifySpecialTeamsSituation(state, choice)).toBe('KICKOFF');
        const pair = selectSpecialTeams(state, choice);
        expect(pair).toEqual({
          offense: 'ST_O_KICKOFF',
          defense: 'ST_D_KICK_RETURN',
        });
        expect(pair).toEqual(SPECIAL_TEAMS_TRIGGERS.KICKOFF);
        expect(isSpecialTeamsState(state, choice)).toBe(true);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R11.2: decisão de punt no 4º down → PUNT → ST_O_PUNT + ST_D_PUNT_RETURN', () => {
    fc.assert(
      fc.property(weatherArb, possessionArb, (w, p) => {
        // Fase Punt sempre; e FourthDownDecision com choice=PUNT.
        for (const state of [
          stateWithPhase('Punt', w, p),
          stateWithPhase('FourthDownDecision', w, p),
        ]) {
          const choice: FourthDownChoice | undefined =
            state.phase === 'Punt' ? undefined : 'PUNT';
          expect(classifySpecialTeamsSituation(state, choice)).toBe('PUNT');
          const pair = selectSpecialTeams(state, choice);
          expect(pair).toEqual({
            offense: 'ST_O_PUNT',
            defense: 'ST_D_PUNT_RETURN',
          });
          expect(pair).toEqual(SPECIAL_TEAMS_TRIGGERS.PUNT);
          expect(isSpecialTeamsState(state, choice)).toBe(true);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R11.3: FG / ponto extra → FIELD_GOAL → ST_O_FIELD_GOAL + ST_D_KICK_BLOCK', () => {
    fc.assert(
      fc.property(weatherArb, possessionArb, (w, p) => {
        // FieldGoalAtt e ExtraPointPhase (sem choice); FourthDownDecision + FIELD_GOAL.
        const cases: Array<[GamePhase, FourthDownChoice | undefined]> = [
          ['FieldGoalAtt', undefined],
          ['ExtraPointPhase', undefined],
          ['FourthDownDecision', 'FIELD_GOAL'],
        ];
        for (const [phase, choice] of cases) {
          const state = stateWithPhase(phase, w, p);
          expect(classifySpecialTeamsSituation(state, choice)).toBe(
            'FIELD_GOAL',
          );
          const pair = selectSpecialTeams(state, choice);
          expect(pair).toEqual({
            offense: 'ST_O_FIELD_GOAL',
            defense: 'ST_D_KICK_BLOCK',
          });
          expect(pair).toEqual(SPECIAL_TEAMS_TRIGGERS.FIELD_GOAL);
          expect(isSpecialTeamsState(state, choice)).toBe(true);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R11.4: fases de scrimmage regular → NONE → selectSpecialTeams = null', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_ST_PHASES),
        weatherArb,
        possessionArb,
        choiceArb,
        (phase, w, p, choice) => {
          const state = stateWithPhase(phase, w, p);
          // Fases regulares nunca acionam ST, independentemente da choice.
          expect(classifySpecialTeamsSituation(state, choice)).toBe('NONE');
          expect(selectSpecialTeams(state, choice)).toBeNull();
          expect(isSpecialTeamsState(state, choice)).toBe(false);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R11.4: 4º down com GO_FOR_IT / sem decisão → NONE (segue scrimmage)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        possessionArb,
        fc.constantFrom('GO_FOR_IT' as const, undefined),
        (w, p, choice) => {
          const state = stateWithPhase('FourthDownDecision', w, p);
          expect(classifySpecialTeamsSituation(state, choice)).toBe('NONE');
          expect(selectSpecialTeams(state, choice)).toBeNull();
          expect(isSpecialTeamsState(state, choice)).toBe(false);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R11.4: determinismo — mesmo (state, choice) → mesmo resultado em chamadas repetidas', () => {
    fc.assert(
      fc.property(phaseArb, choiceArb, weatherArb, possessionArb, (phase, choice, w, p) => {
        const state = stateWithPhase(phase, w, p);
        const first = selectSpecialTeams(state, choice);
        for (let i = 0; i < 5; i++) {
          expect(classifySpecialTeamsSituation(state, choice)).toBe(
            classifySpecialTeamsSituation(state, choice),
          );
          expect(selectSpecialTeams(state, choice)).toEqual(first);
          expect(isSpecialTeamsState(state, choice)).toBe(first !== null);
        }
        // A seleção, quando existe, coincide com a tabela canônica (nunca
        // aleatória): o par pertence a SPECIAL_TEAMS_TRIGGERS.
        if (first !== null) {
          const situation = classifySpecialTeamsSituation(state, choice);
          expect(situation).not.toBe('NONE');
          expect(first).toEqual(
            SPECIAL_TEAMS_TRIGGERS[
              situation as Exclude<typeof situation, 'NONE'>
            ],
          );
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
