import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { applySkillMod } from './probability';
import type { SimulationParameters } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test do limite do modificador de habilidade (Task 4.4).
 *
 * // Feature: pfl-simulation-engine, Property 18: Modificador de habilidade limitado a ±0.15
 *
 * **Validates: Requirements 6.3**
 *
 * Para todo modificador de habilidade proposto (`skillMod`) — inclusive valores
 * extremos muito fora da faixa normal — o valor efetivamente aplicado por
 * `applySkillMod` tem módulo menor ou igual a `skill_mod_max_abs = 0.15`, ou
 * seja, fica sempre no intervalo fechado `[-0.15, +0.15]`.
 *
 * Além da invariante universal, verificamos que a saturação é exata: qualquer
 * `skillMod` acima de `+skill_mod_max_abs` satura exatamente em
 * `+skill_mod_max_abs`, e qualquer `skillMod` abaixo de `-skill_mod_max_abs`
 * satura exatamente em `-skill_mod_max_abs`. Valores já dentro da faixa passam
 * intactos.
 */

/**
 * Baseline MVP de design (não calibrado) — valores do design para o
 * `Modelo_Probabilistico`: `skill_mod_max_abs = 0.15`. Os demais campos de
 * `SimulationParameters` não são lidos por `applySkillMod`, mas constam para
 * honrar o contrato de tipo com os valores do baseline.
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

const MAX_ABS = BASELINE_PARAMS.skill_mod_max_abs; // 0.15

/**
 * Gerador de modificadores de habilidade "extremos": cobre a faixa normal
 * densamente e inclui magnitudes grandes (positivas e negativas) capazes de
 * saturar o limite em qualquer dos dois sentidos.
 */
const skillModArb = fc.oneof(
  // Doubles finitos arbitrários (podem ser enormes em módulo).
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  // Faixa "normal" densamente amostrada em torno de ±0.15.
  fc.double({ min: -1, max: 1, noNaN: true }),
  // Extremos explícitos para forçar saturação.
  fc.constantFrom(-1e9, -1000, -1, -0.15, 0, 0.15, 1, 1000, 1e9),
);

describe('probability.applySkillMod — limite ±skill_mod_max_abs (Property 18)', () => {
  it('mantém o módulo do modificador sempre ≤ skill_mod_max_abs para entradas arbitrárias e extremas', () => {
    fc.assert(
      fc.property(skillModArb, (skillMod) => {
        const applied = applySkillMod(skillMod, BASELINE_PARAMS);
        expect(Number.isFinite(applied)).toBe(true);
        expect(Math.abs(applied)).toBeLessThanOrEqual(MAX_ABS);
        expect(applied).toBeGreaterThanOrEqual(-MAX_ABS);
        expect(applied).toBeLessThanOrEqual(MAX_ABS);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('satura exatamente em +skill_mod_max_abs quando skillMod ultrapassa o limite superior', () => {
    fc.assert(
      fc.property(
        // Qualquer valor estritamente acima de +0.15.
        fc.double({ min: MAX_ABS + 1e-9, max: 1e9, noNaN: true }),
        (skillMod) => {
          const applied = applySkillMod(skillMod, BASELINE_PARAMS);
          expect(applied).toBe(MAX_ABS);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('satura exatamente em -skill_mod_max_abs quando skillMod ultrapassa o limite inferior', () => {
    fc.assert(
      fc.property(
        // Qualquer valor estritamente abaixo de -0.15.
        fc.double({ min: MAX_ABS + 1e-9, max: 1e9, noNaN: true }),
        (excess) => {
          const applied = applySkillMod(-excess, BASELINE_PARAMS);
          expect(applied).toBe(-MAX_ABS);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('preserva intacto todo skillMod já dentro de [-skill_mod_max_abs, +skill_mod_max_abs]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -MAX_ABS, max: MAX_ABS, noNaN: true }),
        (skillMod) => {
          const applied = applySkillMod(skillMod, BASELINE_PARAMS);
          expect(applied).toBe(skillMod);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
