import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { progressAt } from './progress';
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
 * Teste de propriedade da projeção de andamento (`progressAt`) — Task 3.2.
 *
 * // Feature: pfl-gameday-result-ui, Property 11: Projeção de andamento espelha o estado do evento
 *
 * **Validates: Requirements 8.1, 8.2, 8.4**
 *
 * *Para todo* `Log_Partida` e todo índice de evento válido `i`, a projeção
 * `progressAt(log, i)` **espelha** o `state`/`narrative` do evento de origem,
 * sem inventar valores:
 * - `score` iguala `log.events[i].state.score` (R8.1);
 * - `quarter`, `gameClockDeci`, `down`, `distance`, `possession` igualam os
 *   campos correspondentes de `log.events[i].state` (R8.2);
 * - `weather` iguala `log.events[i].state.weather` (R8.4);
 * - `narrative` iguala `log.events[i].narrative`.
 *
 * O arbitrário de `GameLog`/`LogEvent` é auto-contido (sem fixtures
 * compartilhadas): gera eventos arbitrários com `StateSnapshot` arbitrário e
 * narrativa arbitrária, e sorteia um índice válido dentro de `events`. Nenhum
 * I/O é realizado — a projeção é uma função pura do log.
 */

// ---------------------------------------------------------------------------
// Arbitrários auto-contidos de domínio (GameLog / LogEvent / StateSnapshot)
// ---------------------------------------------------------------------------

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const TEAMS: readonly Team[] = ['home', 'away'];
const EVENT_TYPES: readonly LogEventType[] = [
  'MATCH_INIT',
  'WEATHER_ROLL',
  'KICKOFF',
  'SNAP',
  'TICK',
  'PLAY_SELECTED',
  'MATCHUP_APPLIED',
  'ATTR_CONTEST',
  'PLAY_RESULT',
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

/** `StateSnapshot` arbitrário com todos os campos usados pela projeção. */
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

/** `LogEvent` arbitrário auto-contido; `seq` é preenchido ao montar o log. */
const eventArb: fc.Arbitrary<Omit<LogEvent, 'seq'>> = fc.record({
  type: fc.constantFrom(...EVENT_TYPES),
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
 * `GameLog` arbitrário com ao menos um evento (para existir índice válido).
 * `seq` é atribuído de forma crescente e estável a partir da posição.
 */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(eventArb, { minLength: 1, maxLength: 20 })
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

/** Um log junto a um índice de evento válido dentro dele. */
const logWithIndexArb: fc.Arbitrary<{ log: GameLog; index: number }> =
  gameLogArb.chain((log) =>
    fc
      .integer({ min: 0, max: log.events.length - 1 })
      .map((index) => ({ log, index })),
  );

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

describe('progressAt — Property 11: projeção espelha o estado do evento', () => {
  it('espelha score, quarter, relógio, down, distância, posse, clima e narrativa (R8.1, R8.2, R8.4)', () => {
    fc.assert(
      fc.property(logWithIndexArb, ({ log, index }) => {
        const event = log.events[index]!;
        const state = event.state;

        const frame = progressAt(log, index);

        // R8.1 — placar espelhado do state.
        expect(frame.score.home).toBe(state.score.home);
        expect(frame.score.away).toBe(state.score.away);

        // R8.2 — período, relógio (décimos), down, distância, posse.
        expect(frame.quarter).toBe(state.quarter);
        expect(frame.gameClockDeci).toBe(state.gameClock);
        expect(frame.down).toBe(state.down);
        expect(frame.distance).toBe(state.distance);
        expect(frame.possession).toBe(state.possession);

        // R8.4 — clima apenas exibido, nunca sorteado.
        expect(frame.weather).toBe(state.weather);

        // Narrativa do evento, sem reescrita.
        expect(frame.narrative).toBe(event.narrative);
      }),
    );
  });
});
