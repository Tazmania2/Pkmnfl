/**
 * Modelo_Probabilistico — disputa, corrida e passe (`lib/sim/play/probability.ts`).
 *
 * Funções **puras** do núcleo que implementam o modelo probabilístico do design
 * (seção "(d) Disputa de atributos — Modelo_Probabilistico" e "(e)/(f) Clima,
 * fadiga e resolução do resultado"). Nenhuma leitura de ambiente, relógio ou
 * `Math.random`: toda aleatoriedade entra pelo `Rng` recebido e sai no resultado,
 * consumido na ordem fixa documentada por `// RNG consume #k: ...`.
 *
 * Os parâmetros numéricos (`base`, `difference_coefficient`, `min`, `max`,
 * `skill_mod_max_abs`, intervalos de corrida/passe) vêm sempre de
 * `SimulationParameters` (baseline de design não calibrado), nunca hardcoded —
 * os valores do baseline MVP são `base=0.5`, `coef=0.45`, `min=0.05`, `max=0.95`,
 * `skill_mod_max_abs=0.15`, perda de corrida em `[-4, -1]`, passe curto `[3, 10]`
 * e profundo `[12, 35]`.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.8, 6.9_
 */

import type { Rng } from '../rng';
import type { SimulationParameters } from '../types';

/** Limita `value` ao intervalo fechado `[lo, hi]`. */
function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}

/**
 * Normaliza uma diferença de atributos para `[-1, 1]`. Valores já normalizados
 * passam intactos; valores fora da faixa são saturados (clamp), de modo que o
 * termo `difference_coefficient * Δattr` nunca exceda `±difference_coefficient`
 * antes do clamp final da probabilidade.
 */
export function normalizeAttrDelta(attrDelta: number): number {
  return clamp(attrDelta, -1, 1);
}

/**
 * Aplica o limite do módulo de um modificador de habilidade a
 * `skill_mod_max_abs` (R6.3). O resultado fica sempre em
 * `[-skill_mod_max_abs, +skill_mod_max_abs]`.
 */
export function applySkillMod(
  skillMod: number,
  params: Pick<SimulationParameters, 'skill_mod_max_abs'>,
): number {
  const maxAbs = Math.abs(params.skill_mod_max_abs);
  return clamp(skillMod, -maxAbs, maxAbs);
}

/** Entradas do cálculo da probabilidade de uma `Disputa_Atributos`. */
export interface ComputeProbabilityInput {
  /**
   * Δattr: diferença de atributos relevantes (ofensiva − defensiva), **já
   * normalizada** ou passível de normalização para `[-1, 1]`.
   */
  readonly attrDelta: number;
  /** `offense_probability_delta` do matchup, aplicado antes do clamp (R5.2). */
  readonly matchupDelta?: number;
  /** Modificador de habilidade bruto (será limitado a `±skill_mod_max_abs`). */
  readonly skillMod?: number;
  /** Modificador agregado de clima (recepção/passe/chute conforme a fase). */
  readonly climaMod?: number;
}

/**
 * Calcula a probabilidade final de sucesso de uma `Disputa_Atributos` (R6.1,
 * R6.2):
 *
 * ```
 * p_bruta = base + difference_coefficient * Δattr + delta_matchup + skillMod + climaMod
 * p_final = clamp(p_bruta, min, max)
 * ```
 *
 * - `Δattr` é normalizado a `[-1, 1]` antes de entrar na fórmula.
 * - `skillMod` é limitado a `±skill_mod_max_abs` antes de somar.
 * - O **clamp a `[min, max]` é a última operação** sobre a probabilidade: nenhum
 *   modificador posterior pode retirá-la de `[0.05, 0.95]` (R6.2).
 *
 * Função pura: não consome RNG.
 */
export function compute(
  input: ComputeProbabilityInput,
  params: SimulationParameters,
): number {
  const dAttr = normalizeAttrDelta(input.attrDelta);
  const matchupDelta = input.matchupDelta ?? 0;
  const skillMod = applySkillMod(input.skillMod ?? 0, params);
  const climaMod = input.climaMod ?? 0;

  const pBruta =
    params.base +
    params.difference_coefficient * dAttr +
    matchupDelta +
    skillMod +
    climaMod;

  // Clamp final — ÚLTIMA operação sobre a probabilidade (R6.2).
  return clamp(pBruta, params.min, params.max);
}

/**
 * Decide o sucesso de uma disputa contra a probabilidade final (R6.1): sucesso
 * quando `rng.nextFloat() < p_final`.
 *
 * Consome **exatamente um** valor do RNG — o "teste de sucesso" da ordem fixa de
 * consumo (ver design: "Ordem fixa de consumo do RNG", passo 2.iii).
 */
export function decideSuccess(pFinal: number, rng: Rng): boolean {
  // RNG consume #1 (disputa): teste de sucesso contra a probabilidade final.
  return rng.nextFloat() < pFinal;
}

/** Resultado da amostragem de jardas de uma jogada de corrida. */
export interface RunResult {
  /** Jardas resultantes: ganho (>= 0) quando o gap é vencido, perda (< 0) quando perdido. */
  readonly yards: number;
  /** `true` quando o ataque venceu o gap de corrida (ganho); `false` em perda. */
  readonly gained: boolean;
}

/**
 * Resolve as jardas de uma jogada de **corrida** (R6.8).
 *
 * - Quando o gap é vencido (`gapWon = true`): ganho determinístico pela fórmula
 *   `ganho = base_run + round(coef_run * clamp(run_advantage, 0, 1))`. Com o
 *   baseline MVP (`run.base = 2`, `run.coef = 4`) isso é
 *   `2 + round(4 * clamp(run_advantage, 0, 1))`, ou seja `[2, 6]`.
 * - Quando o gap é perdido (`gapWon = false`): perda **amostrada** uniformemente
 *   em `[run.loss_min, run.loss_max] = [-4, -1]` jardas via `rng.nextInt`.
 *
 * O caminho de ganho não consome RNG (é determinístico); o caminho de perda
 * consome exatamente um `rng.nextInt` — amostragem de resultado da ordem fixa.
 */
export function run(
  runAdvantage: number,
  gapWon: boolean,
  params: SimulationParameters,
  rng: Rng,
): RunResult {
  if (gapWon) {
    const gain =
      params.run.base + Math.round(params.run.coef * clamp(runAdvantage, 0, 1));
    return { yards: gain, gained: true };
  }
  // RNG consume (corrida): perda amostrada em [loss_min, loss_max] = [-4, -1].
  const loss = rng.nextInt(params.run.loss_min, params.run.loss_max);
  return { yards: loss, gained: false };
}

/** Profundidade do passe, que seleciona o intervalo de jardas-alvo. */
export type PassDepth = 'short' | 'deep';

/**
 * Amostra as **jardas-alvo** de uma jogada de **passe** (R6.9) via RNG, no
 * intervalo definido pelo baseline:
 *
 * - `short` → `pass.short = [3, 10]`
 * - `deep`  → `pass.deep  = [12, 35]`
 *
 * Consome exatamente um `rng.nextInt` — amostragem de resultado da ordem fixa.
 */
export function pass(
  depth: PassDepth,
  params: SimulationParameters,
  rng: Rng,
): number {
  const [lo, hi] = depth === 'short' ? params.pass.short : params.pass.deep;
  // RNG consume (passe): jardas-alvo amostradas no intervalo do baseline.
  return rng.nextInt(lo, hi);
}
