import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { compute, type ComputeProbabilityInput } from './probability';
import type { SimulationParameters } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test do clamp final de probabilidade (Task 4.3).
 *
 * // Feature: pfl-simulation-engine, Property 17: Clamp de probabilidade sempre em [0.05, 0.95]
 *
 * **Validates: Requirements 6.2**
 *
 * Para toda combinação de atributos (Δattr), delta de matchup, modificador de
 * habilidade (skillMod) e modificador de clima (climaMod) — inclusive valores
 * extremos muito fora da faixa normal — a probabilidade final de qualquer
 * disputa calculada por `compute` está sempre no intervalo fechado
 * `[min, max] = [0.05, 0.95]`.
 *
 * Além da invariante universal, verificamos que o clamp é a ÚLTIMA operação
 * sobre a probabilidade: alimentando entradas cuja soma bruta é empurrada muito
 * acima de `max` (ou muito abaixo de `min`), a saída satura exatamente no limite
 * correspondente — nenhum modificador posterior pode retirá-la de `[0.05, 0.95]`.
 */

/**
 * Baseline MVP de design (não calibrado) — valores do design para o
 * `Modelo_Probabilistico`: `base = 0.5`, `difference_coefficient = 0.45`,
 * `min = 0.05`, `max = 0.95`, `skill_mod_max_abs = 0.15`. Os demais campos de
 * `SimulationParameters` não são lidos por `compute`, mas constam para honrar o
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

const MIN = BASELINE_PARAMS.min; // 0.05
const MAX = BASELINE_PARAMS.max; // 0.95

/**
 * Gerador de valores "extremos": inclui NaN-free doubles arbitrários (que
 * cobrem a faixa normal e valores muito fora dela), com ênfase em magnitudes
 * grandes capazes de saturar o clamp em qualquer dos dois sentidos.
 */
const extremeNum = fc.oneof(
  // Doubles finitos arbitrários (podem ser enormes em módulo).
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  // Faixa "normal" densamente amostrada.
  fc.double({ min: -2, max: 2, noNaN: true }),
  // Extremos explícitos para forçar saturação.
  fc.constantFrom(-1e6, -1000, -10, 10, 1000, 1e6),
);

const computeInputArb: fc.Arbitrary<ComputeProbabilityInput> = fc.record({
  attrDelta: extremeNum,
  matchupDelta: extremeNum,
  skillMod: extremeNum,
  climaMod: extremeNum,
});

describe('probability.compute — clamp final em [0.05, 0.95] (Property 17)', () => {
  it('mantém a probabilidade final sempre em [min, max] para entradas arbitrárias e extremas', () => {
    fc.assert(
      fc.property(computeInputArb, (input) => {
        const p = compute(input, BASELINE_PARAMS);
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(MIN);
        expect(p).toBeLessThanOrEqual(MAX);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('satura exatamente em max quando a soma bruta é empurrada bem acima de 0.95', () => {
    fc.assert(
      fc.property(
        // Qualquer excesso positivo somado garante soma bruta > max.
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        (excess) => {
          const input: ComputeProbabilityInput = {
            attrDelta: 1, // normalizado a +1 → +coef
            matchupDelta: excess, // empurra bem acima de max
            skillMod: 1, // limitado a +0.15
            climaMod: excess, // reforça o estouro
          };
          const p = compute(input, BASELINE_PARAMS);
          expect(p).toBe(MAX);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('satura exatamente em min quando a soma bruta é empurrada bem abaixo de 0.05', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        (excess) => {
          const input: ComputeProbabilityInput = {
            attrDelta: -1, // normalizado a -1 → -coef
            matchupDelta: -excess, // empurra bem abaixo de min
            skillMod: -1, // limitado a -0.15
            climaMod: -excess, // reforça o colapso
          };
          const p = compute(input, BASELINE_PARAMS);
          expect(p).toBe(MIN);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
