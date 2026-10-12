import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  checkLearnableMoveIntegrity,
  checkPokemonAbilityIntegrity,
  VALIDATION_CHECKS,
  type CatalogIds,
  type LearnableMoveRef,
  type PokemonAbilityRef,
} from './validate';

// Feature: pfl-data-catalog, Property 10: Validação detecta integridade referencial

/**
 * Teste de propriedade de integridade referencial do Processo_Validacao_Pos_Ingestao
 * (Task 7.5).
 *
 * **Feature: pfl-data-catalog, Property 10: Validação detecta integridade referencial**
 *
 * **Validates: Requirements 8.3, 8.4**
 *
 * Para qualquer estado do banco, a validação aprova a integridade referencial se
 * e somente se toda relação de golpe aprendível referencia um `move_id` e um
 * `pokemon_id` existentes, e toda relação de habilidade referencia um
 * `ability_id` e um `pokemon_id` existentes; qualquer relação órfã é detectada e
 * reportada com seus identificadores.
 *
 * Estratégia: geram-se conjuntos de ids de catálogo (`species`, `moves`,
 * `abilities`) e listas de relações cujos ids podem ou não pertencer a esses
 * conjuntos. O conjunto esperado de relações órfãs (e seus identificadores) é
 * calculado de forma independente da implementação — apenas com pertinência de
 * conjunto — e comparado com os `ValidationIssue` reportados.
 */

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

/**
 * Gera um conjunto de ids de catálogo (podendo ser vazio) dentro de um intervalo
 * controlado, de modo que relações possam cair dentro ou fora dele.
 */
const idSetArb = fc.uniqueArray(fc.integer({ min: 1, max: 60 }), {
  maxLength: 40,
});

const catalogArb: fc.Arbitrary<CatalogIds> = fc
  .record({
    species: idSetArb,
    moves: idSetArb,
    abilities: idSetArb,
  })
  .map(({ species, moves, abilities }) => ({
    species: new Set(species),
    moves: new Set(moves),
    abilities: new Set(abilities),
  }));

/**
 * Relação de golpe cujos ids são amostrados num intervalo que extrapola o
 * domínio dos conjuntos de catálogo (1..60), garantindo que órfãs sejam geradas
 * com frequência razoável.
 */
const learnableRefArb: fc.Arbitrary<LearnableMoveRef> = fc.record({
  pokemon_id: fc.integer({ min: 1, max: 80 }),
  move_id: fc.integer({ min: 1, max: 80 }),
});

const abilityRefArb: fc.Arbitrary<PokemonAbilityRef> = fc.record({
  pokemon_id: fc.integer({ min: 1, max: 80 }),
  ability_id: fc.integer({ min: 1, max: 80 }),
});

// ---------------------------------------------------------------------------
// Oráculos independentes (apenas pertinência de conjunto)
// ---------------------------------------------------------------------------

/** Uma relação de golpe é órfã se o pokemon_id OU o move_id não existe. */
function isLearnableOrphan(
  relation: LearnableMoveRef,
  catalogs: CatalogIds,
): boolean {
  return (
    !catalogs.species.has(relation.pokemon_id) ||
    !catalogs.moves.has(relation.move_id)
  );
}

/** Uma relação de habilidade é órfã se o pokemon_id OU o ability_id não existe. */
function isAbilityOrphan(
  relation: PokemonAbilityRef,
  catalogs: CatalogIds,
): boolean {
  return (
    !catalogs.species.has(relation.pokemon_id) ||
    !catalogs.abilities.has(relation.ability_id)
  );
}

// ---------------------------------------------------------------------------
// Propriedade — golpes aprendíveis (Req. 8.3)
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Property 10: Validação detecta integridade referencial', () => {
  it('aprova iff toda relação de golpe tem FKs existentes e reporta cada órfã (R8.3)', () => {
    fc.assert(
      fc.property(
        fc.array(learnableRefArb, { maxLength: 40 }),
        catalogArb,
        (relations, catalogs) => {
          const issues = checkLearnableMoveIntegrity(relations, catalogs);

          const expectedOrphans = relations.filter((r) =>
            isLearnableOrphan(r, catalogs),
          );

          // Bicondicional: aprova (sem issues) sse não há relação órfã.
          expect(issues.length === 0).toBe(expectedOrphans.length === 0);

          // Um issue por relação órfã, na mesma ordem das relações de entrada.
          expect(issues).toHaveLength(expectedOrphans.length);

          for (let i = 0; i < expectedOrphans.length; i += 1) {
            const orphan = expectedOrphans[i]!;
            const issue = issues[i]!;
            expect(issue.check).toBe(VALIDATION_CHECKS.learnableMoveFk);
            // Reporta exatamente os identificadores da relação órfã.
            expect(issue.ids).toEqual([orphan.pokemon_id, orphan.move_id]);
          }

          // Nenhuma relação íntegra é reportada como órfã.
          for (const relation of relations) {
            if (!isLearnableOrphan(relation, catalogs)) {
              const reported = issues.some(
                (issue) =>
                  issue.ids?.[0] === relation.pokemon_id &&
                  issue.ids?.[1] === relation.move_id,
              );
              // Observação: um par íntegro pode coincidir em ids com uma órfã
              // apenas se forem a mesma relação; aqui, íntegra ⇒ não é órfã,
              // logo não deve haver issue com check de golpe para esse par
              // a menos que exista outra relação órfã com os mesmos ids — o que
              // é impossível, pois os ids determinam a pertinência.
              expect(reported).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nomeia a FK ausente no detalhe de cada órfã de golpe (R8.3)', () => {
    fc.assert(
      fc.property(
        fc.array(learnableRefArb, { maxLength: 30 }),
        catalogArb,
        (relations, catalogs) => {
          const issues = checkLearnableMoveIntegrity(relations, catalogs);
          const orphans = relations.filter((r) =>
            isLearnableOrphan(r, catalogs),
          );

          for (let i = 0; i < orphans.length; i += 1) {
            const orphan = orphans[i]!;
            const detail = issues[i]!.detail;
            const pokemonMissing = !catalogs.species.has(orphan.pokemon_id);
            const moveMissing = !catalogs.moves.has(orphan.move_id);
            expect(detail.includes(`pokemon_id ${orphan.pokemon_id}`)).toBe(
              pokemonMissing,
            );
            expect(detail.includes(`move_id ${orphan.move_id}`)).toBe(
              moveMissing,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Propriedade — habilidades disponíveis (Req. 8.4)
  // -------------------------------------------------------------------------

  it('aprova iff toda relação de habilidade tem FKs existentes e reporta cada órfã (R8.4)', () => {
    fc.assert(
      fc.property(
        fc.array(abilityRefArb, { maxLength: 40 }),
        catalogArb,
        (relations, catalogs) => {
          const issues = checkPokemonAbilityIntegrity(relations, catalogs);

          const expectedOrphans = relations.filter((r) =>
            isAbilityOrphan(r, catalogs),
          );

          expect(issues.length === 0).toBe(expectedOrphans.length === 0);
          expect(issues).toHaveLength(expectedOrphans.length);

          for (let i = 0; i < expectedOrphans.length; i += 1) {
            const orphan = expectedOrphans[i]!;
            const issue = issues[i]!;
            expect(issue.check).toBe(VALIDATION_CHECKS.pokemonAbilityFk);
            expect(issue.ids).toEqual([orphan.pokemon_id, orphan.ability_id]);
          }

          for (const relation of relations) {
            if (!isAbilityOrphan(relation, catalogs)) {
              const reported = issues.some(
                (issue) =>
                  issue.ids?.[0] === relation.pokemon_id &&
                  issue.ids?.[1] === relation.ability_id,
              );
              expect(reported).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nomeia a FK ausente no detalhe de cada órfã de habilidade (R8.4)', () => {
    fc.assert(
      fc.property(
        fc.array(abilityRefArb, { maxLength: 30 }),
        catalogArb,
        (relations, catalogs) => {
          const issues = checkPokemonAbilityIntegrity(relations, catalogs);
          const orphans = relations.filter((r) => isAbilityOrphan(r, catalogs));

          for (let i = 0; i < orphans.length; i += 1) {
            const orphan = orphans[i]!;
            const detail = issues[i]!.detail;
            const pokemonMissing = !catalogs.species.has(orphan.pokemon_id);
            const abilityMissing = !catalogs.abilities.has(orphan.ability_id);
            expect(detail.includes(`pokemon_id ${orphan.pokemon_id}`)).toBe(
              pokemonMissing,
            );
            expect(detail.includes(`ability_id ${orphan.ability_id}`)).toBe(
              abilityMissing,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Caso-limite: catálogo que cobre todas as relações ⇒ aprovação (sem issues)
  // -------------------------------------------------------------------------

  it('não reporta nenhuma órfã quando o catálogo cobre todas as relações (R8.3/R8.4)', () => {
    fc.assert(
      fc.property(
        fc.array(learnableRefArb, { maxLength: 30 }),
        fc.array(abilityRefArb, { maxLength: 30 }),
        (learnable, abilities) => {
          // Catálogo construído para cobrir exatamente os ids referenciados.
          const catalogs: CatalogIds = {
            species: new Set([
              ...learnable.map((r) => r.pokemon_id),
              ...abilities.map((r) => r.pokemon_id),
            ]),
            moves: new Set(learnable.map((r) => r.move_id)),
            abilities: new Set(abilities.map((r) => r.ability_id)),
          };

          expect(checkLearnableMoveIntegrity(learnable, catalogs)).toEqual([]);
          expect(checkPokemonAbilityIntegrity(abilities, catalogs)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
