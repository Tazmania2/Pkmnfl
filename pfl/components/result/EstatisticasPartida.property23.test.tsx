// @vitest-environment jsdom

/**
 * Property 23 — Estatísticas exibidas igualam `GameStats` do log (Task 15.2),
 * componente sob teste `components/result/EstatisticasPartida.tsx`.
 *
 * // Feature: pfl-gameday-result-ui, Property 23: Estatísticas exibidas igualam
 * // `GameStats` do log
 *
 * **Validates: Requirements 14.1**
 *
 * `EstatisticasPartida` recebe o `GameStats` do `Log_Partida` (`log.stats`) e o
 * renderiza verbatim num `<dl>` — corridas (tentativas/jardas), passes
 * (completos/tentativas, jardas, interceptações), turnovers e faltas —, **sem
 * recalcular nem fabricar números** (R14.1, R14.3). Esta propriedade gera um
 * `GameStats` arbitrário (campos inteiros não-negativos; `scoringSummary` pode
 * ser `[]`), renderiza o componente e assevera que cada valor numérico exibido
 * é **exatamente** o campo correspondente do `GameStats` de entrada — nada é
 * transformado nem inventado. O composto "completos / tentativas" é verificado
 * em conjunto para garantir que ambos vêm diretamente de `passes`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import fc from 'fast-check';

import { EstatisticasPartida } from './EstatisticasPartida';
import type { GameStats } from '@/lib/match';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Arbitrário autossuficiente de GameStats
// ---------------------------------------------------------------------------

/** Inteiro não-negativo numa faixa generosa, cobrindo 0 e valores de vários dígitos. */
const countArb: fc.Arbitrary<number> = fc.nat({ max: 999 });

const gameStatsArb: fc.Arbitrary<GameStats> = fc.record({
  rushes: fc.record({ attempts: countArb, yards: countArb }),
  passes: fc.record({
    attempts: countArb,
    completions: countArb,
    yards: countArb,
    interceptions: countArb,
  }),
  turnovers: countArb,
  fouls: countArb,
  // O componente não lê `scoringSummary`; a lista vazia é suficiente e válida.
  scoringSummary: fc.constant([]),
});

/**
 * Lê o `<dd>` associado a um `<dt>` cujo texto corresponde a `label`, dentro de
 * um `<div.estatisticas__item>`. Retorna o texto renderizado (verbatim) do valor.
 */
function readValue(container: HTMLElement, label: string): string {
  const items = Array.from(
    container.querySelectorAll<HTMLElement>('.estatisticas__item'),
  );
  const item = items.find((el) => el.querySelector('dt')?.textContent === label);
  if (!item) {
    throw new Error(`Item com rótulo "${label}" não encontrado`);
  }
  const dd = item.querySelector('dd');
  if (!dd) {
    throw new Error(`Valor (<dd>) ausente para o rótulo "${label}"`);
  }
  return dd.textContent ?? '';
}

describe('Property 23 — estatísticas exibidas igualam GameStats do log', () => {
  it('exibe cada métrica verbatim do GameStats, sem transformar nem inventar', () => {
    fc.assert(
      fc.property(gameStatsArb, (stats) => {
        const { container } = render(<EstatisticasPartida stats={stats} />);

        // Cada valor numérico exibido == campo correspondente do GameStats (R14.1).
        expect(readValue(container, 'Corridas (tentativas)')).toBe(
          String(stats.rushes.attempts),
        );
        expect(readValue(container, 'Corridas (jardas)')).toBe(
          String(stats.rushes.yards),
        );
        expect(readValue(container, 'Passes (completos / tentativas)')).toBe(
          `${stats.passes.completions} / ${stats.passes.attempts}`,
        );
        expect(readValue(container, 'Passes (jardas)')).toBe(
          String(stats.passes.yards),
        );
        expect(readValue(container, 'Interceptações')).toBe(
          String(stats.passes.interceptions),
        );
        expect(readValue(container, 'Turnovers')).toBe(String(stats.turnovers));
        expect(readValue(container, 'Faltas')).toBe(String(stats.fouls));

        // Reforço do composto: ambos completions e attempts aparecem no texto do
        // mesmo <dd>, assegurando que nenhum número foi fabricado nem omitido.
        const passesItem = Array.from(
          container.querySelectorAll<HTMLElement>('.estatisticas__item'),
        ).find(
          (el) =>
            el.querySelector('dt')?.textContent ===
            'Passes (completos / tentativas)',
        )!;
        const dd = within(passesItem).getByText(
          `${stats.passes.completions} / ${stats.passes.attempts}`,
        );
        expect(dd).toBeInTheDocument();

        cleanup();
      }),
    );
  });
});
