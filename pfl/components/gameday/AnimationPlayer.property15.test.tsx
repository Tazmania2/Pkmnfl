// @vitest-environment jsdom

/**
 * Teste de propriedade do player de animação (`AnimationPlayer`) — spec
 * `pfl-gameday-result-ui`, Task 14.2.
 *
 * // Feature: pfl-gameday-result-ui, Property 15: Reprodução, pular e acelerar
 * // não alteram log nem placar
 *
 * **Validates: Requirements 9.4**
 *
 * *Para todo* `Log_Partida` + `Placar`, reproduzir a animação, **pular** e
 * **acelerar** (1x↔2x) é **puro** com relação aos dados da partida: nem o log
 * nem o placar são mutados pelo player (R9.4 — a animação é representação visual
 * e nunca altera `Log_Partida` nem `Placar`).
 *
 * O `AnimationPlayer` é um **player burro**: recebe `Scene[]` já computadas por
 * `buildAnimationScenes(log)` e nunca vê o log/placar em si. Esta propriedade
 * verifica a invariância de ponta a ponta exercitando o player como a página o
 * exercitaria:
 *
 * 1. Constrói um `GameLog` arbitrário auto-contido (eventos `SNAP`/`PLAY_RESULT`
 *    com número de Snap) e um `Placar` arbitrário.
 * 2. Deriva `scenes = buildAnimationScenes(log)` e clona profundamente
 *    `log`+`score` (`structuredClone`) ANTES de renderizar.
 * 3. Renderiza o player; exercita-o: alterna a **velocidade** via
 *    `onToggleSpeed` (controlada — a velocidade é mantida pelo próprio teste),
 *    clica em **Pular**, e avança os timers falsos para dirigir o laço de `rAF`.
 * 4. Assevera que `log` e `score` permanecem **profundamente iguais** aos clones
 *    pré-render (o player não mutou nenhum dos dois).
 * 5. Assevera que a sequência de cenas não foi alterada pela reprodução
 *    (`buildAnimationScenes(log)` recomputado é igual às cenas renderizadas).
 *
 * `requestAnimationFrame` é dirigido por timers falsos (`vi.useFakeTimers`) com
 * um polyfill determinístico de `rAF`/`cancelAnimationFrame` sobre `setTimeout`.
 * `cleanup`/`unmount` e `vi.useRealTimers()`/`vi.restoreAllMocks()` em
 * `afterEach`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import fc from 'fast-check';

import { AnimationPlayer } from './AnimationPlayer';
import { buildAnimationScenes } from '@/lib/match';
import type {
  GameLog,
  LogEvent,
  LogEventType,
  Score,
  SpeciesRawIndex,
  StateSnapshot,
  Team,
  Weather,
  JsonValue,
} from '@/lib/match';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Garante que o polyfill de requestAnimationFrame/cancelAnimationFrame (e
  // quaisquer outros globais stubados) nunca vaze para arquivos irmãos quando a
  // suíte completa roda concorrente.
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Arbitrários auto-contidos de domínio (GameLog / LogEvent / Score) — mesmo
// estilo de `lib/match/animation.property13.test.ts`, mantidos pequenos.
// ---------------------------------------------------------------------------

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const TEAMS: readonly Team[] = ['home', 'away'];

/** Tipos que o planejador trata como Snap jogado (ancoram uma cena). */
const SNAP_EVENT_TYPES: readonly LogEventType[] = ['SNAP', 'PLAY_RESULT'];

const weatherArb: fc.Arbitrary<Weather> = fc.constantFrom(...WEATHERS);
const teamArb: fc.Arbitrary<Team> = fc.constantFrom(...TEAMS);

const nonNegIntArb = fc.integer({ min: 0, max: 10_000 });

const scoreSnapshotArb: fc.Arbitrary<StateSnapshot['score']> = fc.record({
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
  score: scoreSnapshotArb,
  weather: weatherArb,
});

const jsonScalarArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

/**
 * `detail` com alguns ids de pokémon plausíveis (para o player resolver sprites
 * e exercitar `resolveSprite`) além de campos escalares arbitrários.
 */
const detailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> = fc.record(
  {
    offensePokemonIds: fc.array(fc.integer({ min: 1, max: 50 }), {
      maxLength: 3,
    }),
    defensePokemonIds: fc.array(fc.integer({ min: 1, max: 50 }), {
      maxLength: 3,
    }),
    extra: fc.dictionary(fc.string(), jsonScalarArb, { maxKeys: 3 }),
  },
  { requiredKeys: [] },
) as unknown as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

/** Evento de Snap jogado: `SNAP`/`PLAY_RESULT` com `snap` não negativo. */
const snapEventArb: fc.Arbitrary<Omit<LogEvent, 'seq'>> = fc.record({
  type: fc.constantFrom(...SNAP_EVENT_TYPES),
  snap: fc.integer({ min: 0, max: 8 }),
  tick: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  state: stateArb,
  narrative: fc.string(),
  detail: detailArb,
  powerReason: fc.option(fc.constantFrom('INERT_WITH_WARNING', ''), {
    nil: undefined,
  }),
});

/**
 * `GameLog` arbitrário pequeno (poucos Snaps). `seq` crescente e estável a
 * partir da posição (o log já chega ordenado por `seq`).
 */
const gameLogArb: fc.Arbitrary<GameLog> = fc
  .array(snapEventArb, { minLength: 0, maxLength: 6 })
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

const scoreArb: fc.Arbitrary<Score> = fc.record({
  home: nonNegIntArb,
  away: nonNegIntArb,
  final: fc.boolean(),
  tie: fc.boolean(),
});

// ---------------------------------------------------------------------------
// SpeciesRawIndex mínimo — sem sprites, força o substituto local (R9.6). O
// player nunca acessa fonte externa; aqui basta um índice vazio determinístico.
// ---------------------------------------------------------------------------

const EMPTY_SPECIES: SpeciesRawIndex = {
  get: () => undefined,
};

// ---------------------------------------------------------------------------
// Polyfill determinístico de requestAnimationFrame sobre timers falsos.
// Cada quadro agenda um `setTimeout(~16ms)`; avançar os timers falsos dirige o
// laço de rAF do player de forma controlada e terminável.
// ---------------------------------------------------------------------------

function installRafPolyfill(): void {
  const FRAME_MS = 16;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(performance.now()), FRAME_MS) as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  });
}

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

describe('AnimationPlayer — Property 15: reprodução/pular/acelerar não alteram log nem placar', () => {
  it('o player não muta log nem placar ao reproduzir, pular e acelerar (R9.4)', () => {
    fc.assert(
      fc.property(gameLogArb, scoreArb, (log, score) => {
        vi.useFakeTimers();
        installRafPolyfill();

        // Cenas derivadas do log ANTES de qualquer render.
        const scenes = buildAnimationScenes(log);

        // Clones profundos de referência (verdade pré-render).
        const logClone = structuredClone(log);
        const scoreClone = structuredClone(score);
        const scenesClone = structuredClone(scenes);

        const onComplete = vi.fn();

        // Velocidade controlada pelo pai: mantida aqui e alternada 1x↔2x. Um
        // wrapper permite re-renderizar o player com o novo `speed` (como a
        // página faria), sem recriar as cenas nem tocar no log/placar.
        let speed: 1 | 2 = 1;
        const toggleSpeed = (): void => {
          speed = speed === 1 ? 2 : 1;
        };

        const { queryByRole, rerender, unmount } = render(
          <AnimationPlayer
            scenes={scenes}
            speed={speed}
            species={EMPTY_SPECIES}
            onComplete={onComplete}
            onToggleSpeed={toggleSpeed}
          />,
        );

        // Exercita a cadência: avança timers para dirigir alguns quadros de rAF.
        act(() => {
          vi.advanceTimersByTime(200);
        });

        // Alterna a velocidade (acelerar), se os controles estiverem visíveis
        // (log com Snaps). Clica no botão de acelerar e re-renderiza com o novo
        // `speed` controlado — exatamente o fluxo controlado do design.
        const acelerar = queryByRole('button', { name: /Velocidade/i });
        if (acelerar !== null) {
          fireEvent.click(acelerar);
          rerender(
            <AnimationPlayer
              scenes={scenes}
              speed={speed}
              species={EMPTY_SPECIES}
              onComplete={onComplete}
              onToggleSpeed={toggleSpeed}
            />,
          );
          // Avança mais alguns quadros sob a nova velocidade.
          act(() => {
            vi.advanceTimersByTime(200);
          });
        }

        // Pular: leva a animação ao fim imediatamente (R11.2), se disponível.
        const pular = queryByRole('button', { name: /Pular anima/i });
        if (pular !== null) {
          fireEvent.click(pular);
        }

        // Esgota quaisquer timers pendentes do laço de cadência.
        act(() => {
          vi.runOnlyPendingTimers();
        });

        unmount();

        // --- Invariante central (R9.4): log e placar inalterados pelo player.
        expect(log).toEqual(logClone);
        expect(score).toEqual(scoreClone);

        // A sequência de cenas não foi mutada pela reprodução: recomputar do
        // mesmo log produz exatamente as cenas renderizadas, e o array de cenas
        // mantém seu conteúdo original.
        expect(scenes).toEqual(scenesClone);
        expect(buildAnimationScenes(log)).toEqual(scenesClone);

        // Teardown por iteração: restaura timers reais (desinstala o polyfill de
        // rAF) para a próxima amostra começar limpa.
        vi.useRealTimers();
      }),
      // 20 execuções já exercitam a propriedade em entradas variadas mantendo o
      // custo de render baixo sob contenção de CPU na suíte completa.
      { numRuns: 20 },
    );
  }, 30_000);
});
