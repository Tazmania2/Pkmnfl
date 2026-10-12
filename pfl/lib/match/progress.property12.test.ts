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
  GameStats,
  JsonValue,
} from './contracts';

/**
 * Teste de propriedade da ordem determinística das narrativas exibidas
 * (Task 3.3), módulo sob teste `lib/match/progress.ts`.
 *
 * // Feature: pfl-gameday-result-ui, Property 12: Narrativas exibidas seguem a
 * // ordem determinística do log
 *
 * **Validates: Requirements 8.3**
 *
 * *Para todo* `Log_Partida` com ao menos um evento, mapear
 * `progressAt(log, i).narrative` sobre os índices `0..events.length-1` deve
 * produzir **exatamente** `log.events.map(e => e.narrative)` — na mesma ordem,
 * sem omissão, reordenação ou duplicação (R8.3). Além disso, a projeção é
 * determinística: chamar `progressAt` duas vezes sobre o mesmo `log`/índice
 * devolve a mesma narrativa.
 *
 * O arbitrário de `GameLog`/`LogEvent` é autossuficiente neste arquivo: não
 * importa geradores de outras tarefas, evitando colisões com os testes irmãos
 * 3.2/3.4.
 */

// ---------------------------------------------------------------------------
// Arbitrários autossuficientes de GameLog / LogEvent
// ---------------------------------------------------------------------------

const teamArb: fc.Arbitrary<Team> = fc.constantFrom('home', 'away');

const weatherArb: fc.Arbitrary<Weather> = fc.constantFrom(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
);

const eventTypeArb: fc.Arbitrary<LogEventType> = fc.constantFrom(
  'MATCH_INIT',
  'WEATHER_ROLL',
  'KICKOFF',
  'SNAP',
  'TICK',
  'PLAY_SELECTED',
  'PLAY_RESULT',
  'SCORE',
  'POSSESSION_CHANGE',
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'FOUL',
  'QUARTER_END',
  'GAME_END',
);

const stateArb: fc.Arbitrary<StateSnapshot> = fc.record({
  quarter: fc.integer({ min: 1, max: 4 }),
  gameClock: fc.integer({ min: 0, max: 9000 }),
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 0, max: 99 }),
  ballOn: fc.integer({ min: 0, max: 100 }),
  possession: teamArb,
  score: fc.record({
    home: fc.integer({ min: 0, max: 70 }),
    away: fc.integer({ min: 0, max: 70 }),
  }),
  weather: weatherArb,
});

/**
 * Gerador de `narrative` que deliberatamente inclui strings vazias, repetidas e
 * com conteúdo arbitrário, para expor qualquer omissão/dedup/reordenação na
 * projeção.
 */
const narrativeArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.string(),
  fc.constantFrom('Snap!', 'Touchdown!', 'Snap!', 'Fumble recuperado'),
);

const detailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> = fc.oneof(
  fc.constant<Readonly<Record<string, JsonValue>>>({}),
  fc.record({
    effectId: fc.string(),
    outcome: fc.string(),
  }),
);

/** Um `LogEvent` com `seq` atribuído pelo construtor do log (abaixo). */
const eventBodyArb = fc.record({
  type: eventTypeArb,
  state: stateArb,
  narrative: narrativeArb,
  detail: detailArb,
  powerReason: fc.option(fc.string(), { nil: undefined }),
});

/**
 * `GameLog` com ao menos um evento. Os `seq` são atribuídos de forma crescente
 * (0..N-1) após a geração dos corpos, refletindo a ordenação estável do log.
 */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(eventBodyArb, { minLength: 1, maxLength: 25 })
  .map((bodies): GameLog => {
    const events: LogEvent[] = bodies.map((body, i) => ({
      seq: i,
      type: body.type,
      state: body.state,
      narrative: body.narrative,
      detail: body.detail,
      ...(body.powerReason !== undefined
        ? { powerReason: body.powerReason }
        : {}),
    }));

    const stats: GameStats = {
      rushes: { attempts: 0, yards: 0 },
      passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
      turnovers: 0,
      fouls: 0,
      scoringSummary: [],
    };

    return {
      seedUsed: '0',
      baselineVersion: 'test-baseline',
      baselineStatus: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
      events,
      stats,
    };
  });

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe('Property 12: narrativas exibidas seguem a ordem determinística do log', () => {
  it('mapear progressAt sobre todos os índices espelha log.events.map(e => e.narrative) sem omissão, reordenação ou duplicação (R8.3)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const expected = log.events.map((e) => e.narrative);

        const projected = log.events.map(
          (_e, i) => progressAt(log, i).narrative,
        );

        // Igualdade posição-a-posição: mesma ordem, mesmo comprimento, mesmo
        // conteúdo — logo, nenhuma omissão, reordenação ou duplicação.
        expect(projected).toEqual(expected);
        expect(projected.length).toBe(log.events.length);
      }),
    );
  });

  it('a projeção da narrativa é determinística: duas chamadas no mesmo log/índice coincidem', () => {
    fc.assert(
      fc.property(
        gameLogArb,
        fc.integer({ min: 0, max: 1_000_000 }),
        (log, rawIndex) => {
          const i = rawIndex % log.events.length;

          const first = progressAt(log, i).narrative;
          const second = progressAt(log, i).narrative;

          expect(first).toBe(second);
          // E coincide com a fonte do log no mesmo índice.
          expect(first).toBe(log.events[i]!.narrative);
        },
      ),
    );
  });
});
