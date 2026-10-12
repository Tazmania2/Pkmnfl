import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { clonePresetToDraft } from './index';
import {
  DEFAULT_ANATOMY_CONVENTIONS,
  hasBlocking,
  validateDraft,
  type ValidationWarning,
} from '../validation';
import type { EligibilitySnapshot } from '../team/eligibility-adapter';
import type { PresetId, TeamDraft } from '../team/model';

// Feature: pfl-team-strategy-ui, Property 2: Preset carregado é salvável sem ajuste

/**
 * Property test de savabilidade de preset (Task 5.3).
 *
 * **Feature: pfl-team-strategy-ui, Property 2: Preset carregado é salvável sem ajuste**
 *
 * **Validates: Requirements 1.4**
 *
 * *Para todo* `preset_id` ∈ {`balanced`,`ground`,`aerial`,`curti`}, o
 * `TeamDraft` produzido por {@link clonePresetToDraft} **não** gera nenhum
 * aviso **bloqueante** em {@link validateDraft} — ou seja, um preset carregado é
 * salvável sem qualquer ajuste manual (R1.4).
 *
 * A `Camada_Leitura` não é consultada: o {@link EligibilitySnapshot} é
 * **derivado do próprio preset**, de modo que, por construção, cada espécie do
 * roster é permitida, cada habilidade está disponível e cada golpe é aprendível
 * pela respectiva espécie. Isso isola a propriedade do estado do catálogo/DB e
 * testa a hipótese do design: as definições de preset são internamente
 * consistentes e, portanto, passam no gate de persistência.
 *
 * Avisos **não bloqueantes** (`INERT_EFFECT`, `ANATOMY_LIMIT`) são aceitáveis —
 * a propriedade é sobre savabilidade (`hasBlocking === false`), não sobre
 * ausência total de avisos.
 */

const PRESET_IDS: readonly PresetId[] = ['balanced', 'ground', 'aerial', 'curti'];

/**
 * Constrói um {@link EligibilitySnapshot} síncrono derivado inteiramente de um
 * `TeamDraft` de preset: as espécies do roster são as permitidas; para cada
 * espécie, o conjunto aprendível é a união dos golpes de todas as instâncias
 * daquela espécie e o conjunto de habilidades disponíveis é a união das
 * habilidades selecionadas. Nomes são preenchidos com placeholders rastreáveis
 * (R17.5) e nenhum efeito é marcado como inerte.
 *
 * Com este snapshot, nenhum aviso de `MOVE_NOT_LEARNABLE`,
 * `ABILITY_NOT_AVAILABLE` ou `SPECIES_NOT_ALLOWED` pode ser emitido para os
 * atletas do próprio preset — o teste passa a medir apenas as regras estruturais
 * (contagem/duplicata de golpes, teto do roster, 11 identidades distintas por
 * unidade), que são o cerne de "salvável sem ajuste".
 */
function snapshotFromDraft(draft: TeamDraft): EligibilitySnapshot {
  const allowedSpecies = new Set<number>();
  const learnable = new Map<number, Set<number>>();
  const abilities = new Map<number, Set<number>>();
  const moveName = new Map<number, string>();
  const abilityName = new Map<number, string>();

  for (const athlete of draft.roster) {
    allowedSpecies.add(athlete.pokemonId);

    const moves = learnable.get(athlete.pokemonId) ?? new Set<number>();
    for (const moveId of athlete.moveIds) {
      moves.add(moveId);
      if (!moveName.has(moveId)) {
        moveName.set(moveId, `Golpe #${moveId}`);
      }
    }
    learnable.set(athlete.pokemonId, moves);

    const abis = abilities.get(athlete.pokemonId) ?? new Set<number>();
    abis.add(athlete.abilityId);
    abilities.set(athlete.pokemonId, abis);
    if (!abilityName.has(athlete.abilityId)) {
      abilityName.set(athlete.abilityId, `Habilidade #${athlete.abilityId}`);
    }
  }

  return {
    allowedSpecies,
    learnable,
    abilities,
    moveName,
    abilityName,
    inertEffects: new Set<string>(),
  };
}

/** Lista apenas os avisos bloqueantes, para mensagens de falha legíveis. */
function blockingWarnings(
  warnings: readonly ValidationWarning[],
): ValidationWarning[] {
  return warnings.filter((w) => w.blocking);
}

describe('Feature: pfl-team-strategy-ui, Property 2: Preset carregado é salvável sem ajuste', () => {
  it('cada preset clonado não produz nenhum aviso bloqueante (R1.4) — asserção direta por preset', () => {
    for (const id of PRESET_IDS) {
      const draft = clonePresetToDraft(id);
      const elig = snapshotFromDraft(draft);
      const warnings = validateDraft(draft, elig, DEFAULT_ANATOMY_CONVENTIONS);

      const blocking = blockingWarnings(warnings);
      expect(
        blocking,
        `Preset "${id}" deveria ser salvável sem ajuste, mas gerou avisos bloqueantes: ${JSON.stringify(
          blocking.map((w) => ({ code: w.code, message: w.message })),
          null,
          2,
        )}`,
      ).toEqual([]);
      expect(hasBlocking(warnings)).toBe(false);
    }
  });

  it('para todo preset_id, clonePresetToDraft é salvável sem ajuste (hasBlocking === false)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PRESET_IDS), (id) => {
        const draft = clonePresetToDraft(id);
        const elig = snapshotFromDraft(draft);
        const warnings = validateDraft(draft, elig, DEFAULT_ANATOMY_CONVENTIONS);

        // R1.4: nenhum aviso bloqueante ⇒ o preset é salvável sem ajuste.
        expect(hasBlocking(warnings)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('a presença de avisos não bloqueantes não impede o salvamento do preset', () => {
    // Verifica a semântica do gate: mesmo que a validação retorne avisos, o
    // predicado de persistência só reprova quando há avisos bloqueantes.
    for (const id of PRESET_IDS) {
      const draft = clonePresetToDraft(id);
      const elig = snapshotFromDraft(draft);
      const warnings = validateDraft(draft, elig, DEFAULT_ANATOMY_CONVENTIONS);

      // Todo aviso eventualmente presente aqui é não bloqueante.
      for (const w of warnings) {
        expect(w.blocking).toBe(false);
      }
    }
  });
});
