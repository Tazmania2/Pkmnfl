/**
 * Property test dos modificadores de clima (`modifiers`) — Task 5.5.
 *
 * // Feature: pfl-simulation-engine, Property 23: Modificadores de clima aplicados conforme o clima
 *
 * **Validates: Requirements 7.2, 7.3, 7.5**
 *
 * *Para toda* jogada, sob `RAIN` a recepção recebe `-0.04` e a probabilidade de
 * fumble recebe `+0.02` (R7.2); sob `WIND` o passe profundo e o chute longo
 * recebem `-0.05` (R7.3); sob `COLD` a recepção recebe `-0.02` (R7.5); sob
 * `HEAT` a fadiga por snap recebe `+0.002`; e sob `CLEAR` nenhum desses
 * modificadores é aplicado (todos os canais ficam em zero). Além disso, para
 * cada clima, os canais que NÃO lhe são aplicáveis permanecem exatamente zero.
 *
 * Este arquivo cobre SOMENTE os modificadores (`modifiers`); o sorteio de clima
 * (`roll`) é testado em arquivo dedicado (Task 5.4 — Property 22, em
 * `weather.roll.test.ts`), que este teste NÃO toca.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { modifiers, type WeatherEffect } from './weather';
import type { SimulationParameters, Weather } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * `SimulationParameters` com os valores de design do MVP. Apenas
 * `weather_modifiers` influencia `modifiers`; os demais campos constam por
 * completude do contrato de tipo e não são lidos pela função sob teste. Os
 * valores de `weather_modifiers` são o baseline de design: RAIN recepção
 * `-0.04`/fumble `+0.02`, WIND passe profundo `-0.05`/chute longo `-0.05`,
 * HEAT fadiga `+0.002`/snap, COLD recepção `-0.02`.
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

/** Conjunto canônico de climas válidos. */
const ALL_WEATHER: readonly Weather[] = [
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
];

/** Os cinco canais do `WeatherEffect`, para varredura exaustiva de zeros. */
const EFFECT_CHANNELS: ReadonlyArray<keyof WeatherEffect> = [
  'reception',
  'fumble',
  'deepPass',
  'longKick',
  'fatiguePerSnap',
];

/**
 * Oráculo independente do efeito esperado por clima (R7.2–R7.5). Constrói o
 * `WeatherEffect` esperado a partir do baseline, deixando explícito quais canais
 * cada clima afeta e, implicitamente, que todos os demais são zero.
 */
function expectedEffect(
  weather: Weather,
  params: SimulationParameters,
): WeatherEffect {
  const zero: WeatherEffect = {
    reception: 0,
    fumble: 0,
    deepPass: 0,
    longKick: 0,
    fatiguePerSnap: 0,
  };
  const mods = params.weather_modifiers;
  switch (weather) {
    case 'RAIN':
      return { ...zero, reception: mods.RAIN.reception, fumble: mods.RAIN.fumble };
    case 'WIND':
      return { ...zero, deepPass: mods.WIND.deep_pass, longKick: mods.WIND.long_kick };
    case 'COLD':
      return { ...zero, reception: mods.COLD.reception };
    case 'HEAT':
      return { ...zero, fatiguePerSnap: mods.HEAT.fatigue_per_snap };
    case 'CLEAR':
    default:
      return zero;
  }
}

describe('weather.modifiers — Property 23 (modificadores conforme o clima)', () => {
  it('aplica, para todo Weather, exatamente os modificadores do baseline (demais canais zero)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_WEATHER), (weather) => {
        expect(modifiers(weather, BASELINE_PARAMS)).toEqual(
          expectedEffect(weather, BASELINE_PARAMS),
        );
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('zera todo canal não aplicável ao clima vigente (para todo Weather)', () => {
    // Mapa canônico dos canais que CADA clima pode afetar. Os ausentes devem
    // ser exatamente zero — o que confirma que nenhum modificador "vaza" entre
    // climas (ex.: RAIN não mexe em deepPass/longKick/fatiguePerSnap).
    const applicable: Readonly<Record<Weather, ReadonlyArray<keyof WeatherEffect>>> = {
      CLEAR: [],
      RAIN: ['reception', 'fumble'],
      WIND: ['deepPass', 'longKick'],
      HEAT: ['fatiguePerSnap'],
      COLD: ['reception'],
    };

    fc.assert(
      fc.property(fc.constantFrom(...ALL_WEATHER), (weather) => {
        const effect = modifiers(weather, BASELINE_PARAMS);
        for (const channel of EFFECT_CHANNELS) {
          if (!applicable[weather].includes(channel)) {
            expect(effect[channel]).toBe(0);
          }
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('RAIN → recepção -0.04 e fumble +0.02 (R7.2); demais canais zero', () => {
    const effect = modifiers('RAIN', BASELINE_PARAMS);
    expect(effect.reception).toBe(-0.04);
    expect(effect.fumble).toBe(0.02);
    expect(effect.deepPass).toBe(0);
    expect(effect.longKick).toBe(0);
    expect(effect.fatiguePerSnap).toBe(0);
  });

  it('WIND → passe profundo -0.05 e chute longo -0.05 (R7.3); demais canais zero', () => {
    const effect = modifiers('WIND', BASELINE_PARAMS);
    expect(effect.deepPass).toBe(-0.05);
    expect(effect.longKick).toBe(-0.05);
    expect(effect.reception).toBe(0);
    expect(effect.fumble).toBe(0);
    expect(effect.fatiguePerSnap).toBe(0);
  });

  it('COLD → recepção -0.02 (R7.5); demais canais zero', () => {
    const effect = modifiers('COLD', BASELINE_PARAMS);
    expect(effect.reception).toBe(-0.02);
    expect(effect.fumble).toBe(0);
    expect(effect.deepPass).toBe(0);
    expect(effect.longKick).toBe(0);
    expect(effect.fatiguePerSnap).toBe(0);
  });

  it('HEAT → fadiga +0.002/snap; demais canais zero', () => {
    const effect = modifiers('HEAT', BASELINE_PARAMS);
    expect(effect.fatiguePerSnap).toBe(0.002);
    expect(effect.reception).toBe(0);
    expect(effect.fumble).toBe(0);
    expect(effect.deepPass).toBe(0);
    expect(effect.longKick).toBe(0);
  });

  it('CLEAR → nenhum modificador aplicado (todos os canais zero)', () => {
    const effect = modifiers('CLEAR', BASELINE_PARAMS);
    for (const channel of EFFECT_CHANNELS) {
      expect(effect[channel]).toBe(0);
    }
  });
});
