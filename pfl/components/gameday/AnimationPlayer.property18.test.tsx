// @vitest-environment jsdom

/**
 * Property 18 — spec `pfl-gameday-result-ui`, Task 14.4.
 *
 * **Alternância de velocidade é determinística entre 1x e 2x.**
 *
 * O `AnimationPlayer` é um player **burro** com a velocidade **controlada pelo
 * pai**: recebe `speed: 1 | 2` como prop e expõe `onToggleSpeed?`. A semântica de
 * alternância (1→2, 2→1) vive no pai, então a Property 18 é verificada em duas
 * frentes complementares:
 *
 * (a) **Regra de toggle pura** `toggle(s) = s === 1 ? 2 : 1`: começando de 1 ou 2,
 *     aplicá-la N vezes produz **apenas** 1 ou 2 (nunca outro valor), é
 *     **determinística** (mesma sequência a cada execução) e é **involutiva**
 *     (aplicá-la duas vezes retorna ao início). Isso codifica a determinística
 *     alternância 1x↔2x exigida por R11.3/R11.4.
 *
 * (b) **Fidelidade do componente ao `speed` controlado**: o botão de acelerar
 *     reflete exatamente o `speed` corrente (rótulo e `aria-pressed`) e dispara
 *     `onToggleSpeed` uma vez por acionamento, sem alterar o log. Simulando o laço
 *     controlado (estado de `speed` mantido no teste + `onToggleSpeed` que aplica
 *     `toggle`), K acionamentos arbitrários produzem exatamente a alternância
 *     determinística 1↔2.
 *
 * **Validates: Requirements 11.3, 11.4**
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

import { AnimationPlayer } from './AnimationPlayer';
import type { Scene, SpeciesRawEntry, SpeciesRawIndex } from '@/lib/match';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Regra de alternância sob teste (a mesma semântica que o pai aplica, R11.3/R11.4).
// ---------------------------------------------------------------------------

type Speed = 1 | 2;
const toggle = (s: Speed): Speed => (s === 1 ? 2 : 1);

// ---------------------------------------------------------------------------
// Fixtures mínimas para o player não concluir durante o teste.
//
// Uma única cena com `durationHint` alto mantém a animação em reprodução (os
// controles pular/acelerar só aparecem enquanto não concluída, R11.7). Não
// avançamos timers nem usamos rAF: a asserção é sobre os controles, não sobre a
// cadência, então o laço de rAF do jsdom não produz efeito observável aqui.
// ---------------------------------------------------------------------------

function cenaUnica(): Scene[] {
  return [
    {
      index: 0,
      snap: 0,
      eventIndex: 0,
      offense: 'home',
      offenseSprites: [{ pokemonId: 1 }],
      defenseSprites: [{ pokemonId: 2 }],
      resultKind: 'PLAY',
      narrative: 'Snap inicial',
      warnings: [],
      // Alto o bastante para que a cadência nunca avance durante o teste.
      durationHint: 1_000_000,
    },
  ];
}

/** `SpeciesRawIndex` mínimo (um `Map`) — resolveSprite cai no substituto local. */
function speciesIndex(): SpeciesRawIndex {
  return new Map<number, SpeciesRawEntry>();
}

/** Localiza o botão de acelerar pelo prefixo do rótulo "Velocidade". */
function botaoAcelerar(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Velocidade/ });
}

// ---------------------------------------------------------------------------
// (a) Regra de toggle pura: fechamento em {1,2}, determinismo e involução.
// ---------------------------------------------------------------------------

describe('Property 18 — alternância de velocidade é determinística 1x/2x (regra pura)', () => {
  it('aplicar toggle N vezes a partir de 1 ou 2 produz apenas 1 ou 2 (fechamento no domínio)', () => {
    fc.assert(
      fc.property(fc.constantFrom<Speed>(1, 2), fc.integer({ min: 0, max: 50 }), (inicio, n) => {
        let s = inicio;
        for (let i = 0; i < n; i += 1) {
          s = toggle(s);
          expect(s === 1 || s === 2).toBe(true);
        }
      }),
    );
  });

  it('toggle é determinística: a mesma sequência de acionamentos sempre dá o mesmo resultado', () => {
    fc.assert(
      fc.property(fc.constantFrom<Speed>(1, 2), fc.integer({ min: 0, max: 50 }), (inicio, n) => {
        const run = (): Speed => {
          let s = inicio;
          for (let i = 0; i < n; i += 1) s = toggle(s);
          return s;
        };
        expect(run()).toBe(run());
        // Alternância determinística: N par preserva, N ímpar inverte.
        const esperado: Speed = n % 2 === 0 ? inicio : toggle(inicio);
        expect(run()).toBe(esperado);
      }),
    );
  });

  it('toggle é involutiva: aplicá-la duas vezes retorna ao valor inicial', () => {
    fc.assert(
      fc.property(fc.constantFrom<Speed>(1, 2), (inicio) => {
        expect(toggle(toggle(inicio))).toBe(inicio);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// (b) Fidelidade do componente ao `speed` controlado.
// ---------------------------------------------------------------------------

describe('Property 18 — o player reflete fielmente o speed controlado (1x/2x)', () => {
  it('speed=1: rótulo mostra 1x, aria-pressed=false; clique chama onToggleSpeed uma vez', async () => {
    const user = userEvent.setup();
    const onToggleSpeed = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenaUnica()}
        speed={1}
        species={speciesIndex()}
        onComplete={vi.fn()}
        onToggleSpeed={onToggleSpeed}
      />,
    );

    const botao = botaoAcelerar();
    expect(botao).toHaveTextContent('Velocidade 1x (alternar para 2x)');
    expect(botao.getAttribute('aria-pressed')).toBe('false');

    await user.click(botao);
    expect(onToggleSpeed).toHaveBeenCalledTimes(1);
  });

  it('speed=2: rótulo mostra 2x, aria-pressed=true; clique chama onToggleSpeed uma vez', async () => {
    const user = userEvent.setup();
    const onToggleSpeed = vi.fn();
    render(
      <AnimationPlayer
        scenes={cenaUnica()}
        speed={2}
        species={speciesIndex()}
        onComplete={vi.fn()}
        onToggleSpeed={onToggleSpeed}
      />,
    );

    const botao = botaoAcelerar();
    expect(botao).toHaveTextContent('Velocidade 2x (alternar para 1x)');
    expect(botao.getAttribute('aria-pressed')).toBe('true');

    await user.click(botao);
    expect(onToggleSpeed).toHaveBeenCalledTimes(1);
  });

  it('o rótulo e aria-pressed são função pura do speed corrente (ambos os valores do domínio)', () => {
    fc.assert(
      fc.property(fc.constantFrom<Speed>(1, 2), (speed) => {
        const { unmount } = render(
          <AnimationPlayer
            scenes={cenaUnica()}
            speed={speed}
            species={speciesIndex()}
            onComplete={vi.fn()}
            onToggleSpeed={vi.fn()}
          />,
        );

        const botao = botaoAcelerar();
        const outra = toggle(speed);
        expect(botao).toHaveTextContent(`Velocidade ${speed}x (alternar para ${outra}x)`);
        expect(botao.getAttribute('aria-pressed')).toBe(String(speed === 2));

        unmount();
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// (b, cont.) Laço controlado: K acionamentos reais produzem a alternância 1↔2.
// ---------------------------------------------------------------------------

describe('Property 18 — laço controlado produz a alternância determinística 1↔2', () => {
  it('clicar o controle K vezes gera exatamente a sequência de toggles a partir do speed inicial', () => {
    fc.assert(
      fc.property(fc.constantFrom<Speed>(1, 2), fc.integer({ min: 1, max: 8 }), (inicio, kliks) => {
        // Estado de velocidade controlado pelo "pai" simulado no teste.
        let speed: Speed = inicio;
        const sequenciaObservada: Speed[] = [];

        // onToggleSpeed aplica a regra pura; o teste re-renderiza com o novo speed.
        const onToggleSpeed = vi.fn(() => {
          speed = toggle(speed);
        });

        const { rerender, unmount } = render(
          <AnimationPlayer
            scenes={cenaUnica()}
            speed={speed}
            species={speciesIndex()}
            onComplete={vi.fn()}
            onToggleSpeed={onToggleSpeed}
          />,
        );

        const esperada: Speed[] = [];
        let modelo: Speed = inicio;

        for (let i = 0; i < kliks; i += 1) {
          // Acionamento síncrono do controle (equivalente a um clique real para
          // efeito de disparar o onClick que delega ao pai).
          fireEvent.click(botaoAcelerar());
          // Reflete no componente o novo speed decidido pelo pai (controlado).
          rerender(
            <AnimationPlayer
              scenes={cenaUnica()}
              speed={speed}
              species={speciesIndex()}
              onComplete={vi.fn()}
              onToggleSpeed={onToggleSpeed}
            />,
          );
          sequenciaObservada.push(speed);

          modelo = toggle(modelo);
          esperada.push(modelo);
        }

        // A sequência real de velocidades é exatamente a alternância 1↔2.
        expect(sequenciaObservada).toEqual(esperada);
        // Todos os valores pertencem ao domínio {1,2}.
        expect(sequenciaObservada.every((s) => s === 1 || s === 2)).toBe(true);
        // Uma chamada de toggle por clique.
        expect(onToggleSpeed).toHaveBeenCalledTimes(kliks);

        unmount();
      }),
      // 20 execuções mantêm a cobertura da alternância determinística reduzindo
      // o número de re-renders por propriedade sob contenção de CPU.
      { numRuns: 20 },
    );
  }, 30_000);
});
