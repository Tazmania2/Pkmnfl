import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { buildAnimationScenes, MIN_MS, MAX_MS } from './animation';
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
 * Teste de propriedade de pureza e determinismo do planejador de cenas
 * (`buildAnimationScenes`) — Task 4.3.
 *
 * // Feature: pfl-gameday-result-ui, Property 14: `buildAnimationScenes` é pura e determinística
 *
 * **Validates: Requirements 10.1, 10.2, 16.2**
 *
 * *Para todo* `Log_Partida`, `buildAnimationScenes(log)` deriva toda a sequência
 * de cenas **exclusivamente do log** — nunca do relógio de sistema nem de
 * aleatoriedade local (R10.2). Consequências verificadas aqui:
 *
 * - **Determinismo (R10.1, R16.2):** duas invocações sobre o mesmo `log`
 *   produzem arrays profundamente iguais (`toEqual`).
 * - **Pureza sob ambiente adversarial (R10.2):** entre as duas invocações,
 *   adulteramos `Date.now`, o construtor `Date` e `Math.random` para devolver
 *   valores diferentes/garbage. Como a função nada deriva do relógio real nem de
 *   entropia, os dois resultados permanecem idênticos. Os originais são
 *   restaurados em um bloco `finally`.
 * - **Cadência estável e dentro de faixa:** todo `durationHint` cai em
 *   `[MIN_MS, MAX_MS]` e é idêntico entre as duas invocações.
 *
 * O arbitrário de `GameLog`/`LogEvent` é auto-contido (sem fixtures
 * compartilhadas), para não colidir com os arbitrários das tarefas irmãs
 * (4.2/4.4). Nenhum I/O é realizado.
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

/**
 * `detail` arbitrário contendo tanto chaves genéricas quanto as chaves
 * efetivamente consultadas pelo planejador (ids de sprites, marcadores de
 * desfecho), para exercitar os ramos de derivação sem fixar valores.
 */
const detailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> = fc.record(
  {
    offensePokemonIds: fc.option(
      fc.array(fc.integer({ min: 1, max: 1000 }), { maxLength: 4 }),
      { nil: undefined },
    ),
    defensePokemonIds: fc.option(
      fc.array(fc.integer({ min: 1, max: 1000 }), { maxLength: 4 }),
      { nil: undefined },
    ),
    completed: fc.option(fc.boolean(), { nil: undefined }),
    turnover: fc.option(fc.boolean(), { nil: undefined }),
    intercepted: fc.option(fc.boolean(), { nil: undefined }),
    offense: fc.option(fc.string(), { nil: undefined }),
    effectId: fc.option(fc.string(), { nil: undefined }),
    outcome: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: [] },
) as unknown as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

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
 * `GameLog` arbitrário. Permite `minLength: 0` para também cobrir o log sem
 * Snaps (→ `[]`, R9.7). `seq` é atribuído de forma crescente a partir da posição.
 */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(eventArb, { minLength: 0, maxLength: 20 })
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
// Ambiente adversarial — adultera relógio e entropia entre as duas invocações
// ---------------------------------------------------------------------------

/** Captura as referências originais do ambiente para restauração garantida. */
const ORIGINAL_DATE = globalThis.Date;
const ORIGINAL_DATE_NOW = Date.now;
const ORIGINAL_MATH_RANDOM = Math.random;

afterEach(() => {
  // Rede de segurança adicional além do `finally` interno de cada execução.
  globalThis.Date = ORIGINAL_DATE;
  Date.now = ORIGINAL_DATE_NOW;
  Math.random = ORIGINAL_MATH_RANDOM;
});

/**
 * Executa `fn` sob um ambiente de relógio/entropia adulterado por `profile`,
 * restaurando SEMPRE os originais num `finally`. Isso prova que a função sob
 * teste nada lê do relógio real nem de `Math.random`.
 */
function underTamperedEnv<T>(
  profile: { now: number; random: number },
  fn: () => T,
): T {
  try {
    Date.now = () => profile.now;
    Math.random = () => profile.random;
    // Construtor `Date` adulterado: `new Date()` passa a reportar um instante
    // fixo/garbage. Qualquer dependência oculta do relógio divergiria aqui.
    // Montamos o fake via `Object.assign` sobre uma função base e vinculamos o
    // protótipo com `Object.setPrototypeOf` para NÃO atribuir à propriedade
    // somente-leitura `prototype` (o que o `tsc` estrito rejeita).
    const fakeBase = function (this: unknown, ...args: unknown[]) {
      if (args.length === 0) {
        return new ORIGINAL_DATE(profile.now);
      }
      return new (ORIGINAL_DATE as unknown as new (...a: unknown[]) => Date)(
        ...args,
      );
    };
    // Faz `fakeBase.prototype` herdar do protótipo real de `Date`, preservando
    // o comportamento de instâncias/`instanceof` sem reatribuir `prototype`.
    Object.setPrototypeOf(fakeBase.prototype, ORIGINAL_DATE.prototype);
    const Fake = Object.assign(fakeBase, {
      now: () => profile.now,
      parse: ORIGINAL_DATE.parse,
      UTC: ORIGINAL_DATE.UTC,
    }) as unknown as DateConstructor;
    globalThis.Date = Fake;

    return fn();
  } finally {
    globalThis.Date = ORIGINAL_DATE;
    Date.now = ORIGINAL_DATE_NOW;
    Math.random = ORIGINAL_MATH_RANDOM;
  }
}

// ---------------------------------------------------------------------------
// Property 14
// ---------------------------------------------------------------------------

describe('buildAnimationScenes — Property 14: pura e determinística', () => {
  it('produz a mesma sequência de cenas sob ambientes adversariais distintos (R10.1, R10.2, R16.2)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        // Primeira invocação: Math.random=0, relógio no instante A.
        const first = underTamperedEnv(
          { now: 0, random: 0 },
          () => buildAnimationScenes(log),
        );

        // Segunda invocação: Math.random=0.999 e relógio adiantado — garbage
        // completamente diferente. Nada disso pode influenciar a saída.
        const second = underTamperedEnv(
          { now: 8_640_000_000_000_000, random: 0.999_999_999 },
          () => buildAnimationScenes(log),
        );

        // Determinismo + pureza: resultados profundamente iguais apesar do
        // ambiente divergente entre as chamadas.
        expect(second).toEqual(first);

        // Cadência derivada do log: dentro da faixa e estável entre invocações.
        expect(first.length).toBe(second.length);
        for (let i = 0; i < first.length; i++) {
          const a = first[i]!;
          const b = second[i]!;
          expect(a.durationHint).toBeGreaterThanOrEqual(MIN_MS);
          expect(a.durationHint).toBeLessThanOrEqual(MAX_MS);
          expect(b.durationHint).toBe(a.durationHint);
        }
      }),
    );
  });

  it('é idempotente sob invocação repetida no mesmo ambiente (R10.1)', () => {
    fc.assert(
      fc.property(gameLogArb, (log) => {
        const a = buildAnimationScenes(log);
        const b = buildAnimationScenes(log);
        expect(b).toEqual(a);
      }),
    );
  });
});
