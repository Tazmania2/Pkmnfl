import { describe, expect, it, vi } from 'vitest';

/**
 * `validate-cli.ts` carrega `readDbStateFromSupabase` que importa dinamicamente
 * `../supabase/public-client`. O cliente público não inicia com `server-only`,
 * mas o neutralizamos por precaução de forma consistente com os demais testes;
 * os testes injetam `readDbState` e nunca atingem o cliente real do Supabase.
 */
vi.mock('server-only', () => ({}));

// Mock de `node:fs` para controlar `readFileSync` sem tocar o disco. O helper
// `fsMock.readFileSync` é configurado por teste em `loadExpectedCounts`.
const fsMock = vi.hoisted(() => ({ readFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: fsMock.readFileSync }));

import {
  assemblePostIngestionInput,
  formatValidationOutcome,
  loadExpectedCounts,
  runValidation,
  type DbState,
  type ExpectedCounts,
  type ValidateCliDeps,
  type ValidatePaths,
} from './validate-cli';
import { computeSha256, type RawResource } from './validate';
import { EXCLUDED_POKEMON_IDS } from './allowed-species';
import type { ManifestEntry } from './types';

// ---------------------------------------------------------------------------
// Fixtures: estado do banco "aprovável" + artefatos de validação coerentes
// ---------------------------------------------------------------------------

const EXPECTED: ExpectedCounts = { species: 146, moves: 591, abilities: 113 };

/** Estado do banco que satisfaz todas as verificações do núcleo puro. */
function passingDbState(): DbState {
  const isAllowedById = new Map<number, boolean>();
  for (const id of EXCLUDED_POKEMON_IDS) {
    isAllowedById.set(id, false);
  }
  return {
    counts: { species: 146, moves: 591, abilities: 113 },
    eligibility: { allowedCount: 146, isAllowedById },
    learnableMoves: [{ pokemon_id: 1, move_id: 10 }],
    pokemonAbilities: [{ pokemon_id: 1, ability_id: 100 }],
    catalogs: {
      species: new Set([1]),
      moves: new Set([10]),
      abilities: new Set([100]),
    },
  };
}

const RESOURCE: RawResource = { path: 'pokemon/1.json', bytes: '{"id":1}' };
const MANIFEST: ManifestEntry[] = [
  { path: RESOURCE.path, sha256: computeSha256(RESOURCE.bytes) },
];

const PATHS: ValidatePaths = {
  report: '/fake/VALIDATION_REPORT.json',
  manifest: '/fake/manifest.json',
  root: '/fake',
};

/** Monta deps injetadas a partir de um estado de banco e artefatos opcionais. */
function depsFor(
  dbState: DbState,
  overrides: Partial<ValidateCliDeps> = {},
): ValidateCliDeps {
  return {
    loadExpectedCounts: () => EXPECTED,
    loadManifest: () => MANIFEST,
    readRawResources: () => [RESOURCE],
    readDbState: async () => dbState,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runValidation — aprovação (passed = true)
// ---------------------------------------------------------------------------

describe('runValidation — estado íntegro aprova', () => {
  it('retorna passed=true e issues vazio quando tudo está correto', async () => {
    const outcome = await runValidation(PATHS, depsFor(passingDbState()));
    expect(outcome.passed).toBe(true);
    expect(outcome.issues).toHaveLength(0);
  });

  it('encaminha as contagens esperadas à leitura do banco', async () => {
    const readDbState = vi.fn(async (_e: ExpectedCounts) => passingDbState());
    await runValidation(PATHS, depsFor(passingDbState(), { readDbState }));
    expect(readDbState).toHaveBeenCalledWith(EXPECTED);
  });
});

// ---------------------------------------------------------------------------
// runValidation — falhas por verificação, com ids reportados (Req. 8.6)
// ---------------------------------------------------------------------------

describe('runValidation — detecta falhas e reporta ids', () => {
  it('falha quando as contagens divergem (Req. 8.1)', async () => {
    const state = { ...passingDbState(), counts: { species: 145, moves: 591, abilities: 113 } };
    const outcome = await runValidation(PATHS, depsFor(state));
    expect(outcome.passed).toBe(false);
    expect(outcome.issues.some((i) => i.check === 'species_count')).toBe(true);
  });

  it('falha quando uma espécie excluída está marcada como permitida (Req. 8.2)', async () => {
    const state = passingDbState();
    const isAllowedById = new Map(state.eligibility.isAllowedById);
    isAllowedById.set(150, true); // Mewtwo indevidamente permitido.
    const outcome = await runValidation(
      PATHS,
      depsFor({ ...state, eligibility: { ...state.eligibility, isAllowedById } }),
    );
    const issue = outcome.issues.find((i) => i.check === 'excluded_species_eligibility');
    expect(issue).toBeDefined();
    expect(issue?.ids).toContain(150);
  });

  it('falha e reporta o par órfão de golpe aprendível (Req. 8.3)', async () => {
    const state = passingDbState();
    const outcome = await runValidation(
      PATHS,
      depsFor({ ...state, learnableMoves: [{ pokemon_id: 1, move_id: 999 }] }),
    );
    const issue = outcome.issues.find(
      (i) => i.check === 'learnable_move_referential_integrity',
    );
    expect(issue).toBeDefined();
    expect(issue?.ids).toEqual([1, 999]);
  });

  it('falha quando um checksum do manifest diverge (Req. 8.5)', async () => {
    const outcome = await runValidation(
      PATHS,
      depsFor(passingDbState(), {
        loadManifest: () => [{ path: RESOURCE.path, sha256: 'deadbeef' }],
      }),
    );
    const issue = outcome.issues.find((i) => i.check === 'manifest_sha256');
    expect(issue).toBeDefined();
    expect(issue?.ids).toContain(RESOURCE.path);
  });
});

// ---------------------------------------------------------------------------
// assemblePostIngestionInput — combina estado do banco + artefatos
// ---------------------------------------------------------------------------

describe('assemblePostIngestionInput', () => {
  it('combina estado do banco, manifest e recursos no PostIngestionInput', () => {
    const state = passingDbState();
    const input = assemblePostIngestionInput(state, MANIFEST, [RESOURCE]);
    expect(input.counts).toBe(state.counts);
    expect(input.eligibility).toBe(state.eligibility);
    expect(input.learnableMoves).toBe(state.learnableMoves);
    expect(input.pokemonAbilities).toBe(state.pokemonAbilities);
    expect(input.catalogs).toBe(state.catalogs);
    expect(input.manifest).toBe(MANIFEST);
    expect(input.resources).toEqual([RESOURCE]);
  });
});

// ---------------------------------------------------------------------------
// loadExpectedCounts — leitura/validação do VALIDATION_REPORT.json
// ---------------------------------------------------------------------------

describe('loadExpectedCounts', () => {
  it('lê as contagens de actual_counts do acervo v1.7', () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        actual_counts: {
          pokemon_fichas: 146,
          move_jsons: 591,
          ability_jsons: 113,
        },
        validation_passed: true,
      }),
    );
    expect(loadExpectedCounts('/tmp/validation-report.json')).toEqual({
      species: 146,
      moves: 591,
      abilities: 113,
    });
  });

  it('lança quando actual_counts está ausente', () => {
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ validation_passed: true }));
    expect(() => loadExpectedCounts('/tmp/bad.json')).toThrow(/actual_counts/);
  });
});

// ---------------------------------------------------------------------------
// formatValidationOutcome — relatório legível com ids (Req. 8.6)
// ---------------------------------------------------------------------------

describe('formatValidationOutcome', () => {
  it('confirma aprovação quando passed', () => {
    const text = formatValidationOutcome({ passed: true, issues: [] });
    expect(text).toContain('APROVADO');
  });

  it('lista cada verificação com check, detail e ids em falha', () => {
    const text = formatValidationOutcome({
      passed: false,
      issues: [
        { check: 'species_count', detail: 'contagem incorreta', ids: [146, 145] },
        { check: 'manifest_sha256', detail: 'sha256 divergente', ids: ['pokemon/1.json'] },
      ],
    });
    expect(text).toContain('FALHA');
    expect(text).toContain('[species_count] contagem incorreta');
    expect(text).toContain('ids: 146, 145');
    expect(text).toContain('[manifest_sha256]');
    expect(text).toContain('pokemon/1.json');
  });
});
