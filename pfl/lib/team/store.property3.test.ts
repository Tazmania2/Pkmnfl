import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { addAthlete, loadEmpty, ROSTER_CAP } from './store';
import type { AthleteDraft, TeamDraft } from './model';

/**
 * Teste de propriedade: instâncias distintas e duplicatas de espécie (Task 1.3).
 *
 * // Feature: pfl-team-strategy-ui, Property 3: Instâncias distintas, inclusive duplicatas de espécie
 *
 * **Validates: Requirements 2.1, 2.2**
 *
 * *Para qualquer* roster, cada `AthleteDraft` ocupa uma vaga distinta
 * identificada por `instanceId` único; quando dois ou mais atletas
 * compartilham o mesmo `pokemonId`, o número de vagas ocupadas é igual ao
 * número de instâncias (nenhuma deduplicação por espécie).
 *
 * A propriedade exercita o módulo puro `store.ts` montando um roster a partir
 * de `loadEmpty` e aplicando `addAthlete` em sequência. Cada atleta gerado tem
 * um `instanceId` único (as identidades são distintas por construção), mas o
 * `pokemonId` é sorteado de um conjunto pequeno para forçar duplicatas de
 * espécie com alta frequência. Nenhum I/O é realizado.
 */

/**
 * Gera uma sequência de atletas com `instanceId` únicos e `pokemonId` sorteado
 * de um conjunto pequeno (1..6), de modo que duplicatas de espécie sejam
 * frequentes. O tamanho fica dentro do `ROSTER_CAP` para isolar a propriedade
 * de instâncias/duplicatas da regra de teto (coberta pela Property 4).
 */
function athletesArb(): fc.Arbitrary<AthleteDraft[]> {
  return fc
    .uniqueArray(fc.integer({ min: 0, max: 100_000 }), {
      minLength: 0,
      maxLength: ROSTER_CAP,
    })
    .chain((instanceIds) =>
      fc.tuple(
        ...instanceIds.map((instanceId) =>
          fc.record<AthleteDraft>({
            instanceId: fc.constant(instanceId),
            // Conjunto pequeno de espécies -> duplicatas de pokemonId frequentes.
            pokemonId: fc.integer({ min: 1, max: 6 }),
            abilityId: fc.integer({ min: 1, max: 20 }),
            moveIds: fc.uniqueArray(fc.integer({ min: 1, max: 50 }), {
              minLength: 4,
              maxLength: 4,
            }),
            positionDesignation: fc.constantFrom('QB', 'RB', 'WR', 'LB', 'CB'),
          }),
        ),
      ),
    );
}

/** Aplica `addAthlete` em sequência a partir de um draft vazio. */
function buildRoster(athletes: AthleteDraft[]): TeamDraft {
  return athletes.reduce<TeamDraft>(
    (draft, athlete) => addAthlete(draft, athlete),
    loadEmpty('Property3'),
  );
}

describe('Feature: pfl-team-strategy-ui, Property 3: Instâncias distintas, inclusive duplicatas de espécie', () => {
  it('cada atleta ocupa uma vaga distinta por instanceId único (R2.1)', () => {
    fc.assert(
      fc.property(athletesArb(), (athletes) => {
        const draft = buildRoster(athletes);

        // Uma vaga por adição: nenhuma deduplicação por espécie.
        expect(draft.roster.length).toBe(athletes.length);

        // Todos os instanceId são distintos (identidade única por vaga).
        const ids = draft.roster.map((a) => a.instanceId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 100 },
    );
  });

  it('duplicatas de pokemonId ocupam vagas separadas, sem dedup por espécie (R2.2)', () => {
    fc.assert(
      fc.property(athletesArb(), (athletes) => {
        const draft = buildRoster(athletes);

        // Para cada espécie, o nº de vagas ocupadas == nº de instâncias geradas.
        const expectedPerSpecies = new Map<number, number>();
        for (const a of athletes) {
          expectedPerSpecies.set(
            a.pokemonId,
            (expectedPerSpecies.get(a.pokemonId) ?? 0) + 1,
          );
        }

        const actualPerSpecies = new Map<number, number>();
        for (const a of draft.roster) {
          actualPerSpecies.set(
            a.pokemonId,
            (actualPerSpecies.get(a.pokemonId) ?? 0) + 1,
          );
        }

        expect(actualPerSpecies).toEqual(expectedPerSpecies);

        // Cada instância preserva sua identidade: o instanceId gerado continua
        // mapeado ao mesmo pokemonId no roster (nenhuma fusão de instâncias).
        const byInstance = new Map(
          draft.roster.map((a) => [a.instanceId, a.pokemonId]),
        );
        for (const a of athletes) {
          expect(byInstance.get(a.instanceId)).toBe(a.pokemonId);
        }
      }),
      { numRuns: 100 },
    );
  });
});
