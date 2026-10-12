/**
 * Estatísticas agregadas da partida (`lib/sim/stats.ts`).
 *
 * Deriva, de forma **pura e determinística**, as `GameStats` a partir do fluxo
 * **ordenado** de eventos do `Log_Partida` (R13.5). A função `computeStats` é a
 * fonte única de verdade das agregações; o `log.ts` (Task 13.1) apenas costura o
 * `GameStats` resultante ao `GameLog`, substituindo o `EMPTY_STATS` placeholder.
 *
 * ## O que é derivado (Property 39)
 *
 * As estatísticas são **exatamente a contagem dos eventos correspondentes** no
 * log — nunca uma re-simulação. O mapeamento de campos de evento → estatística é:
 *
 * - **Corridas** (`rushes`): de cada `PLAY_RESULT` cuja jogada ofensiva
 *   (`detail.offense`) é de corrida (`O_RUN_*`): `attempts += 1` e
 *   `yards += detail.yardsGained`.
 * - **Passes** (`passes`): de cada `PLAY_RESULT` cuja jogada ofensiva é de passe
 *   (`O_PASS_*` / `O_PLAY_ACTION`): `attempts += 1`; se `detail.completed === true`
 *   então `completions += 1` e `yards += detail.yardsGained`; se
 *   `detail.intercepted === true` então `interceptions += 1`.
 * - **Turnovers** (`turnovers`): contagem de perdas de posse — cada
 *   `PLAY_RESULT` com `detail.turnover === true` (fumble/INT) **mais** cada
 *   evento explícito `POSSESSION_CHANGE` marcado como turnover
 *   (`detail.turnover === true`). A dupla fonte é de-duplicada por `snap` para
 *   que uma única perda de posse não seja contada duas vezes (o `POSSESSION_CHANGE`
 *   do mesmo snap de um `PLAY_RESULT` já contado é ignorado).
 * - **Faltas** (`fouls`): contagem de eventos `FOUL` (R14.3).
 * - **Resumo de scoring** (`scoringSummary`): uma `ScoringEntry` por evento
 *   `SCORE`, lida de `detail` (`type`, `team`, `quarter`) na ordem de emissão.
 *
 * ## Coerência do placar (Property 11 / R13.5)
 *
 * `scoringPointsByTeam` soma os pontos do `scoringSummary` por time usando a
 * **mesma fonte de verdade** de pontos da FSM (`SCORING_POINTS`): TD=6, FG=3,
 * SAFETY=2 (creditado ao adversário, já refletido no `team` da entrada), PAT=1,
 * conversão de 2 pontos=2. `assertScoreCoherence` verifica que essa soma iguala
 * o `Placar` final de cada time — sem pontos órfãos nem evento de scoring sem
 * contrapartida no placar. É um invariante checável que acompanha as estatísticas.
 *
 * ## Pureza
 *
 * Sem I/O, rede, relógio de sistema ou entropia. A mesma sequência de eventos
 * sempre produz o mesmo `GameStats`; a ordem de entrada é a única fonte de
 * ordenação do `scoringSummary`.
 *
 * _Requirements: 13.5_
 */

import { SCORING_POINTS } from './fsm';
import type {
  GameStats,
  JsonValue,
  LogEvent,
  ScoringEntry,
  ScoringType,
  Team,
} from './types';
import type { PipelineLogEvent } from './play/pipeline';

// ---------------------------------------------------------------------------
// Tipo de entrada: eventos ordenados, com ou sem `seq`
// ---------------------------------------------------------------------------

/**
 * Entrada mínima aceita por `computeStats`: um evento do log, com ou sem `seq`.
 * `LogEvent` (já com `seq`, de `log.ts`) e `PipelineLogEvent` (sem `seq`, do
 * pipeline/FSM) satisfazem este contrato, pois `computeStats` lê apenas `type`,
 * `snap` e `detail` — nunca o `seq`. Assim as estatísticas podem ser derivadas
 * tanto do log final quanto do fluxo bruto, sem acoplar à atribuição de `seq`.
 */
export type StatsEvent = LogEvent | PipelineLogEvent;

// ---------------------------------------------------------------------------
// Classificação de jogadas ofensivas a partir do id (espelha o pipeline)
// ---------------------------------------------------------------------------

/** Ids de jogada ofensiva de corrida (espelha `pipeline.RUN_PLAYS`). */
const RUN_PLAY_IDS: ReadonlySet<string> = new Set<string>([
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
]);

/**
 * Ids de jogada ofensiva de passe (inclui play action, que termina em passe;
 * espelha `pipeline.PASS_PLAYS`).
 */
const PASS_PLAY_IDS: ReadonlySet<string> = new Set<string>([
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
]);

// ---------------------------------------------------------------------------
// Leitura segura de campos de `detail` (JsonValue → tipo esperado)
// ---------------------------------------------------------------------------

/** Lê uma string de `detail[key]`, ou `undefined` se ausente/outro tipo. */
function readString(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): string | undefined {
  const v = detail[key];
  return typeof v === 'string' ? v : undefined;
}

/** Lê um número finito de `detail[key]`, ou `undefined` se ausente/inválido. */
function readNumber(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): number | undefined {
  const v = detail[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Lê um booleano de `detail[key]`, ou `undefined` se ausente/outro tipo. */
function readBoolean(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): boolean | undefined {
  const v = detail[key];
  return typeof v === 'boolean' ? v : undefined;
}

/** `true` se o valor é um `ScoringType` conhecido. */
function isScoringType(value: string | undefined): value is ScoringType {
  return (
    value === 'TD' ||
    value === 'FG' ||
    value === 'SAFETY' ||
    value === 'PAT' ||
    value === 'TWO_PT'
  );
}

/** `true` se o valor é um `Team` conhecido. */
function isTeam(value: string | undefined): value is Team {
  return value === 'home' || value === 'away';
}

// ---------------------------------------------------------------------------
// Acumulador mutável interno (congelado em `GameStats` imutável no final)
// ---------------------------------------------------------------------------

interface MutableStats {
  rushes: { attempts: number; yards: number };
  passes: {
    attempts: number;
    completions: number;
    yards: number;
    interceptions: number;
  };
  turnovers: number;
  fouls: number;
  scoringSummary: ScoringEntry[];
}

/** Acumulador zerado. */
function emptyMutableStats(): MutableStats {
  return {
    rushes: { attempts: 0, yards: 0 },
    passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
    turnovers: 0,
    fouls: 0,
    scoringSummary: [],
  };
}

// ---------------------------------------------------------------------------
// Agregação por tipo de evento
// ---------------------------------------------------------------------------

/**
 * Acumula uma jogada resolvida (`PLAY_RESULT`) nas estatísticas de corrida/passe
 * e sinaliza se a jogada foi um turnover (fumble/INT) para a contagem de
 * turnovers de-duplicada por snap.
 *
 * @returns `true` se o `PLAY_RESULT` representa um turnover.
 */
function accumulatePlayResult(
  acc: MutableStats,
  detail: Readonly<Record<string, JsonValue>>,
): boolean {
  const offense = readString(detail, 'offense');
  const yards = readNumber(detail, 'yardsGained') ?? 0;
  const completed = readBoolean(detail, 'completed');
  const intercepted = readBoolean(detail, 'intercepted') ?? false;
  const turnover = readBoolean(detail, 'turnover') ?? false;

  if (offense !== undefined && RUN_PLAY_IDS.has(offense)) {
    acc.rushes.attempts += 1;
    acc.rushes.yards += yards;
  } else if (offense !== undefined && PASS_PLAY_IDS.has(offense)) {
    acc.passes.attempts += 1;
    if (completed === true) {
      acc.passes.completions += 1;
      acc.passes.yards += yards;
    }
    if (intercepted === true) {
      acc.passes.interceptions += 1;
    }
  }

  return turnover;
}

/**
 * Monta uma `ScoringEntry` a partir do `detail` de um evento `SCORE`. Aceita o
 * tipo embutido (`detail.type`) ou o campo explícito `detail.scoringType`, e lê
 * `team` e `quarter`. Devolve `null` se o evento não carrega um scoring válido
 * (evento `SCORE` malformado é ignorado em vez de corromper o resumo).
 */
function readScoringEntry(
  detail: Readonly<Record<string, JsonValue>>,
): ScoringEntry | null {
  const type = readString(detail, 'type') ?? readString(detail, 'scoringType');
  const team = readString(detail, 'team');
  const quarter = readNumber(detail, 'quarter');

  if (!isScoringType(type) || !isTeam(team) || quarter === undefined) {
    return null;
  }
  return { type, team, quarter };
}

// ---------------------------------------------------------------------------
// Função principal: derivação pura de GameStats a partir dos eventos
// ---------------------------------------------------------------------------

/**
 * Deriva as `GameStats` do fluxo **ordenado** de eventos do `Log_Partida`
 * (R13.5). Puro e determinístico: lê apenas `type`, `snap` e `detail` de cada
 * evento (funciona com `LogEvent` e com `PipelineLogEvent`).
 *
 * Turnovers são contados uma única vez por snap: um `PLAY_RESULT` com
 * `turnover = true` conta a perda de posse daquele snap; um `POSSESSION_CHANGE`
 * no mesmo snap já contabilizado é ignorado (de-duplicação), enquanto um
 * `POSSESSION_CHANGE` isolado (sem `PLAY_RESULT` de turnover no mesmo snap)
 * ainda é contado.
 *
 * @param events Eventos em ordem de emissão (com ou sem `seq`).
 * @returns `GameStats` imutável derivado dos eventos.
 */
export function computeStats(
  events: ReadonlyArray<StatsEvent>,
): GameStats {
  const acc = emptyMutableStats();
  // Snaps cuja perda de posse já foi contada (via PLAY_RESULT.turnover), para
  // de-duplicar um POSSESSION_CHANGE emitido no mesmo snap.
  const turnoverSnaps = new Set<number>();

  for (const event of events) {
    switch (event.type) {
      case 'PLAY_RESULT': {
        const isTurnover = accumulatePlayResult(acc, event.detail);
        if (isTurnover) {
          acc.turnovers += 1;
          turnoverSnaps.add(event.snap ?? -1);
        }
        break;
      }
      case 'POSSESSION_CHANGE': {
        // Conta apenas se o snap ainda não foi contabilizado por um PLAY_RESULT
        // de turnover, evitando dupla contagem da mesma perda de posse.
        const snap = event.snap ?? -1;
        const markedTurnover = readBoolean(event.detail, 'turnover');
        const isTurnover = markedTurnover ?? true;
        if (isTurnover && !turnoverSnaps.has(snap)) {
          acc.turnovers += 1;
          turnoverSnaps.add(snap);
        }
        break;
      }
      case 'FOUL': {
        acc.fouls += 1;
        break;
      }
      case 'SCORE': {
        const entry = readScoringEntry(event.detail);
        if (entry !== null) {
          acc.scoringSummary.push(entry);
        }
        break;
      }
      default:
        break;
    }
  }

  return freezeStats(acc);
}

/** Projeta o acumulador mutável no `GameStats` imutável de saída. */
function freezeStats(acc: MutableStats): GameStats {
  return {
    rushes: { attempts: acc.rushes.attempts, yards: acc.rushes.yards },
    passes: {
      attempts: acc.passes.attempts,
      completions: acc.passes.completions,
      yards: acc.passes.yards,
      interceptions: acc.passes.interceptions,
    },
    turnovers: acc.turnovers,
    fouls: acc.fouls,
    scoringSummary: acc.scoringSummary.slice(),
  };
}

// ---------------------------------------------------------------------------
// Coerência do placar com o resumo de scoring (Property 11 / R13.5)
// ---------------------------------------------------------------------------

/** Pontos por time derivados do `scoringSummary`. */
export interface ScorePointsByTeam {
  readonly home: number;
  readonly away: number;
}

/**
 * Soma os pontos do `scoringSummary` por time, usando a fonte única de pontos da
 * FSM (`SCORING_POINTS`): TD=6, FG=3, SAFETY=2, PAT=1, TWO_PT=2. O `team` de cada
 * `ScoringEntry` já é o **time beneficiado** (no safety, o adversário do time em
 * posse), de modo que a soma por `team` é direta e não precisa reinterpretar a
 * mecânica do evento.
 *
 * @param summary Resumo de scoring (ordem irrelevante para a soma).
 * @returns Pontos acumulados de `home` e `away`.
 */
export function scoringPointsByTeam(
  summary: ReadonlyArray<ScoringEntry>,
): ScorePointsByTeam {
  let home = 0;
  let away = 0;
  for (const entry of summary) {
    const points = SCORING_POINTS[entry.type];
    if (entry.team === 'home') {
      home += points;
    } else {
      away += points;
    }
  }
  return { home, away };
}

/** Placar final por time a conferir contra o resumo de scoring. */
export interface FinalScoreByTeam {
  readonly home: number;
  readonly away: number;
}

/** Resultado da verificação de coerência placar × scoring. */
export interface ScoreCoherence {
  /** `true` quando a soma do scoring iguala o placar final em ambos os times. */
  readonly coherent: boolean;
  /** Pontos derivados do `scoringSummary` por time. */
  readonly fromScoring: ScorePointsByTeam;
  /** Placar final informado por time. */
  readonly finalScore: FinalScoreByTeam;
}

/**
 * Verifica a coerência entre a soma de pontos do `scoringSummary` e o `Placar`
 * final de cada time (Property 11 / R13.5), **sem lançar**: devolve um descritor
 * com o veredito e os valores comparados, para o chamador decidir (log, teste,
 * asserção).
 *
 * @param stats Estatísticas agregadas (usa `scoringSummary`).
 * @param finalScore Placar final `{ home, away }`.
 * @returns Descritor de coerência (`coherent`, `fromScoring`, `finalScore`).
 */
export function checkScoreCoherence(
  stats: GameStats,
  finalScore: FinalScoreByTeam,
): ScoreCoherence {
  const fromScoring = scoringPointsByTeam(stats.scoringSummary);
  const coherent =
    fromScoring.home === finalScore.home &&
    fromScoring.away === finalScore.away;
  return { coherent, fromScoring, finalScore };
}

/**
 * Asserção de coerência placar × scoring (Property 11 / R13.5): lança um `Error`
 * determinado quando a soma dos pontos do `scoringSummary` não iguala o `Placar`
 * final de algum time — indício de ponto órfão no placar ou de evento de scoring
 * sem contrapartida. Usada como invariante de integridade pelo núcleo/testes.
 *
 * @param stats Estatísticas agregadas (usa `scoringSummary`).
 * @param finalScore Placar final `{ home, away }`.
 * @throws Error quando a soma do scoring diverge do placar final.
 */
export function assertScoreCoherence(
  stats: GameStats,
  finalScore: FinalScoreByTeam,
): void {
  const { coherent, fromScoring } = checkScoreCoherence(stats, finalScore);
  if (!coherent) {
    throw new Error(
      'Incoerência placar × scoring (R13.5): soma do scoringSummary ' +
        `home=${fromScoring.home}, away=${fromScoring.away} ≠ placar final ` +
        `home=${finalScore.home}, away=${finalScore.away}.`,
    );
  }
}
