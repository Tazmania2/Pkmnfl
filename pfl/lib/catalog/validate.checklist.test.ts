import { describe, expect, it } from 'vitest';

import { EXCLUDED_POKEMON_IDS } from './allowed-species';
import {
  computeSha256,
  EXPECTED_ABILITIES_COUNT,
  EXPECTED_ALLOWED_COUNT,
  EXPECTED_MOVES_COUNT,
  EXPECTED_SPECIES_COUNT,
  validatePostIngestion,
  VALIDATION_CHECKS,
  type CatalogIds,
  type EligibilityState,
  type PostIngestionInput,
} from './validate';

/**
 * Testes de exemplo do checklist de validação pós-ingestão (Task 7.6).
 *
 * Complementares aos testes por-função de `validate.test.ts`: aqui exercitamos
 * o `validatePostIngestion` de ponta a ponta com **estados conhecidos** —
 * nomeados e concretos — para evidenciar o comportamento do checklist agregado
 * conforme as cláusulas de aceitação:
 *
 * - Req. 8.7: um estado totalmente válido retorna `passed: true` com `issues`
 *   vazio (todas as verificações satisfeitas).
 * - Req. 8.6: estados inválidos conhecidos retornam `passed: false` com os
 *   `issues` carregando o nome correto da verificação e os identificadores dos
 *   registros envolvidos.
 * - Req. 6.2: a elegibilidade exige os cinco ids excluídos {144,145,146,150,151}
 *   com `is_allowed = false`; marcar qualquer um deles como `true` reprova e o
 *   id infrator é reportado.
 *
 * _Requirements: 6.2, 8.6, 8.7_
 */

// ---------------------------------------------------------------------------
// Fixtures de estado conhecido
// ---------------------------------------------------------------------------

/** Os cinco `pokemon_id` excluídos do MVP (Req. 6.2), como lista ordenada. */
const EXCLUDED_IDS_SORTED: readonly number[] = [...EXCLUDED_POKEMON_IDS].sort(
  (a, b) => a - b,
);

/** Catálogo de ids existentes, suficiente para resolver as FKs das relações. */
function knownCatalogs(): CatalogIds {
  return {
    species: new Set([1, 4, 7, 25]),
    moves: new Set([33, 52, 85]),
    abilities: new Set([65, 66]),
  };
}

/**
 * Estado de elegibilidade válido: 146 espécies permitidas e os cinco ids
 * excluídos todos confirmados com `is_allowed = false` (Req. 6.2).
 */
function knownValidEligibility(): EligibilityState {
  const isAllowedById = new Map<number, boolean>();
  for (const id of EXCLUDED_IDS_SORTED) {
    isAllowedById.set(id, false);
  }
  return { allowedCount: EXPECTED_ALLOWED_COUNT, isAllowedById };
}

/**
 * Estado pós-ingestão totalmente íntegro: contagens-alvo, elegibilidade
 * correta, relações com FKs resolvidas e checksums do manifest conferindo.
 * Serve de base para derivar estados inválidos pontuais nos testes de 8.6.
 */
function knownValidState(): PostIngestionInput {
  const rawBulbasaur = '{"pokemon_id":1,"slug":"bulbasaur"}';
  const rawCharmander = '{"id":4,"name":"charmander"}';
  return {
    counts: {
      species: EXPECTED_SPECIES_COUNT,
      moves: EXPECTED_MOVES_COUNT,
      abilities: EXPECTED_ABILITIES_COUNT,
    },
    eligibility: knownValidEligibility(),
    learnableMoves: [
      { pokemon_id: 1, move_id: 33 },
      { pokemon_id: 25, move_id: 85 },
    ],
    pokemonAbilities: [
      { pokemon_id: 1, ability_id: 65 },
      { pokemon_id: 4, ability_id: 66 },
    ],
    catalogs: knownCatalogs(),
    resources: [
      { path: 'pokemon/1.json', bytes: rawBulbasaur },
      { path: 'pokemon/4.json', bytes: rawCharmander },
    ],
    manifest: [
      { path: 'pokemon/1.json', sha256: computeSha256(rawBulbasaur) },
      { path: 'pokemon/4.json', sha256: computeSha256(rawCharmander) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Req. 8.7 — estado válido conhecido aprova com issues vazio
// ---------------------------------------------------------------------------

describe('checklist de validação — estado válido conhecido (R8.7)', () => {
  it('aprova (passed:true, issues vazio) quando todas as verificações passam', () => {
    const outcome = validatePostIngestion(knownValidState());
    expect(outcome.passed).toBe(true);
    expect(outcome.issues).toEqual([]);
  });

  it('aprova de forma idempotente ao revalidar o mesmo estado', () => {
    const state = knownValidState();
    expect(validatePostIngestion(state).passed).toBe(true);
    expect(validatePostIngestion(state).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Req. 8.6 — estados inválidos conhecidos reprovam com check e ids corretos
// ---------------------------------------------------------------------------

describe('checklist de validação — estados inválidos conhecidos (R8.6)', () => {
  it('reprova com a contagem de espécies errada reportando esperado/obtido', () => {
    const state: PostIngestionInput = {
      ...knownValidState(),
      counts: {
        species: 145,
        moves: EXPECTED_MOVES_COUNT,
        abilities: EXPECTED_ABILITIES_COUNT,
      },
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0]?.check).toBe(VALIDATION_CHECKS.speciesCount);
    expect(outcome.issues[0]?.ids).toEqual([EXPECTED_SPECIES_COUNT, 145]);
  });

  it('reprova uma relação de golpe órfã reportando o par (pokemon_id, move_id)', () => {
    const state: PostIngestionInput = {
      ...knownValidState(),
      learnableMoves: [{ pokemon_id: 999, move_id: 33 }],
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);
    const issue = outcome.issues.find(
      (i) => i.check === VALIDATION_CHECKS.learnableMoveFk,
    );
    expect(issue?.ids).toEqual([999, 33]);
  });

  it('reprova uma relação de habilidade órfã reportando o par (pokemon_id, ability_id)', () => {
    const state: PostIngestionInput = {
      ...knownValidState(),
      pokemonAbilities: [{ pokemon_id: 1, ability_id: 999 }],
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);
    const issue = outcome.issues.find(
      (i) => i.check === VALIDATION_CHECKS.pokemonAbilityFk,
    );
    expect(issue?.ids).toEqual([1, 999]);
  });

  it('reprova um checksum divergente reportando o path do recurso alterado', () => {
    const base = knownValidState();
    const state: PostIngestionInput = {
      ...base,
      resources: [
        { path: 'pokemon/1.json', bytes: '{"pokemon_id":1,"slug":"bulbasaur"}' },
        { path: 'pokemon/4.json', bytes: '{"id":4,"name":"charmander"} ALTERADO' },
      ],
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);
    const issue = outcome.issues.find(
      (i) => i.check === VALIDATION_CHECKS.checksum,
    );
    expect(issue?.ids).toEqual(['pokemon/4.json']);
  });

  it('agrega múltiplas falhas conhecidas, cada uma com seu check e ids', () => {
    const state: PostIngestionInput = {
      ...knownValidState(),
      counts: {
        species: EXPECTED_SPECIES_COUNT,
        moves: 590,
        abilities: EXPECTED_ABILITIES_COUNT,
      },
      learnableMoves: [{ pokemon_id: 1, move_id: 7777 }],
      pokemonAbilities: [{ pokemon_id: 8888, ability_id: 65 }],
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);

    const byCheck = new Map(outcome.issues.map((i) => [i.check, i]));
    expect(byCheck.get(VALIDATION_CHECKS.movesCount)?.ids).toEqual([
      EXPECTED_MOVES_COUNT,
      590,
    ]);
    expect(byCheck.get(VALIDATION_CHECKS.learnableMoveFk)?.ids).toEqual([
      1, 7777,
    ]);
    expect(byCheck.get(VALIDATION_CHECKS.pokemonAbilityFk)?.ids).toEqual([
      8888, 65,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Req. 6.2 — exclusões de elegibilidade com os 5 ids = false
// ---------------------------------------------------------------------------

describe('checklist de validação — exclusões de elegibilidade (R6.2)', () => {
  it('os cinco ids excluídos são exatamente {144,145,146,150,151}', () => {
    expect(EXCLUDED_IDS_SORTED).toEqual([144, 145, 146, 150, 151]);
  });

  it('aprova quando os cinco ids excluídos estão com is_allowed = false', () => {
    const outcome = validatePostIngestion(knownValidState());
    expect(outcome.passed).toBe(true);
    expect(
      outcome.issues.some(
        (i) => i.check === VALIDATION_CHECKS.exclusionEligibility,
      ),
    ).toBe(false);
  });

  it.each(EXCLUDED_IDS_SORTED)(
    'reprova quando o id excluído %i está marcado como is_allowed = true',
    (excludedId) => {
      const base = knownValidState();
      const isAllowedById = new Map(base.eligibility.isAllowedById);
      isAllowedById.set(excludedId, true);
      const state: PostIngestionInput = {
        ...base,
        eligibility: { ...base.eligibility, isAllowedById },
      };
      const outcome = validatePostIngestion(state);
      expect(outcome.passed).toBe(false);
      const issue = outcome.issues.find(
        (i) => i.check === VALIDATION_CHECKS.exclusionEligibility,
      );
      expect(issue).toBeDefined();
      expect(issue?.ids).toEqual([excludedId]);
    },
  );

  it('reporta todos os cinco ids quando nenhum está confirmado como false', () => {
    const base = knownValidState();
    const isAllowedById = new Map<number, boolean>();
    for (const id of EXCLUDED_IDS_SORTED) {
      isAllowedById.set(id, true);
    }
    const state: PostIngestionInput = {
      ...base,
      eligibility: { allowedCount: 151, isAllowedById },
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);
    const issue = outcome.issues.find(
      (i) => i.check === VALIDATION_CHECKS.exclusionEligibility,
    );
    expect(issue?.ids).toEqual([144, 145, 146, 150, 151]);
  });

  it('trata um id excluído ausente do mapa como exclusão não confirmada', () => {
    const base = knownValidState();
    const isAllowedById = new Map(base.eligibility.isAllowedById);
    isAllowedById.delete(146);
    const state: PostIngestionInput = {
      ...base,
      eligibility: { ...base.eligibility, isAllowedById },
    };
    const outcome = validatePostIngestion(state);
    expect(outcome.passed).toBe(false);
    const issue = outcome.issues.find(
      (i) => i.check === VALIDATION_CHECKS.exclusionEligibility,
    );
    expect(issue?.ids).toEqual([146]);
  });
});
