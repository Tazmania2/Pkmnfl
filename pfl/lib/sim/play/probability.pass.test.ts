import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { pass, type PassDepth } from './probability';
import { createRng } from '../rng';
import type { SimulationParameters } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test das jardas-alvo de passe (Task 4.6).
 *
 * // Feature: pfl-simulation-engine, Property 21: Jardas-alvo de passe nos intervalos definidos
 *
 * **Validates: Requirements 6.9**
 *
 * Para qualquer `Seed_RNG`, a jogada de passe amostra as jardas-alvo via RNG no
 * intervalo definido pelo baseline:
 *
 * - `pass('short', …)` → inteiro em `pass.short = [3, 10]`.
 * - `pass('deep', …)`  → inteiro em `pass.deep  = [12, 35]`.
 *
 * Verificamos duas invariantes universais:
 *
 * 1. **Faixa + integralidade:** para toda semente e profundidade, a saída é um
 *    inteiro dentro do intervalo fechado correspondente ao baseline.
 * 2. **Determinismo:** a mesma semente (mesmo `createRng`) sempre produz a
 *    mesma amostra de jardas para a mesma profundidade — reprodutibilidade byte
 *    a byte do núcleo puro.
 */

/**
 * Baseline MVP de design (não calibrado) — fornece os intervalos de passe lidos
 * por `pass`: `pass.short = [3, 10]`, `pass.deep = [12, 35]`. Os demais campos de
 * `SimulationParameters` não são lidos por `pass`, mas constam para honrar o
 * contrato de tipo com os valores do baseline.
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

const [SHORT_LO, SHORT_HI] = BASELINE_PARAMS.pass.short; // [3, 10]
const [DEEP_LO, DEEP_HI] = BASELINE_PARAMS.pass.deep; // [12, 35]

/** `Seed_RNG` arbitrário no domínio uint64 `[0, 2^64 - 1]`. */
const seedArb = fc.bigInt({ min: 0n, max: (1n << 64n) - 1n });

/** Ambas as profundidades suportadas pelo passe. */
const depthArb: fc.Arbitrary<PassDepth> = fc.constantFrom('short', 'deep');

describe('probability.pass — jardas-alvo nos intervalos do baseline (Property 21)', () => {
  it('short: amostra sempre um inteiro em [3, 10] para qualquer semente', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const yards = pass('short', BASELINE_PARAMS, createRng(seed));
        expect(Number.isInteger(yards)).toBe(true);
        expect(yards).toBeGreaterThanOrEqual(SHORT_LO);
        expect(yards).toBeLessThanOrEqual(SHORT_HI);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('deep: amostra sempre um inteiro em [12, 35] para qualquer semente', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const yards = pass('deep', BASELINE_PARAMS, createRng(seed));
        expect(Number.isInteger(yards)).toBe(true);
        expect(yards).toBeGreaterThanOrEqual(DEEP_LO);
        expect(yards).toBeLessThanOrEqual(DEEP_HI);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('é determinístico: a mesma semente produz a mesma amostra para a mesma profundidade', () => {
    fc.assert(
      fc.property(seedArb, depthArb, (seed, depth) => {
        const a = pass(depth, BASELINE_PARAMS, createRng(seed));
        const b = pass(depth, BASELINE_PARAMS, createRng(seed));
        expect(a).toBe(b);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
