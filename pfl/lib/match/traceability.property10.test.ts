/**
 * Property 10 — Origem rastreável de todo valor exibido (Task 6.4).
 *
 * // Feature: pfl-gameday-result-ui, Property 10: Origem rastreável de todo
 * // valor exibido
 *
 * **Validates: Requirements 6.4, 8.5, 13.4, 14.3, 17.5**
 *
 * Esta propriedade é transversal: cobre as TRÊS funções puras de projeção que a
 * UI consome — `progressAt` (`lib/match/progress.ts`), `determineOutcome` e
 * `selectHighlights` (`lib/match/result.ts`) — e afirma a invariante central do
 * design: **o log/placar é a única verdade** (R6.4, R17.5). Todo valor que essas
 * funções expõem é lido ou derivado de um campo real do `Log_Partida`/`Placar`;
 * nenhuma fabrica número, time, desfecho ou evento sem origem rastreável.
 *
 * - `progressAt(log, i)` (R8.5): cada campo do `ProgressFrame` iguala o campo
 *   correspondente de `log.events[i].state`/`.narrative`; os `warnings` só
 *   existem quando o evento carrega `powerReason` (vazios quando não) e cada
 *   aviso contém textualmente o `powerReason` do evento.
 * - `determineOutcome(score)` (R13.4): o desfecho é função pura de
 *   `score.home`/`score.away` — o `team` vencedor é o lado de MAIOR pontuação, e
 *   só há `tie` quando as pontuações são iguais; nenhum time/desfecho é
 *   introduzido fora do que o placar implica.
 * - `selectHighlights(log)` (R14.3): todo `highlight.eventIndex` é um índice
 *   válido de `log.events`; `quarter`/`clock`/`text` igualam os dados do evento
 *   de origem; e o `kind` corresponde ao evento ser de scoring/turnover.
 *
 * O arbitrário de `GameLog`/`Score` é autossuficiente neste arquivo (nome
 * dedicado `traceability.property10.test.ts`) para não colidir com os testes
 * irmãos 6.2 (`result.outcome.property22.test.ts`) e 6.3
 * (`result.highlights.property24.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { progressAt, formatClock } from './progress';
import { determineOutcome, selectHighlights } from './result';
import type {
  GameLog,
  LogEvent,
  LogEventType,
  StateSnapshot,
  Score,
  Team,
  Weather,
  GameStats,
  JsonValue,
} from './contracts';

// ---------------------------------------------------------------------------
// Regras de seleção espelhadas (asserção independente do módulo sob teste)
// ---------------------------------------------------------------------------

const KNOWN_SCORING_TYPES = ['TD', 'FG', 'SAFETY', 'PAT', 'TWO_PT'] as const;
const SCORING_SET = new Set<string>(KNOWN_SCORING_TYPES);

/** `kind` esperado de um highlight derivado do evento de origem. */
function expectedHighlightKind(event: LogEvent): string | null {
  if (event.type === 'SCORE') {
    const type = event.detail['type'];
    return typeof type === 'string' && SCORING_SET.has(type) ? type : null;
  }
  if (event.type === 'POSSESSION_CHANGE') {
    return event.detail['turnover'] === true ? 'TURNOVER' : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arbitrários autossuficientes de domínio
// ---------------------------------------------------------------------------

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const TEAMS: readonly Team[] = ['home', 'away'];

const weatherArb: fc.Arbitrary<Weather> = fc.constantFrom(...WEATHERS);
const teamArb: fc.Arbitrary<Team> = fc.constantFrom(...TEAMS);

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

const narrativeArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.string({ maxLength: 60 }),
  fc.constantFrom('Touchdown!', 'Field goal é bom', 'Interceptação!', 'Fumble!'),
);

const powerReasonArb = fc.constantFrom(
  'INERT_WITH_WARNING',
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'TELEKINESIS_NOTE',
  'ANATOMY_WARNING',
);

const jsonLeafArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string({ maxLength: 10 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

/** `detail` de um evento SCORE (type conhecido/desconhecido/ausente/não-string). */
const scoreDetailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.oneof(
    fc.record({ type: fc.constantFrom(...KNOWN_SCORING_TYPES) }),
    fc.record({ type: fc.constantFrom('XP', 'UNKNOWN', '') }),
    fc.constant<Readonly<Record<string, JsonValue>>>({}),
    fc.record({ type: fc.integer({ min: 0, max: 9 }) }),
  ) as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

/** `detail` de um evento POSSESSION_CHANGE (turnover true/false/ausente/não-boolean). */
const possessionDetailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.oneof(
    fc.record({ turnover: fc.boolean() }),
    fc.constant<Readonly<Record<string, JsonValue>>>({}),
    fc.record({ turnover: fc.constantFrom('true', 'false') }),
  ) as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

/** `detail` com campos rastreáveis que `deriveWarnings` pode anexar. */
const genericDetailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.record(
    {
      effectId: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
        nil: undefined,
      }),
      instanceId: fc.option(fc.integer({ min: 1, max: 9999 }), {
        nil: undefined,
      }),
      outcome: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
        nil: undefined,
      }),
      noise: fc.option(jsonLeafArb, { nil: undefined }),
    },
    { requiredKeys: [] },
  ) as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

const OTHER_EVENT_TYPES: ReadonlyArray<LogEventType> = [
  'MATCH_INIT',
  'WEATHER_ROLL',
  'KICKOFF',
  'SNAP',
  'TICK',
  'PLAY_SELECTED',
  'PLAY_RESULT',
  'FOUL',
  'QUARTER_END',
  'GAME_END',
];

/**
 * Corpo de evento (sem `seq`) que mistura SCORE, POSSESSION_CHANGE e outros, e
 * que — em metade dos casos — carrega um `powerReason` presente, para exercitar
 * tanto `progressAt` (warnings) quanto `selectHighlights` (seleção) no mesmo log.
 */
const eventBodyArb = fc
  .record({
    kind: fc.oneof(
      fc.record({
        type: fc.constant<LogEventType>('SCORE'),
        detail: scoreDetailArb,
      }),
      fc.record({
        type: fc.constant<LogEventType>('POSSESSION_CHANGE'),
        detail: possessionDetailArb,
      }),
      fc.record({
        type: fc.constantFrom(...OTHER_EVENT_TYPES),
        detail: genericDetailArb,
      }),
    ),
    state: stateArb,
    narrative: narrativeArb,
    powerReason: fc.oneof(fc.constant(undefined), fc.constant(''), powerReasonArb),
  })
  .map((e) => ({
    type: e.kind.type,
    state: e.state,
    narrative: e.narrative,
    detail: e.kind.detail,
    powerReason: e.powerReason,
  }));

const emptyStats: GameStats = {
  rushes: { attempts: 0, yards: 0 },
  passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
  turnovers: 0,
  fouls: 0,
  scoringSummary: [],
};

/** `GameLog` com lista densa de eventos; `seq` atribuído de forma crescente. */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(eventBodyArb, { minLength: 1, maxLength: 24 })
  .map((bodies): GameLog => {
    const events: LogEvent[] = bodies.map((body, i) => {
      const base: LogEvent = {
        seq: i,
        type: body.type,
        state: body.state,
        narrative: body.narrative,
        detail: body.detail,
      };
      return body.powerReason === undefined
        ? base
        : { ...base, powerReason: body.powerReason };
    });

    return {
      seedUsed: '0',
      baselineVersion: 'test-baseline',
      baselineStatus: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
      events,
      stats: emptyStats,
    };
  });

/** Um log junto a um índice de evento válido dentro dele. */
const logWithIndexArb: fc.Arbitrary<{ log: GameLog; index: number }> =
  gameLogArb.chain((log) =>
    fc
      .integer({ min: 0, max: log.events.length - 1 })
      .map((index) => ({ log, index })),
  );

/** `Score` arbitrário independente, cobrindo home>away, away>home e empate. */
const scoreArb: fc.Arbitrary<Score> = fc.oneof(
  // Caso geral.
  fc.record({
    home: fc.integer({ min: 0, max: 80 }),
    away: fc.integer({ min: 0, max: 80 }),
    final: fc.boolean(),
    tie: fc.boolean(),
  }),
  // Empate garantido.
  fc.record({
    n: fc.integer({ min: 0, max: 80 }),
    final: fc.boolean(),
  }).map(({ n, final }) => ({ home: n, away: n, final, tie: true })),
) as fc.Arbitrary<Score>;

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: origem rastreável de todo valor exibido (R6.4, R8.5, R13.4, R14.3, R17.5)', () => {
  // -------------------------------------------------------------------------
  // progressAt — todo campo projetado mapeia de volta ao state/narrative/powerReason
  // -------------------------------------------------------------------------
  it('progressAt: cada campo do frame equivale a um campo do evento de origem (R8.5, R17.5)', () => {
    fc.assert(
      fc.property(logWithIndexArb, ({ log, index }) => {
        const event = log.events[index]!;
        const state = event.state;
        const frame = progressAt(log, index);

        // Placar / período / relógio / down / distância / posse / clima.
        expect(frame.score.home).toBe(state.score.home);
        expect(frame.score.away).toBe(state.score.away);
        expect(frame.quarter).toBe(state.quarter);
        expect(frame.gameClockDeci).toBe(state.gameClock);
        expect(frame.down).toBe(state.down);
        expect(frame.distance).toBe(state.distance);
        expect(frame.possession).toBe(state.possession);
        expect(frame.weather).toBe(state.weather);

        // Narrativa espelhada sem reescrita.
        expect(frame.narrative).toBe(event.narrative);

        // Warnings: só existem com powerReason; cada aviso é rastreável a ele.
        const reason = event.powerReason;
        const hasReason = reason !== undefined && reason !== '';
        if (!hasReason) {
          expect(frame.warnings).toEqual([]);
        } else {
          expect(frame.warnings.length).toBeGreaterThan(0);
          for (const w of frame.warnings) {
            expect(w).toContain(reason);
          }
        }
      }),
    );
  });

  // -------------------------------------------------------------------------
  // determineOutcome — desfecho é função pura e total do placar
  // -------------------------------------------------------------------------
  it('determineOutcome: vencedor é o lado de maior placar; empate sse placares iguais (R13.4)', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const outcome = determineOutcome(score);

        if (score.home === score.away) {
          // Nenhum time é introduzido quando o placar não implica vencedor.
          expect(outcome).toEqual({ kind: 'tie' });
          return;
        }

        expect(outcome.kind).toBe('winner');
        if (outcome.kind === 'winner') {
          const higher: Team = score.home > score.away ? 'home' : 'away';
          // O time vencedor é EXATAMENTE o lado de maior pontuação do placar.
          expect(outcome.team).toBe(higher);
          // E nunca o lado de menor pontuação.
          const lower: Team = higher === 'home' ? 'away' : 'home';
          expect(outcome.team).not.toBe(lower);
        }
      }),
    );
  });

  it('determineOutcome: é determinística e depende apenas de home/away (R13.4)', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        // Mesma entrada ⇒ mesmo desfecho.
        expect(determineOutcome(score)).toEqual(determineOutcome(score));

        // Alterar apenas `tie` (campo não lido) não muda o desfecho: a função
        // deriva tudo de home/away, nada mais do placar é fabricado.
        const flipped: Score = { ...score, tie: !score.tie };
        expect(determineOutcome(flipped)).toEqual(determineOutcome(score));
      }),
    );
  });

  // -------------------------------------------------------------------------
  // selectHighlights — todo highlight exposto mapeia a um evento real do log
  // -------------------------------------------------------------------------
  it('selectHighlights: eventIndex é válido e campos vêm do evento de origem (R14.3, R17.5)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const highlights = selectHighlights(log);

        for (const h of highlights) {
          // eventIndex é índice real de log.events.
          expect(Number.isInteger(h.eventIndex)).toBe(true);
          expect(h.eventIndex).toBeGreaterThanOrEqual(0);
          expect(h.eventIndex).toBeLessThan(log.events.length);

          const source = log.events[h.eventIndex]!;

          // kind corresponde ao evento ser de scoring/turnover (não fabricado).
          const kind = expectedHighlightKind(source);
          expect(kind).not.toBeNull();
          expect(h.kind).toBe(kind);

          // Campos exibidos espelham o evento de origem.
          expect(h.quarter).toBe(source.state.quarter);
          expect(h.clock).toBe(formatClock(source.state.gameClock));
          expect(h.text).toBe(source.narrative);
        }
      }),
    );
  });

  it('selectHighlights: seleciona exatamente os eventos elegíveis, na ordem do log (R14.3)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const expectedIndices: number[] = [];
        for (let i = 0; i < log.events.length; i += 1) {
          if (expectedHighlightKind(log.events[i]!) !== null) {
            expectedIndices.push(i);
          }
        }

        const highlights = selectHighlights(log);
        // Nenhuma omissão nem seleção extra; nenhum evento fabricado.
        expect(highlights.map((h) => h.eventIndex)).toEqual(expectedIndices);
      }),
    );
  });
});
