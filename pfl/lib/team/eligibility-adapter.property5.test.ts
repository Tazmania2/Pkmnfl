import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { AbilityRecord, MoveRecord } from '../catalog/types';
import {
  resolveEligibilitySnapshot,
  type EligibilitySource,
} from './eligibility-adapter';

/**
 * Teste de propriedade da restrição de espécies ao conjunto permitido
 * (Task 2.2).
 *
 * // Feature: pfl-team-strategy-ui, Property 5: Seleção de espécies restrita ao conjunto permitido
 *
 * **Validates: Requirements 2.5, 2.6**
 *
 * Enunciado (design): *para qualquer* catálogo, as opções de espécie oferecidas
 * para novas instâncias são exatamente `getAllowedSpecies`; e *para qualquer*
 * `pokemon_id`, adicionar uma instância é aceito se e somente se o id pertence a
 * esse conjunto — caso contrário produz `SPECIES_NOT_ALLOWED` identificando a
 * espécie.
 *
 * `validateRoster` (que emite `SPECIES_NOT_ALLOWED`) pertence à Task 4.2, ainda
 * **não** implementada. Esta propriedade valida o que já existe: o adaptador de
 * elegibilidade (`resolveEligibilitySnapshot`). Ela demonstra que
 *
 * 1. o conjunto `snapshot.allowedSpecies` espelha **exatamente** o conjunto
 *    `allowedSpeciesIds` da {@link EligibilitySource} mockada (fidelidade do
 *    catálogo, R2.5); e
 * 2. a pertinência a `snapshot.allowedSpecies` é o **critério exato** de
 *    aceitação/recusa de qualquer `pokemon_id` (base do futuro
 *    `SPECIES_NOT_ALLOWED`, R2.6): aceito ⇔ `id ∈ allowedSpecies`.
 *
 * A `Camada_Leitura` é mockada em memória pela {@link EligibilitySource} — sem
 * rede, sem I/O real.
 */

/**
 * Fonte de elegibilidade em memória para o teste. `allowedSpeciesIds` devolve o
 * conjunto gerado; as demais consultas são projetadas a partir de mapas simples.
 * Golpes/habilidades inexistentes resolvem `null`; espécies sem relação resolvem
 * o conjunto vazio — exatamente o contrato documentado da fonte.
 */
function createFakeSource(spec: {
  allowed: ReadonlySet<number>;
  learnable?: ReadonlyMap<number, ReadonlySet<number>>;
  abilities?: ReadonlyMap<number, ReadonlySet<number>>;
  moves?: ReadonlyMap<number, MoveRecord>;
  abilityRecords?: ReadonlyMap<number, AbilityRecord>;
}): EligibilitySource {
  return {
    allowedSpeciesIds(): Promise<Set<number>> {
      // Devolve uma cópia defensiva para garantir que o adaptador não dependa
      // de aliasing com a estrutura interna da fonte.
      return Promise.resolve(new Set(spec.allowed));
    },
    learnableMoveIds(pokemonId: number): Promise<Set<number>> {
      return Promise.resolve(new Set(spec.learnable?.get(pokemonId) ?? []));
    },
    availableAbilityIds(pokemonId: number): Promise<Set<number>> {
      return Promise.resolve(new Set(spec.abilities?.get(pokemonId) ?? []));
    },
    move(moveId: number): Promise<MoveRecord | null> {
      return Promise.resolve(spec.moves?.get(moveId) ?? null);
    },
    ability(abilityId: number): Promise<AbilityRecord | null> {
      return Promise.resolve(spec.abilityRecords?.get(abilityId) ?? null);
    },
  };
}

/**
 * Gera um "catálogo": um conjunto de `pokemon_id` permitidos. Pode ser vazio
 * (nenhuma espécie permitida) para exercitar o caso-limite em que toda adição é
 * recusada.
 */
function allowedArb(): fc.Arbitrary<Set<number>> {
  return fc
    .uniqueArray(fc.integer({ min: 1, max: 151 }), { minLength: 0, maxLength: 20 })
    .map((ids) => new Set(ids));
}

describe('Feature: pfl-team-strategy-ui, Property 5: Seleção de espécies restrita ao conjunto permitido', () => {
  it('o snapshot espelha exatamente o conjunto permitido da fonte (R2.5)', async () => {
    await fc.assert(
      fc.asyncProperty(allowedArb(), async (allowed) => {
        const source = createFakeSource({ allowed });

        // As espécies solicitadas no snapshot são justamente as do roster em
        // edição; aqui pedimos as permitidas e algumas fora para garantir que o
        // conjunto `allowedSpecies` não depende do que foi solicitado.
        const requested = [...allowed, 900, 901, 902];
        const snapshot = await resolveEligibilitySnapshot(source, {
          pokemonIds: requested,
        });

        // Igualdade de conjuntos: mesmos tamanhos e mesma pertinência.
        expect(snapshot.allowedSpecies.size).toBe(allowed.size);
        for (const id of allowed) {
          expect(snapshot.allowedSpecies.has(id)).toBe(true);
        }
        // Nenhum id extra foi inventado pelo adaptador.
        for (const id of snapshot.allowedSpecies) {
          expect(allowed.has(id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('pertinência a allowedSpecies é o critério exato de aceitação/recusa (R2.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        allowedArb(),
        // Candidatos a adicionar, cobrindo ids dentro e fora do intervalo gerado.
        fc.uniqueArray(fc.integer({ min: 1, max: 999 }), {
          minLength: 1,
          maxLength: 15,
        }),
        async (allowed, candidates) => {
          const source = createFakeSource({ allowed });
          const snapshot = await resolveEligibilitySnapshot(source, {
            pokemonIds: candidates,
          });

          /**
           * Oráculo da aceitação, derivado diretamente do design:
           * adicionar uma instância é aceito se e somente se seu `pokemon_id`
           * pertence ao conjunto permitido. Caso contrário, a adição é recusada
           * (futuro `SPECIES_NOT_ALLOWED` identificando a espécie em 4.2).
           */
          const accepts = (pokemonId: number): boolean =>
            snapshot.allowedSpecies.has(pokemonId);

          for (const id of candidates) {
            // O veredito de aceitação coincide, bit a bit, com a pertinência ao
            // conjunto permitido independente da origem (R2.6): sem exceções,
            // sem falsos positivos nem falsos negativos.
            expect(accepts(id)).toBe(allowed.has(id));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
