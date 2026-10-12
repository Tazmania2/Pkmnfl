// Feature: pfl-simulation-engine, Property 7: Encerramento por tempo limite de jogada
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  derivePlayTicks,
  maxTicksPerPlay,
  resolvePlayClock,
  type PlayTickInput,
} from './clock';
import { createInitialState } from './state';
import { PBT_NUM_RUNS } from './test-setup';
import type { GameState, SimulationParameters } from './types';

/**
 * Teste de propriedade do encerramento por tempo limite de jogada (Task 3.4).
 *
 * **Feature: pfl-simulation-engine, Property 7: Encerramento por tempo limite de jogada**
 *
 * _Validates: Requirements 2.4_
 *
 * Property 7 (design): *para toda* jogada que não resolve em até 300 ticks
 * (30 s / 0,1 s), o motor encerra a jogada **exatamente** no 300º tick e marca
 * o encerramento por tempo limite (que o pipeline/FSM traduz no evento
 * `TIMEOUT` do `Log_Partida`). A unidade testada é `resolvePlayClock`, que
 * reporta `{ ticks, timedOut, clockDeci }` por jogada.
 *
 * Com os valores do baseline de design — `tick_s = 0.1`, `play_timeout_s = 30`,
 * `quarter_seconds = 900` — o limite é `maxTicksPerPlay = 30 / 0.1 = 300` ticks.
 *
 * As invariantes universais verificadas são:
 * 1. `ticks` nunca excede `maxTicksPerPlay` (teto absoluto de duração).
 * 2. Quando a duração derivada atinge/excede o máximo, `timedOut === true` e
 *    `ticks === maxTicksPerPlay` (a jogada é encerrada exatamente no limite).
 * 3. Quando a duração derivada fica abaixo do máximo, `timedOut === false` e
 *    `ticks` é a própria duração derivada (sem truncamento).
 * 4. `clockDeci` nunca excede o relógio restante do quarto (`gameClockDeci`).
 */

/**
 * `SimulationParameters` com os valores de design relevantes ao relógio.
 * Apenas `tick_s`, `play_timeout_s` e `quarter_seconds` influenciam o relógio;
 * os demais campos recebem os valores de referência do baseline de design por
 * completude de tipo, sem efeito sobre `resolvePlayClock`.
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
    inactive_snap_recovery: -0.001,
    max_penalty: 0.12,
  },
  run: { base: 2, coef: 4, loss_min: -4, loss_max: -1 },
  pass: { short: [3, 10], deep: [12, 35] },
};

const MAX_TICKS = maxTicksPerPlay(BASELINE_PARAMS); // 300 com os valores de design

/** Gerador de entradas arbitrárias de jogada que governam a duração. */
const playInput: fc.Arbitrary<PlayTickInput> = fc.record({
  // Jardas amplas o bastante para, em jogadas vivas, estourar o teto de 300
  // ticks (base + |jardas| * 2 >= 300 requer |jardas| alto), exercitando os
  // dois lados do limite de tempo.
  yardsGained: fc.integer({ min: -400, max: 400 }),
  stopsClock: fc.boolean(),
  isPass: fc.boolean(),
});

/** Estado inicial de jogo com um relógio de quarto arbitrário (em décimos). */
function stateWithClock(gameClockDeci: number): GameState {
  const base = createInitialState({ weather: 'CLEAR' });
  return { ...base, gameClockDeci };
}

describe('Feature: pfl-simulation-engine, Property 7: Encerramento por tempo limite de jogada', () => {
  it('baseline de design: maxTicksPerPlay = play_timeout_s / tick_s = 300 (Req. 2.4)', () => {
    expect(MAX_TICKS).toBe(300);
  });

  it('resolvePlayClock nunca excede o teto e encerra no limite ⇔ duração ≥ máximo (Req. 2.4)', () => {
    fc.assert(
      fc.property(
        playInput,
        // Relógio restante do quarto em [0, 9000] décimos (0..900 s).
        fc.integer({ min: 0, max: 9000 }),
        (input, gameClockDeci) => {
          const state = stateWithClock(gameClockDeci);
          const outcome = resolvePlayClock(input, state, BASELINE_PARAMS);
          const derived = derivePlayTicks(input, MAX_TICKS);

          // (1) O teto absoluto é respeitado: nenhuma jogada dura mais que 300.
          expect(outcome.ticks).toBeLessThanOrEqual(MAX_TICKS);
          expect(outcome.ticks).toBeGreaterThanOrEqual(1);

          if (derived >= MAX_TICKS) {
            // (2) Atingiu/excedeu o limite → encerra EXATAMENTE no 300º tick.
            expect(outcome.timedOut).toBe(true);
            expect(outcome.ticks).toBe(MAX_TICKS);
          } else {
            // (3) Abaixo do limite → não há timeout e os ticks são a duração
            // derivada, sem truncamento.
            expect(outcome.timedOut).toBe(false);
            expect(outcome.ticks).toBe(derived);
          }

          // (4) O tempo de relógio a consumir nunca ultrapassa o relógio
          // restante do quarto (R2.3), e é não-negativo.
          expect(outcome.clockDeci).toBeGreaterThanOrEqual(0);
          expect(outcome.clockDeci).toBeLessThanOrEqual(gameClockDeci);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('jogadas vivas com jardas extremas estouram o tempo limite e são marcadas como timedOut (Req. 2.4)', () => {
    fc.assert(
      fc.property(
        // Jogada viva (não para o relógio) com |jardas| suficiente para que
        // base + |jardas| * 2 >= 300 (ou seja |jardas| >= 150), garantindo o
        // encerramento por tempo limite.
        fc.record({
          yardsGained: fc
            .integer({ min: 150, max: 400 })
            .chain((y) => fc.constantFrom(y, -y)),
          isPass: fc.boolean(),
        }),
        fc.integer({ min: 0, max: 9000 }),
        ({ yardsGained, isPass }, gameClockDeci) => {
          const state = stateWithClock(gameClockDeci);
          const outcome = resolvePlayClock(
            { yardsGained, stopsClock: false, isPass },
            state,
            BASELINE_PARAMS,
          );

          expect(outcome.timedOut).toBe(true);
          expect(outcome.ticks).toBe(MAX_TICKS);
          expect(outcome.clockDeci).toBeLessThanOrEqual(gameClockDeci);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
