/**
 * Sorteio e modificadores de clima (`lib/sim/play/weather.ts`).
 *
 * Puro e determinístico (Task 5.3). O `Clima` é sorteado **uma única vez** na
 * inicialização da partida, consumindo **exatamente um** `rng.nextFloat()`,
 * mapeado por faixas cumulativas na ordem fixa `CLEAR, RAIN, WIND, HEAT, COLD`
 * (R7.1). Os limiares são derivados cumulativamente das probabilidades
 * parametrizadas em `simulation_parameters.weather` (CLEAR .40, RAIN .20,
 * WIND .15, HEAT .15, COLD .10), reproduzindo os cortes de design
 * `<0.40 / <0.60 / <0.75 / <0.90 / caso contrário`.
 *
 * `modifiers` devolve os `weather_modifiers` do baseline correspondentes ao
 * clima vigente (R7.2–R7.5): RAIN recepção `-0.04` e fumble `+0.02`; WIND passe
 * profundo `-0.05` e chute longo `-0.05`; COLD recepção `-0.02`; HEAT fadiga
 * `+0.002`/snap; CLEAR sem modificador. A função é pura: não consome RNG, não lê
 * ambiente e não muta a entrada — apenas projeta o baseline no clima dado.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.5_
 */

import type {
  Rng,
} from '../rng';
import type {
  SimulationParameters,
  Weather,
  WeatherModifiers,
} from '../types';

/**
 * Ordem fixa de avaliação das faixas cumulativas de clima (R7.1). A ordem é
 * canônica e NUNCA deve mudar: o determinismo do sorteio depende dela.
 */
const WEATHER_ORDER: readonly Weather[] = [
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
] as const;

/**
 * Projeção canônica (nula) dos modificadores quando o clima não traz efeito:
 * usada para `CLEAR`, cujo contrato é "sem modificador".
 */
export interface WeatherEffect {
  /** Delta aplicado à recepção (RAIN/COLD); 0 quando não aplicável. */
  readonly reception: number;
  /** Acréscimo à probabilidade de fumble (RAIN); 0 quando não aplicável. */
  readonly fumble: number;
  /** Delta aplicado a passes profundos (WIND); 0 quando não aplicável. */
  readonly deepPass: number;
  /** Delta aplicado a chutes longos (WIND); 0 quando não aplicável. */
  readonly longKick: number;
  /** Fadiga adicional por snap (HEAT); 0 quando não aplicável. */
  readonly fatiguePerSnap: number;
}

/** Efeito neutro de clima (CLEAR — sem modificador). */
const NO_EFFECT: WeatherEffect = {
  reception: 0,
  fumble: 0,
  deepPass: 0,
  longKick: 0,
  fatiguePerSnap: 0,
};

/**
 * Sorteia o `Clima` da partida consumindo **um único** `rng.nextFloat()`.
 *
 * O mapeamento usa faixas cumulativas na ordem `CLEAR, RAIN, WIND, HEAT, COLD`,
 * com os limiares derivados somando as probabilidades de `params.weather` na
 * mesma ordem. Para as probabilidades de design (0.40 / 0.20 / 0.15 / 0.15 /
 * 0.10) isso reproduz exatamente os cortes `<0.40 / <0.60 / <0.75 / <0.90`,
 * caindo em `COLD` no restante. O último clima da ordem é o fallback: qualquer
 * `r < 1` que ultrapasse os limiares anteriores (inclusive por imprecisão de
 * ponto flutuante na soma) resolve-se nele, garantindo totalidade do mapeamento.
 *
 * @param rng    Gerador_RNG determinístico (única fonte de entropia).
 * @param params Parâmetros de simulação do baseline (fornecem `weather`).
 * @returns O `Weather` sorteado.
 */
export function roll(rng: Rng, params: SimulationParameters): Weather {
  // RNG consume #k: sorteio de clima (um único nextFloat na inicialização).
  const r = rng.nextFloat();

  // Faixas cumulativas na ordem canônica. Avalia-se até o penúltimo clima; o
  // último (`COLD`, `fallback`) fecha o intervalo [0,1), tornando o mapeamento
  // total mesmo sob somas de ponto flutuante levemente < 1.
  const fallback: Weather = WEATHER_ORDER[WEATHER_ORDER.length - 1] ?? 'COLD';
  let cumulative = 0;
  for (const weather of WEATHER_ORDER) {
    if (weather === fallback) {
      break;
    }
    cumulative += params.weather[weather];
    if (r < cumulative) {
      return weather;
    }
  }

  return fallback;
}

/**
 * Projeta os `weather_modifiers` do baseline no clima vigente, devolvendo um
 * `WeatherEffect` com todos os campos preenchidos (0 quando o clima não afeta
 * aquele canal). Pura: não consome RNG nem muta a entrada.
 *
 * - RAIN: recepção `-0.04`, fumble `+0.02` (R7.2).
 * - WIND: passe profundo `-0.05`, chute longo `-0.05` (R7.3).
 * - COLD: recepção `-0.02` (R7.5).
 * - HEAT: fadiga `+0.002`/snap (R7.4; aplicada pela fadiga, não à probabilidade).
 * - CLEAR: sem modificador.
 *
 * Os valores vêm de `params.weather_modifiers` (parametrizados no baseline), não
 * de constantes locais, mantendo a origem única e versionada.
 *
 * @param weather Clima vigente.
 * @param params  Parâmetros de simulação do baseline (fornecem `weather_modifiers`).
 * @returns O efeito de clima correspondente.
 */
export function modifiers(
  weather: Weather,
  params: SimulationParameters,
): WeatherEffect {
  const mods: WeatherModifiers = params.weather_modifiers;

  switch (weather) {
    case 'RAIN':
      return {
        ...NO_EFFECT,
        reception: mods.RAIN.reception,
        fumble: mods.RAIN.fumble,
      };
    case 'WIND':
      return {
        ...NO_EFFECT,
        deepPass: mods.WIND.deep_pass,
        longKick: mods.WIND.long_kick,
      };
    case 'COLD':
      return {
        ...NO_EFFECT,
        reception: mods.COLD.reception,
      };
    case 'HEAT':
      return {
        ...NO_EFFECT,
        fatiguePerSnap: mods.HEAT.fatigue_per_snap,
      };
    case 'CLEAR':
    default:
      return NO_EFFECT;
  }
}
