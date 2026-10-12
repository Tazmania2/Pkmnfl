import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { assignRole, loadEmpty } from './store';
import type { AthleteDraft, LineupUnit, TeamDraft } from './model';
import { isAllowedSpecies } from '../catalog/allowed-species';

/**
 * Teste de propriedade: atribuição de posição registra e reflete, sem proibição
 * por espécie (Task 9.6).
 *
 * // Feature: pfl-team-strategy-ui, Property 6: Atribuição de posição registra e reflete, sem proibição por espécie
 *
 * **Validates: Requirements 4.3, 4.4**
 *
 * Property 6 (design): para qualquer unidade, papel e instância, `assignRole`
 * com uma atribuição válida **registra** a `position_designation` do atleta e
 * faz a atribuição aparecer **exatamente uma vez** na unidade correspondente
 * (R4.3); e, para **qualquer Especie_Permitida** e **qualquer papel**, a
 * atribuição **nunca** é bloqueada por uma regra de espécie — não há proibição
 * arbitrária de espécie por posição (R4.4).
 *
 * O teste exercita a transição pura `assignRole` da store (a UI
 * `CampoAtribuicao` apenas a invoca), sem rede nem I/O. O conjunto de espécies
 * usa a faixa permitida real (`isAllowedSpecies`), confirmando que nenhuma
 * delas é recusada em nenhum papel.
 */

/** Unidades de escalação (ataque, defesa e as seis de special teams). */
const UNITS: readonly LineupUnit[] = [
  'offense',
  'defense',
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
] as const;

/** Papéis de exemplo — a atribuição é livre, qualquer rótulo serve de papel. */
const ROLES: readonly string[] = [
  'QB',
  'RB',
  'WR1',
  'WR2',
  'LT',
  'C',
  'DE',
  'LB',
  'CB',
  'FS',
  'K',
] as const;

/** `pokemonId` de uma Especie_Permitida (faixa real 1..151 menos lendários). */
function allowedSpeciesArb(): fc.Arbitrary<number> {
  return fc
    .integer({ min: 1, max: 151 })
    .filter((id) => isAllowedSpecies(id));
}

/** Atleta com espécie permitida; demais campos são livres nesta propriedade. */
function athleteArb(): fc.Arbitrary<AthleteDraft> {
  return fc.record({
    instanceId: fc.integer({ min: 1, max: 1_000_000 }),
    pokemonId: allowedSpeciesArb(),
    abilityId: fc.integer({ min: 1, max: 50 }),
    moveIds: fc.uniqueArray(fc.integer({ min: 1, max: 200 }), {
      minLength: 4,
      maxLength: 4,
    }),
    positionDesignation: fc.constant(''),
  });
}

/** Monta um draft com um único atleta no roster. */
function draftWithAthlete(athlete: AthleteDraft): TeamDraft {
  return { ...loadEmpty('Property6'), roster: [athlete] };
}

/** Conta as entradas de escalação que casam (unit, role, instanceId). */
function countEntry(
  draft: TeamDraft,
  unit: LineupUnit,
  role: string,
  instanceId: number,
): number {
  return draft.lineups.filter(
    (l) => l.unit === unit && l.role === role && l.instanceId === instanceId,
  ).length;
}

describe('Feature: pfl-team-strategy-ui, Property 6: Atribuição de posição registra e reflete, sem proibição por espécie', () => {
  it('atribuição válida registra a position_designation e aparece exatamente uma vez na unidade (R4.3)', () => {
    fc.assert(
      fc.property(
        athleteArb(),
        fc.constantFrom(...UNITS),
        fc.constantFrom(...ROLES),
        (athlete, unit, role) => {
          const draft = draftWithAthlete(athlete);
          const next = assignRole(draft, unit, role, athlete.instanceId);

          // A atribuição aparece exatamente uma vez na unidade/papel.
          expect(
            countEntry(next, unit, role, athlete.instanceId),
          ).toBe(1);

          // Reflete na ficha: position_designation registrada como o papel.
          const updated = next.roster.find(
            (a) => a.instanceId === athlete.instanceId,
          );
          expect(updated?.positionDesignation).toBe(role);

          // Imutabilidade: o draft original não é mutado.
          expect(draft.lineups).toHaveLength(0);
          expect(draft.roster[0]?.positionDesignation).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nenhuma Especie_Permitida é bloqueada em nenhum papel — sem proibição arbitrária (R4.4)', () => {
    fc.assert(
      fc.property(
        athleteArb(),
        fc.constantFrom(...UNITS),
        fc.constantFrom(...ROLES),
        (athlete, unit, role) => {
          // Pré-condição da propriedade: a espécie é permitida.
          expect(isAllowedSpecies(athlete.pokemonId)).toBe(true);

          const next = assignRole(
            draftWithAthlete(athlete),
            unit,
            role,
            athlete.instanceId,
          );

          // Independentemente da espécie, a atribuição foi aceita (presente).
          expect(
            countEntry(next, unit, role, athlete.instanceId),
          ).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reatribuir o papel substitui o ocupante, mantendo exatamente uma entrada na unidade/papel (R4.3)', () => {
    fc.assert(
      fc.property(
        // Dois instanceId distintos: idB = idA + offset (>=1) garante idA != idB.
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        allowedSpeciesArb(),
        allowedSpeciesArb(),
        fc.constantFrom(...UNITS),
        fc.constantFrom(...ROLES),
        (baseId, offset, speciesA, speciesB, unit, role) => {
          const idA = baseId;
          const idB = baseId + offset;
          const athleteA: AthleteDraft = {
            instanceId: idA,
            pokemonId: speciesA,
            abilityId: 1,
            moveIds: [1, 2, 3, 4],
            positionDesignation: '',
          };
          const athleteB: AthleteDraft = {
            instanceId: idB,
            pokemonId: speciesB,
            abilityId: 1,
            moveIds: [1, 2, 3, 4],
            positionDesignation: '',
          };
          const draft: TeamDraft = {
            ...loadEmpty('Property6'),
            roster: [athleteA, athleteB],
          };

          // Primeiro A ocupa o papel; depois B o reassume.
          const afterA = assignRole(draft, unit, role, idA);
          const afterB = assignRole(afterA, unit, role, idB);

          // Exatamente uma entrada no papel, e é a de B (substituição).
          const atRole = afterB.lineups.filter(
            (l) => l.unit === unit && l.role === role,
          );
          expect(atRole).toHaveLength(1);
          expect(atRole[0]?.instanceId).toBe(idB);

          // A não aparece mais nesse papel; B aparece exatamente uma vez.
          expect(countEntry(afterB, unit, role, idA)).toBe(0);
          expect(countEntry(afterB, unit, role, idB)).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
