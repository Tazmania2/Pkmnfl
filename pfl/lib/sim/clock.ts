/**
 * Loop de ticks, relógio, quartos e play_timeout (`lib/sim/clock.ts`).
 *
 * Este módulo é o **relógio determinístico** da simulação. Ele traduz o avanço
 * discreto por `Tick` (0,1 s) em décimos de segundo inteiros (`gameClockDeci`),
 * organiza a partida em quatro quartos de 900 s e encerra uma jogada por tempo
 * limite quando ela atinge `play_timeout_s` (30 s) sem resolução.
 *
 * Princípio de pureza (R1.5): o tempo decorrido por uma jogada **não** vem de um
 * relógio de parede. É **derivado determinísticamente do resultado da jogada**
 * (`derivePlayTicks`) — a mesma `PlayResolution` sempre produz a mesma duração
 * em ticks, em qualquer plataforma. Nada aqui lê `Date`, `performance` nem
 * qualquer fonte de entropia externa; toda a aritmética é inteira para evitar
 * divergências de ponto flutuante entre motores.
 *
 * Relação de unidades (chave para a estabilidade do relógio):
 * - `tick_s = 0.1` s por tick ⇒ **1 tick = 1 décimo de segundo = 1 unidade de
 *   `gameClockDeci`**. Essa correspondência de 1 para 1 mantém o relógio inteiro
 *   e dispensa qualquer conversão de ponto flutuante no caminho quente.
 * - `quarter_seconds = 900` s ⇒ `QUARTER_DECI = 9000` décimos por quarto.
 * - `play_timeout_s = 30` s ⇒ `MAX_TICKS_PER_PLAY = 300` ticks por jogada.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4_
 */

import type { GameState, SimulationParameters } from './types';
import { QUARTER_DECI } from './state';

// ---------------------------------------------------------------------------
// Constantes derivadas do baseline (unidades inteiras)
// ---------------------------------------------------------------------------

/** Número total de quartos de tempo regulamentar (R2.2). */
export const TOTAL_QUARTERS = 4;

/**
 * Décimos de segundo que um único `Tick` consome (R2.1).
 *
 * Com `tick_s = 0.1`, cada tick vale exatamente 1 décimo de segundo. Mantemos a
 * constante explícita (e derivável de `SimulationParameters`) para que a relação
 * tick ↔ relógio seja um único ponto de verdade.
 */
export const DECI_PER_TICK = 1;

/**
 * Converte `tick_s` (segundos por tick) em décimos de segundo inteiros por tick.
 *
 * No baseline do MVP `tick_s = 0.1` ⇒ 1 décimo por tick. A conversão usa
 * arredondamento para o inteiro mais próximo para absorver ruído de ponto
 * flutuante de `tick_s * 10` (ex.: `0.1 * 10` pode não ser exatamente `1`), sem
 * jamais depender de um relógio real.
 *
 * @param params Parâmetros do baseline (usa `tick_s`).
 * @returns Décimos de segundo consumidos por tick (inteiro ≥ 0).
 */
export function deciPerTick(params: SimulationParameters): number {
  return Math.round(params.tick_s * 10);
}

/**
 * Número máximo de ticks que uma jogada pode durar antes do encerramento por
 * tempo limite (R2.4): `play_timeout_s / tick_s`. No baseline, `30 / 0.1 = 300`.
 *
 * @param params Parâmetros do baseline (usa `play_timeout_s` e `tick_s`).
 * @returns Limite inteiro de ticks por jogada.
 */
export function maxTicksPerPlay(params: SimulationParameters): number {
  return Math.round(params.play_timeout_s / params.tick_s);
}

/**
 * Décimos de segundo de um quarto (R2.2): `quarter_seconds * 10`. No baseline,
 * `900 * 10 = 9000`, coincidindo com `QUARTER_DECI` de `state.ts`.
 *
 * @param params Parâmetros do baseline (usa `quarter_seconds`).
 * @returns Duração do quarto em décimos de segundo (inteiro).
 */
export function quarterDeci(params: SimulationParameters): number {
  return Math.round(params.quarter_seconds * 10);
}

// ---------------------------------------------------------------------------
// Avanço do relógio por ticks
// ---------------------------------------------------------------------------

/**
 * Decresce o relógio do quarto por uma quantidade de ticks, nunca abaixo de
 * zero. Puro: devolve apenas o novo valor de `gameClockDeci`, sem tocar no
 * `GameState` (a transição completa fica em `tickDownClock`).
 *
 * @param gameClockDeci Relógio corrente do quarto em décimos de segundo.
 * @param ticks Número de ticks a decrescer (≥ 0).
 * @param deciPerTickValue Décimos consumidos por tick (default: `DECI_PER_TICK`).
 * @returns Novo relógio em décimos de segundo, limitado a `[0, +∞)`.
 */
export function advanceClockByTicks(
  gameClockDeci: number,
  ticks: number,
  deciPerTickValue: number = DECI_PER_TICK,
): number {
  if (ticks < 0) {
    throw new RangeError('advanceClockByTicks requires ticks >= 0');
  }
  const consumed = ticks * deciPerTickValue;
  const next = gameClockDeci - consumed;
  return next < 0 ? 0 : next;
}

/**
 * Converte uma quantidade de ticks no número de décimos que o relógio pode
 * efetivamente decrescer sem ultrapassar zero. Útil para registrar no log o
 * tempo realmente consumido quando uma jogada excede o fim do quarto (R2.3).
 *
 * @param gameClockDeci Relógio corrente do quarto em décimos de segundo.
 * @param ticks Ticks pretendidos (≥ 0).
 * @param deciPerTickValue Décimos por tick (default: `DECI_PER_TICK`).
 * @returns Décimos efetivamente consumíveis, em `[0, gameClockDeci]`.
 */
export function clockDeciForTicks(
  gameClockDeci: number,
  ticks: number,
  deciPerTickValue: number = DECI_PER_TICK,
): number {
  if (ticks < 0) {
    throw new RangeError('clockDeciForTicks requires ticks >= 0');
  }
  const requested = ticks * deciPerTickValue;
  return requested > gameClockDeci ? gameClockDeci : requested;
}

/**
 * Decresce o relógio do `GameState` por uma quantidade de ticks, devolvendo um
 * **novo** `GameState` imutável (R2.3). Não altera posse, down, quarto nem
 * placar — apenas o relógio. A decisão de virar o quarto quando o relógio chega
 * a zero é de `endQuarter`/`advanceAfterPlay`, mantendo este helper focado.
 *
 * @param state Estado corrente (não mutado).
 * @param ticks Ticks a decrescer (≥ 0).
 * @param deciPerTickValue Décimos por tick (default: `DECI_PER_TICK`).
 * @returns Novo `GameState` com o relógio decrescido.
 */
export function tickDownClock(
  state: GameState,
  ticks: number,
  deciPerTickValue: number = DECI_PER_TICK,
): GameState {
  const nextClock = advanceClockByTicks(
    state.gameClockDeci,
    ticks,
    deciPerTickValue,
  );
  if (nextClock === state.gameClockDeci) {
    return state;
  }
  return { ...state, gameClockDeci: nextClock };
}

// ---------------------------------------------------------------------------
// Fim de quarto e fim de jogo
// ---------------------------------------------------------------------------

/**
 * Indica se o relógio do quarto corrente chegou a zero (R2.3). Condição única
 * de virada de quarto / fim de jogo.
 *
 * @param state Estado corrente.
 * @returns `true` quando `gameClockDeci <= 0`.
 */
export function isQuarterOver(state: GameState): boolean {
  return state.gameClockDeci <= 0;
}

/**
 * Indica se a partida chegou ao fim do tempo regulamentar: 4º quarto com o
 * relógio zerado (R2.2, R2.6). Sem overtime no MVP — a decisão de empate como
 * `Decisao_Produto_Pendente` é da FSM (Task 12).
 *
 * @param state Estado corrente.
 * @returns `true` quando é o último quarto e o relógio chegou a zero.
 */
export function isRegulationOver(state: GameState): boolean {
  return state.quarter >= TOTAL_QUARTERS && isQuarterOver(state);
}

/**
 * Encerra o quarto corrente, devolvendo um novo `GameState`. Se ainda houver
 * quartos por jogar, avança para o próximo quarto e recarrega o relógio para
 * `quarterDeciValue` (default: `QUARTER_DECI`), colocando a fase em `Kickoff`.
 * No 4º quarto, não avança: apenas marca a fase `EndOfGame` (a FSM decide o
 * desfecho — vencedor ou empate pendente).
 *
 * Puro e imutável: não altera posse, placar nem fadiga.
 *
 * @param state Estado corrente (não mutado).
 * @param quarterDeciValue Décimos a recarregar no novo quarto (default: `QUARTER_DECI`).
 * @returns Novo `GameState` no próximo quarto, ou em `EndOfGame` no 4º quarto.
 */
export function endQuarter(
  state: GameState,
  quarterDeciValue: number = QUARTER_DECI,
): GameState {
  if (state.quarter >= TOTAL_QUARTERS) {
    return { ...state, phase: 'EndOfGame' };
  }
  return {
    ...state,
    quarter: state.quarter + 1,
    gameClockDeci: quarterDeciValue,
    phase: 'Kickoff',
  };
}

// ---------------------------------------------------------------------------
// Duração de jogada derivada do resultado (determinística, nunca wall-clock)
// ---------------------------------------------------------------------------

/**
 * Entrada mínima para derivar a duração de uma jogada em ticks. É um subconjunto
 * do resultado da jogada: nada aqui depende de tempo real. A derivação é uma
 * função pura `(resultado) → ticks`, garantindo que a mesma jogada consuma
 * sempre o mesmo tempo de relógio (R2.1, pré-requisito do determinismo R1.1).
 */
export interface PlayTickInput {
  /** Jardas líquidas da jogada (o módulo governa a duração; sinal é ignorado). */
  readonly yardsGained?: number;
  /** `true` quando a jogada parou o relógio (incompleto, fora de campo, pontuação). */
  readonly stopsClock?: boolean;
  /** `true` para jogadas de passe (base de tempo distinta da corrida). */
  readonly isPass?: boolean;
}

/**
 * Base de tempo (em ticks) de uma jogada de corrida que não para o relógio.
 * Escolhida no baseline do MVP; mantida como constante nomeada para derivação
 * determinística e fácil ajuste futuro.
 */
export const BASE_RUN_TICKS = 40; // 4,0 s
/** Base de tempo (em ticks) de uma jogada de passe. */
export const BASE_PASS_TICKS = 25; // 2,5 s
/** Ticks adicionais por jarda (módulo) percorrida. */
export const TICKS_PER_YARD = 2; // 0,2 s por jarda
/** Base de tempo (em ticks) de uma jogada que para o relógio (bola morta cedo). */
export const BASE_DEAD_BALL_TICKS = 10; // 1,0 s

/**
 * Deriva **determinísticamente** a duração de uma jogada em ticks a partir do
 * seu resultado — nunca de tempo de parede (R2.1, requisito de determinismo).
 *
 * Modelo (todo inteiro, portável):
 * - Jogada que **para o relógio** (`stopsClock`): tempo curto e fixo
 *   (`BASE_DEAD_BALL_TICKS`), independentemente das jardas, pois a ação se
 *   encerra cedo (passe incompleto, saída de campo, pontuação).
 * - Jogada **viva**: base por tipo (`BASE_PASS_TICKS` para passe,
 *   `BASE_RUN_TICKS` para corrida) acrescida de `TICKS_PER_YARD` por jarda do
 *   **módulo** do avanço (perdas também consomem tempo).
 *
 * O resultado é sempre limitado a `[1, maxTicks]`: toda jogada dura ao menos 1
 * tick e nunca excede o teto de tempo limite por jogada (R2.4).
 *
 * @param input Subconjunto do resultado da jogada que governa sua duração.
 * @param maxTicks Teto de ticks por jogada (default: 300 = `play_timeout_s/tick_s`).
 * @returns Duração da jogada em ticks, inteiro em `[1, maxTicks]`.
 */
export function derivePlayTicks(
  input: PlayTickInput,
  maxTicks = 300,
): number {
  const yards = Math.abs(Math.trunc(input.yardsGained ?? 0));

  let ticks: number;
  if (input.stopsClock) {
    ticks = BASE_DEAD_BALL_TICKS;
  } else {
    const base = input.isPass ? BASE_PASS_TICKS : BASE_RUN_TICKS;
    ticks = base + yards * TICKS_PER_YARD;
  }

  if (ticks < 1) return 1;
  if (ticks > maxTicks) return maxTicks;
  return ticks;
}

// ---------------------------------------------------------------------------
// Encerramento por tempo limite de jogada (play_timeout)
// ---------------------------------------------------------------------------

/**
 * Resultado do avanço do loop de ticks de uma única jogada. Reporta quantos
 * ticks a jogada efetivamente durou e se foi encerrada por tempo limite
 * (R2.4). O chamador (pipeline/FSM) usa `timedOut` para emitir o evento
 * `TIMEOUT` no log e `ticks` para decrescer o relógio.
 */
export interface PlayClockOutcome {
  /** Ticks que a jogada efetivamente consumiu (inteiro em `[1, maxTicks]`). */
  readonly ticks: number;
  /** `true` quando a jogada atingiu o tick de tempo limite sem resolução. */
  readonly timedOut: boolean;
  /** Décimos de segundo a decrescer do relógio (limitado ao relógio restante). */
  readonly clockDeci: number;
}

/**
 * Resolve o loop de ticks de uma jogada a partir da sua duração derivada,
 * aplicando a regra de tempo limite (R2.4): se a duração atinge ou excede o
 * limite de ticks por jogada (300 no baseline, = `play_timeout_s / tick_s`), a
 * jogada é encerrada por tempo limite e marcada com `timedOut = true`.
 *
 * A duração é **derivada do resultado** (`derivePlayTicks`), nunca de um relógio
 * real — o loop apenas aplica o teto e calcula o tempo de relógio a consumir,
 * mantendo o determinismo. O `clockDeci` devolvido respeita o relógio restante
 * do quarto, de modo que uma jogada no fim do quarto não leve o relógio abaixo
 * de zero (R2.3).
 *
 * @param resolution Subconjunto do resultado que governa a duração da jogada.
 * @param state Estado corrente (fornece o relógio restante do quarto).
 * @param params Parâmetros do baseline (tempo limite, tick e relógio).
 * @returns Ticks consumidos, flag de tempo limite e décimos a decrescer.
 */
export function resolvePlayClock(
  resolution: PlayTickInput,
  state: GameState,
  params: SimulationParameters,
): PlayClockOutcome {
  const maxTicks = maxTicksPerPlay(params);
  const perTick = deciPerTick(params);

  const derived = derivePlayTicks(resolution, maxTicks);
  const timedOut = derived >= maxTicks;
  // Quando excede o tempo limite, a jogada é encerrada exatamente no limite.
  const ticks = timedOut ? maxTicks : derived;

  const clockDeci = clockDeciForTicks(state.gameClockDeci, ticks, perTick);

  return { ticks, timedOut, clockDeci };
}
