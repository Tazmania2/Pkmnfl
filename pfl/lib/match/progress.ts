/**
 * Leitores de andamento puros (`lib/match/progress.ts`) — spec `pfl-gameday-result-ui`.
 *
 * Funções **puras** que projetam o `Log_Partida` nos valores exibidos pelo HUD
 * de andamento (Tela_Game_Day). Nenhuma inventa números: todo valor é lido ou
 * derivado do `state`/`narrative`/`detail`/`powerReason` do próprio `LogEvent`
 * (R8.1–R8.5, R12.1, R17.5). Nenhum I/O, nenhum relógio de sistema, nenhum
 * `Math.random`/`Date` — reproduzir o mesmo log gera a mesma projeção
 * (determinismo da Property 14 estendido a `progressAt`).
 *
 * Dois leitores:
 * - `progressAt(log, eventIndex)`: projeta o `LogEvent` de índice `eventIndex`
 *   num `ProgressFrame` legível (placar, quarto, relógio, down, distância,
 *   posse, clima, narrativa e avisos de efeito inerte/supressão).
 * - `formatClock(gameClockDeci)`: converte o relógio de jogo (décimos de
 *   segundo, inteiro) para o rótulo de exibição `mm:ss`.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 12.1_
 */

import type { ProgressFrame } from './types';
import type { GameLog, LogEvent, JsonValue } from './contracts';

// ---------------------------------------------------------------------------
// Projeção de andamento (R8.1–R8.5, R12.1)
// ---------------------------------------------------------------------------

/**
 * Projeta o evento de índice `eventIndex` do `Log_Partida` num `ProgressFrame`
 * legível para o HUD de andamento. A projeção **espelha** o `state` e a
 * `narrative` do evento (Property 11): placar, quarto, relógio (em décimos),
 * down, distância, posse e clima vêm de `log.events[eventIndex].state`; a
 * narrativa vem de `log.events[eventIndex].narrative`. Os `warnings` reúnem o
 * `powerReason` do evento (ex.: `INERT_WITH_WARNING`, `POWER_SUPPRESSED`) e o
 * texto correspondente do `detail`, exibidos junto à narrativa (R12.1). Nenhum
 * número ou bônus é fabricado — tudo é rastreável ao log (R8.5, R17.5, R12.2,
 * R12.3).
 *
 * @throws {RangeError} se `eventIndex` estiver fora de `[0, events.length)`.
 */
export function progressAt(log: GameLog, eventIndex: number): ProgressFrame {
  const events = log.events;
  if (
    !Number.isInteger(eventIndex) ||
    eventIndex < 0 ||
    eventIndex >= events.length
  ) {
    throw new RangeError(
      `progressAt: eventIndex ${eventIndex} fora de [0, ${events.length})`,
    );
  }

  const event = events[eventIndex];
  if (event === undefined) {
    // Inalcançável após a verificação de limites acima; satisfaz a checagem de
    // acesso indexado estrito (`noUncheckedIndexedAccess`) sem inventar dados.
    throw new RangeError(
      `progressAt: evento ausente no índice ${eventIndex}`,
    );
  }
  const state = event.state;

  return {
    // Placar corrente do Snap, copiado do state (R8.1).
    score: { home: state.score.home, away: state.score.away },
    // Período, relógio (décimos), down, distância, posse (R8.2).
    quarter: state.quarter,
    gameClockDeci: state.gameClock,
    down: state.down,
    distance: state.distance,
    possession: state.possession,
    // Clima apenas exibido, nunca sorteado (R8.4).
    weather: state.weather,
    // Narrativa do evento, sem reescrita (R8.3).
    narrative: event.narrative,
    // Avisos de efeito inerte/supressão derivados do powerReason + detail (R12.1).
    warnings: deriveWarnings(event),
  };
}

/**
 * Deriva a lista de avisos de um evento a partir do seu `powerReason` e do texto
 * relevante do `detail`. Só produz avisos quando o evento efetivamente registra
 * um motivo de poder (`powerReason` presente) — nunca introduz avisos ou bônus
 * silenciosos que o log não registre (R12.1–R12.3). O conteúdo é derivado dos
 * campos do próprio evento, mantendo a rastreabilidade ao log (R8.5, R17.5).
 */
function deriveWarnings(event: LogEvent): ReadonlyArray<string> {
  const reason = event.powerReason;
  if (reason === undefined || reason === '') {
    return [];
  }

  const parts: string[] = [reason];

  // Anexa o contexto rastreável do detail quando presente, sem inventar valores.
  const effectId = readStringField(event.detail, 'effectId');
  if (effectId !== null) {
    parts.push(`efeito ${effectId}`);
  }

  const instanceId = readNumberField(event.detail, 'instanceId');
  if (instanceId !== null) {
    parts.push(`atleta ${instanceId}`);
  }

  const outcome = readStringField(event.detail, 'outcome');
  if (outcome !== null) {
    parts.push(outcome);
  }

  return [parts.join(' — ')];
}

/** Lê um campo string de `detail`, retornando `null` quando ausente/outro tipo. */
function readStringField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): string | null {
  const value = detail[key];
  return typeof value === 'string' ? value : null;
}

/** Lê um campo numérico de `detail`, retornando `null` quando ausente/outro tipo. */
function readNumberField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): number | null {
  const value = detail[key];
  return typeof value === 'number' ? value : null;
}

// ---------------------------------------------------------------------------
// Formatação do relógio de jogo (R8.2)
// ---------------------------------------------------------------------------

/**
 * Converte o relógio de jogo em **décimos de segundo** (inteiro, como gravado em
 * `StateSnapshot.gameClock`) para o rótulo de exibição `mm:ss`. O valor é
 * truncado para o segundo inteiro mais baixo (floor), e minutos/segundos são
 * zero-preenchidos a dois dígitos.
 *
 * Exemplos:
 * - `9000` (900,0 s) → `"15:00"`
 * - `605`  (60,5 s)  → `"01:00"`
 * - `0`              → `"00:00"`
 *
 * Entradas não inteiras são truncadas em décimos; entradas negativas são
 * tratadas como `0` (o relógio de jogo nunca é negativo no log).
 */
export function formatClock(gameClockDeci: number): string {
  const safeDeci =
    Number.isFinite(gameClockDeci) && gameClockDeci > 0
      ? Math.trunc(gameClockDeci)
      : 0;

  const totalSeconds = Math.floor(safeDeci / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/** Zero-preenche um inteiro não negativo a (ao menos) dois dígitos. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
