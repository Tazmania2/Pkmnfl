import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { getPreset, clonePresetToDraft } from './index';
import {
  addAthlete,
  removeAthlete,
  updateAthlete,
  assignRole,
  clearRole,
  setOffenseStyle,
  setDefenseStyle,
  reorderOffensePlays,
  reorderDefensePlays,
} from '../team/store';
import {
  OFFENSE_PLAYS,
  DEFENSE_PLAYS,
  type AthleteDraft,
  type LineupUnit,
  type PlayId,
  type PresetId,
  type TeamDraft,
} from '../team/model';

// Feature: pfl-team-strategy-ui, Property 1: Preset clonado é fiel e nunca muta a definição original

/**
 * Property test de clone de preset (Task 5.2).
 *
 * **Feature: pfl-team-strategy-ui, Property 1: Preset clonado é fiel e nunca muta a definição original**
 *
 * **Validates: Requirements 1.3, 1.5, 10.2**
 *
 * *Para todo* `preset_id` ∈ {`balanced`,`ground`,`aerial`,`curti`} e *para
 * qualquer* sequência de edições aplicadas ao `TeamDraft` resultante:
 * - (a) o rascunho recém-clonado é estruturalmente igual à definição do preset
 *   (roster, atribuições e estratégia), ignorando a proveniência que a
 *   definição não possui;
 * - (b) a definição original do preset permanece inalterada campo a campo após
 *   as edições, provando que a definição congelada e o rascunho editável não
 *   compartilham referências.
 */

const PRESET_IDS: readonly PresetId[] = ['balanced', 'ground', 'aerial', 'curti'];

/** Cópia profunda independente, usada como oráculo de "estado anterior". */
function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Comando de edição aplicado ao draft. Cada comando devolve o novo `TeamDraft`
 * produzido pela transição pura correspondente da store. Nenhum deles toca na
 * definição do preset — a propriedade (b) confirma isso.
 */
type EditCommand = (draft: TeamDraft) => TeamDraft;

/** Gera um `AthleteDraft` novo, com `instanceId` fora do roster do preset. */
function newAthleteArb(existingIds: readonly number[]): fc.Arbitrary<AthleteDraft> {
  const maxExisting = existingIds.length ? Math.max(...existingIds) : 0;
  return fc.record({
    instanceId: fc.integer({ min: maxExisting + 1, max: maxExisting + 1000 }),
    pokemonId: fc.integer({ min: 1, max: 151 }),
    abilityId: fc.integer({ min: 1, max: 200 }),
    moveIds: fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 4, maxLength: 4 }),
    positionDesignation: fc.constantFrom('QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB'),
  });
}

/** Permutação arbitrária de um conjunto fixo de jogadas. */
function permutationArb(set: readonly PlayId[]): fc.Arbitrary<PlayId[]> {
  return fc
    .shuffledSubarray([...set], { minLength: set.length, maxLength: set.length })
    .map((xs) => [...xs]);
}

/**
 * Monta um gerador de um único comando de edição, usando dados reais do preset
 * (ids de instância e papéis/unidades realmente presentes nas escalações) para
 * que as transições exerçam caminhos significativos (substituir ocupante,
 * remover instância escalada, etc.).
 */
function editCommandArb(def: ReturnType<typeof getPreset>): fc.Arbitrary<EditCommand> {
  const instanceIds = def.roster.map((a) => a.instanceId);
  const instanceIdArb = instanceIds.length
    ? fc.constantFrom(...instanceIds)
    : fc.integer({ min: 1, max: 10 });

  // Pares (unit, role) reais das escalações do preset.
  const unitRolePairs = def.lineups.map((l) => [l.unit, l.role] as [LineupUnit, string]);
  const unitRoleArb: fc.Arbitrary<[LineupUnit, string]> = unitRolePairs.length
    ? fc.constantFrom(...unitRolePairs)
    : fc.constant(['offense', 'QB'] as [LineupUnit, string]);

  const commands: fc.Arbitrary<EditCommand>[] = [
    // addAthlete
    newAthleteArb(instanceIds).map(
      (athlete): EditCommand => (draft) => addAthlete(draft, athlete),
    ),
    // removeAthlete (de uma instância real)
    instanceIdArb.map(
      (id): EditCommand => (draft) => removeAthlete(draft, id),
    ),
    // updateAthlete (patch arbitrário)
    fc
      .tuple(
        instanceIdArb,
        fc.record(
          {
            pokemonId: fc.integer({ min: 1, max: 151 }),
            abilityId: fc.integer({ min: 1, max: 200 }),
            moveIds: fc.array(fc.integer({ min: 1, max: 500 }), {
              minLength: 4,
              maxLength: 4,
            }),
            positionDesignation: fc.constantFrom('QB', 'RB', 'WR', 'TE'),
          },
          { requiredKeys: [] },
        ),
      )
      .map(
        ([id, patch]): EditCommand =>
          (draft) =>
            updateAthlete(draft, id, patch),
      ),
    // assignRole (unidade/papel reais, instância real)
    fc
      .tuple(unitRoleArb, instanceIdArb)
      .map(
        ([[unit, role], id]): EditCommand =>
          (draft) =>
            assignRole(draft, unit, role, id),
      ),
    // clearRole
    unitRoleArb.map(
      ([unit, role]): EditCommand =>
        (draft) =>
          clearRole(draft, unit, role),
    ),
    // setOffenseStyle / setDefenseStyle
    fc.string().map(
      (style): EditCommand => (draft) => setOffenseStyle(draft, style),
    ),
    fc.string().map(
      (style): EditCommand => (draft) => setDefenseStyle(draft, style),
    ),
    // reorder plays (permutações válidas)
    permutationArb(OFFENSE_PLAYS).map(
      (order): EditCommand => (draft) => reorderOffensePlays(draft, order),
    ),
    permutationArb(DEFENSE_PLAYS).map(
      (order): EditCommand => (draft) => reorderDefensePlays(draft, order),
    ),
  ];

  return fc.oneof(...commands);
}

describe('Feature: pfl-team-strategy-ui, Property 1: Preset clonado é fiel e nunca muta a definição original', () => {
  it('clonePresetToDraft reproduz fielmente roster/lineups/strategy da definição (R1.3, R10.2)', () => {
    for (const id of PRESET_IDS) {
      const def = getPreset(id);
      const draft = clonePresetToDraft(id);

      // (a) Igualdade estrutural das três substruturas (proveniência ignorada,
      // pois a definição não a possui).
      expect(draft.roster).toEqual(def.roster);
      expect(draft.lineups).toEqual(def.lineups);
      expect(draft.strategy).toEqual(def.strategy);

      // Sem referências compartilhadas: o clone é profundo.
      expect(draft.roster).not.toBe(def.roster);
      expect(draft.strategy).not.toBe(def.strategy);
      expect(draft.strategy.offensePlayPriority).not.toBe(
        def.strategy.offensePlayPriority,
      );
      draft.roster.forEach((athlete, i) => {
        const defAthlete = def.roster[i]!;
        expect(athlete).not.toBe(defAthlete);
        expect(athlete.moveIds).not.toBe(defAthlete.moveIds);
      });
    }
  });

  it('nenhuma sequência de edições do draft clonado muta a definição do preset (R1.5, R10.2)', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...PRESET_IDS)
          .chain((id) =>
            fc.array(editCommandArb(getPreset(id)), { minLength: 1, maxLength: 25 }).map(
              (edits) => ({ id, edits }),
            ),
          ),
        ({ id, edits }) => {
          const def = getPreset(id);

          // Snapshot da definição ANTES de qualquer edição (oráculo).
          const snapshot = deepCopy({
            presetId: def.presetId,
            name: def.name,
            roster: def.roster,
            lineups: def.lineups,
            strategy: def.strategy,
          });

          // Clona e aplica a sequência arbitrária de edições ao draft.
          let draft = clonePresetToDraft(id);
          for (const edit of edits) {
            draft = edit(draft);
          }

          // (b) A definição permanece inalterada campo a campo após as edições.
          expect(def.presetId).toEqual(snapshot.presetId);
          expect(def.name).toEqual(snapshot.name);
          expect(def.roster).toEqual(snapshot.roster);
          expect(def.lineups).toEqual(snapshot.lineups);
          expect(def.strategy).toEqual(snapshot.strategy);
          // E segue sendo a mesma referência congelada reutilizada por getPreset.
          expect(getPreset(id)).toBe(def);
        },
      ),
      { numRuns: 100 },
    );
  });
});
