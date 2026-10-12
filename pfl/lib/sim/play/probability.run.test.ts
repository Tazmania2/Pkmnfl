import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { run } from './probability';
import { createRng } from '../rng';
import type { SimulationParameters } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test de ganho e perda de corrida (Task 4.5).
 *
 * // Feature: pfl-simulation-engine, Property 20: Ganho e perda de corrida pela fórmula
 *
 * **Validates: Requirements 6.8**
 *
 * *Para todo* `run_advantage`, o ganho de corrida (gap vencido) é exatamente
 * `base + round(coef * clamp(run_advantage, 0, 1))` — com o baseline MVP
 * (`run.base = 2`, `run.coef = 4`) isso é `2 + round(4 * clamp(run_advantage, 0, 1))`,
 * sempre um inteiro em `[2, 6]` e determinístico (nenhum valor do RNG é
 * consumido no caminho de ganho). *Quando* o gap de corrida é perdido, a perda
 * é amostrada via `rng.nextInt` e pertence sempre a
 * `[run.loss_min, run.loss_max] = [-4, -1]` jardas, de forma determinística
 * (mesmo seed + mesmas entradas → mesma perda).
 */

/**
 * `SimulationParameters` de baseline com os valores de design do MVP para o
 * ganho/perda de corrida (`run.base = 2`, `run.coef = 4`, `run.loss_min = -4`,
 * `run.loss_max = -1`). Os demais campos são preenchidos com os valores do
 * baseline congelado apenas para satisfazer o tipo — `run` lê somente `params.run`.
 */
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

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Domínio do Seed_RNG: uint64 em [0, 2^64 - 1]. */
const UINT64_MAX = (1n << 64n) - 1n;
const seedArb = fc.bigInt({ min: 0n, max: UINT64_MAX });

/**
 * `run_advantage` finito e amplo: cobre valores dentro de `[0, 1]` e **fora**
 * dessa faixa (negativos e > 1), para exercitar o clamp a `[0, 1]` da fórmula
 * do ganho.
 */
const runAdvantageArb = fc.float({
  min: Math.fround(-5),
  max: Math.fround(5),
  noNaN: true,
  noDefaultInfinity: true,
});

describe('run — ganho e perda de corrida pela fórmula (Property 20, R6.8)', () => {
  it('ganho (gap vencido) é 2 + round(4 * clamp(run_advantage, 0, 1)), inteiro em [2, 6]', () => {
    fc.assert(
      fc.property(runAdvantageArb, seedArb, (runAdvantage, seed) => {
        const rng = createRng(seed);
        const result = run(runAdvantage, true, BASELINE_PARAMS, rng);

        const expected =
          BASELINE_PARAMS.run.base +
          Math.round(BASELINE_PARAMS.run.coef * clamp(runAdvantage, 0, 1));

        expect(result.gained).toBe(true);
        expect(result.yards).toBe(expected);
        // Ganho sempre inteiro em [2, 6] com o baseline MVP.
        expect(Number.isInteger(result.yards)).toBe(true);
        expect(result.yards).toBeGreaterThanOrEqual(2);
        expect(result.yards).toBeLessThanOrEqual(6);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('o caminho de ganho é determinístico e não consome RNG (estado inalterado)', () => {
    fc.assert(
      fc.property(runAdvantageArb, seedArb, (runAdvantage, seed) => {
        // Dois RNGs independentes com o MESMO seed partem do mesmo estado.
        const rngA = createRng(seed);
        const rngB = createRng(seed);

        const stateBefore = rngA.state();
        const result = run(runAdvantage, true, BASELINE_PARAMS, rngA);
        const stateAfter = rngA.state();

        // Nenhum valor consumido no ganho ⇒ o estado interno não avança.
        expect(stateAfter).toEqual(stateBefore);

        // E o primeiro float de rngB (intacto) coincide com o de rngA (também
        // intacto), confirmando que o ganho não gastou saídas do gerador.
        expect(rngA.nextFloat()).toBe(rngB.nextFloat());

        // Mesmo seed + mesmas entradas ⇒ mesmo ganho (determinístico).
        const resultBis = run(runAdvantage, true, BASELINE_PARAMS, createRng(seed));
        expect(resultBis.yards).toBe(result.yards);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('perda (gap perdido) é amostrada via RNG sempre em [-4, -1] (inteiro)', () => {
    fc.assert(
      fc.property(runAdvantageArb, seedArb, (runAdvantage, seed) => {
        const rng = createRng(seed);
        const result = run(runAdvantage, false, BASELINE_PARAMS, rng);

        expect(result.gained).toBe(false);
        expect(Number.isInteger(result.yards)).toBe(true);
        expect(result.yards).toBeGreaterThanOrEqual(BASELINE_PARAMS.run.loss_min);
        expect(result.yards).toBeLessThanOrEqual(BASELINE_PARAMS.run.loss_max);
        // Baseline MVP: [loss_min, loss_max] = [-4, -1].
        expect(result.yards).toBeGreaterThanOrEqual(-4);
        expect(result.yards).toBeLessThanOrEqual(-1);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a perda é determinística: mesmo seed + mesmas entradas → mesma perda', () => {
    fc.assert(
      fc.property(runAdvantageArb, seedArb, (runAdvantage, seed) => {
        const lossA = run(runAdvantage, false, BASELINE_PARAMS, createRng(seed)).yards;
        const lossB = run(runAdvantage, false, BASELINE_PARAMS, createRng(seed)).yards;
        expect(lossA).toBe(lossB);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
