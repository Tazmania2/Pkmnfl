import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { loadEmpty, setOffenseStyle, setDefenseStyle } from './store';
import { OFFENSE_PLAYS, DEFENSE_PLAYS, type TeamDraft } from './model';

/**
 * Teste de propriedade: estilos registrados na estratégia (Task 1.6).
 *
 * // Feature: pfl-team-strategy-ui, Property 14: Estilos registrados na estratégia
 *
 * **Validates: Requirements 11.2, 11.3**
 *
 * *Para qualquer* valor de estilo, `setOffenseStyle`/`setDefenseStyle`
 * registram o valor selecionado na `StrategyDraft`
 * (`strategy.offenseStyle` / `strategy.defenseStyle`), devolvendo sempre um
 * **novo** `TeamDraft` sem mutar o anterior e sem perturbar os demais campos da
 * estratégia (prioridades de jogada e o outro estilo).
 *
 * Nenhum DOM, rede ou I/O: as transições da store são funções puras.
 */

/** Snapshot imutável de um draft para comparar antes/depois (detecta mutação). */
function snapshot(draft: TeamDraft): string {
  return JSON.stringify(draft);
}

/** Gera um draft inicial variado para exercitar diferentes pontos de partida. */
function draftArb(): fc.Arbitrary<TeamDraft> {
  return fc.record({
    name: fc.string(),
    offenseStyle: fc.string(),
    defenseStyle: fc.string(),
    // Prioridades geradas como permutações completas dos conjuntos fixos, para
    // refletir um estado de estratégia realista que não pode ser perturbado.
    offensePlayPriority: fc.shuffledSubarray([...OFFENSE_PLAYS], {
      minLength: OFFENSE_PLAYS.length,
      maxLength: OFFENSE_PLAYS.length,
    }),
    defensePlayPriority: fc.shuffledSubarray([...DEFENSE_PLAYS], {
      minLength: DEFENSE_PLAYS.length,
      maxLength: DEFENSE_PLAYS.length,
    }),
  }).map(({ name, offenseStyle, defenseStyle, offensePlayPriority, defensePlayPriority }) => {
    const base = loadEmpty(name);
    return {
      ...base,
      strategy: {
        offenseStyle,
        defenseStyle,
        offensePlayPriority,
        defensePlayPriority,
      },
    };
  });
}

/** Valores de estilo possíveis, incluindo vazio e strings arbitrárias. */
const styleArb = fc.string();

describe('Feature: pfl-team-strategy-ui, Property 14: Estilos registrados na estratégia', () => {
  it('setOffenseStyle registra offenseStyle sem mutar nem perturbar os demais campos (R11.2)', () => {
    fc.assert(
      fc.property(draftArb(), styleArb, (draft, style) => {
        const before = snapshot(draft);
        const next = setOffenseStyle(draft, style);

        // Registra o estilo selecionado.
        expect(next.strategy.offenseStyle).toBe(style);

        // Não muta o draft anterior (nova referência, conteúdo preservado).
        expect(next).not.toBe(draft);
        expect(snapshot(draft)).toBe(before);

        // Não perturba os demais campos da estratégia.
        expect(next.strategy.defenseStyle).toBe(draft.strategy.defenseStyle);
        expect(next.strategy.offensePlayPriority).toEqual(
          draft.strategy.offensePlayPriority,
        );
        expect(next.strategy.defensePlayPriority).toEqual(
          draft.strategy.defensePlayPriority,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('setDefenseStyle registra defenseStyle sem mutar nem perturbar os demais campos (R11.3)', () => {
    fc.assert(
      fc.property(draftArb(), styleArb, (draft, style) => {
        const before = snapshot(draft);
        const next = setDefenseStyle(draft, style);

        // Registra o estilo selecionado.
        expect(next.strategy.defenseStyle).toBe(style);

        // Não muta o draft anterior.
        expect(next).not.toBe(draft);
        expect(snapshot(draft)).toBe(before);

        // Não perturba os demais campos da estratégia.
        expect(next.strategy.offenseStyle).toBe(draft.strategy.offenseStyle);
        expect(next.strategy.offensePlayPriority).toEqual(
          draft.strategy.offensePlayPriority,
        );
        expect(next.strategy.defensePlayPriority).toEqual(
          draft.strategy.defensePlayPriority,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('setOffenseStyle e setDefenseStyle são independentes e compõem sem interferência', () => {
    fc.assert(
      fc.property(draftArb(), styleArb, styleArb, (draft, offStyle, defStyle) => {
        // Aplicar um estilo e depois o outro registra ambos, preservando as
        // prioridades de jogada do draft original.
        const afterOffense = setOffenseStyle(draft, offStyle);
        const afterBoth = setDefenseStyle(afterOffense, defStyle);

        expect(afterBoth.strategy.offenseStyle).toBe(offStyle);
        expect(afterBoth.strategy.defenseStyle).toBe(defStyle);
        expect(afterBoth.strategy.offensePlayPriority).toEqual(
          draft.strategy.offensePlayPriority,
        );
        expect(afterBoth.strategy.defensePlayPriority).toEqual(
          draft.strategy.defensePlayPriority,
        );
      }),
      { numRuns: 100 },
    );
  });
});
