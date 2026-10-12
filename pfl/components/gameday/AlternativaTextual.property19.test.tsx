// @vitest-environment jsdom

/**
 * Property 19 — spec `pfl-gameday-result-ui`, Task 13.4.
 *
 * **Alternativa_Textual equivale à narrativa do log, invariante ao modo de
 * reprodução.** A lista textual completa renderizada por `AlternativaTextual` é
 * função apenas das `scenes` (= do `Log_Partida`): pular, acelerar ou reproduzir
 * integralmente — ou seja, qualquer `currentIndex`, inclusive fora de faixa —
 * **não** altera a sequência de narrativas exibida. E essa sequência é
 * exatamente `scenes.map(s => s.narrative)`, na ordem do log, sem omissão,
 * reordenação ou duplicação (equivalência à narrativa do log).
 *
 * **Validates: Requirements 11.5, 17.4**
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import { AlternativaTextual } from './AlternativaTextual';
import type { Scene } from '@/lib/match';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Arbitrário mínimo de `Scene` — foca nos campos que a Alternativa_Textual lê
// (snap, narrative, warnings) e preenche o restante com valores plausíveis do
// domínio. Mantido pequeno (maxLength ~8) para velocidade.
// ---------------------------------------------------------------------------

const team: fc.Arbitrary<Scene['offense']> = fc.constantFrom('home', 'away');

const spriteRef = fc.record({ pokemonId: fc.integer({ min: 1, max: 999 }) });

/**
 * Narrativas arbitrárias incluindo string vazia, repetições e textos com
 * espaços — para exercitar a extração/igualdade sem assumir unicidade.
 */
const narrative: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constant('TD do time da casa'),
  fc.string({ maxLength: 40 }),
  fc.lorem({ maxCount: 4 }),
);

function sceneAt(index: number): fc.Arbitrary<Scene> {
  return fc.record({
    index: fc.constant(index),
    snap: fc.integer({ min: 0, max: 60 }),
    eventIndex: fc.integer({ min: 0, max: 200 }),
    offense: team,
    offenseSprites: fc.array(spriteRef, { maxLength: 4 }),
    defenseSprites: fc.array(spriteRef, { maxLength: 4 }),
    resultKind: fc.constantFrom('PLAY', 'PASS_COMPLETE', 'TURNOVER', 'INTERCEPTION'),
    narrative,
    warnings: fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
    durationHint: fc.integer({ min: 600, max: 2500 }),
  });
}

/** Sequência de cenas com `index` 0..N-1, como produziria `buildAnimationScenes`. */
const scenes: fc.Arbitrary<Scene[]> = fc
  .integer({ min: 1, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => sceneAt(i))))
  .map((arr) => arr as Scene[]);

// ---------------------------------------------------------------------------
// Extração: lê a sequência de narrativas da lista completa renderizada.
//
// Cada `<li class="pfl-alt-textual__item">` tem o formato:
//   <span class="pfl-alt-textual__rotulo-snap">Snap N:</span>{' '}{narrative}
//   [<ul class="pfl-alt-textual__avisos">…</ul>]
// A narrativa é o conteúdo textual do item EXCLUINDO o rótulo do snap e a lista
// de avisos; o espaço separador líder é removido com um único trim à esquerda.
// ---------------------------------------------------------------------------

function extractNarratives(container: HTMLElement): string[] {
  const items = Array.from(
    container.querySelectorAll<HTMLLIElement>('ol.pfl-alt-textual__lista > li.pfl-alt-textual__item'),
  );

  return items.map((item) => {
    let text = '';
    for (const node of Array.from(item.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        // Ignora o rótulo "Snap N:" e a sublista de avisos; qualquer outro
        // elemento (não há, por construção) contribuiria com seu texto.
        if (
          el.classList.contains('pfl-alt-textual__rotulo-snap') ||
          el.classList.contains('pfl-alt-textual__avisos')
        ) {
          continue;
        }
        text += el.textContent ?? '';
      }
    }
    // Remove o único espaço separador que o componente insere via `{' '}`.
    return text.replace(/^ /, '');
  });
}

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

describe('AlternativaTextual — Property 19 (narrativa equivale ao log, invariante ao modo)', () => {
  it('a sequência de narrativas da lista completa é igual a scenes.map(s=>s.narrative) e invariante a currentIndex', () => {
    fc.assert(
      fc.property(scenes, (scene) => {
        const esperado = scene.map((s) => s.narrative);

        // Índices que simulam "reproduzido integralmente" (0, meio, fim) e modos
        // alternativos (pulado/acelerado) via valores fora de faixa.
        const meio = Math.floor((scene.length - 1) / 2);
        const indices = [-1, 0, meio, scene.length - 1, scene.length + 5];

        for (const idx of indices) {
          const { container, unmount } = render(
            <AlternativaTextual scenes={scene} currentIndex={idx} />,
          );
          const extraido = extractNarratives(container);

          // Equivalência à narrativa do log (R17.4): mesma sequência, mesma
          // ordem, sem omissão/reordenação/duplicação.
          expect(extraido).toEqual(esperado);

          // Invariância ao modo de reprodução (R11.5): o conteúdo não depende de
          // `currentIndex` — já garantido por igualar sempre o mesmo `esperado`.
          unmount();
        }

        return true;
      }),
      // Cada execução renderiza o componente ~5 vezes; 20 execuções preservam a
      // variedade de entradas enquanto cortam o custo de render sob contenção.
      { numRuns: 20 },
    );
  }, 30_000);
});
