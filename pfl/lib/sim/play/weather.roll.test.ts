/**
 * Property test do sorteio de clima (`roll`) — Task 5.4.
 *
 * // Feature: pfl-simulation-engine, Property 22: Sorteio de clima pelas faixas cumulativas
 *
 * **Validates: Requirements 7.1**
 *
 * *Para todo* valor `r` em [0, 1) do `Gerador_RNG`, o clima sorteado é
 * determinado pelas faixas cumulativas na ordem fixa `CLEAR` (r < 0.40),
 * `RAIN` (r < 0.60), `WIND` (r < 0.75), `HEAT` (r < 0.90) e `COLD` (caso
 * contrário), com os limiares derivados cumulativamente das probabilidades
 * de `params.weather`. Além disso, `roll` consome **exatamente um**
 * `rng.nextFloat()` na inicialização.
 *
 * Este arquivo cobre SOMENTE o sorteio (`roll`); os modificadores de clima
 * (`modifiers`) são testados em arquivo dedicado (Task 5.5 — Property 23).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { roll } from './weather';
import { createRng, type Rng } from '../rng';
import type { SimulationParameters, Weather } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * `SimulationParameters` com os valores de design do MVP. Apenas `weather`
 * influencia `roll` (probabilidades CLEAR .40 / RAIN .20 / WIND .15 /
 * HEAT .15 / COLD .10, cujas somas cumulativas dão os cortes
 * 0.40 / 0.60 / 0.75 / 0.90); os demais campos constam por completude do
 * contrato de tipo e não são lidos pelo sorteio.
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

/**
 * Oráculo independente do mapeamento de clima (R7.1). Reconstrói as faixas
 * cumulativas na ordem fixa `CLEAR, RAIN, WIND, HEAT, COLD` **derivando os
 * limiares por soma das probabilidades de `params.weather`** — exatamente o que
 * o design manda ("faixas cumulativas ... derivadas das probabilidades"). O
 * último clima da ordem é o fallback, fechando [0,1) e garantindo totalidade.
 *
 * Importante: a derivação cumulativa é feita com a MESMA aritmética de ponto
 * flutuante que a implementação (somas sucessivas na mesma ordem), de modo que
 * este oráculo valide a regra cumulativa em si — e não uma reinterpretação com
 * literais `0.40/0.60/0.75/0.90`, que divergiriam da soma por 1 ULP em cortes
 * como `0.6`, `0.75` e `0.9` (ver teste de fronteira).
 */
function expectedWeather(r: number, params: SimulationParameters): Weather {
  const order: readonly Weather[] = ALL_WEATHER;
  const fallback = order[order.length - 1] as Weather;
  let cumulative = 0;
  for (const weather of order) {
    if (weather === fallback) break;
    cumulative += params.weather[weather];
    if (r < cumulative) return weather;
  }
  return fallback;
}

/**
 * Cria um `Rng` falso que registra quantas vezes `nextFloat` foi chamado e
 * devolve sempre o valor controlado `value`. `nextInt`/`state` não são usados
 * por `roll`, mas constam para honrar o contrato de `Rng`.
 */
function stubRng(value: number): { rng: Rng; floatCalls: () => number } {
  let calls = 0;
  const rng: Rng = {
    nextFloat(): number {
      calls += 1;
      return value;
    },
    nextInt(): number {
      throw new Error('roll não deve chamar nextInt');
    },
    state(): readonly [number, number, number, number] {
      return [0, 0, 0, 0] as const;
    },
  };
  return { rng, floatCalls: () => calls };
}

describe('weather.roll — Property 22 (sorteio por faixas cumulativas)', () => {
  it('mapeia r em [0,1) pelas faixas cumulativas na ordem canônica', () => {
    fc.assert(
      fc.property(
        // Floats em [0, 1), o domínio exato do nextFloat do RNG.
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (r) => {
          const { rng } = stubRng(r);
          expect(roll(rng, BASELINE_PARAMS)).toBe(
            expectedWeather(r, BASELINE_PARAMS),
          );
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('consome exatamente um nextFloat por sorteio (stub Rng)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (r) => {
          const { rng, floatCalls } = stubRng(r);
          roll(rng, BASELINE_PARAMS);
          expect(floatCalls()).toBe(1);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('com o RNG real, sempre devolve um Weather válido e avança o estado em exatamente um draw', () => {
    fc.assert(
      fc.property(
        // Seeds uint64 arbitrários via composição de duas palavras de 32 bits.
        fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
        (seed) => {
          // Dois RNGs com o mesmo seed produzem a mesma trajetória.
          const rngUnderTest = createRng(seed);
          const rngOracle = createRng(seed);

          const weather = rollWithRealRng(rngUnderTest);

          // 1) Resultado é sempre um clima válido (totalidade do mapeamento).
          expect(ALL_WEATHER).toContain(weather);

          // 2) Consome exatamente um nextFloat: o estado de `rngUnderTest`
          //    após `roll` deve igualar o estado de um RNG irmão que avançou
          //    exatamente um `nextFloat()` — nem mais, nem menos.
          const firstDraw = rngOracle.nextFloat();
          expect(rngUnderTest.state()).toEqual(rngOracle.state());

          // 3) E o clima resultante corresponde ao primeiro float sorteado,
          //    confirmando que `roll` usou aquele único draw.
          expect(weather).toBe(expectedWeather(firstDraw, BASELINE_PARAMS));
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('resolve os valores de fronteira conforme as faixas cumulativas', () => {
    // Casos "no interior" de cada faixa — mapeiam de forma inequívoca,
    // independentemente de arredondamento de ponto flutuante.
    const interior: ReadonlyArray<readonly [number, Weather]> = [
      [0.0, 'CLEAR'],
      [0.3999, 'CLEAR'],
      [0.4, 'RAIN'], // corte CLEAR é prob. única (0.4), não soma: 0.4 < 0.4 é falso
      [0.5999, 'RAIN'],
      [0.7499, 'WIND'],
      [0.8999, 'HEAT'],
      [0.9999, 'COLD'],
    ];

    for (const [r, expected] of interior) {
      const { rng } = stubRng(r);
      expect(roll(rng, BASELINE_PARAMS)).toBe(expected);
    }

    // Fronteiras nominais nos cortes SOMADOS (0.60, 0.75, 0.90): como os
    // limiares são derivados cumulativamente de `params.weather`, cada soma
    // resulta ~1 ULP ACIMA do valor nominal (0.6→0.6000000000000001, etc.).
    // Logo `r` exatamente no corte nominal cai na faixa INFERIOR. Este é o
    // comportamento correto da regra cumulativa (R7.1) e aqui é fixado como
    // contrato — o oráculo cumulativo abaixo deve concordar com `roll`.
    const summedBoundaries: readonly number[] = [0.6, 0.75, 0.9];
    for (const r of summedBoundaries) {
      const { rng } = stubRng(r);
      expect(roll(rng, BASELINE_PARAMS)).toBe(
        expectedWeather(r, BASELINE_PARAMS),
      );
    }
    // E, explicitamente, o lado inferior do corte somado:
    expect(roll(stubRng(0.6).rng, BASELINE_PARAMS)).toBe('RAIN');
    expect(roll(stubRng(0.75).rng, BASELINE_PARAMS)).toBe('WIND');
    expect(roll(stubRng(0.9).rng, BASELINE_PARAMS)).toBe('HEAT');
  });
});

/**
 * Executa `roll` com o RNG real. Isolado numa função para deixar explícito que
 * nenhuma outra fonte de entropia é consumida no caminho sob teste.
 */
function rollWithRealRng(rng: Rng): Weather {
  return roll(rng, BASELINE_PARAMS);
}
