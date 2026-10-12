/**
 * Property 24 — Highlights são derivados, determinísticos e rastreáveis ao log
 * (Task 6.3), módulo sob teste `lib/match/result.ts` (`selectHighlights`).
 *
 * // Feature: pfl-gameday-result-ui, Property 24: Highlights são derivados,
 * // determinísticos e rastreáveis ao log
 *
 * **Validates: Requirements 14.2, 14.3**
 *
 * `selectHighlights(log)` percorre `log.events` em ordem determinística e
 * seleciona apenas eventos relevantes para o resumo:
 * - `SCORE` cujo `detail.type` é um `ScoringType` conhecido (TD/FG/SAFETY/PAT/
 *   TWO_PT);
 * - `POSSESSION_CHANGE` com `detail.turnover === true`.
 *
 * Cada `Highlight` referencia o `eventIndex` **existente** do `LogEvent` de
 * origem — nenhum evento é fabricado (R14.3) — e todos os campos exibidos
 * (`quarter`, `text`) vêm do próprio evento, mantendo tudo rastreável ao log.
 * A derivação é pura e determinística: o mesmo log sempre produz o mesmo
 * resultado (R14.2).
 *
 * O arbitrário de `GameLog`/`LogEvent` é autossuficiente neste arquivo
 * (nome dedicado `result.highlights.property24.test.ts`), misturando eventos
 * `SCORE` (vários `detail.type`, inclusive tipos desconhecidos), eventos
 * `POSSESSION_CHANGE` (turnover `true`/`false`/ausente) e outros eventos
 * irrelevantes — para exercitar seleção, ordenação, rastreabilidade e
 * determinismo sem colidir com os testes irmãos 6.2/6.4.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { selectHighlights } from './result';
import { formatClock } from './progress';
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

// ---------------------------------------------------------------------------
// Espelho das regras de seleção do módulo sob teste (para asserção independente)
// ---------------------------------------------------------------------------

const KNOWN_SCORING_TYPES = ['TD', 'FG', 'SAFETY', 'PAT', 'TWO_PT'] as const;
const SCORING_SET = new Set<string>(KNOWN_SCORING_TYPES);

/**
 * Predicado que decide se um `LogEvent` é selecionável como highlight, espelhando
 * exatamente a regra de `selectHighlights`: `SCORE` com `detail.type` conhecido
 * ou `POSSESSION_CHANGE` com `detail.turnover === true`.
 */
function isSelectable(event: LogEvent): boolean {
  if (event.type === 'SCORE') {
    const type = event.detail['type'];
    return typeof type === 'string' && SCORING_SET.has(type);
  }
  if (event.type === 'POSSESSION_CHANGE') {
    return event.detail['turnover'] === true;
  }
  return false;
}

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

/**
 * `detail` de um evento `SCORE`. `type` pode ser:
 * - um `ScoringType` conhecido (deve ser selecionado);
 * - um tipo desconhecido (não deve ser selecionado);
 * - ausente / não-string (não deve ser selecionado).
 */
const scoreDetailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.oneof(
    // Tipo de scoring conhecido.
    fc.record({ type: fc.constantFrom(...KNOWN_SCORING_TYPES) }),
    // Tipo string desconhecido.
    fc.record({ type: fc.constantFrom('XP', 'UNKNOWN', 'ROUGE', '') }),
    // `type` ausente.
    fc.constant<Readonly<Record<string, JsonValue>>>({}),
    // `type` presente mas não-string.
    fc.record({ type: fc.integer({ min: 0, max: 9 }) }),
  ) as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

/**
 * `detail` de um evento `POSSESSION_CHANGE`. `turnover` pode ser:
 * - `true` (deve ser selecionado);
 * - `false` (não selecionado);
 * - ausente ou não-boolean (não selecionado).
 */
const possessionDetailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.oneof(
    fc.record({ turnover: fc.boolean() }),
    fc.constant<Readonly<Record<string, JsonValue>>>({}),
    // `turnover` presente mas não-boolean (ex.: string "true").
    fc.record({ turnover: fc.constantFrom('true', 'false') }),
  ) as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

/** `detail` de qualquer outro evento irrelevante. */
const otherDetailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.oneof(
    fc.constant<Readonly<Record<string, JsonValue>>>({}),
    fc.record({ note: fc.string({ maxLength: 10 }) }),
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

/** Corpo de evento (sem `seq`), misturando SCORE, POSSESSION_CHANGE e outros. */
const eventBodyArb = fc.oneof(
  // Evento SCORE.
  fc.record({
    type: fc.constant<LogEventType>('SCORE'),
    state: stateArb,
    narrative: narrativeArb,
    detail: scoreDetailArb,
  }),
  // Evento POSSESSION_CHANGE.
  fc.record({
    type: fc.constant<LogEventType>('POSSESSION_CHANGE'),
    state: stateArb,
    narrative: narrativeArb,
    detail: possessionDetailArb,
  }),
  // Qualquer outro evento irrelevante ao resumo.
  fc.record({
    type: fc.constantFrom(...OTHER_EVENT_TYPES),
    state: stateArb,
    narrative: narrativeArb,
    detail: otherDetailArb,
  }),
);

/**
 * `GameLog` com uma lista densa de eventos (0..N). Os `seq` são atribuídos de
 * forma crescente (0..N-1) após a geração, refletindo a ordenação estável do
 * log. `maxLength` generoso para garantir mistura de eventos selecionáveis e não
 * selecionáveis.
 */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(eventBodyArb, { minLength: 0, maxLength: 30 })
  .map((bodies): GameLog => {
    const events: LogEvent[] = bodies.map((body, i) => ({
      seq: i,
      type: body.type,
      state: body.state,
      narrative: body.narrative,
      detail: body.detail,
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
// Property 24
// ---------------------------------------------------------------------------

describe('Property 24: highlights são derivados, determinísticos e rastreáveis ao log', () => {
  it('cada highlight referencia um eventIndex válido e selecionável — nada é fabricado (R14.3)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const highlights = selectHighlights(log);

        for (const h of highlights) {
          // eventIndex é um índice válido em log.events.
          expect(Number.isInteger(h.eventIndex)).toBe(true);
          expect(h.eventIndex).toBeGreaterThanOrEqual(0);
          expect(h.eventIndex).toBeLessThan(log.events.length);

          // O evento referenciado existe e é, de fato, selecionável.
          const source = log.events[h.eventIndex]!;
          expect(isSelectable(source)).toBe(true);
        }
      }),
    );
  });

  it('highlights aparecem na mesma ordem dos eventos de origem (índices estritamente crescentes)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const highlights = selectHighlights(log);

        for (let i = 1; i < highlights.length; i += 1) {
          expect(highlights[i]!.eventIndex).toBeGreaterThan(
            highlights[i - 1]!.eventIndex,
          );
        }

        // A sequência de índices coincide exatamente com os índices de todos os
        // eventos selecionáveis do log, na ordem do log — nenhuma omissão nem
        // seleção extra.
        const expectedIndices: number[] = [];
        for (let i = 0; i < log.events.length; i += 1) {
          if (isSelectable(log.events[i]!)) {
            expectedIndices.push(i);
          }
        }
        expect(highlights.map((h) => h.eventIndex)).toEqual(expectedIndices);
      }),
    );
  });

  it('quarter, clock e text de cada highlight vêm do evento de origem (rastreável, R14.3)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const highlights = selectHighlights(log);

        for (const h of highlights) {
          const source = log.events[h.eventIndex]!;
          expect(h.quarter).toBe(source.state.quarter);
          expect(h.clock).toBe(formatClock(source.state.gameClock));
          expect(h.text).toBe(source.narrative);
        }
      }),
    );
  });

  it('é determinística: duas chamadas sobre o mesmo log produzem resultados profundamente iguais (R14.2)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const first = selectHighlights(log);
        const second = selectHighlights(log);
        expect(first).toEqual(second);
      }),
    );
  });
});
