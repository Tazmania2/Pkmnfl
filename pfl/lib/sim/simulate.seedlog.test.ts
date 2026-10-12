/**
 * Property 4 — Seed registrado no log (`lib/sim/simulate.seedlog.test.ts`).
 *
 * Arquivo DEDICADO a Property 4 (Task 14.4). Verifica que, para uma
 * `ResolvedInput` arbitrária, a simulação **ecoa fielmente** o `Seed_RNG`
 * usado em dois lugares complementares do `SimulationResult`:
 *
 *  - `result.seedUsed` é o `bigint` exatamente igual a `input.seed`;
 *  - `result.log.seedUsed` é a **representação decimal** desse mesmo seed,
 *    isto é, `input.seed.toString(10)` (R1.7).
 *
 * Isso garante a auditabilidade e reprodutibilidade exigidas pelo design: a
 * partir do log é possível recuperar o seed exato (uint64, sem perda de
 * precisão) e re-simular byte a byte.
 *
 * `simulate` executa o loop completo de uma partida (potencialmente milhares de
 * snaps), portanto é pesado; usamos um `numRuns` modesto (ver `SEEDLOG_RUNS`),
 * suficiente para exercitar o espaço de seeds/presets sem tornar a suíte lenta.
 */

// Feature: pfl-simulation-engine, Property 4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { simulate } from './simulate';
import type {
  AthleteStats,
  Baseline,
  Position,
  Preset,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  SimulationParameters,
  Strategy,
} from './types';

// ---------------------------------------------------------------------------
// Número de iterações: `simulate` é pesado (loop de partida completo), então
// mantemos o `numRuns` modesto. Ainda assim exercita variação de seed e preset.
// ---------------------------------------------------------------------------

const SEEDLOG_RUNS = 25;

// ---------------------------------------------------------------------------
// Baseline congelado do MVP (mesmos valores de design das demais suítes)
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
    inactive_snap_recovery: 0.001,
    max_penalty: 0.12,
  },
  run: { base: 2, coef: 4, loss_min: -4, loss_max: -1 },
  pass: { short: [3, 10], deep: [12, 35] },
};

const BASELINE: Baseline = {
  version: 'D1-design-2026-10-09',
  status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
  simulationParameters: BASELINE_PARAMS,
  matchups: new Map<string, number>(),
};

// ---------------------------------------------------------------------------
// Construção de atletas, lineups e entrada resolvida (padrão reaproveitado)
// ---------------------------------------------------------------------------

const OFFENSE_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'C'];
const DEFENSE_POSITIONS: readonly Position[] = ['DL', 'LB', 'CB', 'S'];

function makeAthlete(
  instanceId: number,
  position: Position,
  stats: AthleteStats,
): ResolvedAthlete {
  return {
    instanceId,
    pokemonId: 1,
    types: ['NORMAL'],
    stats,
    abilityId: 1,
    moveIds: [1, 2, 3, 4],
    additionalEffectIds: [],
    positionDesignation: position,
  };
}

function makeLineup(teamOffset: number, stats: AthleteStats): ResolvedLineup {
  const offense = OFFENSE_POSITIONS.map((position, i) =>
    makeAthlete(teamOffset + i, position, stats),
  );
  const defense = DEFENSE_POSITIONS.map((position, i) =>
    makeAthlete(teamOffset + 10 + i, position, stats),
  );
  return { units: { offense, defense, specialTeams: [] } };
}

function makeInput(seed: bigint, preset: Preset, stats: AthleteStats): ResolvedInput {
  const strategy: Strategy = { preset };
  return {
    home: makeLineup(0, stats),
    away: makeLineup(100, stats),
    strategyHome: strategy,
    strategyAway: strategy,
    baseline: BASELINE,
    effectDisposition: new Map(),
    seed,
  };
}

// ---------------------------------------------------------------------------
// Geradores (fast-check)
// ---------------------------------------------------------------------------

/** `Seed_RNG` em todo o domínio uint64. */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

const presetArb = fc.constantFrom<Preset>('BALANCED', 'GROUND', 'AERIAL', 'CURTI');

const statsArb: fc.Arbitrary<AthleteStats> = fc.record({
  hp: fc.integer({ min: 20, max: 150 }),
  attack: fc.integer({ min: 20, max: 150 }),
  defense: fc.integer({ min: 20, max: 150 }),
  specialAttack: fc.integer({ min: 20, max: 150 }),
  specialDefense: fc.integer({ min: 20, max: 150 }),
  speed: fc.integer({ min: 20, max: 150 }),
});

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('Property 4 — seed registrado no log', () => {
  it('result.seedUsed ecoa o bigint e log.seedUsed é seu decimal (R1.7)', () => {
    fc.assert(
      fc.property(seedArb, presetArb, statsArb, (seed, preset, stats) => {
        const input = makeInput(seed, preset, stats);
        const result = simulate(input);

        // `seedUsed` (bigint) é exatamente o seed de entrada.
        expect(result.seedUsed).toBe(seed);

        // `log.seedUsed` é a representação decimal (uint64) do mesmo seed.
        expect(result.log.seedUsed).toBe(input.seed.toString(10));
      }),
      { numRuns: SEEDLOG_RUNS },
    );
  });
});
