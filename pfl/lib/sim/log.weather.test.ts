// Feature: pfl-simulation-engine, Property 24: Clima e modificadores registrados no log
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { buildGameLog } from './log';
import { modifiers, type WeatherEffect } from './play/weather';
import type { PipelineLogEvent } from './play/pipeline';
import type {
  Baseline,
  JsonValue,
  SimulationParameters,
  StateSnapshot,
  Weather,
} from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test de **clima registrado no log** (Task 13.6).
 *
 * **Feature: pfl-simulation-engine, Property 24: Clima e modificadores registrados no log**
 *
 * _Validates: Requirements 7.6_
 *
 * O clima sorteado e seus modificadores vigentes são registrados no
 * `Log_Partida`: um evento `WEATHER_ROLL` carrega, no `detail`, o `Weather`
 * sorteado e os cinco canais de `weather.modifiers()`; além disso, **todo**
 * evento do log carrega o mesmo clima em `state.weather`. Ambas as garantias
 * devem sobreviver a `buildGameLog` (atribuição de `seq` + costura do log) sem
 * perda nem reescrita.
 */

/**
 * `SimulationParameters` do baseline de design do MVP. Apenas
 * `weather_modifiers` é lido por `modifiers`; os demais campos constam por
 * completude do contrato de tipo. Os valores de `weather_modifiers` são o
 * baseline: RAIN recepção `-0.04`/fumble `+0.02`, WIND passe profundo
 * `-0.05`/chute longo `-0.05`, HEAT fadiga `+0.002`/snap, COLD recepção `-0.02`.
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

/** Baseline versionado congelado do MVP (origem/status para o cabeçalho). */
const BASELINE: Baseline = {
  version: 'D1-design-2026-10-09',
  status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
  simulationParameters: BASELINE_PARAMS,
  matchups: new Map<string, number>(),
};

/** Conjunto canônico de climas válidos (ordem de sorteio). */
const ALL_WEATHER: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];

/** Arbitrário de clima da partida. */
const arbWeather: fc.Arbitrary<Weather> = fc.constantFrom(...ALL_WEATHER);

/**
 * Constrói um `StateSnapshot` mínimo porém completo com o clima informado. Os
 * demais campos são valores de referência fixos — o foco é `weather`.
 */
function snapshotWith(weather: Weather): StateSnapshot {
  return {
    quarter: 1,
    gameClock: 9000,
    down: 1,
    distance: 10,
    ballOn: 25,
    possession: 'home',
    score: { home: 0, away: 0 },
    weather,
  };
}

/**
 * Serializa um `WeatherEffect` nos canais planos do `detail` do evento
 * `WEATHER_ROLL`, de modo que os modificadores aplicados fiquem registrados no
 * log como valores JSON auditáveis.
 */
function effectToDetail(effect: WeatherEffect): Readonly<Record<string, JsonValue>> {
  return {
    reception: effect.reception,
    fumble: effect.fumble,
    deepPass: effect.deepPass,
    longKick: effect.longKick,
    fatiguePerSnap: effect.fatiguePerSnap,
  };
}

/**
 * Monta um fluxo de eventos de partida (sem `seq`) para o clima dado: um evento
 * `WEATHER_ROLL` com o clima sorteado + seus modificadores no `detail`, seguido
 * de `n` eventos genéricos — todos carregando o mesmo clima em `state.weather`.
 */
function buildStream(
  weather: Weather,
  effect: WeatherEffect,
  followUps: number,
): ReadonlyArray<PipelineLogEvent> {
  const snapshot = snapshotWith(weather);
  const weatherRoll: PipelineLogEvent = {
    type: 'WEATHER_ROLL',
    state: snapshot,
    narrative: `Clima sorteado: ${weather}.`,
    detail: {
      weather,
      modifiers: effectToDetail(effect),
    },
  };
  const rest: PipelineLogEvent[] = [];
  for (let i = 0; i < followUps; i++) {
    rest.push({
      type: 'PLAY_SELECTED',
      snap: i,
      state: snapshot,
      narrative: `Snap ${i} sob clima ${weather}.`,
      detail: { snap: i },
    });
  }
  return [weatherRoll, ...rest];
}

describe('log.weather — Property 24: clima e modificadores registrados no log (R7.6)', () => {
  it('registra o clima sorteado e os modificadores aplicados em WEATHER_ROLL', () => {
    fc.assert(
      fc.property(arbWeather, fc.nat({ max: 12 }), (weather, followUps) => {
        const effect = modifiers(weather, BASELINE_PARAMS);
        const events = buildStream(weather, effect, followUps);

        const log = buildGameLog({ events, seed: 42n, baseline: BASELINE });

        // Existe exatamente um WEATHER_ROLL preservado no log.
        const rolls = log.events.filter((e) => e.type === 'WEATHER_ROLL');
        expect(rolls).toHaveLength(1);
        const roll = rolls[0]!;

        // O clima sorteado sobrevive no detail do WEATHER_ROLL.
        expect(roll.detail.weather).toBe(weather);

        // Os cinco canais de modifiers() sobrevivem com os valores de weather.modifiers().
        expect(roll.detail.modifiers).toEqual(effectToDetail(effect));

        // E o próprio snapshot do evento carrega o clima.
        expect(roll.state.weather).toBe(weather);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('todo evento do log carrega o mesmo clima da partida em state.weather', () => {
    fc.assert(
      fc.property(arbWeather, fc.nat({ max: 12 }), (weather, followUps) => {
        const effect = modifiers(weather, BASELINE_PARAMS);
        const events = buildStream(weather, effect, followUps);

        const log = buildGameLog({ events, seed: 7n, baseline: BASELINE });

        // Consistência do clima ao longo de todo o log (R7.6: clima único).
        expect(log.events.length).toBe(followUps + 1);
        for (const e of log.events) {
          expect(e.state.weather).toBe(weather);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
