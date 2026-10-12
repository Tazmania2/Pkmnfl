import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadEmpty,
  reorderOffensePlays,
  reorderDefensePlays,
} from './store';
import { OFFENSE_PLAYS, DEFENSE_PLAYS, type PlayId } from './model';

// Feature: pfl-team-strategy-ui, Property 13: Priorização de jogadas é uma permutação do conjunto fixo

/**
 * Property test de priorização de jogadas (Task 1.5).
 *
 * **Feature: pfl-team-strategy-ui, Property 13: Priorização de jogadas é uma permutação do conjunto fixo**
 *
 * **Validates: Requirements 12.3, 12.4**
 *
 * Para qualquer reordenação solicitada, a prioridade registrada é uma
 * permutação exata do conjunto de seis jogadas do lado (`OFFENSE_PLAYS` para
 * ataque, `DEFENSE_PLAYS` para defesa): mesmos elementos, sem perda nem
 * duplicação, na ordem solicitada. `reorderOffensePlays`/`reorderDefensePlays`
 * aceitam uma permutação válida e a registram; uma entrada que não é permutação
 * (duplicata, omissão ou id estrangeiro) é recusada e o estado anterior é
 * preservado.
 */

/** Verdadeiro sse `a` e `b` têm os mesmos elementos como multiconjunto. */
function sameMultiset<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (xs: readonly T[]) => [...xs].sort();
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/** Verdadeiro sse `order` é permutação exata de `expected` (sem repetir/omitir). */
function isExactPermutation(
  order: readonly PlayId[],
  expected: readonly PlayId[],
): boolean {
  return sameMultiset(order, expected);
}

/** Gera uma permutação arbitrária do conjunto fixo informado. */
function permutationArb(expected: readonly PlayId[]): fc.Arbitrary<PlayId[]> {
  return fc
    .shuffledSubarray([...expected], {
      minLength: expected.length,
      maxLength: expected.length,
    })
    .map((xs) => [...xs]);
}

/** Ids estrangeiros que nunca pertencem a nenhum conjunto fixo. */
const FOREIGN_IDS = ['X_FAKE', 'Z_UNKNOWN', 'O_FOO', 'D_BAR'] as string[] as PlayId[];

/**
 * Gera uma ordem inválida (não-permutação) do conjunto fixo informado:
 * duplicata, omissão, id estrangeiro, ou lista de tamanho errado. Garante que o
 * resultado nunca seja, por acaso, uma permutação válida.
 */
function nonPermutationArb(expected: readonly PlayId[]): fc.Arbitrary<PlayId[]> {
  const base = [...expected];
  const variants: fc.Arbitrary<PlayId[]>[] = [
    // Duplicata: repete o primeiro id, descartando o último (mesmo tamanho).
    fc.constant([base[0]!, ...base.slice(0, base.length - 1)]),
    // Omissão: remove um elemento (tamanho menor).
    fc.integer({ min: 0, max: base.length - 1 }).map((i) =>
      base.filter((_, idx) => idx !== i),
    ),
    // Id estrangeiro no lugar de um existente.
    fc
      .tuple(
        fc.integer({ min: 0, max: base.length - 1 }),
        fc.constantFrom(...FOREIGN_IDS),
      )
      .map(([i, foreign]) => base.map((id, idx) => (idx === i ? foreign : id))),
    // Lista vazia.
    fc.constant([] as PlayId[]),
    // Conjunto do lado oposto (ids válidos, porém do outro conjunto).
    fc.constant(
      (expected === OFFENSE_PLAYS ? DEFENSE_PLAYS : OFFENSE_PLAYS).slice() as PlayId[],
    ),
  ];
  return fc
    .oneof(...variants)
    .filter((order) => !isExactPermutation(order, expected));
}

describe('Feature: pfl-team-strategy-ui, Property 13: Priorização de jogadas é uma permutação do conjunto fixo', () => {
  it('reorderOffensePlays aceita qualquer permutação e a registra na ordem solicitada (R12.3)', () => {
    fc.assert(
      fc.property(permutationArb(OFFENSE_PLAYS), (order) => {
        const draft = reorderOffensePlays(loadEmpty(), order);
        const registered = draft.strategy.offensePlayPriority;

        // Registrada exatamente na ordem solicitada.
        expect(registered).toEqual(order);
        // É permutação exata do conjunto fixo: mesmos ids, sem repetir/omitir.
        expect(isExactPermutation(registered, OFFENSE_PLAYS)).toBe(true);
        expect(new Set(registered).size).toBe(OFFENSE_PLAYS.length);
      }),
      { numRuns: 100 },
    );
  });

  it('reorderDefensePlays aceita qualquer permutação e a registra na ordem solicitada (R12.4)', () => {
    fc.assert(
      fc.property(permutationArb(DEFENSE_PLAYS), (order) => {
        const draft = reorderDefensePlays(loadEmpty(), order);
        const registered = draft.strategy.defensePlayPriority;

        expect(registered).toEqual(order);
        expect(isExactPermutation(registered, DEFENSE_PLAYS)).toBe(true);
        expect(new Set(registered).size).toBe(DEFENSE_PLAYS.length);
      }),
      { numRuns: 100 },
    );
  });

  it('reorderOffensePlays recusa uma não-permutação e preserva o estado anterior (R12.3)', () => {
    fc.assert(
      fc.property(
        permutationArb(OFFENSE_PLAYS),
        nonPermutationArb(OFFENSE_PLAYS),
        (seed, invalid) => {
          // Estado anterior: uma prioridade válida já registrada.
          const before = reorderOffensePlays(loadEmpty(), seed);
          const after = reorderOffensePlays(before, invalid);

          // A ordem inválida não é adotada; a prioridade anterior é preservada.
          expect(after.strategy.offensePlayPriority).toEqual(
            before.strategy.offensePlayPriority,
          );
          // Segue sendo uma permutação exata do conjunto fixo.
          expect(
            isExactPermutation(after.strategy.offensePlayPriority, OFFENSE_PLAYS),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reorderDefensePlays recusa uma não-permutação e preserva o estado anterior (R12.4)', () => {
    fc.assert(
      fc.property(
        permutationArb(DEFENSE_PLAYS),
        nonPermutationArb(DEFENSE_PLAYS),
        (seed, invalid) => {
          const before = reorderDefensePlays(loadEmpty(), seed);
          const after = reorderDefensePlays(before, invalid);

          expect(after.strategy.defensePlayPriority).toEqual(
            before.strategy.defensePlayPriority,
          );
          expect(
            isExactPermutation(after.strategy.defensePlayPriority, DEFENSE_PLAYS),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
