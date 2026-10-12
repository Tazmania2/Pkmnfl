import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { assignRole, loadEmpty } from './store';
import type { AthleteDraft, LineupUnit, TeamDraft } from './model';
import { isAllowedSpecies } from '../catalog/allowed-species';

/**
 * Teste de propriedade: equivalência entre atribuição por teclado e por
 * arrastar (Task 11.3).
 *
 * // Feature: pfl-team-strategy-ui, Property 7: Equivalência entre atribuição por teclado e por arrastar
 *
 * **Validates: Requirements 4.2, 17.3**
 *
 * Property 7 (design): para qualquer unidade, papel e instância, o estado
 * `TeamDraft` resultante da atribuição pelo **seletor acessível por teclado** é
 * idêntico ao estado resultante da **atribuição equivalente por arrastar**.
 *
 * Insight do contrato do componente (`components/team/CampoAtribuicao.tsx`):
 * ambos os caminhos convergem para o **mesmo** callback
 * `assignRole(unit, role, instanceId)` na store:
 * - **Teclado**: o `<select>` emite `onChange`; o valor da opção é
 *   `String(instanceId)` e o handler faz `onAssign(unit, role, Number(value))`.
 * - **Arrastar**: o `ItemRoster` grava `String(instanceId)` no `dataTransfer`
 *   no `dragStart`; o `onDrop` lê essa string e a orquestração chama
 *   `onAssign(unit, role, Number(...))` → `assignRole`.
 *
 * Portanto a equivalência reduz-se a: dado o mesmo `(unit, role, instanceId)`,
 * o `TeamDraft` resultante é idêntico independentemente do caminho de entrada.
 * O teste modela cada caminho com um pequeno auxiliar que reproduz a extração
 * `string → Number` de cada fonte (valor do `<option>` / `dataTransfer`) e
 * exige igualdade profunda dos estados. Sem rede nem I/O.
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
  return fc.integer({ min: 1, max: 151 }).filter((id) => isAllowedSpecies(id));
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

/** Monta um draft com um único atleta no roster (ponto de partida comum). */
function draftWithAthlete(athlete: AthleteDraft): TeamDraft {
  return { ...loadEmpty('Property7'), roster: [athlete] };
}

/**
 * Caminho **teclado**: reproduz o `onChange` do `<select>` de
 * `CampoAtribuicao`. A opção carrega `value = String(instanceId)`; o handler
 * converte com `Number(value)` e invoca `assignRole`.
 */
function assignViaKeyboard(
  draft: TeamDraft,
  unit: LineupUnit,
  role: string,
  instanceId: number,
): TeamDraft {
  const optionValue = String(instanceId); // valor do <option> no DOM
  return assignRole(draft, unit, role, Number(optionValue));
}

/**
 * Caminho **arrastar**: reproduz o fluxo drop → orquestração. O `ItemRoster`
 * grava `String(instanceId)` no `dataTransfer` (`text/plain`); o `onDrop` lê a
 * string e a orquestração chama `assignRole` com `Number(...)`.
 */
function assignViaDrag(
  draft: TeamDraft,
  unit: LineupUnit,
  role: string,
  instanceId: number,
): TeamDraft {
  // dataTransfer é sempre textual; o ItemRoster escreve String(instanceId).
  const dataTransfer: Readonly<Record<string, string>> = {
    'text/plain': String(instanceId),
  };
  const parsed = Number(dataTransfer['text/plain']); // leitura no onDrop
  return assignRole(draft, unit, role, parsed);
}

describe('Feature: pfl-team-strategy-ui, Property 7: Equivalência entre atribuição por teclado e por arrastar', () => {
  it('para o mesmo (unit, role, instanceId), teclado e arrastar produzem TeamDraft idêntico (R4.2/R17.3)', () => {
    fc.assert(
      fc.property(
        athleteArb(),
        fc.constantFrom(...UNITS),
        fc.constantFrom(...ROLES),
        (athlete, unit, role) => {
          const draft = draftWithAthlete(athlete);

          const byKeyboard = assignViaKeyboard(
            draft,
            unit,
            role,
            athlete.instanceId,
          );
          const byDrag = assignViaDrag(draft, unit, role, athlete.instanceId);

          // Núcleo da propriedade: os dois caminhos geram estados idênticos.
          expect(byKeyboard).toEqual(byDrag);

          // E ambos equivalem ao assignRole canônico (contrato do componente).
          const canonical = assignRole(draft, unit, role, athlete.instanceId);
          expect(byKeyboard).toEqual(canonical);
          expect(byDrag).toEqual(canonical);

          // O draft de origem permanece intacto (imutabilidade preservada).
          expect(draft.lineups).toHaveLength(0);
          expect(draft.roster[0]?.positionDesignation).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('equivalência sobre estado já parcialmente escalado (substituição de ocupante)', () => {
    fc.assert(
      fc.property(
        // Dois instanceId distintos: idB = idA + offset (offset >= 1).
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
          // Partida: A já ocupa o papel; agora B reassume por cada caminho.
          const seeded: TeamDraft = assignRole(
            { ...loadEmpty('Property7'), roster: [athleteA, athleteB] },
            unit,
            role,
            idA,
          );

          const byKeyboard = assignViaKeyboard(seeded, unit, role, idB);
          const byDrag = assignViaDrag(seeded, unit, role, idB);

          expect(byKeyboard).toEqual(byDrag);
          expect(byKeyboard).toEqual(assignRole(seeded, unit, role, idB));
        },
      ),
      { numRuns: 100 },
    );
  });
});
