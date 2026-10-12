/**
 * Property test de determinismo byte a byte do núcleo `simulate`
 * (`simulate.determinism`) — Task 14.2.
 *
 * // Feature: pfl-simulation-engine, Property 1: Determinismo byte a byte
 *
 * **Validates: Requirements 1.1, 1.5, 12.7, 13.6, 15.5**
 *
 * O design exige que `simulate(input: ResolvedInput): SimulationResult` seja uma
 * função **pura e determinística** (R1.1, R1.5): toda a variação entra pela
 * assinatura e sai no resultado, sem leitura de relógio de sistema, ambiente,
 * rede, banco ou entropia externa — a única fonte de aleatoriedade é o `Rng`
 * criado uma única vez de `input.seed`. Como consequência, duas invocações
 * **independentes** de `simulate` sobre a MESMA `ResolvedInput` produzem
 * resultados **byte a byte idênticos** (R13.6, R15.5), e o `seedUsed` ecoado é
 * exatamente o seed de entrada (R12.7 — reprodutibilidade entre invocações).
 *
 * Estratégia de verificação (propriedade universal sobre entradas arbitrárias):
 * para um `ResolvedInput` arbitrário (seed uint64 arbitrário, presets de
 * estratégia variados — o clima é sorteado internamente a partir do seed —, e
 * stats de atletas variados), chamamos `simulate(input)` **duas vezes** e
 * exigimos:
 *   1. `stableStringify(a.log) === stableStringify(b.log)` — log canônico byte a
 *      byte idêntico (o critério forte de determinismo do design);
 *   2. `a.score` profundamente igual a `b.score` (placar final idêntico);
 *   3. `a.seedUsed === b.seedUsed` e igual ao `input.seed` (seed reproduzível).
 *
 * Não exigimos divergência entre seeds distintos (isso é a Property 3); aqui o
 * foco é a reprodutibilidade da MESMA entrada.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { simulate } from './simulate';
import { stableStringify } from './log';
import type {
  Baseline,
  EffectStatus,
  Preset,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  SimulationParameters,
  Strategy,
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
// Fixtures de atletas / escalações (padrão de pipeline.rngorder.test.ts)
// ---------------------------------------------------------------------------

/** Spec de stats variáveis de um atleta, gerada pelo fast-check. */
interface AthleteSpec {
  readonly offenseAttack: number;
  readonly defenseAttack: number;
}

/**
 * Constrói um `ResolvedAthlete` mínimo e válido com `attack` dado (os demais
 * stats seguem o mesmo valor, bastando variar a probabilidade de disputa). O
 * `instanceId` deve ser único por time — gerado pelo chamador.
 */
function makeAthlete(
  instanceId: number,
  position: ResolvedAthlete['positionDesignation'],
  attack: number,
): ResolvedAthlete {
  return {
    instanceId,
    pokemonId: 1 + (instanceId % 100),
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
 * Escalação resolvida com ataque (QB/RB/WR) e defesa (CB/S/LB). Os `instanceId`
 * são offsetados por `base` para garantir unicidade por time dentro do input.
 */
function makeLineup(base: number, spec: AthleteSpec): ResolvedLineup {
  return {
    units: {
      offense: [
        makeAthlete(base + 1, 'QB', spec.offenseAttack),
        makeAthlete(base + 2, 'RB', spec.offenseAttack),
        makeAthlete(base + 3, 'WR', spec.offenseAttack),
      ],
      defense: [
        makeAthlete(base + 4, 'CB', spec.defenseAttack),
        makeAthlete(base + 5, 'S', spec.defenseAttack),
        makeAthlete(base + 6, 'LB', spec.defenseAttack),
      ],
      specialTeams: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Seeds uint64 arbitrários para o `Gerador_RNG` (R1.2). */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

const PRESETS: readonly Preset[] = ['BALANCED', 'GROUND', 'AERIAL', 'CURTI'];
const presetArb: fc.Arbitrary<Preset> = fc.constantFrom(...PRESETS);
const strategyArb: fc.Arbitrary<Strategy> = presetArb.map((preset) => ({
  preset,
}));

/** Ratings que variam a probabilidade de sucesso ao longo do espectro. */
const attackArb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 200 });
const athleteSpecArb: fc.Arbitrary<AthleteSpec> = fc.record({
  offenseAttack: attackArb,
  defenseAttack: attackArb,
});

/**
 * `ResolvedInput` arbitrário e autossuficiente. O clima NÃO é parte da entrada:
 * é sorteado internamente por `simulate` a partir do seed, de modo que variá-lo
 * aqui seria incorreto — o determinismo é verificado sobre a MESMA entrada.
 */
const inputArb: fc.Arbitrary<ResolvedInput> = fc
  .record({
    seed: seedArb,
    strategyHome: strategyArb,
    strategyAway: strategyArb,
    homeSpec: athleteSpecArb,
    awaySpec: athleteSpecArb,
  })
  .map(({ seed, strategyHome, strategyAway, homeSpec, awaySpec }) => ({
    home: makeLineup(0, homeSpec),
    away: makeLineup(100, awaySpec),
    strategyHome,
    strategyAway,
    baseline: BASELINE,
    effectDisposition: EMPTY_DISPOSITION,
    seed,
  }));

// ---------------------------------------------------------------------------
// Property 1 — determinismo byte a byte
// ---------------------------------------------------------------------------

describe('simulate — Property 1 (determinismo byte a byte)', () => {
  // `simulate` executa uma partida completa (milhares de snaps). Rodá-la DUAS
  // vezes por caso é pesado, então reduzimos as iterações para `DETERMINISM_RUNS`
  // (vs. `PBT_NUM_RUNS=100`) para manter o teste rápido sem perder cobertura do
  // espaço de entradas, e elevamos o timeout por teste bem acima do padrão de 5s.
  const DETERMINISM_RUNS = Math.min(PBT_NUM_RUNS, 25);

  it(
    'duas invocações sobre a MESMA entrada produzem log/placar/seed byte a byte idênticos (R1.1, R13.6, R15.5)',
    () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const a = simulate(input);
          const b = simulate(input);

          // (1) Log canônico byte a byte idêntico — o critério forte do design.
          expect(stableStringify(a.log)).toBe(stableStringify(b.log));

          // (2) Placar final profundamente igual.
          expect(b.score).toEqual(a.score);

          // (3) Seed ecoado idêntico entre invocações e igual ao de entrada
          // (reprodutibilidade — R12.7).
          expect(b.seedUsed).toBe(a.seedUsed);
          expect(a.seedUsed).toBe(input.seed);
        }),
        { numRuns: DETERMINISM_RUNS },
      );
    },
    60_000,
  );
});
