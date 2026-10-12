import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { addAthlete, loadEmpty, ROSTER_CAP } from './store';
import type { AthleteDraft } from './model';

/**
 * Teste de propriedade: teto do roster nunca excedido (Task 1.4).
 *
 * // Feature: pfl-team-strategy-ui, Property 4: Teto do roster nunca excedido
 *
 * **Validates: Requirements 2.3, 2.4**
 *
 * *Para toda* sequência de adições, o tamanho do roster nunca excede
 * {@link ROSTER_CAP} (53). Qualquer adição que levaria o total acima de 53 é
 * **recusada**, preservando o roster existente inalterado. Em particular, a
 * 54ª adição é recusada e as 53 entradas anteriores permanecem idênticas em
 * conteúdo e ordem.
 *
 * O teste exercita apenas o nível da store (`addAthlete`), sem rede nem I/O:
 * parte de `loadEmpty()` e aplica uma sequência de atletas gerados.
 */

/** Gera uma `AthleteDraft` plausível (campos não restritos por esta propriedade). */
function athleteArb(): fc.Arbitrary<AthleteDraft> {
  return fc.record({
    instanceId: fc.integer({ min: 1, max: 1_000_000 }),
    pokemonId: fc.integer({ min: 1, max: 151 }),
    abilityId: fc.integer({ min: 1, max: 50 }),
    moveIds: fc.array(fc.integer({ min: 1, max: 200 }), {
      minLength: 4,
      maxLength: 4,
    }),
    positionDesignation: fc.string(),
  });
}

describe('Feature: pfl-team-strategy-ui, Property 4: Teto do roster nunca excedido', () => {
  it('addAthlete nunca faz o roster crescer além de ROSTER_CAP (R2.3, R2.4)', () => {
    fc.assert(
      fc.property(
        // Gera mais atletas do que o teto para forçar recusas (até ~2x o cap).
        fc.array(athleteArb(), { minLength: 0, maxLength: ROSTER_CAP * 2 }),
        (athletes) => {
          let draft = loadEmpty();

          for (const athlete of athletes) {
            draft = addAthlete(draft, athlete);
            // Invariante: o tamanho nunca ultrapassa o teto.
            expect(draft.roster.length).toBeLessThanOrEqual(ROSTER_CAP);
          }

          // Tamanho final é o mínimo entre total ofertado e o teto.
          expect(draft.roster.length).toBe(
            Math.min(athletes.length, ROSTER_CAP),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a 54ª adição é recusada e preserva as 53 entradas existentes (R2.4)', () => {
    fc.assert(
      fc.property(
        // Exatamente ROSTER_CAP atletas para preencher o roster...
        fc.array(athleteArb(), {
          minLength: ROSTER_CAP,
          maxLength: ROSTER_CAP,
        }),
        // ...e um atleta extra cuja adição deve ser recusada.
        athleteArb(),
        (filling, extra) => {
          let draft = loadEmpty();
          for (const athlete of filling) {
            draft = addAthlete(draft, athlete);
          }

          // Roster cheio no teto.
          expect(draft.roster.length).toBe(ROSTER_CAP);
          const before = draft.roster;

          // Tenta a 54ª adição: deve ser recusada.
          const after = addAthlete(draft, extra).roster;

          // Tamanho preservado no teto.
          expect(after.length).toBe(ROSTER_CAP);
          // Entradas preservadas em conteúdo e ordem.
          expect(after).toEqual(before);
          // O extra não aparece no roster.
          expect(after.some((a) => a === extra)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
