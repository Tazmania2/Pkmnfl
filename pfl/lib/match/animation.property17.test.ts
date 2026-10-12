import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { buildAnimationScenes } from './animation';
import type {
  GameLog,
  LogEvent,
  LogEventType,
  StateSnapshot,
  Team,
  Weather,
  JsonValue,
} from './contracts';

/**
 * Teste de propriedade do planejador de cenas (`buildAnimationScenes`) — Task 4.4.
 *
 * // Feature: pfl-gameday-result-ui, Property 17: Log sem Snaps produz zero cenas e vai direto ao resultado
 *
 * **Validates: Requirements 9.7**
 *
 * *Para todo* `Log_Partida` cujos eventos **não contêm nenhum Snap jogado**
 * (nenhum evento de tipo `SNAP` nem `PLAY_RESULT`) — incluindo o log com lista de
 * eventos vazia —, `buildAnimationScenes(log)` SHALL retornar `[]`: a
 * Animacao_8bit não produz nenhum quadro de confronto e a Tela_Game_Day segue
 * direto ao resultado (R9.7).
 *
 * O arbitrário de `GameLog`/`LogEvent` é auto-contido (sem fixtures
 * compartilhadas): gera eventos arbitrários restringindo o tipo ao conjunto de
 * `LogEventType` que **não** representa Snaps jogados (`MATCH_INIT`,
 * `WEATHER_ROLL`, `SCORE`, `QUARTER_END`, `GAME_END`, etc.), e inclui o caso
 * `events: []`. A função é pura — nenhum I/O é realizado.
 */

// ---------------------------------------------------------------------------
// Arbitrários auto-contidos de domínio (GameLog / LogEvent / StateSnapshot)
// ---------------------------------------------------------------------------

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const TEAMS: readonly Team[] = ['home', 'away'];

/**
 * Todos os `LogEventType` **exceto** `SNAP` e `PLAY_RESULT` — ou seja, os tipos
 * que o planejador de cenas não conta como Snap jogado. Um log formado apenas
 * por estes tipos é, por definição, um log "sem Snaps" (R9.7).
 */
const NON_SNAP_EVENT_TYPES: readonly LogEventType[] = [
  'MATCH_INIT',
  'WEATHER_ROLL',
  'KICKOFF',
  'TICK',
  'PLAY_SELECTED',
  'MATCHUP_APPLIED',
  'ATTR_CONTEST',
  'SCORE',
  'POSSESSION_CHANGE',
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'TELEKINESIS_NOTE',
  'ANATOMY_WARNING',
  'FOUL',
  'PENDING_DECISION',
  'TIMEOUT',
  'QUARTER_END',
  'GAME_END',
];

const weatherArb: fc.Arbitrary<Weather> = fc.constantFrom(...WEATHERS);
const teamArb: fc.Arbitrary<Team> = fc.constantFrom(...TEAMS);

/** Inteiro não negativo "razoável" para pontuação/relógio/jardas. */
const nonNegIntArb = fc.integer({ min: 0, max: 100_000 });

const scoreArb: fc.Arbitrary<StateSnapshot['score']> = fc.record({
  home: nonNegIntArb,
  away: nonNegIntArb,
});

/** `StateSnapshot` arbitrário com todos os campos lidos pelo planejador. */
const stateArb: fc.Arbitrary<StateSnapshot> = fc.record({
  quarter: fc.integer({ min: 1, max: 4 }),
  gameClock: fc.integer({ min: 0, max: 9000 }),
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 0, max: 99 }),
  ballOn: fc.integer({ min: 0, max: 100 }),
  possession: teamArb,
  score: scoreArb,
  weather: weatherArb,
});

/** Valor JSON escalar simples para popular `detail` sem recursão. */
const jsonScalarArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

const detailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.dictionary(fc.string(), jsonScalarArb, { maxKeys: 4 });

/**
 * `LogEvent` arbitrário **sem Snap jogado**: o `type` é sorteado apenas de
 * `NON_SNAP_EVENT_TYPES`. `seq` é preenchido ao montar o log.
 */
const nonSnapEventArb: fc.Arbitrary<Omit<LogEvent, 'seq'>> = fc.record({
  type: fc.constantFrom(...NON_SNAP_EVENT_TYPES),
  snap: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  tick: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  state: stateArb,
  narrative: fc.string(),
  detail: detailArb,
  powerReason: fc.option(
    fc.constantFrom('INERT_WITH_WARNING', 'POWER_SUPPRESSED', ''),
    { nil: undefined },
  ),
});

/**
 * `GameLog` arbitrário cujos eventos **nunca** contêm `SNAP`/`PLAY_RESULT`.
 * `minLength: 0` cobre explicitamente o log com `events: []`. `seq` é atribuído
 * de forma crescente e estável a partir da posição.
 */
const noSnapLogArb: fc.Arbitrary<GameLog> = fc
  .array(nonSnapEventArb, { minLength: 0, maxLength: 25 })
  .map((partials): GameLog => {
    const events: LogEvent[] = partials.map((p, i) => ({ seq: i, ...p }));
    return {
      seedUsed: '0',
      baselineVersion: 'test-baseline',
      baselineStatus: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
      events,
      stats: {
        rushes: { attempts: 0, yards: 0 },
        passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
        turnovers: 0,
        fouls: 0,
        scoringSummary: [],
      },
    };
  });

// ---------------------------------------------------------------------------
// Property 17
// ---------------------------------------------------------------------------

describe('buildAnimationScenes — Property 17: log sem Snaps produz zero cenas', () => {
  it('retorna [] para todo log sem eventos SNAP/PLAY_RESULT, inclusive o log vazio (R9.7)', () => {
    fc.assert(
      fc.property(noSnapLogArb, (log) => {
        const scenes = buildAnimationScenes(log);
        expect(scenes).toEqual([]);
      }),
    );
  });
});
