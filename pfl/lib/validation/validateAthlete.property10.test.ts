// Feature: pfl-team-strategy-ui, Property 10: Validação da ficha é função pura do estado e detecta exatamente os casos inválidos
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { AnatomyConventions } from '../anatomy';
import type { EligibilitySnapshot } from '../team/eligibility-adapter';
import type { AthleteDraft } from '../team/model';
import { validateAthlete, type ValidationWarning } from './index';

/**
 * Teste de propriedade da validação da ficha do atleta (Task 4.3).
 *
 * **Property 10: Validação da ficha é função pura do estado e detecta exatamente
 * os casos inválidos.**
 *
 * **Validates: Requirements 6.4, 7.1, 7.2, 7.3, 7.4, 7.5**
 *
 * *Para qualquer* `AthleteDraft` e snapshot de elegibilidade, `validateAthlete`
 * contém:
 * - `MOVE_NOT_LEARNABLE` (nomeando o golpe) para cada golpe fora de
 *   `getLearnableMoveIds`;
 * - `ABILITY_NOT_AVAILABLE` (nomeando a habilidade) se e somente se a habilidade
 *   está fora de `getAvailableAbilities`;
 * - `MOVE_COUNT_NOT_FOUR` (com a contagem atual) se e somente se o número de
 *   golpes é diferente de quatro;
 * - `MOVE_DUPLICATE` (nomeando o golpe repetido) se e somente se há golpes
 *   repetidos.
 *
 * Como a saída é função apenas do estado, chamar `validateAthlete` duas vezes com
 * a mesma entrada produz resultados profundamente iguais e não muta a entrada.
 *
 * O snapshot é construído em memória (sem rede): controlamos os conjuntos
 * `learnable`/`abilities` por espécie. Usamos uma `AnatomyConventions` neutra
 * (`anatomyWarning` retorna `null`) para isolar o teste de `ANATOMY_LIMIT`, e as
 * fichas geradas têm `positionDesignation` vazia (nenhum aviso anatômico).
 */

/** Convenção anatômica neutra: nunca gera `ANATOMY_LIMIT`. */
const NEUTRAL_ANATOMY: AnatomyConventions = {
  anatomyWarning: () => null,
};

/** Espécie fixa usada em todas as fichas geradas. */
const POKEMON_ID = 25;

/**
 * Constrói um `EligibilitySnapshot` em memória para a espécie fixa, com os
 * conjuntos de golpes aprendíveis e habilidades disponíveis fornecidos.
 * `inertEffects` é vazio para isolar o teste de `INERT_EFFECT`.
 */
function makeSnapshot(
  learnableMoves: ReadonlySet<number>,
  availableAbilities: ReadonlySet<number>,
): EligibilitySnapshot {
  const moveName = new Map<number, string>();
  for (const id of learnableMoves) {
    moveName.set(id, `Golpe ${id}`);
  }
  const abilityName = new Map<number, string>();
  for (const id of availableAbilities) {
    abilityName.set(id, `Habilidade ${id}`);
  }
  return {
    allowedSpecies: new Set<number>([POKEMON_ID]),
    learnable: new Map<number, ReadonlySet<number>>([[POKEMON_ID, learnableMoves]]),
    abilities: new Map<number, ReadonlySet<number>>([[POKEMON_ID, availableAbilities]]),
    moveName,
    abilityName,
    inertEffects: new Set<string>(),
  };
}

/** Conta avisos de um dado código. */
function countCode(
  warnings: readonly ValidationWarning[],
  code: ValidationWarning['code'],
): number {
  return warnings.filter((w) => w.code === code).length;
}

/** Conjunto dos `moveId` referenciados por avisos de um dado código. */
function moveIdsForCode(
  warnings: readonly ValidationWarning[],
  code: ValidationWarning['code'],
): Set<number> {
  const out = new Set<number>();
  for (const w of warnings) {
    if (w.code === code && w.target.moveId !== undefined) {
      out.add(w.target.moveId);
    }
  }
  return out;
}

/**
 * Mundo gerado: um pool de ids elegíveis (golpes aprendíveis / habilidades
 * disponíveis) e a ficha do atleta, cujos golpes e habilidade podem estar
 * dentro ou fora do pool, com contagem de golpes variável e possíveis
 * duplicatas. Isso garante que o gerador produza tanto fichas válidas quanto
 * inválidas.
 */
interface World {
  readonly learnableMoves: Set<number>;
  readonly availableAbilities: Set<number>;
  readonly athlete: AthleteDraft;
}

const moveIdArb = fc.integer({ min: 1, max: 40 });
const abilityIdArb = fc.integer({ min: 1, max: 20 });

const worldArb: fc.Arbitrary<World> = fc
  .record({
    learnableMoves: fc.uniqueArray(moveIdArb, { minLength: 0, maxLength: 12 }),
    availableAbilities: fc.uniqueArray(abilityIdArb, { minLength: 0, maxLength: 6 }),
    // 0..6 golpes, permitindo contagens != 4 e duplicatas (não unique).
    moveIds: fc.array(moveIdArb, { minLength: 0, maxLength: 6 }),
    abilityId: abilityIdArb,
    instanceId: fc.integer({ min: 1, max: 1000 }),
  })
  .map(({ learnableMoves, availableAbilities, moveIds, abilityId, instanceId }) => ({
    learnableMoves: new Set(learnableMoves),
    availableAbilities: new Set(availableAbilities),
    athlete: {
      instanceId,
      pokemonId: POKEMON_ID,
      abilityId,
      moveIds,
      positionDesignation: '',
    },
  }));

describe('validateAthlete — Property 10', () => {
  it('detecta exatamente os casos inválidos e é função pura do estado', () => {
    fc.assert(
      fc.property(worldArb, (world) => {
        const snapshot = makeSnapshot(world.learnableMoves, world.availableAbilities);
        const athlete = world.athlete;

        // Snapshot da entrada para checar ausência de mutação depois.
        const athleteBefore = structuredClone(athlete);

        const warnings = validateAthlete(athlete, snapshot, NEUTRAL_ANATOMY);

        // --- MOVE_NOT_LEARNABLE: um aviso por golpe fora do conjunto aprendível,
        // nomeando o golpe. Como pode haver duplicatas de um mesmo golpe não
        // aprendível, a contagem bate com a quantidade de ocorrências. ---
        const nonLearnableOccurrences = athlete.moveIds.filter(
          (id) => !world.learnableMoves.has(id),
        );
        expect(countCode(warnings, 'MOVE_NOT_LEARNABLE')).toBe(
          nonLearnableOccurrences.length,
        );
        // O conjunto de golpes citados corresponde exatamente aos não aprendíveis.
        const citedNonLearnable = moveIdsForCode(warnings, 'MOVE_NOT_LEARNABLE');
        const expectedNonLearnable = new Set(nonLearnableOccurrences);
        expect([...citedNonLearnable].sort((a, b) => a - b)).toEqual(
          [...expectedNonLearnable].sort((a, b) => a - b),
        );
        for (const w of warnings) {
          if (w.code === 'MOVE_NOT_LEARNABLE') {
            expect(w.message).toContain(`#${w.target.moveId}`);
          }
        }

        // --- ABILITY_NOT_AVAILABLE: presente sse a habilidade está fora do
        // conjunto disponível, nomeando a habilidade. ---
        const abilityInvalid = !world.availableAbilities.has(athlete.abilityId);
        expect(countCode(warnings, 'ABILITY_NOT_AVAILABLE')).toBe(
          abilityInvalid ? 1 : 0,
        );
        if (abilityInvalid) {
          const w = warnings.find((x) => x.code === 'ABILITY_NOT_AVAILABLE')!;
          expect(w.target.abilityId).toBe(athlete.abilityId);
          expect(w.message).toContain(`#${athlete.abilityId}`);
        }

        // --- MOVE_COUNT_NOT_FOUR: presente sse a contagem != 4, e a mensagem
        // reflete a contagem real. ---
        const countInvalid = athlete.moveIds.length !== 4;
        expect(countCode(warnings, 'MOVE_COUNT_NOT_FOUR')).toBe(countInvalid ? 1 : 0);
        if (countInvalid) {
          const w = warnings.find((x) => x.code === 'MOVE_COUNT_NOT_FOUR')!;
          expect(w.message).toContain(`${athlete.moveIds.length}`);
        }

        // --- MOVE_DUPLICATE: presente sse há golpes repetidos; um aviso por
        // golpe distinto repetido, nomeando-o. ---
        const seen = new Set<number>();
        const duplicatedMoveIds = new Set<number>();
        for (const id of athlete.moveIds) {
          if (seen.has(id)) {
            duplicatedMoveIds.add(id);
          }
          seen.add(id);
        }
        expect(countCode(warnings, 'MOVE_DUPLICATE')).toBe(duplicatedMoveIds.size);
        expect(
          [...moveIdsForCode(warnings, 'MOVE_DUPLICATE')].sort((a, b) => a - b),
        ).toEqual([...duplicatedMoveIds].sort((a, b) => a - b));
        for (const w of warnings) {
          if (w.code === 'MOVE_DUPLICATE') {
            expect(w.message).toContain(`#${w.target.moveId}`);
          }
        }

        // --- Isolamento: nenhum aviso não bloqueante deve surgir (sem efeitos
        // inertes e sem designação de posição). ---
        expect(countCode(warnings, 'INERT_EFFECT')).toBe(0);
        expect(countCode(warnings, 'ANATOMY_LIMIT')).toBe(0);

        // --- Pureza: segunda chamada é deep-equal e a entrada não é mutada. ---
        const warningsAgain = validateAthlete(athlete, snapshot, NEUTRAL_ANATOMY);
        expect(warningsAgain).toEqual(warnings);
        expect(athlete).toEqual(athleteBefore);
      }),
      { numRuns: 100 },
    );
  });

  it('corrigir a invalidez remove exatamente o aviso correspondente (função do estado)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(moveIdArb, { minLength: 5, maxLength: 12 }),
        abilityIdArb,
        (pool, abilityId) => {
          // Conjuntos elegíveis amplos; construímos uma ficha válida e então
          // injetamos uma única invalidez de cada vez, verificando que surge
          // exatamente o aviso daquela condição.
          const learnable = new Set(pool);
          const abilities = new Set<number>([abilityId]);
          const snapshot = makeSnapshot(learnable, abilities);
          const [m0, m1, m2, m3] = pool as [number, number, number, number];
          const fourMoves = [m0, m1, m2, m3];

          const valid: AthleteDraft = {
            instanceId: 1,
            pokemonId: POKEMON_ID,
            abilityId,
            moveIds: [...fourMoves],
            positionDesignation: '',
          };
          // Ficha válida: sem avisos.
          expect(validateAthlete(valid, snapshot, NEUTRAL_ANATOMY)).toEqual([]);

          // Habilidade indisponível → somente ABILITY_NOT_AVAILABLE.
          const badAbility: AthleteDraft = { ...valid, abilityId: abilityId + 1000 };
          const wa = validateAthlete(badAbility, snapshot, NEUTRAL_ANATOMY);
          expect(wa.map((w) => w.code)).toEqual(['ABILITY_NOT_AVAILABLE']);

          // Golpe não aprendível → somente MOVE_NOT_LEARNABLE.
          const unknownMove = Math.max(...pool) + 1;
          const badMove: AthleteDraft = {
            ...valid,
            moveIds: [unknownMove, m1, m2, m3],
          };
          const wm = validateAthlete(badMove, snapshot, NEUTRAL_ANATOMY);
          expect(wm.map((w) => w.code)).toEqual(['MOVE_NOT_LEARNABLE']);

          // Contagem != 4 (três golpes) → somente MOVE_COUNT_NOT_FOUR.
          const badCount: AthleteDraft = { ...valid, moveIds: fourMoves.slice(0, 3) };
          const wc = validateAthlete(badCount, snapshot, NEUTRAL_ANATOMY);
          expect(wc.map((w) => w.code)).toEqual(['MOVE_COUNT_NOT_FOUR']);

          // Golpe duplicado → somente MOVE_DUPLICATE.
          const badDup: AthleteDraft = {
            ...valid,
            moveIds: [m0, m0, m1, m2],
          };
          const wd = validateAthlete(badDup, snapshot, NEUTRAL_ANATOMY);
          expect(wd.map((w) => w.code)).toEqual(['MOVE_DUPLICATE']);
        },
      ),
      { numRuns: 100 },
    );
  });
});
