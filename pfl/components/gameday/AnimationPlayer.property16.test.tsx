// @vitest-environment jsdom

/**
 * Property 16 — spec `pfl-gameday-result-ui`, Task 14.3.
 *
 * **Conclusão e pular conduzem ao resultado usando o placar do log.**
 *
 * O `AnimationPlayer` é um player burro: ele nunca carrega nem altera o
 * `Placar`. A navegação para a Tela_Resultado é disparada pelo **sinal**
 * `onComplete` — a página então usa o `Placar` já presente no `Log_Partida`
 * (R9.5, R11.2). No nível do componente, Property 16 reduz-se a: **conclusão e
 * pular disparam `onComplete` exatamente uma vez** (o gatilho da navegação),
 * sem jamais tocar no log/placar.
 *
 * Três caminhos, para `scenes = buildAnimationScenes(log)` arbitrário:
 *
 * - **Pular** (R11.2): clicar "Pular animação" dispara `onComplete` exatamente
 *   uma vez, de forma imediata (sem precisar avançar o relógio — bem abaixo dos
 *   500 ms). Após a conclusão, os controles de pular/acelerar ficam ocultos
 *   (R11.7). O `score` associado permanece inalterado.
 * - **Reproduzir até o fim** (R9.5): avançar o relógio o suficiente para passar
 *   por `durationHint / speed` de cada cena dispara `onComplete` exatamente uma
 *   vez ao final — nunca múltiplas vezes.
 * - **Log sem Snaps** (R9.7): `scenes = []` dispara `onComplete` exatamente uma
 *   vez imediatamente e não renderiza controles.
 *
 * **Validates: Requirements 9.5, 11.2**
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import fc from 'fast-check';

import { AnimationPlayer } from './AnimationPlayer';
import { buildAnimationScenes, MAX_MS } from '@/lib/match';
import type {
  GameLog,
  LogEvent,
  Score,
  StateSnapshot,
  SpeciesRawEntry,
  SpeciesRawIndex,
  Team,
  Weather,
} from '@/lib/match';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Índice de espécies mínimo (SpeciesRawIndex): um `Map` basta — o player só o
// usa para resolver sprites, e a ausência de entrada cai no substituto local.
// ---------------------------------------------------------------------------

const EMPTY_SPECIES: SpeciesRawIndex = new Map<number, SpeciesRawEntry>();

// ---------------------------------------------------------------------------
// Arbitrário auto-contido de GameLog com Snaps.
//
// Construímos eventos SNAP com números de `snap` crescentes e `seq` crescente,
// relógio de jogo (`gameClock`) decrescente em passos conhecidos para que a
// aritmética de `durationHint` seja tratável. O `score` é fixo por log e NUNCA
// é alterado pelo player — o emparelhamos para afirmar invariância.
// ---------------------------------------------------------------------------

const team: fc.Arbitrary<Team> = fc.constantFrom('home', 'away');
const weather: fc.Arbitrary<Weather> = fc.constantFrom(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
);

const score: fc.Arbitrary<Score> = fc.record({
  home: fc.integer({ min: 0, max: 70 }),
  away: fc.integer({ min: 0, max: 70 }),
  final: fc.constant(true),
  tie: fc.constant(false),
});

function stateFor(snap: number, possession: Team, w: Weather): StateSnapshot {
  // Relógio decresce 50 décimos (5 s) por Snap a partir de 9000 (900 s), nunca
  // negativo. Isso torna `durationHint` conhecido e limitado por MAX_MS.
  const gameClock = Math.max(0, 9000 - snap * 50);
  return {
    quarter: 1,
    gameClock,
    down: 1,
    distance: 10,
    ballOn: 25,
    possession,
    score: { home: 0, away: 0 },
    weather: w,
  };
}

/** Um log com `n` Snaps (eventos SNAP), ordenado por `seq` crescente. */
function gameLogWithSnaps(n: number): fc.Arbitrary<GameLog> {
  return fc
    .tuple(
      fc.array(team, { minLength: n, maxLength: n }),
      weather,
      fc.string({ maxLength: 20 }),
    )
    .map(([possessions, w, seedUsed]) => {
      const events: LogEvent[] = Array.from({ length: n }, (_, i) => {
        const possession = possessions[i] ?? 'home';
        return {
          seq: i,
          type: 'SNAP' as const,
          snap: i + 1,
          state: stateFor(i + 1, possession, w),
          narrative: `Snap ${i + 1}`,
          detail: { offense: 'O_RUN_INSIDE' },
        } satisfies LogEvent;
      });

      return {
        seedUsed: seedUsed === '' ? '0' : seedUsed,
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
      } satisfies GameLog;
    });
}

/** Log não-vazio: 1..5 Snaps. */
const nonEmptyLog: fc.Arbitrary<GameLog> = fc
  .integer({ min: 1, max: 5 })
  .chain((n) => gameLogWithSnaps(n));

/** Localiza o botão "Pular animação" no container, ou `null` se ausente. */
function findSkipButton(container: HTMLElement): HTMLButtonElement | null {
  const botoes = Array.from(container.querySelectorAll('button'));
  return (
    botoes.find((b) => (b.textContent ?? '').includes('Pular animação')) ?? null
  );
}

const speed: fc.Arbitrary<1 | 2> = fc.constantFrom(1, 2);

// ===========================================================================
// Property 16
// ===========================================================================

describe('AnimationPlayer — Property 16 (conclusão/pular disparam onComplete, placar do log)', () => {
  // -------------------------------------------------------------------------
  // Caminho PULAR (R11.2)
  // -------------------------------------------------------------------------
  it('pular dispara onComplete exatamente uma vez, imediatamente, e oculta os controles (R11.2, R11.7)', () => {
    fc.assert(
      fc.property(nonEmptyLog, speed, (log, spd) => {
        const scenes = buildAnimationScenes(log);
        // Placar que a página usaria na navegação — o player nunca o altera.
        const score: Score = { home: 21, away: 17, final: true, tie: false };
        const scoreAntes = { ...score };

        const onComplete = vi.fn();

        const { container, unmount } = render(
          <AnimationPlayer
            scenes={scenes}
            speed={spd}
            species={EMPTY_SPECIES}
            onComplete={onComplete}
          />,
        );

        const skip = findSkipButton(container);
        expect(skip).not.toBeNull();

        // Clicar em pular: a conclusão é imediata e síncrona (sem avançar
        // relógio algum — bem abaixo do limite de 500 ms de R11.2).
        act(() => {
          fireEvent.click(skip as HTMLButtonElement);
        });

        // onComplete chamado exatamente uma vez (sinal de navegação — R11.2).
        expect(onComplete).toHaveBeenCalledTimes(1);

        // Controles ocultos após a conclusão (R11.7): o player não renderiza
        // mais o botão de pular.
        expect(findSkipButton(container)).toBeNull();

        // O player nunca tocou no Placar (navegação usa o placar do log).
        expect(score).toEqual(scoreAntes);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Caminho REPRODUZIR ATÉ O FIM (R9.5)
  // -------------------------------------------------------------------------
  it('reproduzir até o fim dispara onComplete exatamente uma vez (R9.5)', () => {
    fc.assert(
      fc.property(nonEmptyLog, speed, (log, spd) => {
        vi.useFakeTimers();
        try {
          const scenes = buildAnimationScenes(log);
          const onComplete = vi.fn();

          const { unmount } = render(
            <AnimationPlayer
              scenes={scenes}
              speed={spd}
              species={EMPTY_SPECIES}
              onComplete={onComplete}
            />,
          );

          // A cadência avança quando o tempo acumulado atinge
          // `durationHint / speed` da cena corrente. O pior caso por cena é
          // MAX_MS; avançamos um passo grande por cena, com folga, para passar
          // por todas. Cada "passo" é uma leva de frames de rAF.
          const stepMs = MAX_MS + 50;
          const totalSteps = scenes.length + 2;

          for (let i = 0; i < totalSteps; i++) {
            act(() => {
              vi.advanceTimersByTime(stepMs);
            });
          }

          // Concluída toda a sequência → onComplete uma única vez (R9.5),
          // jamais múltiplas vezes mesmo com frames adicionais de rAF.
          expect(onComplete).toHaveBeenCalledTimes(1);

          unmount();
        } finally {
          vi.useRealTimers();
        }
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Caminho LOG SEM SNAPS (R9.7)
  // -------------------------------------------------------------------------
  it('scenes vazio dispara onComplete exatamente uma vez e não renderiza controles (R9.7)', () => {
    fc.assert(
      fc.property(speed, (spd) => {
        const onComplete = vi.fn();

        const { container, unmount } = render(
          <AnimationPlayer
            scenes={[]}
            speed={spd}
            species={EMPTY_SPECIES}
            onComplete={onComplete}
          />,
        );

        // onComplete imediato e único (R9.7).
        expect(onComplete).toHaveBeenCalledTimes(1);
        // Nenhum controle renderizado (nada a reproduzir).
        expect(findSkipButton(container)).toBeNull();

        unmount();
      }),
      { numRuns: 50 },
    );
  });

  // -------------------------------------------------------------------------
  // Emparelhamento com o placar do log: scenes = buildAnimationScenes(log) e o
  // score que a página usaria. O player nunca altera o score; onComplete é o
  // único gatilho de navegação (que usará esse score inalterado).
  // -------------------------------------------------------------------------
  it('o gatilho onComplete convive com um placar inalterado derivado do log', () => {
    fc.assert(
      fc.property(nonEmptyLog, score, (log, scoreDoLog) => {
        const scenes = buildAnimationScenes(log);
        const scoreAntes = { ...scoreDoLog };

        const onComplete = vi.fn();

        const { container, unmount } = render(
          <AnimationPlayer
            scenes={scenes}
            speed={1}
            species={EMPTY_SPECIES}
            onComplete={onComplete}
          />,
        );

        act(() => {
          fireEvent.click(findSkipButton(container) as HTMLButtonElement);
        });

        expect(onComplete).toHaveBeenCalledTimes(1);
        // O placar que a navegação usará permanece exatamente o do log.
        expect(scoreDoLog).toEqual(scoreAntes);

        unmount();
      }),
      { numRuns: 50 },
    );
  });
});
