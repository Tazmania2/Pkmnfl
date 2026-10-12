import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DECI_PER_TICK,
  TOTAL_QUARTERS,
  advanceClockByTicks,
  clockDeciForTicks,
  endQuarter,
  isQuarterOver,
  isRegulationOver,
  quarterDeci,
  tickDownClock,
} from './clock';
import { QUARTER_DECI, createInitialState } from './state';
import type { GameState, SimulationParameters } from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test do relógio discreto e monotônico por quarto (Task 3.3).
 *
 * // Feature: pfl-simulation-engine, Property 6: Relógio discreto e monotônico por quarto
 *
 * **Validates: Requirements 2.1, 2.3, 2.6**
 *
 * Para toda partida, `gameClockDeci` é sempre inteiro (décimos de segundo),
 * nunca aumenta dentro de um mesmo quarto, e cada decréscimo é múltiplo de 1
 * décimo (0,1 s = `DECI_PER_TICK`); a partida tem no máximo quatro quartos
 * (`TOTAL_QUARTERS`) e o fim do tempo regulamentar é atingível e detectável no
 * 4º quarto com relógio zerado (`isRegulationOver`), sem simular prolongamento.
 *
 * Esta camada expõe os blocos puros do relógio (`advanceClockByTicks`,
 * `clockDeciForTicks`, `tickDownClock`, `isQuarterOver`, `isRegulationOver`,
 * `endQuarter`). A propriedade é verificável integralmente aqui porque toda a
 * aritmética do relógio é inteira e o avanço só pode decrescer o relógio
 * (R2.1, R2.3): não há caminho que o faça aumentar dentro de um quarto, e a
 * virada/encerramento de quarto é a única operação que recarrega o relógio.
 */

/** Baseline do MVP: `tick_s = 0.1` ⇒ 1 décimo por tick; quarto de 900 s. */
const BASELINE_PARAMS: Pick<
  SimulationParameters,
  'tick_s' | 'quarter_seconds' | 'play_timeout_s'
> = {
  tick_s: 0.1,
  quarter_seconds: 900,
  play_timeout_s: 30,
};

/** Relógio arbitrário em décimos de segundo inteiros, dentro de um quarto. */
const clockArb = fc.integer({ min: 0, max: QUARTER_DECI });

/** Contagem de ticks arbitrária não negativa (até ~1,5× o quarto). */
const ticksArb = fc.integer({ min: 0, max: 15000 });

/** Clima arbitrário para montar um `GameState` inicial válido. */
const weatherArb = fc.constantFrom(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
) as fc.Arbitrary<GameState['weather']>;

describe('Relógio discreto e monotônico por quarto (Property 6)', () => {
  it('advanceClockByTicks nunca aumenta o relógio e nunca o leva abaixo de zero (R2.3)', () => {
    fc.assert(
      fc.property(clockArb, ticksArb, (gameClockDeci, ticks) => {
        const next = advanceClockByTicks(gameClockDeci, ticks);
        // Monotonicamente não crescente dentro do quarto.
        expect(next).toBeLessThanOrEqual(gameClockDeci);
        // Nunca abaixo de zero.
        expect(next).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('o relógio permanece inteiro e cada decréscimo é múltiplo de 1 décimo (R2.1)', () => {
    fc.assert(
      fc.property(clockArb, ticksArb, (gameClockDeci, ticks) => {
        const next = advanceClockByTicks(gameClockDeci, ticks);
        // Discreto: valor sempre inteiro (décimos de segundo).
        expect(Number.isInteger(next)).toBe(true);
        // Décimos efetivamente consumidos.
        const consumed = gameClockDeci - next;
        expect(Number.isInteger(consumed)).toBe(true);
        // Cada décimo consumido é múltiplo de DECI_PER_TICK (1 décimo por tick).
        expect(consumed % DECI_PER_TICK).toBe(0);
        // Nunca consome mais do que o pretendido (ticks * DECI_PER_TICK).
        expect(consumed).toBeLessThanOrEqual(ticks * DECI_PER_TICK);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('aplicar advanceClockByTicks repetidamente é monotônico não crescente e estabiliza em zero (R2.1, R2.3)', () => {
    fc.assert(
      fc.property(
        clockArb,
        fc.array(fc.integer({ min: 0, max: 2000 }), {
          minLength: 1,
          maxLength: 30,
        }),
        (start, tickSequence) => {
          let clock = start;
          for (const ticks of tickSequence) {
            const next = advanceClockByTicks(clock, ticks);
            // Cada passo nunca aumenta e permanece inteiro em [0, start].
            expect(next).toBeLessThanOrEqual(clock);
            expect(next).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(next)).toBe(true);
            clock = next;
          }
          // Após a sequência, o relógio nunca ultrapassou o valor inicial.
          expect(clock).toBeLessThanOrEqual(start);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('clockDeciForTicks limita o consumo a [0, gameClockDeci] e nunca leva o relógio abaixo de zero (R2.3)', () => {
    fc.assert(
      fc.property(clockArb, ticksArb, (gameClockDeci, ticks) => {
        const consumable = clockDeciForTicks(gameClockDeci, ticks);
        expect(consumable).toBeGreaterThanOrEqual(0);
        expect(consumable).toBeLessThanOrEqual(gameClockDeci);
        expect(Number.isInteger(consumable)).toBe(true);
        // Decrescer o relógio pelos décimos consumíveis o mantém em [0, start].
        const after = gameClockDeci - consumable;
        expect(after).toBeGreaterThanOrEqual(0);
        expect(after).toBeLessThanOrEqual(gameClockDeci);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('tickDownClock produz um GameState cujo relógio nunca aumenta e nunca fica negativo (R2.3)', () => {
    fc.assert(
      fc.property(weatherArb, clockArb, ticksArb, (weather, clock, ticks) => {
        const base = createInitialState({ weather });
        const state: GameState = { ...base, gameClockDeci: clock };
        const next = tickDownClock(state, ticks);
        expect(next.gameClockDeci).toBeLessThanOrEqual(state.gameClockDeci);
        expect(next.gameClockDeci).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(next.gameClockDeci)).toBe(true);
        // Imutável: apenas o relógio pode mudar.
        expect(next.quarter).toBe(state.quarter);
        expect(next.possession).toBe(state.possession);
        expect(next.score).toEqual(state.score);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('o quarto é organizado em unidades inteiras de décimos e coincide com QUARTER_DECI (R2.1, R2.2)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3600 }), (quarterSeconds) => {
        const params: SimulationParameters = {
          ...BASELINE_PARAMS,
          quarter_seconds: quarterSeconds,
        } as SimulationParameters;
        const deci = quarterDeci(params);
        expect(Number.isInteger(deci)).toBe(true);
        expect(deci).toBe(quarterSeconds * 10);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a partida tem no máximo quatro quartos e o fim do regulamentar é detectado só no 4º quarto zerado (R2.6)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        fc.integer({ min: 1, max: TOTAL_QUARTERS }),
        clockArb,
        (weather, quarter, clock) => {
          const base = createInitialState({ weather });
          const state: GameState = {
            ...base,
            quarter,
            gameClockDeci: clock,
          };

          const quarterOver = isQuarterOver(state);
          expect(quarterOver).toBe(clock <= 0);

          const regulationOver = isRegulationOver(state);
          // Fim do tempo regulamentar: só no 4º quarto com relógio zerado.
          expect(regulationOver).toBe(
            quarter >= TOTAL_QUARTERS && clock <= 0,
          );
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('endQuarter recarrega o relógio em quartos < 4 e nunca avança além de quatro quartos (R2.6)', () => {
    fc.assert(
      fc.property(
        weatherArb,
        fc.integer({ min: 1, max: TOTAL_QUARTERS }),
        (weather, quarter) => {
          const base = createInitialState({ weather });
          const state: GameState = {
            ...base,
            quarter,
            gameClockDeci: 0,
          };
          const next = endQuarter(state);

          if (quarter >= TOTAL_QUARTERS) {
            // No 4º quarto não há 5º: marca fim de jogo e não avança o quarto.
            expect(next.quarter).toBe(state.quarter);
            expect(next.quarter).toBeLessThanOrEqual(TOTAL_QUARTERS);
            expect(next.phase).toBe('EndOfGame');
          } else {
            // Avança um quarto e recarrega o relógio em décimos inteiros.
            expect(next.quarter).toBe(quarter + 1);
            expect(next.quarter).toBeLessThanOrEqual(TOTAL_QUARTERS);
            expect(next.gameClockDeci).toBe(QUARTER_DECI);
            expect(Number.isInteger(next.gameClockDeci)).toBe(true);
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
