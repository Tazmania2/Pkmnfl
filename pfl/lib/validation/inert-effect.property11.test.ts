import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  abilityInertKey,
  moveInertKey,
  type EligibilitySnapshot,
} from '../team/eligibility-adapter';
import type { AnatomyConventions } from '../anatomy';
import type { AthleteDraft } from '../team/model';
import { hasBlocking, validateAthlete } from './index';

/**
 * Teste de propriedade: efeito inerte equipável, não bloqueante e sinalizado
 * (Task 4.4).
 *
 * // Feature: pfl-team-strategy-ui, Property 11: Efeito inerte é equipável, não
 * // bloqueante e sinalizado
 *
 * **Validates: Requirements 8.1, 8.3**
 *
 * Para todo golpe ou habilidade marcado como efeito inerte (`Efeito_Inerte`) no
 * {@link EligibilitySnapshot}, a validação da ficha (`validateAthlete`):
 *
 * - **inclui** um aviso `INERT_EFFECT` para o efeito selecionado, com
 *   `blocking = false` (sinalizado, mas equipável — R8.1/R8.3);
 * - esse aviso **nunca** torna {@link hasBlocking} verdadeiro por si só —
 *   construímos um atleta de resto válido (4 golpes distintos aprendíveis +
 *   habilidade disponível) para isolar o efeito do aviso inerte;
 * - quando **nenhum** efeito selecionado é inerte, **nenhum** aviso
 *   `INERT_EFFECT` aparece.
 *
 * A `Camada_Leitura` é mockada em memória: construímos o snapshot síncrono
 * diretamente (sem rede). As convenções anatômicas são neutralizadas (sempre
 * `null`) para isolar a propriedade do aviso `ANATOMY_LIMIT`.
 */

/** Convenção anatômica neutra: jamais dispara `ANATOMY_LIMIT`. */
const NEUTRAL_ANATOMY: AnatomyConventions = {
  anatomyWarning: () => null,
};

/**
 * Entrada gerada: uma espécie, 4 golpes distintos aprendíveis, uma habilidade
 * disponível e os subconjuntos (golpes/habilidade) marcados como inertes.
 */
interface Scenario {
  readonly pokemonId: number;
  readonly moveIds: readonly number[];
  readonly abilityId: number;
  /** Índices (0..3) dos golpes que serão marcados como inertes. */
  readonly inertMoveIndices: readonly number[];
  /** Se a habilidade selecionada será marcada como inerte. */
  readonly abilityInert: boolean;
}

/**
 * Gera um cenário com 4 golpes distintos e uma habilidade. Os golpes/habilidade
 * são sempre aprendíveis/disponíveis (atleta de resto válido), de modo que o
 * único eixo variável relevante é a marcação de efeito inerte.
 */
function scenarioArb(): fc.Arbitrary<Scenario> {
  return fc
    .record({
      pokemonId: fc.integer({ min: 1, max: 151 }),
      moveIds: fc.uniqueArray(fc.integer({ min: 1, max: 400 }), {
        minLength: 4,
        maxLength: 4,
      }),
      abilityId: fc.integer({ min: 1, max: 60 }),
      inertMoveIndices: fc.uniqueArray(fc.integer({ min: 0, max: 3 }), {
        minLength: 0,
        maxLength: 4,
      }),
      abilityInert: fc.boolean(),
    });
}

/**
 * Constrói um {@link EligibilitySnapshot} síncrono para o cenário: a espécie
 * aprende exatamente seus 4 golpes e dispõe exatamente de sua habilidade; os
 * nomes legíveis são materializados; e `inertEffects` contém apenas as chaves
 * dos efeitos escolhidos como inertes.
 */
function buildSnapshot(s: Scenario): EligibilitySnapshot {
  const learnable = new Map<number, ReadonlySet<number>>([
    [s.pokemonId, new Set(s.moveIds)],
  ]);
  const abilities = new Map<number, ReadonlySet<number>>([
    [s.pokemonId, new Set([s.abilityId])],
  ]);

  const moveName = new Map<number, string>(
    s.moveIds.map((id) => [id, `Golpe ${id}`]),
  );
  const abilityName = new Map<number, string>([
    [s.abilityId, `Habilidade ${s.abilityId}`],
  ]);

  const inertEffects = new Set<string>();
  for (const index of s.inertMoveIndices) {
    inertEffects.add(moveInertKey(s.moveIds[index]!));
  }
  if (s.abilityInert) {
    inertEffects.add(abilityInertKey(s.abilityId));
  }

  return {
    allowedSpecies: new Set([s.pokemonId]),
    learnable,
    abilities,
    moveName,
    abilityName,
    inertEffects,
  };
}

/** Monta a ficha de atleta de resto válida a partir do cenário. */
function buildAthlete(s: Scenario): AthleteDraft {
  return {
    instanceId: 1,
    pokemonId: s.pokemonId,
    abilityId: s.abilityId,
    moveIds: [...s.moveIds],
    // Sem posição designada: isola a propriedade de qualquer aviso anatômico.
    positionDesignation: '',
  };
}

describe('Feature: pfl-team-strategy-ui, Property 11: Efeito inerte é equipável, não bloqueante e sinalizado', () => {
  it('sinaliza cada efeito inerte selecionado (blocking=false) sem bloquear o salvamento (R8.1, R8.3)', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        const elig = buildSnapshot(s);
        const athlete = buildAthlete(s);

        const warnings = validateAthlete(athlete, elig, NEUTRAL_ANATOMY);
        const inertWarnings = warnings.filter((w) => w.code === 'INERT_EFFECT');

        // Conjuntos esperados de efeitos inertes selecionados.
        const expectedInertMoveIds = new Set(
          s.inertMoveIndices.map((i) => s.moveIds[i]),
        );
        const expectedInertCount =
          expectedInertMoveIds.size + (s.abilityInert ? 1 : 0);

        // (1) Há exatamente um aviso INERT_EFFECT por efeito inerte selecionado.
        expect(inertWarnings).toHaveLength(expectedInertCount);

        // (2) Todo aviso INERT_EFFECT é não bloqueante (equipável, sinalizado).
        for (const w of inertWarnings) {
          expect(w.blocking).toBe(false);
        }

        // (3) Cada golpe inerte tem um aviso associado ao seu moveId.
        const inertMoveTargets = new Set(
          inertWarnings
            .filter((w) => w.target.kind === 'move')
            .map((w) => w.target.moveId),
        );
        for (const moveId of expectedInertMoveIds) {
          expect(inertMoveTargets.has(moveId)).toBe(true);
        }

        // (4) A habilidade inerte, se houver, tem aviso associado ao abilityId.
        const inertAbilityWarnings = inertWarnings.filter(
          (w) => w.target.kind === 'ability',
        );
        if (s.abilityInert) {
          expect(inertAbilityWarnings).toHaveLength(1);
          expect(inertAbilityWarnings[0]!.target.abilityId).toBe(s.abilityId);
        } else {
          expect(inertAbilityWarnings).toHaveLength(0);
        }

        // (5) O atleta é de resto válido: os ÚNICOS avisos são os inertes, logo
        // hasBlocking é falso — o efeito inerte nunca bloqueia por si só.
        expect(warnings).toHaveLength(expectedInertCount);
        expect(hasBlocking(warnings)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('não emite INERT_EFFECT quando nenhum efeito selecionado é inerte (R8.1)', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        // Força o cenário sem nenhum efeito inerte selecionado.
        const nonInert: Scenario = {
          ...s,
          inertMoveIndices: [],
          abilityInert: false,
        };
        const elig = buildSnapshot(nonInert);
        const athlete = buildAthlete(nonInert);

        const warnings = validateAthlete(athlete, elig, NEUTRAL_ANATOMY);

        expect(warnings.some((w) => w.code === 'INERT_EFFECT')).toBe(false);
        // Atleta de resto válido e sem efeitos inertes: nenhum aviso, nada bloqueia.
        expect(warnings).toHaveLength(0);
        expect(hasBlocking(warnings)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
