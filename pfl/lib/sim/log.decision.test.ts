/**
 * Property test de log de decisão e fatores de situação por snap
 * (`lib/sim/log.decision.test.ts`) — Task 13.10.
 *
 * // Feature: pfl-simulation-engine, Property 13: Todo snap registra decisão e
 * // fatores de situação.
 *
 * **Validates: Requirements 4.5**
 *
 * R4.5 exige que, para **cada snap**, o `Log_Partida` registre a decisão de
 * jogada (a `Jogada_Ofensiva` e a `Jogada_Defensiva` escolhidas) **e** os
 * fatores de situação que motivaram a escolha (down, distância, posição no campo
 * e clima). No pipeline (`resolvePlay`, fase (a)/(h)), isso corresponde a um
 * evento `PLAY_SELECTED` entre os `logEvents`, cujo `detail` carrega:
 *   - `offense`/`defense`: as jogadas escolhidas (sempre do `Catalogo_Jogadas`);
 *   - `down`/`distance`/`fieldPosition`/`weather`: os fatores de situação,
 *     coerentes com o `GameState` do snap.
 *
 * Estratégia de verificação (propriedade universal sobre seeds/estados):
 * - Sobre seeds uint64 arbitrários, climas, ratings e estados de down/
 *   distância/posição variados, resolver um snap e exigir que:
 *   1. exista **exatamente um** evento `PLAY_SELECTED` em `logEvents`;
 *   2. `detail.offense`/`detail.defense` sejam as jogadas efetivamente
 *      escolhidas (`outcome.offensePlay`/`outcome.defensePlay`) e ambas
 *      pertençam ao `Catalogo_Jogadas` (R4.3);
 *   3. os fatores de situação `detail.down`/`detail.distance`/
 *      `detail.fieldPosition`/`detail.weather` espelhem o estado do snap
 *      (`state.down`/`state.distance`/`state.ballOn`/`state.weather`);
 *   4. o evento referencie o snap corrente (`event.snap === state.snapCount`).
 *
 * O escopo é a camada de pipeline (eventos sem `seq`): o `PLAY_SELECTED` é a
 * entrada de log que materializa a decisão por snap antes de a agregação de log
 * atribuir o índice sequencial. Puro e determinístico (toda entropia vem do RNG
 * injetado): a mesma entrada reproduz o mesmo evento.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolvePlay, type PlayPolicies } from './play/pipeline';
import {
  createSituationalPolicy,
  isInCatalog,
  PLAY_CATALOG,
} from './play/select';
import { createRng } from './rng';
import { createInitialState } from './state';
import type {
  Baseline,
  EffectStatus,
  GameState,
  PlayId,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  SimulationParameters,
  Strategy,
  Weather,
} from './types';
import { PBT_NUM_RUNS } from './test-setup';

// ---------------------------------------------------------------------------
// Baseline MVP de design (não calibrado) — valores do design
// ---------------------------------------------------------------------------

const BASELINE_PARAMS: SimulationParameters = {
  base: 0.5,
  difference_coefficient: 0.45,
  min: 0.05,
  max: 0.95,
  skill_mod_max_abs: 0.15,
  tick_s: 0.1,
  quarter_seconds: 900,
  play_timeout_s: 30,
  suppression_radius_yards: 2,
  weather: { CLEAR: 0.4, RAIN: 0.2, WIND: 0.15, HEAT: 0.15, COLD: 0.1 },
  weather_modifiers: {
    RAIN: { reception: -0.04, fumble: 0.02 },
    WIND: { deep_pass: -0.05, long_kick: -0.05 },
    HEAT: { fatigue_per_snap: 0.002 },
    COLD: { reception: -0.02 },
  },
  fatigue: {
    active: 0.003,
    extreme_action: 0.005,
    inactive_snap_recovery: -0.001,
    max_penalty: 0.12,
  },
  run: { base: 2, coef: 4, loss_min: -4, loss_max: -1 },
  pass: { short: [3, 10], deep: [12, 35] },
};

const BASELINE: Baseline = {
  version: 'D1-design-2026-10-09',
  status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
  simulationParameters: BASELINE_PARAMS,
  matchups: new Map<string, number>([
    ['O_RUN_INSIDE|D_RUN_FIT', 0.05],
    ['O_PASS_DEEP|D_ZONE', -0.03],
  ]),
};

/** Tabela de disposição de efeitos vazia (nenhum efeito adicional nos fixtures). */
const EMPTY_DISPOSITION: ReadonlyMap<string, EffectStatus> = new Map();

// ---------------------------------------------------------------------------
// Fixtures de atletas / escalações
// ---------------------------------------------------------------------------

let nextInstanceId = 1;

/** Constrói um `ResolvedAthlete` mínimo e válido com rating uniforme `attack`. */
function makeAthlete(
  position: ResolvedAthlete['positionDesignation'],
  attack: number,
): ResolvedAthlete {
  const id = nextInstanceId++;
  return {
    instanceId: id,
    pokemonId: 1 + (id % 100),
    types: ['NORMAL'],
    stats: {
      hp: 100,
      attack,
      defense: attack,
      specialAttack: attack,
      specialDefense: attack,
      speed: attack,
    },
    abilityId: 1,
    moveIds: [1, 2, 3, 4],
    additionalEffectIds: [],
    positionDesignation: position,
  };
}

/**
 * Escalação com QB + RB + WR no ataque (ação-chave de passe/corrida sempre
 * resolvível, validação anatômica `ok`) e CB/S/LB na defesa.
 */
function makeLineup(offenseAttack: number, defenseAttack: number): ResolvedLineup {
  return {
    units: {
      offense: [
        makeAthlete('QB', offenseAttack),
        makeAthlete('RB', offenseAttack),
        makeAthlete('WR', offenseAttack),
      ],
      defense: [
        makeAthlete('CB', defenseAttack),
        makeAthlete('S', defenseAttack),
        makeAthlete('LB', defenseAttack),
      ],
      specialTeams: [],
    },
  };
}

/** `ResolvedInput` mínimo e válido para `resolvePlay`. */
function makeInput(
  homeAttack: number,
  awayAttack: number,
  strategyHome: Strategy,
  strategyAway: Strategy,
  seed: bigint,
): ResolvedInput {
  return {
    home: makeLineup(homeAttack, homeAttack),
    away: makeLineup(awayAttack, awayAttack),
    strategyHome,
    strategyAway,
    baseline: BASELINE,
    effectDisposition: EMPTY_DISPOSITION,
    seed,
  };
}

function policiesFrom(input: ResolvedInput): PlayPolicies {
  return {
    home: createSituationalPolicy(input.strategyHome),
    away: createSituationalPolicy(input.strategyAway),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const weatherArb: fc.Arbitrary<Weather> = fc.constantFrom(...WEATHERS);

/** Ratings que variam a probabilidade de sucesso para exercitar vários ramos. */
const attackArb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 200 });

const PRESETS: readonly Strategy['preset'][] = [
  'BALANCED',
  'GROUND',
  'AERIAL',
  'CURTI',
];
const presetArb: fc.Arbitrary<Strategy['preset']> = fc.constantFrom(...PRESETS);

/** Estado de snap arbitrário (down/distância/posição/relógio/snapCount/posse). */
interface SnapSituation {
  readonly down: number;
  readonly distance: number;
  readonly ballOn: number;
  readonly gameClockDeci: number;
  readonly snapCount: number;
  readonly possession: 'home' | 'away';
}

const situationArb: fc.Arbitrary<SnapSituation> = fc.record({
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 1, max: 30 }),
  ballOn: fc.integer({ min: 1, max: 99 }),
  gameClockDeci: fc.integer({ min: 0, max: 9000 }),
  snapCount: fc.integer({ min: 0, max: 300 }),
  possession: fc.constantFrom('home', 'away'),
});

/** Monta o `GameState` de Drive com a situação arbitrária. */
function stateFrom(situation: SnapSituation, weather: Weather): GameState {
  const base = createInitialState({ weather, possession: situation.possession });
  return {
    ...base,
    phase: 'Drive',
    down: situation.down,
    distance: situation.distance,
    ballOn: situation.ballOn,
    gameClockDeci: situation.gameClockDeci,
    snapCount: situation.snapCount,
  };
}

// ---------------------------------------------------------------------------
// Property 13 — todo snap registra decisão + fatores de situação (R4.5)
// ---------------------------------------------------------------------------

describe('log — Property 13 (decisão e fatores de situação por snap)', () => {
  it('cada snap emite PLAY_SELECTED com as jogadas escolhidas (no catálogo) e os fatores de situação do estado (R4.5)', () => {
    fc.assert(
      fc.property(
        seedArb,
        weatherArb,
        attackArb,
        attackArb,
        presetArb,
        presetArb,
        situationArb,
        (
          seed,
          weather,
          homeAttack,
          awayAttack,
          presetHome,
          presetAway,
          situation,
        ) => {
          const input = makeInput(
            homeAttack,
            awayAttack,
            { preset: presetHome },
            { preset: presetAway },
            seed,
          );
          const policies = policiesFrom(input);
          const state = stateFrom(situation, weather);

          const outcome = resolvePlay(state, input, policies, createRng(seed), {
            catalog: PLAY_CATALOG,
          });

          // (1) Exatamente um PLAY_SELECTED por snap.
          const selectedEvents = outcome.logEvents.filter(
            (e) => e.type === 'PLAY_SELECTED',
          );
          expect(selectedEvents).toHaveLength(1);
          const event = selectedEvents[0]!;

          // (4) O evento referencia o snap corrente.
          expect(event.snap).toBe(state.snapCount);

          // (2) A decisão registrada é a jogada efetivamente escolhida, e ambas
          // as jogadas pertencem ao Catalogo_Jogadas (R4.3).
          const detail = event.detail;
          expect(detail.offense).toBe(outcome.offensePlay);
          expect(detail.defense).toBe(outcome.defensePlay);
          expect(isInCatalog(detail.offense as PlayId)).toBe(true);
          expect(isInCatalog(detail.defense as PlayId)).toBe(true);

          // (3) Os fatores de situação que motivaram a escolha espelham o
          // estado do snap: down, distância, posição no campo e clima.
          expect(detail.down).toBe(state.down);
          expect(detail.distance).toBe(state.distance);
          expect(detail.fieldPosition).toBe(state.ballOn);
          expect(detail.weather).toBe(state.weather);

          // O snapshot de estado anexado ao evento também é coerente com os
          // mesmos fatores (consistência entre `detail` e `state`).
          expect(event.state.down).toBe(state.down);
          expect(event.state.distance).toBe(state.distance);
          expect(event.state.ballOn).toBe(state.ballOn);
          expect(event.state.weather).toBe(state.weather);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
