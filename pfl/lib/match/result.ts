/**
 * Resultado: funções puras (`lib/match/result.ts`) — spec `pfl-gameday-result-ui`.
 *
 * Duas funções **puras e determinísticas** que a Tela_Resultado consome para
 * apresentar o desfecho e o resumo de eventos da Partida, derivando tudo
 * **exclusivamente** do `Placar` e do `Log_Partida` retornados pela
 * `Funcao_Simulacao` — sem recalcular placar, sem inventar eventos e sem
 * entropia local (R13.4, R14.2, R14.3, R17.5). Nenhum I/O, nenhum relógio de
 * sistema, nenhum `Math.random`/`Date`: o mesmo `Placar`/`Log_Partida` sempre
 * produz o mesmo `Outcome`/`Highlight[]`.
 *
 * - `determineOutcome(score)`: deriva vencedor/empate SOMENTE de
 *   `score.home`/`score.away` (R13.2, R13.3, R13.4).
 * - `selectHighlights(log)`: percorre `log.events` em ordem determinística,
 *   selecionando eventos de scoring (`SCORE` → TD/FG/SAFETY/PAT/TWO_PT, coerentes
 *   com `log.stats.scoringSummary`) e turnovers (`POSSESSION_CHANGE` com
 *   `detail.turnover === true`). Cada `Highlight` referencia o `eventIndex`
 *   existente do evento de origem — nenhum evento é fabricado (R14.2, R14.3).
 *
 * _Requirements: 13.2, 13.3, 13.4, 14.2, 14.3_
 */

import type { Outcome, Highlight } from './types';
import type { GameLog, LogEvent, Score, JsonValue } from './contracts';
import { formatClock } from './progress';

// ---------------------------------------------------------------------------
// Desfecho — derivado exclusivamente do Placar (R13.2–R13.4)
// ---------------------------------------------------------------------------

/**
 * Deriva o desfecho da Partida **exclusivamente** do `Placar` (R13.4), sem ler
 * ou recalcular nada do `Log_Partida`:
 *
 * - `score.home !== score.away` → `{ kind: 'winner', team }`, com `team` igual ao
 *   lado de maior pontuação (R13.2);
 * - `score.home === score.away` → `{ kind: 'tie' }` (R13.3).
 *
 * O campo `score.tie` do motor é coerente com a igualdade de pontuações, mas o
 * desfecho é determinado **apenas** por `home`/`away`, mantendo a função total e
 * rastreável ao Placar (R13.4).
 */
export function determineOutcome(score: Score): Outcome {
  if (score.home > score.away) {
    return { kind: 'winner', team: 'home' };
  }
  if (score.away > score.home) {
    return { kind: 'winner', team: 'away' };
  }
  return { kind: 'tie' };
}

// ---------------------------------------------------------------------------
// Highlights — derivados SOMENTE do Log_Partida (R14.2, R14.3)
// ---------------------------------------------------------------------------

/** Tipos de scoring reconhecidos no `detail.type` de um evento `SCORE`. */
const SCORING_TYPES = new Set<string>(['TD', 'FG', 'SAFETY', 'PAT', 'TWO_PT']);

/**
 * Deriva os `Highlights` **somente** do `Log_Partida`, por regra pura e
 * determinística (R14.2, R14.3). Percorre `log.events` **na ordem do log** (a
 * mesma ordem determinística que gera `log.stats.scoringSummary`) e seleciona:
 *
 * - **eventos de scoring**: cada `SCORE` cujo `detail.type` é um
 *   `ScoringType` conhecido (TD/FG/SAFETY/PAT/TWO_PT) — coerente, entrada a
 *   entrada, com `log.stats.scoringSummary`;
 * - **turnovers**: cada `POSSESSION_CHANGE` marcado com `detail.turnover === true`.
 *
 * Cada `Highlight` referencia o `eventIndex` **existente** do `LogEvent` de
 * origem (índice em `log.events`), nunca um evento fabricado (R14.3). O
 * `quarter` e o `clock` vêm do `state` do próprio evento (`clock` formatado por
 * `formatClock`); o `text` vem da `narrative` do evento, mantendo toda a
 * exibição rastreável ao log (R14.3, R17.5).
 *
 * Caminhar `log.events` (e não iterar `scoringSummary` isoladamente) garante que
 * todo highlight tenha um `eventIndex` real e que a ordem reflita exatamente a
 * sequência determinística do log.
 */
export function selectHighlights(log: GameLog): Highlight[] {
  const highlights: Highlight[] = [];

  const events = log.events;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    if (event === undefined) {
      // Inalcançável em uma lista densa; satisfaz `noUncheckedIndexedAccess`
      // sem inventar dados.
      continue;
    }

    const highlight = highlightFromEvent(event, eventIndex);
    if (highlight !== null) {
      highlights.push(highlight);
    }
  }

  return highlights;
}

/**
 * Converte um `LogEvent` num `Highlight` quando — e somente quando — o evento é
 * um dos tipos relevantes para o resumo (scoring ou turnover). Retorna `null`
 * para qualquer outro evento, de modo que nenhum highlight sem origem seja
 * fabricado (R14.3). Puro.
 */
function highlightFromEvent(event: LogEvent, eventIndex: number): Highlight | null {
  if (event.type === 'SCORE') {
    const scoringType = readStringField(event.detail, 'type');
    if (scoringType !== null && SCORING_TYPES.has(scoringType)) {
      return makeHighlight(event, eventIndex, scoringType);
    }
    return null;
  }

  if (event.type === 'POSSESSION_CHANGE') {
    const turnover = readBooleanField(event.detail, 'turnover');
    if (turnover === true) {
      return makeHighlight(event, eventIndex, 'TURNOVER');
    }
    return null;
  }

  return null;
}

/**
 * Monta um `Highlight` a partir do `state`/`narrative` do evento, formatando o
 * relógio com `formatClock`. Todos os campos são lidos do próprio evento —
 * nenhum número ou texto é inventado (R14.3, R17.5).
 */
function makeHighlight(event: LogEvent, eventIndex: number, kind: string): Highlight {
  return {
    eventIndex,
    quarter: event.state.quarter,
    clock: formatClock(event.state.gameClock),
    kind,
    text: event.narrative,
  };
}

/** Lê um campo string de `detail`, retornando `null` quando ausente/outro tipo. */
function readStringField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): string | null {
  const value = detail[key];
  return typeof value === 'string' ? value : null;
}

/** Lê um campo booleano de `detail`, retornando `null` quando ausente/outro tipo. */
function readBooleanField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): boolean | null {
  const value = detail[key];
  return typeof value === 'boolean' ? value : null;
}
