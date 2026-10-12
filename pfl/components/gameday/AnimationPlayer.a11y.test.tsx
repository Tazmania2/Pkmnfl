// @vitest-environment jsdom

/**
 * Testes de componente/acessibilidade do `AnimationPlayer` — spec
 * `pfl-gameday-result-ui`, Task 14.5.
 *
 * Verifica, no DOM (jsdom + `@testing-library/react` + `jest-axe`), que os
 * controles de pular/acelerar da `Animacao_8bit`:
 *
 * - estão **visíveis e são `<button>` reais** durante a reprodução (R11.1);
 * - são **operáveis por teclado** — alcançáveis por `Tab`, focáveis (não há
 *   aprisionamento de foco), acionáveis por Enter/Espaço — com o foco visível
 *   provido por `:focus-visible` CSS (R11.6, R17.2);
 * - o **Pular conclui em ≤500ms** (R11.2): o acionamento chama `onComplete`
 *   de forma essencialmente síncrona (sem recomputação nem timers), e o
 *   componente passa a ocultar os controles (R11.7);
 * - a árvore renderizada **não viola** as regras automatizáveis de acessibilidade
 *   do `jest-axe` (R17.2).
 *
 * As cenas são construídas a partir de um `GameLog` mínimo e real via
 * `buildAnimationScenes` (um par de Snaps), com `durationHint` naturalmente
 * limitado; para garantir que a reprodução não conclua sozinha durante o teste,
 * também validamos com cenas de `durationHint` alto construídas à mão. Nenhum
 * timer é avançado: as asserções são sobre os controles e sua operação, não
 * sobre a cadência de `requestAnimationFrame`.
 *
 * _Requirements: 11.1, 11.2, 11.6, 17.2_
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import { AnimationPlayer } from './AnimationPlayer';
import { buildAnimationScenes } from '@/lib/match';
import type {
  GameLog,
  LogEvent,
  Scene,
  SpeciesRawEntry,
  SpeciesRawIndex,
} from '@/lib/match';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Cenas construídas à mão com `durationHint` muito alto para que o laço de
 * cadência nunca avance (e portanto nunca conclua) durante o teste — assim os
 * controles permanecem visíveis (R11.7) enquanto exercitamos a acessibilidade.
 */
function cenasEstaveis(): Scene[] {
  return [
    {
      index: 0,
      snap: 0,
      eventIndex: 0,
      offense: 'home',
      offenseSprites: [{ pokemonId: 25 }],
      defenseSprites: [{ pokemonId: 6 }],
      resultKind: 'PLAY',
      narrative: 'Primeiro Snap',
      warnings: [],
      durationHint: 1_000_000,
    },
    {
      index: 1,
      snap: 1,
      eventIndex: 1,
      offense: 'away',
      offenseSprites: [{ pokemonId: 9 }],
      defenseSprites: [{ pokemonId: 3 }],
      resultKind: 'PLAY',
      narrative: 'Segundo Snap',
      warnings: [],
      durationHint: 1_000_000,
    },
  ];
}

/**
 * Monta um `GameLog` mínimo e real com dois eventos de Snap para exercitar o
 * caminho de `buildAnimationScenes` (a planejadora pura usada pela página). As
 * cenas resultantes são então usadas para renderizar o player, confirmando que
 * controles e acessibilidade valem também sobre cenas derivadas do log.
 */
function logComDoisSnaps(): GameLog {
  const evento = (seq: number, snap: number, clock: number): LogEvent =>
    ({
      seq,
      type: 'SNAP',
      snap,
      narrative: `Snap ${snap}`,
      state: {
        quarter: 1,
        gameClock: clock,
        down: 1,
        distance: 10,
        ballOn: 25,
        possession: 'home',
        score: { home: 0, away: 0 },
        weather: 'CLEAR',
      },
      detail: {
        offensePokemonIds: [25],
        defensePokemonIds: [6],
      },
    }) as unknown as LogEvent;

  return {
    seedUsed: '123',
    baselineVersion: 'test',
    baselineStatus: 'FROZEN_MVP_TEST',
    events: [evento(0, 0, 9000), evento(1, 1, 8800)],
    stats: {
      home: { rushes: 0, passes: 0, turnovers: 0, penalties: 0 },
      away: { rushes: 0, passes: 0, turnovers: 0, penalties: 0 },
      scoringSummary: [],
    },
  } as unknown as GameLog;
}

/** `SpeciesRawIndex` mínimo — vazio força `resolveSprite` ao substituto local. */
function speciesIndex(): SpeciesRawIndex {
  return new Map<number, SpeciesRawEntry>();
}

function botaoPular(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Pular animação' });
}

function botaoAcelerar(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Velocidade/ });
}

// ---------------------------------------------------------------------------
// R11.1 — controles visíveis e são <button> reais durante a reprodução
// ---------------------------------------------------------------------------

describe('AnimationPlayer — controles visíveis durante a reprodução (R11.1)', () => {
  it('exibe Pular e Acelerar como botões reais, ambos no documento', () => {
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={vi.fn()}
        onToggleSpeed={vi.fn()}
      />,
    );

    const pular = botaoPular();
    const acelerar = botaoAcelerar();

    expect(pular).toBeInTheDocument();
    expect(pular).toBeVisible();
    expect(pular.tagName).toBe('BUTTON');

    expect(acelerar).toBeInTheDocument();
    expect(acelerar).toBeVisible();
    expect(acelerar.tagName).toBe('BUTTON');

    // Os dois controles vivem no grupo rotulado de controles da animação.
    const grupo = screen.getByRole('group', { name: 'Controles da animação' });
    expect(within(grupo).getByRole('button', { name: 'Pular animação' })).toBe(pular);
    expect(within(grupo).getByRole('button', { name: /^Velocidade/ })).toBe(acelerar);
  });

  it('as cenas derivadas de um GameLog real também renderizam os dois controles', () => {
    const scenes = buildAnimationScenes(logComDoisSnaps());
    expect(scenes.length).toBe(2);

    render(
      <AnimationPlayer
        scenes={scenes}
        speed={1}
        species={speciesIndex()}
        onComplete={vi.fn()}
        onToggleSpeed={vi.fn()}
      />,
    );

    expect(botaoPular()).toBeInTheDocument();
    expect(botaoAcelerar()).toBeInTheDocument();
  });

  it('sem onToggleSpeed, o controle de acelerar fica oculto (botão só com onToggleSpeed)', () => {
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={vi.fn()}
      />,
    );

    expect(botaoPular()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Velocidade/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R11.6, R17.2 — operáveis por teclado, focáveis, sem aprisionamento de foco
// ---------------------------------------------------------------------------

describe('AnimationPlayer — controles operáveis por teclado (R11.6, R17.2)', () => {
  it('os controles são alcançáveis por Tab (tabIndex não removido) e recebem foco', async () => {
    const user = userEvent.setup();
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={vi.fn()}
        onToggleSpeed={vi.fn()}
      />,
    );

    const pular = botaoPular();
    const acelerar = botaoAcelerar();

    // Botões nativos não são removidos da ordem de tabulação.
    expect(pular.tabIndex).not.toBe(-1);
    expect(acelerar.tabIndex).not.toBe(-1);

    // Tab navega até o primeiro controle (segue a ordem visual: Pular → Acelerar).
    await user.tab();
    expect(pular).toHaveFocus();

    await user.tab();
    expect(acelerar).toHaveFocus();

    // Foco não aprisionado: tabular de volta sai do último controle.
    await user.tab({ shift: true });
    expect(pular).toHaveFocus();
  });

  it('Enter no Pular focado dispara onComplete (acionamento por teclado)', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={onComplete}
        onToggleSpeed={vi.fn()}
      />,
    );

    botaoPular().focus();
    expect(botaoPular()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Espaço no Pular focado dispara onComplete (acionamento por teclado)', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={onComplete}
        onToggleSpeed={vi.fn()}
      />,
    );

    botaoPular().focus();
    await user.keyboard('{ }');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Enter no Acelerar focado alterna a velocidade via onToggleSpeed', async () => {
    const user = userEvent.setup();
    const onToggleSpeed = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={vi.fn()}
        onToggleSpeed={onToggleSpeed}
      />,
    );

    const acelerar = botaoAcelerar();
    acelerar.focus();
    expect(acelerar).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onToggleSpeed).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R11.2 — Pular conclui em ≤500ms (síncrono, sem recomputação)
// ---------------------------------------------------------------------------

describe('AnimationPlayer — Pular conclui em ≤500ms (R11.2)', () => {
  it('clicar em Pular chama onComplete em muito menos de 500ms', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={onComplete}
        onToggleSpeed={vi.fn()}
      />,
    );

    const inicio = performance.now();
    await user.click(botaoPular());
    const decorrido = performance.now() - inicio;

    expect(onComplete).toHaveBeenCalledTimes(1);
    // Não há recomputação nem timers: a conclusão é essencialmente imediata.
    expect(decorrido).toBeLessThan(500);
  });

  it('após o Pular, o componente oculta os controles (concluída → renderiza null, R11.7)', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenasEstaveis()}
        speed={1}
        species={speciesIndex()}
        onComplete={onComplete}
        onToggleSpeed={vi.fn()}
      />,
    );

    expect(botaoPular()).toBeInTheDocument();

    await user.click(botaoPular());

    expect(onComplete).toHaveBeenCalledTimes(1);
    // currentIndex = total ⇒ concluída ⇒ controles desaparecem.
    expect(screen.queryByRole('button', { name: 'Pular animação' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Velocidade/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Controles da animação' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R17.2 — sem violações de acessibilidade (jest-axe)
// ---------------------------------------------------------------------------

describe('AnimationPlayer — acessibilidade automatizada (R17.2)', () => {
  it('não apresenta violações de acessibilidade durante a reprodução', async () => {
    const { container } = render(
      <main>
        <AnimationPlayer
          scenes={cenasEstaveis()}
          speed={1}
          species={speciesIndex()}
          onComplete={vi.fn()}
          onToggleSpeed={vi.fn()}
        />
      </main>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
