// Feature: pfl-simulation-engine, Property 39: Estatísticas agregadas coerentes com os eventos
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { computeStats, type StatsEvent } from './stats';
import { PBT_NUM_RUNS } from './test-setup';
import type {
  JsonValue,
  ScoringEntry,
  ScoringType,
  StateSnapshot,
  Team,
} from './types';

/**
 * Teste de propriedade das estatísticas agregadas coerentes com os eventos
 * (Task 13.8).
 *
 * **Feature: pfl-simulation-engine, Property 39: Estatísticas agregadas
 * coerentes com os eventos**
 *
 * _Validates: Requirements 13.5_
 *
 * Property 39: `computeStats` deriva as `GameStats` **exatamente como uma
 * contagem dos eventos correspondentes** — nunca por re-simulação. Para um
 * array arbitrário de eventos (`PLAY_RESULT` de corrida/passe com jardas,
 * `completed`, `intercepted`, `turnover` variados; `FOUL`; `SCORE`;
 * `POSSESSION_CHANGE`), as estatísticas resultantes coincidem com a agregação
 * calculada **independentemente** no teste a partir dos mesmos eventos:
 *  - corridas: `attempts`/`yards` = soma sobre os `PLAY_RESULT` de corrida;
 *  - passes: `attempts`/`completions`/`yards`/`interceptions` = soma sobre os
 *    `PLAY_RESULT` de passe (yards só quando `completed`);
 *  - turnovers: contagem de-duplicada por snap de `PLAY_RESULT.turnover` +
 *    `POSSESSION_CHANGE`;
 *  - fouls: contagem de eventos `FOUL`;
 *  - `scoringSummary`: uma entrada por evento `SCORE` válido, na ordem.
 */

const RUN_PLAY_IDS = ['O_RUN_INSIDE', 'O_RUN_OUTSIDE'] as const;
const PASS_PLAY_IDS = [
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
] as const;
const SCORING_TYPES: readonly ScoringType[] = [
  'TD',
  'FG',
  'SAFETY',
  'PAT',
  'TWO_PT',
];
const TEAMS: readonly Team[] = ['home', 'away'];

/** `StateSnapshot` fixo e irrelevante: `computeStats` só lê `type`/`snap`/`detail`. */
const SNAPSHOT: StateSnapshot = {
  quarter: 1,
  gameClock: 9000,
  down: 1,
  distance: 10,
  ballOn: 25,
  possession: 'home',
  score: { home: 0, away: 0 },
  weather: 'CLEAR',
};

/** Formato interno de um evento gerado, com o `snap` destacado para agregação. */
type GenEvent = StatsEvent & { readonly snap: number };

const runArb = (snap: number): fc.Arbitrary<GenEvent> =>
  fc.record({
    offense: fc.constantFrom(...RUN_PLAY_IDS),
    yardsGained: fc.integer({ min: -10, max: 60 }),
    turnover: fc.boolean(),
  }).map(({ offense, yardsGained, turnover }) => ({
    type: 'PLAY_RESULT' as const,
    snap,
    state: SNAPSHOT,
    narrative: '',
    detail: { offense, yardsGained, turnover } as Record<string, JsonValue>,
  }));

const passArb = (snap: number): fc.Arbitrary<GenEvent> =>
  fc.record({
    offense: fc.constantFrom(...PASS_PLAY_IDS),
    yardsGained: fc.integer({ min: 0, max: 70 }),
    completed: fc.boolean(),
    intercepted: fc.boolean(),
    turnover: fc.boolean(),
  }).map(({ offense, yardsGained, completed, intercepted, turnover }) => ({
    type: 'PLAY_RESULT' as const,
    snap,
    state: SNAPSHOT,
    narrative: '',
    detail: {
      offense,
      yardsGained,
      completed,
      intercepted,
      turnover,
    } as Record<string, JsonValue>,
  }));

const foulArb = (snap: number): fc.Arbitrary<GenEvent> =>
  fc.constant({
    type: 'FOUL' as const,
    snap,
    state: SNAPSHOT,
    narrative: '',
    detail: {} as Record<string, JsonValue>,
  });

const scoreArb = (snap: number): fc.Arbitrary<GenEvent> =>
  fc.record({
    type: fc.constantFrom(...SCORING_TYPES),
    team: fc.constantFrom(...TEAMS),
    quarter: fc.integer({ min: 1, max: 4 }),
  }).map(({ type, team, quarter }) => ({
    type: 'SCORE' as const,
    snap,
    state: SNAPSHOT,
    narrative: '',
    detail: { type, team, quarter } as Record<string, JsonValue>,
  }));

const possessionArb = (snap: number): fc.Arbitrary<GenEvent> =>
  fc.record({ turnover: fc.boolean() }).map(({ turnover }) => ({
    type: 'POSSESSION_CHANGE' as const,
    snap,
    state: SNAPSHOT,
    narrative: '',
    detail: { turnover } as Record<string, JsonValue>,
  }));

/** Gera um evento de qualquer tipo relevante, carimbado com o `snap` informado. */
const eventArb = (snap: number): fc.Arbitrary<GenEvent> =>
  fc.oneof(
    runArb(snap),
    passArb(snap),
    foulArb(snap),
    scoreArb(snap),
    possessionArb(snap),
  );

/**
 * Gera um array de eventos. Para exercitar a de-duplicação de turnovers por
 * snap, agrupamos vários eventos sob o mesmo `snap` em alguns pontos: cada
 * "bloco" recebe um `snap` sequencial e contém de 1 a 3 eventos daquele snap.
 */
const eventsArb: fc.Arbitrary<GenEvent[]> = fc
  .array(fc.array(fc.integer(), { minLength: 1, maxLength: 3 }), {
    minLength: 0,
    maxLength: 20,
  })
  .chain((blocks) =>
    fc
      .tuple(
        ...blocks.map((inner, snap) =>
          fc.tuple(...inner.map(() => eventArb(snap))),
        ),
      )
      .map((tuples) => tuples.flat()),
  );

// ---------------------------------------------------------------------------
// Agregação de referência (independente de computeStats)
// ---------------------------------------------------------------------------

interface Expected {
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

function detailNum(detail: Record<string, JsonValue>, k: string): number {
  const v = detail[k];
  return typeof v === 'number' ? v : 0;
}

function detailBool(detail: Record<string, JsonValue>, k: string): boolean {
  return detail[k] === true;
}

function expectedFromEvents(events: ReadonlyArray<GenEvent>): Expected {
  const exp: Expected = {
    rushes: { attempts: 0, yards: 0 },
    passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
    turnovers: 0,
    fouls: 0,
    scoringSummary: [],
  };
  const turnoverSnaps = new Set<number>();

  for (const ev of events) {
    const d = ev.detail as Record<string, JsonValue>;
    switch (ev.type) {
      case 'PLAY_RESULT': {
        const offense = typeof d.offense === 'string' ? d.offense : '';
        if ((RUN_PLAY_IDS as readonly string[]).includes(offense)) {
          exp.rushes.attempts += 1;
          exp.rushes.yards += detailNum(d, 'yardsGained');
        } else if ((PASS_PLAY_IDS as readonly string[]).includes(offense)) {
          exp.passes.attempts += 1;
          if (detailBool(d, 'completed')) {
            exp.passes.completions += 1;
            exp.passes.yards += detailNum(d, 'yardsGained');
          }
          if (detailBool(d, 'intercepted')) {
            exp.passes.interceptions += 1;
          }
        }
        if (detailBool(d, 'turnover')) {
          exp.turnovers += 1;
          turnoverSnaps.add(ev.snap);
        }
        break;
      }
      case 'POSSESSION_CHANGE': {
        const isTurnover = d.turnover === undefined ? true : d.turnover === true;
        if (isTurnover && !turnoverSnaps.has(ev.snap)) {
          exp.turnovers += 1;
          turnoverSnaps.add(ev.snap);
        }
        break;
      }
      case 'FOUL':
        exp.fouls += 1;
        break;
      case 'SCORE': {
        const type = d.type;
        const team = d.team;
        const quarter = d.quarter;
        if (
          typeof type === 'string' &&
          (SCORING_TYPES as readonly string[]).includes(type) &&
          typeof team === 'string' &&
          (TEAMS as readonly string[]).includes(team) &&
          typeof quarter === 'number'
        ) {
          exp.scoringSummary.push({
            type: type as ScoringType,
            team: team as Team,
            quarter,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return exp;
}

describe('Feature: pfl-simulation-engine, Property 39: Estatísticas agregadas coerentes com os eventos', () => {
  it('computeStats deriva GameStats exatamente como contagem dos eventos (Req. 13.5)', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const stats = computeStats(events);
        const expected = expectedFromEvents(events);

        expect(stats.rushes).toEqual(expected.rushes);
        expect(stats.passes).toEqual(expected.passes);
        expect(stats.turnovers).toBe(expected.turnovers);
        expect(stats.fouls).toBe(expected.fouls);
        expect(stats.scoringSummary).toEqual(expected.scoringSummary);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
