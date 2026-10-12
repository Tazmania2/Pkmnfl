/**
 * Fadiga compartilhada por instance_id (`lib/sim/play/fatigue.ts`).
 *
 * Transição pura do `Motor_Simulacao` que atualiza a `Fadiga` após um snap. A
 * fadiga é indexada por `instance_id` — não por unidade de jogo — de modo que,
 * se o mesmo indivíduo atua em ataque e em special teams, as participações
 * leem e escrevem a MESMA entrada do mapa. O mapa de entrada nunca é mutado:
 * `applyFatigue` devolve um **novo** `ReadonlyMap`, preservando as entradas de
 * todos os `instance_id` que não participam do snap (persistência por toda a
 * partida).
 *
 * Regras de acúmulo/recuperação por snap (parametrizadas pelo baseline em
 * `simulation_parameters.fatigue` e `weather_modifiers.HEAT`):
 * - snap ativo: `+active` (default `0.003`) — R6.4
 * - ação extrema: `+extreme_action` (default `0.005`), tem precedência sobre o
 *   acréscimo de ativo (uma ação extrema é também um snap ativo; aplica-se o
 *   maior incremento, não a soma dos dois) — R6.4
 * - snap inativo: `-inactive_snap_recovery` (default `0.001`) — R6.5
 * - clima HEAT: `+fatigue_per_snap` (default `0.002`) adicional para quem
 *   participa do snap (ativo ou extremo), nunca para quem recupera — R7.4
 *
 * Toda penalidade resultante é limitada ao intervalo fechado
 * `[0, max_penalty]` (default `[0, 0.12]`) — R6.6.
 *
 * Puro: sem I/O, sem rede, sem relógio de sistema, sem entropia externa. A
 * mesma entrada sempre produz a mesma saída.
 *
 * _Requirements: 6.4, 6.5, 6.6, 6.7, 7.4, 11.5_
 */

import type { FatigueParameters, Weather } from '../types';

// ---------------------------------------------------------------------------
// Defaults do baseline (simulation_parameters.fatigue e weather_modifiers.HEAT)
// ---------------------------------------------------------------------------

/** Parâmetros de fadiga padrão do baseline congelado do MVP. */
export const DEFAULT_FATIGUE_PARAMETERS: FatigueParameters = {
  active: 0.003,
  extreme_action: 0.005,
  inactive_snap_recovery: 0.001,
  max_penalty: 0.12,
};

/** Acréscimo adicional de fadiga por snap sob clima HEAT (R7.4). */
export const DEFAULT_HEAT_FATIGUE_PER_SNAP = 0.002;

/** Piso da penalidade de fadiga (nunca negativa). */
export const FATIGUE_MIN = 0;

// ---------------------------------------------------------------------------
// Entrada da transição
// ---------------------------------------------------------------------------

/**
 * Conjuntos de `instance_id` que descrevem a participação de cada indivíduo no
 * snap recém-resolvido, mais o clima vigente e os parâmetros do baseline.
 *
 * Os conjuntos são indexados por `instance_id` (compartilhado entre todas as
 * unidades do mesmo indivíduo). Um `instance_id` que não aparece em nenhum dos
 * três conjuntos tem sua fadiga preservada inalterada.
 *
 * Precedência quando um `instance_id` aparece em mais de um conjunto:
 * `extreme` > `active` > `inactive`. Assim, um indivíduo marcado como extremo
 * recebe `+extreme_action` (não a soma com `+active`), e nunca recupera no
 * mesmo snap em que participou ativamente.
 */
export interface FatigueSnapInput {
  /** `instance_id` que participaram ativamente do snap (R6.4). */
  readonly activeInstances: ReadonlySet<number>;
  /** `instance_id` que realizaram uma ação extrema no snap (R6.4). */
  readonly extremeInstances: ReadonlySet<number>;
  /** `instance_id` presentes no snap, porém inativos — recuperam (R6.5). */
  readonly inactiveInstances: ReadonlySet<number>;
  /** Clima vigente; sob HEAT, participantes recebem acréscimo por snap (R7.4). */
  readonly weather: Weather;
  /** Parâmetros de fadiga (default: baseline do MVP). */
  readonly params?: FatigueParameters;
  /** Acréscimo de fadiga por snap sob HEAT (default: baseline do MVP). */
  readonly heatFatiguePerSnap?: number;
}

// ---------------------------------------------------------------------------
// Utilitário interno
// ---------------------------------------------------------------------------

/** Limita um valor ao intervalo fechado `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ---------------------------------------------------------------------------
// Transição pura: (fadiga prévia, participação do snap) → nova fadiga
// ---------------------------------------------------------------------------

/**
 * Aplica, de forma pura, a atualização de fadiga de um snap sobre o mapa de
 * fadiga prévio, indexado por `instance_id`.
 *
 * Para cada `instance_id` tocado pelo snap, parte da fadiga prévia (zero quando
 * ausente), soma o delta correspondente à sua participação (com a precedência
 * `extreme` > `active` > `inactive`), acrescenta a penalidade de HEAT quando o
 * indivíduo participou e o clima é HEAT, e limita o resultado a
 * `[0, max_penalty]`. `instance_id` ausentes de todos os conjuntos são copiados
 * sem alteração, preservando a persistência da fadiga por toda a partida.
 *
 * Não muta nenhum argumento: devolve um novo `ReadonlyMap`.
 *
 * @param prev Fadiga corrente indexada por `instance_id` (não mutada).
 * @param input Conjuntos de participação do snap, clima e parâmetros.
 * @returns Novo `ReadonlyMap<number, number>` com a fadiga atualizada e limitada.
 */
export function applyFatigue(
  prev: ReadonlyMap<number, number>,
  input: FatigueSnapInput,
): ReadonlyMap<number, number> {
  const params = input.params ?? DEFAULT_FATIGUE_PARAMETERS;
  const heatPerSnap = input.heatFatiguePerSnap ?? DEFAULT_HEAT_FATIGUE_PER_SNAP;
  const isHeat = input.weather === 'HEAT';

  // Começa de uma cópia da fadiga prévia: todo instance_id não tocado pelo snap
  // mantém sua penalidade acumulada (persistência durante toda a partida).
  const next = new Map<number, number>(prev);

  const applyDelta = (instanceId: number, delta: number): void => {
    const base = next.get(instanceId) ?? 0;
    next.set(instanceId, clamp(base + delta, FATIGUE_MIN, params.max_penalty));
  };

  // Precedência extreme > active > inactive: um instance_id em `extreme` não é
  // processado novamente como `active`, e um que participou (ativo/extremo) não
  // recupera no mesmo snap. Rastreamos quem já foi processado como participante
  // para resolver sobreposições de forma determinística.
  const processed = new Set<number>();

  // 1) Ações extremas: +extreme_action (+ HEAT se aplicável).
  for (const instanceId of input.extremeInstances) {
    const delta = params.extreme_action + (isHeat ? heatPerSnap : 0);
    applyDelta(instanceId, delta);
    processed.add(instanceId);
  }

  // 2) Snaps ativos (que não foram ações extremas): +active (+ HEAT se aplicável).
  for (const instanceId of input.activeInstances) {
    if (processed.has(instanceId)) continue;
    const delta = params.active + (isHeat ? heatPerSnap : 0);
    applyDelta(instanceId, delta);
    processed.add(instanceId);
  }

  // 3) Inativos que não participaram do snap: recuperam -inactive_snap_recovery.
  //    Não recebem o acréscimo de HEAT, pois não participaram do snap.
  for (const instanceId of input.inactiveInstances) {
    if (processed.has(instanceId)) continue;
    applyDelta(instanceId, -params.inactive_snap_recovery);
    processed.add(instanceId);
  }

  return next;
}
