import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { compute, normalizeAttrDelta } from './probability';
import type { SimulationParameters } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test da fórmula da probabilidade de disputa (Task 4.2).
 *
 * // Feature: pfl-simulation-engine, Property 16: Fórmula da probabilidade de disputa
 *
 * **Validates: Requirements 6.1**
 *
 * *Para toda* combinação de atributos, delta de matchup, modificador de
 * habilidade e modificador de clima, a probabilidade bruta é exatamente
 * `base + difference_coefficient * Δattr + delta_matchup + skillMod + climaMod`
 * com `base = 0.5` e `difference_coefficient = 0.45`, e a probabilidade final é
 * essa bruta após o clamp a `[min, max]` (última operação).
 *
 * A verificação é feita contra uma recomposição independente da fórmula a
 * partir das MESMAS normalizações que `compute` promete aplicar (Δattr
 * saturado a `[-1, 1]`, `skillMod` limitado a `±skill_mod_max_abs`), de modo
 * que o teste confirma a estrutura algébrica e não apenas replica a
 * implementação.
 */

/**
 * `SimulationParameters` de baseline com os valores de design do MVP
 * (`base = 0.5`, `coef = 0.45`, `min = 0.05`, `max = 0.95`,
 * `skill_mod_max_abs = 0.15`). Os demais campos são preenchidos com os valores
 * do baseline congelado apenas para satisfazer o tipo — a fórmula de `compute`
 * não os consome.
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

/**
 * Floats finitos amplos: cobrem valores dentro e fora da faixa normalizada de
 * `Δattr`, deltas de matchup/clima arbitrários e modificadores de habilidade
 * bem além de `±skill_mod_max_abs` (para exercitar o limite de `applySkillMod`).
 */
const finiteFloat = fc.float({
  min: Math.fround(-5),
  max: Math.fround(5),
  noNaN: true,
  noDefaultInfinity: true,
});

describe('Modelo_Probabilistico — Fórmula da probabilidade de disputa (Property 16)', () => {
  it('p_bruta = base + coef*Δattr + matchupDelta + skillMod + climaMod, p_final = clamp(p_bruta) (R6.1)', () => {
    fc.assert(
      fc.property(
        finiteFloat,
        finiteFloat,
        finiteFloat,
        finiteFloat,
        (attrDelta, matchupDelta, skillMod, climaMod) => {
          const pFinal = compute(
            { attrDelta, matchupDelta, skillMod, climaMod },
            BASELINE_PARAMS,
          );

          // Recomposição independente da fórmula com as normalizações prometidas.
          const dAttr = normalizeAttrDelta(attrDelta);
          const maxAbs = Math.abs(BASELINE_PARAMS.skill_mod_max_abs);
          const clampedSkill = clamp(skillMod, -maxAbs, maxAbs);

          const expectedBruta =
            BASELINE_PARAMS.base +
            BASELINE_PARAMS.difference_coefficient * dAttr +
            matchupDelta +
            clampedSkill +
            climaMod;

          const expectedFinal = clamp(
            expectedBruta,
            BASELINE_PARAMS.min,
            BASELINE_PARAMS.max,
          );

          // compute() reproduz exatamente a fórmula após o clamp final.
          expect(pFinal).toBe(expectedFinal);

          // base = 0.5 e difference_coefficient = 0.45 são os valores de design.
          expect(BASELINE_PARAMS.base).toBe(0.5);
          expect(BASELINE_PARAMS.difference_coefficient).toBe(0.45);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('em regime não-saturado (Δattr∈[-1,1], |skillMod|≤max, sem clamp final) p_bruta bate a soma termo a termo (R6.1)', () => {
    const nAttr = fc.float({
      min: Math.fround(-1),
      max: Math.fround(1),
      noNaN: true,
    });
    const smallMod = fc.float({
      min: Math.fround(-0.1),
      max: Math.fround(0.1),
      noNaN: true,
    });

    fc.assert(
      fc.property(nAttr, smallMod, smallMod, smallMod, (attrDelta, matchupDelta, skillMod, climaMod) => {
        const expectedBruta =
          BASELINE_PARAMS.base +
          BASELINE_PARAMS.difference_coefficient * attrDelta +
          matchupDelta +
          skillMod +
          climaMod;

        // Nesse regime a bruta permanece dentro de [min, max], logo o clamp é
        // identidade e compute() devolve exatamente a soma dos termos.
        if (expectedBruta >= BASELINE_PARAMS.min && expectedBruta <= BASELINE_PARAMS.max) {
          const pFinal = compute(
            { attrDelta, matchupDelta, skillMod, climaMod },
            BASELINE_PARAMS,
          );
          expect(pFinal).toBe(expectedBruta);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
