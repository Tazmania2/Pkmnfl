import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EXCLUDED_POKEMON_IDS } from './allowed-species';
import type { ManifestEntry } from './types';
import {
  checkCounts,
  checkEligibility,
  checkLearnableMoveIntegrity,
  checkManifestChecksums,
  checkPokemonAbilityIntegrity,
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
 * Testes de exemplo/edge para as checagens do Processo_Validacao_Pos_Ingestao
 * (Task 7.1): SHA-256 vs. manifest, contagens e elegibilidade.
 *
 * _Requirements: 8.1, 8.2, 8.5_
 */

/** Constrói um EligibilityState válido (146 permitidas, exclusões = false). */
function validEligibility(): EligibilityState {
  const isAllowedById = new Map<number, boolean>();
  for (const id of EXCLUDED_POKEMON_IDS) {
    isAllowedById.set(id, false);
  }
  return { allowedCount: EXPECTED_ALLOWED_COUNT, isAllowedById };
}

describe('computeSha256 — recomputação determinística e byte-sensível (R8.5)', () => {
  it('recomputa o mesmo digest que node:crypto para um conteúdo', () => {
    const content = '{"pokemon_id":1,"slug":"bulbasaur"}';
    const expected = createHash('sha256').update(content, 'utf8').digest('hex');
    expect(computeSha256(content)).toBe(expected);
  });

  it('produz digests diferentes quando um único byte muda', () => {
    const a = computeSha256('abc');
    const b = computeSha256('abd');
    expect(a).not.toBe(b);
  });

  it('trata string UTF-8 e Uint8Array equivalentes de forma idêntica', () => {
    const text = 'héllo';
    const bytes = new TextEncoder().encode(text);
    expect(computeSha256(bytes)).toBe(computeSha256(text));
  });
});

describe('checkManifestChecksums — SHA-256 vs. manifest (R8.5)', () => {
  const content = '{"id":4,"name":"charmander"}';
  const sha256 = computeSha256(content);
  const manifest: ManifestEntry[] = [{ path: 'pokemon/4.json', sha256 }];

  it('não reporta problemas quando o conteúdo é íntegro', () => {
    const issues = checkManifestChecksums(
      [{ path: 'pokemon/4.json', bytes: content }],
      manifest,
    );
    expect(issues).toEqual([]);
  });

  it('reporta divergência quando o conteúdo é alterado', () => {
    const issues = checkManifestChecksums(
      [{ path: 'pokemon/4.json', bytes: content + ' ' }],
      manifest,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.check).toBe(VALIDATION_CHECKS.checksum);
    expect(issues[0]?.ids).toEqual(['pokemon/4.json']);
  });

  it('reporta recurso ausente para um path do manifest', () => {
    const issues = checkManifestChecksums([], manifest);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.ids).toEqual(['pokemon/4.json']);
  });

  it('compara o hex de forma case-insensitive', () => {
    const upper: ManifestEntry[] = [
      { path: 'pokemon/4.json', sha256: sha256.toUpperCase() },
    ];
    const issues = checkManifestChecksums(
      [{ path: 'pokemon/4.json', bytes: content }],
      upper,
    );
    expect(issues).toEqual([]);
  });

  it('ignora recursos fornecidos que não constam do manifest', () => {
    const issues = checkManifestChecksums(
      [
        { path: 'pokemon/4.json', bytes: content },
        { path: 'extra.json', bytes: 'noise' },
      ],
      manifest,
    );
    expect(issues).toEqual([]);
  });
});

describe('checkCounts — contagens vs. actual_counts (R8.1)', () => {
  it('aprova as contagens-alvo (146/591/113)', () => {
    const issues = checkCounts({
      species: EXPECTED_SPECIES_COUNT,
      moves: EXPECTED_MOVES_COUNT,
      abilities: EXPECTED_ABILITIES_COUNT,
    });
    expect(issues).toEqual([]);
  });

  it('reporta cada entidade cuja contagem difere do alvo', () => {
    const issues = checkCounts({ species: 145, moves: 591, abilities: 112 });
    const checks = issues.map((issue) => issue.check);
    expect(checks).toEqual([
      VALIDATION_CHECKS.speciesCount,
      VALIDATION_CHECKS.abilitiesCount,
    ]);
    expect(issues[0]?.ids).toEqual([EXPECTED_SPECIES_COUNT, 145]);
    expect(issues[1]?.ids).toEqual([EXPECTED_ABILITIES_COUNT, 112]);
  });
});

describe('checkEligibility — 146 allowed + exclusões (R8.2)', () => {
  it('aprova 146 permitidas com as exclusões em false', () => {
    expect(checkEligibility(validEligibility())).toEqual([]);
  });

  it('reporta contagem de permitidas incorreta', () => {
    const state: EligibilityState = { ...validEligibility(), allowedCount: 147 };
    const issues = checkEligibility(state);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.check).toBe(VALIDATION_CHECKS.allowedCount);
    expect(issues[0]?.ids).toEqual([EXPECTED_ALLOWED_COUNT, 147]);
  });

  it('reporta um id excluído marcado indevidamente como permitido', () => {
    const base = validEligibility();
    const isAllowedById = new Map(base.isAllowedById);
    isAllowedById.set(150, true);
    const issues = checkEligibility({ ...base, isAllowedById });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.check).toBe(VALIDATION_CHECKS.exclusionEligibility);
    expect(issues[0]?.ids).toEqual([150]);
  });

  it('trata id excluído ausente do mapa como exclusão não confirmada', () => {
    const base = validEligibility();
    const isAllowedById = new Map(base.isAllowedById);
    isAllowedById.delete(144);
    const issues = checkEligibility({ ...base, isAllowedById });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.ids).toEqual([144]);
  });

  it('reporta todos os ids excluídos violados em ordem crescente', () => {
    const isAllowedById = new Map<number, boolean>();
    for (const id of EXCLUDED_POKEMON_IDS) {
      isAllowedById.set(id, true);
    }
    const issues = checkEligibility({ allowedCount: 151, isAllowedById });
    const exclusion = issues.find(
      (issue) => issue.check === VALIDATION_CHECKS.exclusionEligibility,
    );
    expect(exclusion?.ids).toEqual([144, 145, 146, 150, 151]);
  });
});

/** Catálogos com um pequeno conjunto de ids existentes para os testes de FK. */
function sampleCatalogs(): CatalogIds {
  return {
    species: new Set([1, 2, 3]),
    moves: new Set([10, 20, 30]),
    abilities: new Set([100, 200]),
  };
}

describe('checkLearnableMoveIntegrity — FK de golpes aprendíveis (R8.3)', () => {
  it('não reporta problemas quando toda relação resolve as FKs', () => {
    const issues = checkLearnableMoveIntegrity(
      [
        { pokemon_id: 1, move_id: 10 },
        { pokemon_id: 2, move_id: 30 },
      ],
      sampleCatalogs(),
    );
    expect(issues).toEqual([]);
  });

  it('reporta órfã quando o move_id não existe', () => {
    const issues = checkLearnableMoveIntegrity(
      [{ pokemon_id: 1, move_id: 99 }],
      sampleCatalogs(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.check).toBe(VALIDATION_CHECKS.learnableMoveFk);
    expect(issues[0]?.ids).toEqual([1, 99]);
    expect(issues[0]?.detail).toContain('move_id 99');
  });

  it('reporta órfã quando o pokemon_id não existe', () => {
    const issues = checkLearnableMoveIntegrity(
      [{ pokemon_id: 999, move_id: 10 }],
      sampleCatalogs(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.ids).toEqual([999, 10]);
    expect(issues[0]?.detail).toContain('pokemon_id 999');
  });

  it('lista ambas as FKs quando pokemon_id e move_id são inexistentes', () => {
    const issues = checkLearnableMoveIntegrity(
      [{ pokemon_id: 999, move_id: 99 }],
      sampleCatalogs(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toContain('pokemon_id 999');
    expect(issues[0]?.detail).toContain('move_id 99');
  });

  it('reporta uma issue por relação órfã, preservando as válidas', () => {
    const issues = checkLearnableMoveIntegrity(
      [
        { pokemon_id: 1, move_id: 10 },
        { pokemon_id: 2, move_id: 99 },
        { pokemon_id: 999, move_id: 20 },
      ],
      sampleCatalogs(),
    );
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.ids)).toEqual([
      [2, 99],
      [999, 20],
    ]);
  });
});

describe('checkPokemonAbilityIntegrity — FK de habilidades (R8.4)', () => {
  it('não reporta problemas quando toda relação resolve as FKs', () => {
    const issues = checkPokemonAbilityIntegrity(
      [
        { pokemon_id: 1, ability_id: 100 },
        { pokemon_id: 3, ability_id: 200 },
      ],
      sampleCatalogs(),
    );
    expect(issues).toEqual([]);
  });

  it('reporta órfã quando o ability_id não existe', () => {
    const issues = checkPokemonAbilityIntegrity(
      [{ pokemon_id: 1, ability_id: 999 }],
      sampleCatalogs(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.check).toBe(VALIDATION_CHECKS.pokemonAbilityFk);
    expect(issues[0]?.ids).toEqual([1, 999]);
    expect(issues[0]?.detail).toContain('ability_id 999');
  });

  it('reporta órfã quando o pokemon_id não existe', () => {
    const issues = checkPokemonAbilityIntegrity(
      [{ pokemon_id: 777, ability_id: 100 }],
      sampleCatalogs(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.ids).toEqual([777, 100]);
    expect(issues[0]?.detail).toContain('pokemon_id 777');
  });
});

describe('validatePostIngestion — resultado agregado (R8.6/R8.7)', () => {
  /** Monta uma entrada totalmente íntegra (nenhuma verificação falha). */
  function validInput(): PostIngestionInput {
    const content = '{"id":4,"name":"charmander"}';
    return {
      counts: {
        species: EXPECTED_SPECIES_COUNT,
        moves: EXPECTED_MOVES_COUNT,
        abilities: EXPECTED_ABILITIES_COUNT,
      },
      eligibility: validEligibility(),
      learnableMoves: [{ pokemon_id: 1, move_id: 10 }],
      pokemonAbilities: [{ pokemon_id: 1, ability_id: 100 }],
      catalogs: sampleCatalogs(),
      resources: [{ path: 'pokemon/4.json', bytes: content }],
      manifest: [{ path: 'pokemon/4.json', sha256: computeSha256(content) }],
    };
  }

  it('aprova com issues vazio quando tudo é satisfeito', () => {
    const outcome = validatePostIngestion(validInput());
    expect(outcome.passed).toBe(true);
    expect(outcome.issues).toEqual([]);
  });

  it('reprova com passed:false quando qualquer verificação falha', () => {
    const input = { ...validInput(), counts: { species: 145, moves: 591, abilities: 113 } };
    const outcome = validatePostIngestion(input);
    expect(outcome.passed).toBe(false);
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0]?.check).toBe(VALIDATION_CHECKS.speciesCount);
  });

  it('agrega problemas de múltiplas verificações distintas', () => {
    const base = validInput();
    const input: PostIngestionInput = {
      ...base,
      counts: { species: 145, moves: EXPECTED_MOVES_COUNT, abilities: EXPECTED_ABILITIES_COUNT },
      learnableMoves: [{ pokemon_id: 999, move_id: 10 }],
      pokemonAbilities: [{ pokemon_id: 1, ability_id: 999 }],
    };
    const outcome = validatePostIngestion(input);
    expect(outcome.passed).toBe(false);
    const checks = outcome.issues.map((issue) => issue.check);
    expect(checks).toContain(VALIDATION_CHECKS.speciesCount);
    expect(checks).toContain(VALIDATION_CHECKS.learnableMoveFk);
    expect(checks).toContain(VALIDATION_CHECKS.pokemonAbilityFk);
  });

  it('reprova quando um checksum do manifest diverge', () => {
    const base = validInput();
    const input: PostIngestionInput = {
      ...base,
      resources: [{ path: 'pokemon/4.json', bytes: 'alterado' }],
    };
    const outcome = validatePostIngestion(input);
    expect(outcome.passed).toBe(false);
    expect(outcome.issues.map((issue) => issue.check)).toContain(
      VALIDATION_CHECKS.checksum,
    );
  });
});
