/**
 * GameState imutável + transições puras (`lib/sim/state.ts`).
 *
 * Este módulo é o **contêiner de estado imutável** da partida e o conjunto de
 * transições puras genéricas sobre ele. Toda transição tem a forma
 * `(GameState, PlayResolution) → GameState`: recebe o estado corrente e o
 * resultado de uma jogada e devolve um **novo** `GameState`, sem nunca mutar o
 * objeto de entrada (spread para campos escalares, `new Map` para a fadiga).
 * Isso torna o histórico reconstruível e o determinismo byte a byte trivial de
 * verificar — a mesma sequência de entradas sempre produz a mesma sequência de
 * estados.
 *
 * Escopo da Task 3.1: criação do estado inicial e as transições puras
 * genéricas (avanço de bola, placar, posse, relógio, down/distância, fadiga).
 * A lógica da máquina de estados do fluxo de jogo (quais transições disparam em
 * cada fase, special teams, pontuação) é da Task 12.1 (`fsm.ts`) — aqui ficam
 * apenas os blocos de construção imutáveis que a FSM reutiliza, sem duplicar a
 * decisão de fluxo.
 *
 * Convenções de domínio preservadas (R3.7):
 * - `ballOn`: posição da bola em **jardas relativas às goal lines** (0..100,
 *   onde a goal line defendida pelo time em posse é 0 e a goal line adversária
 *   é 100). Usada para determinar touchdown, safety e tentativas de pontuação.
 * - `ballPos`: `Vec3` da esfera física, consumido pela `Esfera_Supressao`.
 * - `fatigue`: `ReadonlyMap<number, number>` indexada por `instance_id`,
 *   compartilhada entre todas as unidades do mesmo indivíduo e atualizada
 *   imutavelmente (nunca `.set` sobre o mapa de entrada).
 *
 * Puro: sem I/O, sem rede, sem relógio de sistema, sem entropia externa.
 *
 * _Requirements: 3.7_
 */

import type { GameState, GamePhase, Team, Vec3, Weather } from './types';

// ---------------------------------------------------------------------------
// Constantes de domínio (NFL)
// ---------------------------------------------------------------------------

/** Comprimento do campo de jogo entre as goal lines, em jardas. */
export const FIELD_LENGTH_YARDS = 100;
/** Jardas a conquistar para um novo conjunto de downs. */
export const DEFAULT_DISTANCE_YARDS = 10;
/** Número de downs por conjunto. */
export const DOWNS_PER_SET = 4;
/** Relógio de um quarto em décimos de segundo (900 s). */
export const QUARTER_DECI = 9000;
/** Posição-padrão da bola após o kickoff de abertura (own 25). */
export const KICKOFF_BALL_ON = 25;
/** Origem espacial neutra da esfera no início da partida. */
export const INITIAL_BALL_POS: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Resultado de uma jogada aplicável ao estado, mínimo e focado nas atualizações
 * de estado (não na lógica de fluxo). É intencionalmente genérico: a FSM
 * (Task 12.1) o produz a partir do pipeline de resolução e o alimenta às
 * transições puras deste módulo.
 *
 * Campos opcionais são "sem efeito quando ausentes": aplicar uma
 * `PlayResolution` vazia (`{}`) devolve um estado equivalente ao de entrada
 * (identidade), o que mantém as transições componíveis.
 */
export interface PlayResolution {
  /** Jardas líquidas ganhas (negativas em perda). Avança/retrocede `ballOn`. */
  readonly yardsGained?: number;
  /** Décimos de segundo consumidos pela jogada (sempre não negativo). */
  readonly clockDeci?: number;
  /** Pontos marcados pelo time indicado em `scoringTeam` nesta jogada. */
  readonly pointsScored?: number;
  /** Time que marcou os pontos (default: time em posse). */
  readonly scoringTeam?: Team;
  /** Quando `true`, a posse passa ao adversário (turnover/punt/entrega). */
  readonly possessionChanges?: boolean;
  /** Delta de fadiga por `instance_id` a aplicar imutavelmente. */
  readonly fatigueDelta?: ReadonlyMap<number, number>;
  /** Nova fase da FSM, se a transição a altera. */
  readonly nextPhase?: GamePhase;
  /** Nova posição espacial da esfera, se a jogada a reposiciona. */
  readonly ballPos?: Vec3;
}

/** Entrada para a criação do estado inicial da partida. */
export interface InitialStateInput {
  /** Clima sorteado na inicialização (consumido do RNG antes das jogadas). */
  readonly weather: Weather;
  /** Time que recebe o kickoff de abertura (default: `home`). */
  readonly possession?: Team;
}

// ---------------------------------------------------------------------------
// Criação do estado inicial
// ---------------------------------------------------------------------------

/**
 * Cria o `GameState` inicial da partida com defaults sensatos de NFL: 1º
 * quarto, relógio cheio (9000 décimos = 900 s), 1º down e 10 jardas, fase de
 * kickoff, placar zerado, bola na própria 25 e mapa de fadiga vazio.
 *
 * O estado retornado é imutável: a fadiga é um `ReadonlyMap` vazio e os campos
 * aninhados (`score`, `ballPos`) são objetos novos, de modo que nenhuma
 * referência externa compartilhada possa mutá-lo.
 *
 * @param input Clima sorteado e, opcionalmente, o time que recebe o kickoff.
 * @returns O `GameState` inicial.
 */
export function createInitialState(input: InitialStateInput): GameState {
  return {
    quarter: 1,
    gameClockDeci: QUARTER_DECI,
    down: 1,
    distance: DEFAULT_DISTANCE_YARDS,
    ballOn: KICKOFF_BALL_ON,
    possession: input.possession ?? 'home',
    score: { home: 0, away: 0 },
    weather: input.weather,
    phase: 'Kickoff',
    fatigue: new Map<number, number>(),
    ballPos: { ...INITIAL_BALL_POS },
    snapCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Utilitários puros de atualização imutável
// ---------------------------------------------------------------------------

/** O time adversário ao informado. */
export function opponentOf(team: Team): Team {
  return team === 'home' ? 'away' : 'home';
}

/** Limita um valor ao intervalo fechado `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Combina a fadiga corrente com um delta por `instance_id`, devolvendo um
 * **novo** `ReadonlyMap` sem mutar nenhum dos mapas de entrada. Chaves ausentes
 * no mapa corrente partem de zero; o resultado é limitado a `[0, maxPenalty]`
 * para respeitar o teto de penalidade do baseline.
 *
 * @param current Fadiga corrente indexada por `instance_id`.
 * @param delta Variação por `instance_id` (positiva ou negativa).
 * @param maxPenalty Teto da penalidade de fadiga (default: 0.12 do baseline).
 * @returns Novo mapa imutável com a fadiga combinada e limitada.
 */
export function mergeFatigue(
  current: ReadonlyMap<number, number>,
  delta: ReadonlyMap<number, number>,
  maxPenalty = 0.12,
): ReadonlyMap<number, number> {
  const next = new Map<number, number>(current);
  for (const [instanceId, change] of delta) {
    const base = next.get(instanceId) ?? 0;
    next.set(instanceId, clamp(base + change, 0, maxPenalty));
  }
  return next;
}

/**
 * Devolve um novo `GameState` com os campos informados sobrescritos, sem mutar
 * o estado de entrada. Atalho tipado para transições pontuais que a FSM compõe.
 *
 * @param state Estado corrente.
 * @param patch Campos a sobrescrever.
 * @returns Novo estado imutável.
 */
export function withState(
  state: GameState,
  patch: Partial<GameState>,
): GameState {
  return { ...state, ...patch };
}

// ---------------------------------------------------------------------------
// Transição pura genérica (GameState, PlayResolution) → GameState
// ---------------------------------------------------------------------------

/**
 * Aplica uma `PlayResolution` ao estado, devolvendo um **novo** `GameState`.
 *
 * As atualizações são genéricas e situacionais, não decisões de fluxo (estas
 * ficam na FSM, Task 12.1):
 * - **Bola**: `ballOn` avança por `yardsGained` e é limitado a `[0, 100]`
 *   jardas relativas às goal lines; `ballPos` é reposicionado se informado.
 * - **Relógio**: `gameClockDeci` decresce por `clockDeci`, nunca abaixo de 0.
 * - **Placar**: `pointsScored` é somado ao `scoringTeam` (default: time em
 *   posse), sem mutar o objeto `score` de entrada.
 * - **Posse**: quando `possessionChanges`, passa ao adversário e a perspectiva
 *   de `ballOn` é espelhada (`100 - ballOn`), pois a posição é relativa às goal
 *   lines do time em posse.
 * - **Fadiga**: combinada imutavelmente por `instance_id` via `mergeFatigue`.
 * - **Fase**: sobrescrita apenas se `nextPhase` for informada.
 *
 * `snapCount` é incrementado por padrão (uma jogada resolvida = um snap);
 * passe `countSnap = false` para transições que não representam um snap (ex.
 * ajustes administrativos de estado).
 *
 * @param state Estado corrente (não mutado).
 * @param resolution Resultado da jogada a aplicar.
 * @param countSnap Se incrementa `snapCount` (default: `true`).
 * @returns Novo `GameState` imutável.
 */
export function applyPlayResolution(
  state: GameState,
  resolution: PlayResolution,
  countSnap = true,
): GameState {
  const possessionChanges = resolution.possessionChanges ?? false;
  const nextPossession = possessionChanges
    ? opponentOf(state.possession)
    : state.possession;

  // `ballOn` é relativo às goal lines do time em posse. Avança pelo ganho e,
  // em troca de posse, espelha para a perspectiva do novo time em posse.
  const advanced = clamp(
    state.ballOn + (resolution.yardsGained ?? 0),
    0,
    FIELD_LENGTH_YARDS,
  );
  const nextBallOn = possessionChanges
    ? FIELD_LENGTH_YARDS - advanced
    : advanced;

  // Placar: soma imutável no time que pontuou (default: time em posse atual).
  const scoringTeam = resolution.scoringTeam ?? state.possession;
  const points = resolution.pointsScored ?? 0;
  const nextScore =
    points > 0
      ? {
          home: state.score.home + (scoringTeam === 'home' ? points : 0),
          away: state.score.away + (scoringTeam === 'away' ? points : 0),
        }
      : state.score;

  // Relógio decresce, nunca abaixo de zero.
  const nextClock = clamp(
    state.gameClockDeci - (resolution.clockDeci ?? 0),
    0,
    QUARTER_DECI,
  );

  // Fadiga combinada imutavelmente por instance_id.
  const nextFatigue = resolution.fatigueDelta
    ? mergeFatigue(state.fatigue, resolution.fatigueDelta)
    : state.fatigue;

  return {
    ...state,
    gameClockDeci: nextClock,
    ballOn: nextBallOn,
    possession: nextPossession,
    score: nextScore,
    phase: resolution.nextPhase ?? state.phase,
    fatigue: nextFatigue,
    ballPos: resolution.ballPos ?? state.ballPos,
    snapCount: countSnap ? state.snapCount + 1 : state.snapCount,
  };
}

// ---------------------------------------------------------------------------
// Transições de down/distância (blocos reutilizados pela FSM)
// ---------------------------------------------------------------------------

/**
 * Avança o conjunto de downs após uma jogada que **não** alcançou a distância:
 * incrementa o down e reduz a distância restante pelo ganho (nunca abaixo de
 * zero). Não altera posse — a decisão de 4º down não convertido é da FSM.
 *
 * @param state Estado corrente.
 * @param yardsGained Jardas líquidas ganhas na jogada.
 * @returns Novo estado com `down`/`distance` atualizados.
 */
export function advanceDown(state: GameState, yardsGained: number): GameState {
  return {
    ...state,
    down: state.down + 1,
    distance: Math.max(0, state.distance - yardsGained),
  };
}

/**
 * Concede um novo conjunto de downs (1º e 10), tipicamente quando o ganho
 * alcança ou supera a distância. Não altera posse nem a posição da bola.
 *
 * @param state Estado corrente.
 * @returns Novo estado com `down = 1` e `distance = 10`.
 */
export function resetDowns(state: GameState): GameState {
  return {
    ...state,
    down: 1,
    distance: DEFAULT_DISTANCE_YARDS,
  };
}
