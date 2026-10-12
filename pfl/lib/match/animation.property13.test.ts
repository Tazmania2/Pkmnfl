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
 * Teste de propriedade do planejador de cenas da animação
 * (`buildAnimationScenes`) — Task 4.2.
 *
 * // Feature: pfl-gameday-result-ui, Property 13: Cenas da animação são uma
 * // bijeção ordenada dos Snaps do log
 *
 * **Validates: Requirements 9.1, 9.3**
 *
 * *Para todo* `Log_Partida`, `buildAnimationScenes(log)` produz **uma cena por
 * Snap jogado**, em ordem crescente de `seq`, com `index` sequencial `0..N-1`,
 * cada cena referenciando (`eventIndex`) um Snap existente; nenhum Snap é
 * omitido, reordenado ou repetido e nenhuma cena é fabricada sem Snap de origem
 * (R9.1 — representa os Snaps na mesma ordem determinística do log, sem omitir,
 * reordenar nem repetir; R9.3 — dirigida exclusivamente pela sequência de Snaps,
 * sem introduzir eventos ausentes do log).
 *
 * O arbitrário de `GameLog`/`LogEvent` é auto-contido (sem fixtures
 * compartilhadas): gera eventos de Snap (`SNAP`/`PLAY_RESULT`) com número de
 * `snap` **não negativo** — a forma válida de um Snap jogado — interleaveados com
 * eventos que **não** são de Snap (que não devem gerar cena). O oráculo da
 * bijeção reproduz exatamente a semântica de agrupamento do módulo: ordenar por
 * `seq` crescente, filtrar `SNAP`/`PLAY_RESULT`, agrupar por `snap` na ordem de
 * **primeira aparição**. Nenhum I/O é realizado — `buildAnimationScenes` é uma
 * função pura do log.
 */

// ---------------------------------------------------------------------------
// Arbitrários auto-contidos de domínio (GameLog / LogEvent / StateSnapshot)
// ---------------------------------------------------------------------------

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const TEAMS: readonly Team[] = ['home', 'away'];

/** Tipos que o módulo trata como Snap jogado (ancoram uma cena). */
const SNAP_EVENT_TYPES: readonly LogEventType[] = ['SNAP', 'PLAY_RESULT'];

/** Tipos que NÃO são Snap — nunca devem originar uma cena. */
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

const nonNegIntArb = fc.integer({ min: 0, max: 100_000 });

const scoreArb: fc.Arbitrary<StateSnapshot['score']> = fc.record({
  home: nonNegIntArb,
  away: nonNegIntArb,
});

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

const jsonScalarArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

const detailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> =
  fc.dictionary(fc.string(), jsonScalarArb, { maxKeys: 4 });

/**
 * Evento de Snap jogado: `type` em `{SNAP, PLAY_RESULT}` com número de `snap`
 * **não negativo** (a forma válida que o módulo agrupa por `snap`).
 */
const snapEventArb: fc.Arbitrary<Omit<LogEvent, 'seq'>> = fc.record({
  type: fc.constantFrom(...SNAP_EVENT_TYPES),
  snap: fc.integer({ min: 0, max: 30 }),
  tick: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  state: stateArb,
  narrative: fc.string(),
  detail: detailArb,
  powerReason: fc.option(fc.constantFrom('INERT_WITH_WARNING', ''), {
    nil: undefined,
  }),
});

/**
 * Evento que não representa um Snap jogado — nunca deve originar cena. Pode até
 * carregar um `snap` numérico, para garantir que apenas o `type` decide.
 */
const nonSnapEventArb: fc.Arbitrary<Omit<LogEvent, 'seq'>> = fc.record({
  type: fc.constantFrom(...NON_SNAP_EVENT_TYPES),
  snap: fc.option(fc.integer({ min: 0, max: 30 }), { nil: undefined }),
  tick: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  state: stateArb,
  narrative: fc.string(),
  detail: detailArb,
  powerReason: fc.option(fc.constantFrom('INERT_WITH_WARNING', ''), {
    nil: undefined,
  }),
});

const anyEventArb: fc.Arbitrary<Omit<LogEvent, 'seq'>> = fc.oneof(
  { weight: 3, arbitrary: snapEventArb },
  { weight: 2, arbitrary: nonSnapEventArb },
);

/**
 * `GameLog` arbitrário com eventos de Snap e não-Snap interleaveados. `seq` é
 * atribuído de forma crescente e estável a partir da posição (o log já chega
 * ordenado por `seq`).
 */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(anyEventArb, { minLength: 0, maxLength: 25 })
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
// Oráculo: a ordem esperada de Snaps jogados (primeira aparição por `seq`)
// ---------------------------------------------------------------------------

/**
 * Reproduz a semântica de agrupamento do módulo: ordena por `seq` crescente,
 * filtra `SNAP`/`PLAY_RESULT` com `snap >= 0` e agrupa por `snap` na ordem de
 * primeira aparição. Retorna, para cada Snap distinto, o par
 * `{ snap, anchorIndex }` — `anchorIndex` é o índice original (em `log.events`)
 * do primeiro evento daquele Snap.
 */
function expectedPlayedSnaps(
  log: GameLog,
): ReadonlyArray<{ snap: number; anchorIndex: number }> {
  const indexed = log.events.map((event, originalIndex) => ({
    event,
    originalIndex,
  }));
  indexed.sort((a, b) => a.event.seq - b.event.seq);

  const order: Array<{ snap: number; anchorIndex: number }> = [];
  const seen = new Set<number>();

  for (const { event, originalIndex } of indexed) {
    if (event.type !== 'SNAP' && event.type !== 'PLAY_RESULT') {
      continue;
    }
    const snapNo = typeof event.snap === 'number' ? event.snap : -1;
    if (snapNo < 0) {
      continue; // fora do espaço desta propriedade (arbitrário usa snap >= 0)
    }
    if (!seen.has(snapNo)) {
      seen.add(snapNo);
      order.push({ snap: snapNo, anchorIndex: originalIndex });
    }
  }

  return order;
}

// ---------------------------------------------------------------------------
// Property 13
// ---------------------------------------------------------------------------

describe('buildAnimationScenes — Property 13: bijeção ordenada Snap↔cena', () => {
  it('produz uma cena por Snap jogado, em ordem crescente de seq, sem omitir/reordenar/repetir (R9.1, R9.3)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const scenes = buildAnimationScenes(log);
        const expected = expectedPlayedSnaps(log);

        // Cardinalidade: uma cena por Snap distinto jogado (nem a mais, nem a
        // menos) — nenhuma cena fabricada sem Snap de origem (R9.3).
        expect(scenes.length).toBe(expected.length);

        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i]!;
          const exp = expected[i]!;

          // `index` sequencial 0..N-1, na ordem de apresentação.
          expect(scene.index).toBe(i);

          // Ordem crescente de `seq`: a sequência de `snap` segue a primeira
          // aparição por `seq` — sem reordenar (R9.1).
          expect(scene.snap).toBe(exp.snap);

          // Rastreabilidade: `eventIndex` aponta o índice de um evento real do
          // log cujo `snap` casa com a cena (R9.3).
          expect(scene.eventIndex).toBeGreaterThanOrEqual(0);
          expect(scene.eventIndex).toBeLessThan(log.events.length);
          expect(scene.eventIndex).toBe(exp.anchorIndex);

          const sourceEvent = log.events[scene.eventIndex]!;
          expect(SNAP_EVENT_TYPES).toContain(sourceEvent.type);
          expect(sourceEvent.snap).toBe(scene.snap);
        }

        // Sem Snap omitido nem repetido: o multiconjunto de `snap` das cenas é
        // exatamente o conjunto de Snaps distintos jogados.
        const sceneSnaps = scenes.map((s) => s.snap);
        const distinctSceneSnaps = new Set(sceneSnaps);
        expect(distinctSceneSnaps.size).toBe(sceneSnaps.length); // sem repetição
        expect(distinctSceneSnaps.size).toBe(expected.length); // sem omissão

        // Os `index` são exatamente 0..N-1, sem lacuna nem duplicata.
        expect(scenes.map((s) => s.index)).toEqual(
          expected.map((_, i) => i),
        );
      }),
    );
  });

  it('log sem Snaps jogados → nenhuma cena (R9.7, borda da bijeção)', () => {
    const onlyNonSnapArb: fc.Arbitrary<GameLog> = fc
      .array(nonSnapEventArb, { minLength: 0, maxLength: 15 })
      .map((partials): GameLog => {
        // Zera qualquer `snap` numérico: eventos não-Snap nunca ancoram cena,
        // independentemente de carregarem número de snap.
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

    fc.assert(
      fc.property(onlyNonSnapArb, (log) => {
        expect(buildAnimationScenes(log)).toEqual([]);
      }),
    );
  });
});
