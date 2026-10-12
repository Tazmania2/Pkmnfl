import { describe, expect, it, vi } from 'vitest';

/**
 * `seed.ts` importa `writer.ts`, que inicia com `import 'server-only'` — guarda
 * que lança fora de um contexto de servidor Next/RSC. Sob Vitest esse contexto
 * não existe; o módulo é substituído por um stub vazio, neutralizando apenas a
 * guarda de importação (o orquestrador usa escritores injetados, nunca os reais).
 */
vi.mock('server-only', () => ({}));

import {
  formatSeedReport,
  runSeed,
  type SeedSources,
  type SeedWriters,
} from './seed';
import { checkManifestChecksums, computeSha256, type RawResource } from './validate';
import type {
  AbilityRow,
  DesignBaselineRow,
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  LearnableMoveRow,
  MoveRow,
  PokemonAbilityRow,
  UpsertResult,
} from './types';
import type { ParseResult } from './loaders';

/**
 * Testes de exemplo/edge do orquestrador do `Processo_Seed` (`runSeed`,
 * Task 8.1).
 *
 * _Requirements: 1.1, 1.5, 2.1, 3.1, 4.1, 5.1, 6.1, 6.4, 7.3, 7.5, 11.1, 11.2_
 *
 * Os testes injetam fontes já carregadas e escritores em memória para exercitar
 * a conferência de checksum (abortagem pré-escrita), a ordem das seis fases, a
 * agregação de rejeições (leitura e escrita) e a convergência idempotente da
 * reexecução — sem disco nem Supabase reais.
 */

// ---------------------------------------------------------------------------
// Fixtures mínimas de origem
// ---------------------------------------------------------------------------

/** Monta uma ficha mínima válida com os golpes/habilidades informados. */
function ficha(
  pokemonId: number,
  moves: number[] = [],
  abilities: number[] = [],
): FichaEspecie {
  return {
    pokemon_id: pokemonId,
    slug: `mon-${pokemonId}`,
    name_display: `Mon ${pokemonId}`,
    eligible: true,
    source_uri: '',
    species_source_uri: '',
    official: {
      types: ['normal'],
      stats: {
        hp: 1,
        attack: 1,
        defense: 1,
        'special-attack': 1,
        'special-defense': 1,
        speed: 1,
      },
      height_dm: 1,
      weight_hg: 1,
      ability_options: abilities.map((id, i) => ({
        name: `ability-${id}`,
        id,
        is_hidden: false,
        slot: i + 1,
      })),
      learnable_moves: moves.map((id) => ({ id, name: `move-${id}`, version_details: [] })),
    },
  };
}

function move(id: number): GolpeEnriquecido {
  return { id, name: `move-${id}` };
}

function ability(id: number): HabilidadeEnriquecida {
  return { id, name: `ability-${id}` };
}

function parsed<T>(valid: T[], rejected: ParseResult<T>['rejected'] = []): ParseResult<T> {
  return { valid, rejected };
}

const BASELINE: DesignBaselineRow[] = [
  { version: 'D1', kind: 'matchups_36', status: 'PROPOSED_BALANCE_VALUE', payload: { a: 1 } },
  { version: 'D1', kind: 'simulation_parameters', status: 'FROZEN', payload: { b: 2 } },
];

/** Fontes com checksums coerentes (nenhuma divergência): recursos + manifest. */
function sourcesWithValidChecksums(overrides: Partial<SeedSources> = {}): SeedSources {
  const resource: RawResource = { path: 'fichas.json', bytes: '[{"pokemon_id":1}]' };
  return {
    fichas: parsed([ficha(1, [10], [100])]),
    moves: parsed([move(10)]),
    abilities: parsed([ability(100)]),
    baseline: BASELINE,
    manifest: [{ path: resource.path, sha256: computeSha256(resource.bytes) }],
    resources: [resource],
    // Índices reversos coerentes com a ficha padrão (move 10 → {1}, ability 100 → {1}),
    // de modo que a conciliação não aponte divergência por padrão.
    movesReverseIndex: { '10': [1] },
    abilitiesReverseIndex: { '100': [1] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Escritores em memória (idempotentes por chave) — espelham o contrato real
// ---------------------------------------------------------------------------

interface MemoryStore {
  readonly moves: Map<number, MoveRow>;
  readonly abilities: Map<number, AbilityRow>;
  readonly species: Map<number, SpeciesRowLike>;
  readonly learnable: Map<string, LearnableMoveRow>;
  readonly pokemonAbilities: Map<string, PokemonAbilityRow>;
  readonly baseline: Map<string, DesignBaselineRow>;
  readonly phaseOrder: string[];
}

type SpeciesRowLike = { pokemon_id: number; is_allowed: boolean };

function newStore(): MemoryStore {
  return {
    moves: new Map(),
    abilities: new Map(),
    species: new Map(),
    learnable: new Map(),
    pokemonAbilities: new Map(),
    baseline: new Map(),
    phaseOrder: [],
  };
}

/** Escritores que gravam num `MemoryStore` por chave, de forma idempotente. */
function memoryWriters(store: MemoryStore): SeedWriters {
  const result = (inserted: number): UpsertResult => ({ inserted, updated: 0, rejected: [] });

  return {
    upsertMoves: async (rows) => {
      store.phaseOrder.push('moves');
      for (const r of rows) store.moves.set(r.move_id, r);
      return result(rows.length);
    },
    upsertAbilities: async (rows) => {
      store.phaseOrder.push('abilities');
      for (const r of rows) store.abilities.set(r.ability_id, r);
      return result(rows.length);
    },
    upsertSpecies: async (rows) => {
      store.phaseOrder.push('species');
      for (const r of rows) store.species.set(r.pokemon_id, { pokemon_id: r.pokemon_id, is_allowed: r.is_allowed });
      return result(rows.length);
    },
    upsertLearnableMoves: async (rows) => {
      store.phaseOrder.push('learnable_moves');
      let rejected: UpsertResult['rejected'] = [];
      for (const r of rows) {
        // Valida FK contra as tabelas base, como o escritor real (R4.5).
        if (!store.species.has(r.pokemon_id) || !store.moves.has(r.move_id)) {
          rejected = [...rejected, { kind: 'pokemon_learnable_moves', key: r, reason: 'FK órfã' }];
          continue;
        }
        store.learnable.set(`${r.pokemon_id}:${r.move_id}`, r);
      }
      return { inserted: rows.length - rejected.length, updated: 0, rejected };
    },
    upsertPokemonAbilities: async (rows) => {
      store.phaseOrder.push('pokemon_abilities');
      let rejected: UpsertResult['rejected'] = [];
      for (const r of rows) {
        if (!store.species.has(r.pokemon_id) || !store.abilities.has(r.ability_id)) {
          rejected = [...rejected, { kind: 'pokemon_abilities', key: r, reason: 'FK órfã' }];
          continue;
        }
        store.pokemonAbilities.set(`${r.pokemon_id}:${r.ability_id}`, r);
      }
      return { inserted: rows.length - rejected.length, updated: 0, rejected };
    },
    upsertDesignBaseline: async (rows) => {
      store.phaseOrder.push('design_baseline');
      for (const r of rows) store.baseline.set(`${r.version}:${r.kind}`, r);
      return result(rows.length);
    },
  };
}

// ---------------------------------------------------------------------------
// Conferência de checksum (abortagem pré-escrita) — R8.5
// ---------------------------------------------------------------------------

describe('runSeed — conferência de checksum antes de escrever (R8.5)', () => {
  it('aborta sem executar nenhuma fase quando um checksum diverge', async () => {
    const store = newStore();
    const writers = memoryWriters(store);
    // Manifest declara um sha256 que não corresponde ao conteúdo do recurso.
    const sources = sourcesWithValidChecksums({
      manifest: [{ path: 'fichas.json', sha256: 'deadbeef' }],
    });

    const report = await runSeed({ sources, writers });

    expect(report.aborted).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.checksumIssues.length).toBeGreaterThan(0);
    expect(report.phases).toHaveLength(0);
    // Nenhuma escrita ocorreu (nenhuma fase foi chamada).
    expect(store.phaseOrder).toHaveLength(0);
    expect(store.moves.size).toBe(0);
  });

  it('prossegue para as fases quando os checksums conferem', async () => {
    const store = newStore();
    const report = await runSeed({ sources: sourcesWithValidChecksums(), writers: memoryWriters(store) });

    expect(report.aborted).toBe(false);
    expect(report.phases).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Ordem das fases (dependência de FK) — moves/abilities → species → relações
// ---------------------------------------------------------------------------

describe('runSeed — ordem das seis fases (dependência de FK)', () => {
  it('executa as fases exatamente na ordem do pipeline', async () => {
    const store = newStore();
    await runSeed({ sources: sourcesWithValidChecksums(), writers: memoryWriters(store) });

    expect(store.phaseOrder).toEqual([
      'moves',
      'abilities',
      'species',
      'learnable_moves',
      'pokemon_abilities',
      'design_baseline',
    ]);
    expect(store.phaseOrder.indexOf('species')).toBeLessThan(store.phaseOrder.indexOf('learnable_moves'));
    expect(store.phaseOrder.indexOf('moves')).toBeLessThan(store.phaseOrder.indexOf('learnable_moves'));
  });

  it('marca is_allowed via toSpeciesRow (R6.1, R6.4)', async () => {
    const store = newStore();
    // 150 (Mewtwo) é excluído → is_allowed=false; 1 é permitido → true.
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1), ficha(150)]),
      moves: parsed([]),
      abilities: parsed([]),
    });

    await runSeed({ sources, writers: memoryWriters(store) });

    expect(store.species.get(1)!.is_allowed).toBe(true);
    expect(store.species.get(150)!.is_allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Agregação de rejeições (leitura e escrita) sem interromper (R1.5, R4.5, R5.4)
// ---------------------------------------------------------------------------

describe('runSeed — rejeições não interrompem o pipeline', () => {
  it('agrega as rejeições de leitura das fontes (R1.5)', async () => {
    const store = newStore();
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1, [10], [100])], [{ index: 2, reason: 'slug ausente', value: {} }]),
    });

    const report = await runSeed({ sources, writers: memoryWriters(store) });

    expect(report.ok).toBe(false);
    expect(report.sourceRejections).toHaveLength(1);
    expect(report.sourceRejections[0]!.reason).toBe('slug ausente');
    // Apesar da rejeição de leitura, todas as fases executaram.
    expect(report.phases).toHaveLength(6);
  });

  it('registra relações com FK órfã e persiste as demais (R4.5, R5.4)', async () => {
    const store = newStore();
    // Ficha referencia move 10 (existe) e move 999 (ausente) → 999 é órfão.
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1, [10, 999], [100])]),
      moves: parsed([move(10)]),
      abilities: parsed([ability(100)]),
    });

    const report = await runSeed({ sources, writers: memoryWriters(store) });

    const learnablePhase = report.phases.find((p) => p.phase === 'learnable_moves')!;
    expect(learnablePhase.result.rejected).toHaveLength(1);
    expect(learnablePhase.result.inserted).toBe(1);
    // O par válido foi gravado; o órfão não.
    expect(store.learnable.has('1:10')).toBe(true);
    expect(store.learnable.has('1:999')).toBe(false);
    expect(report.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotência / convergência da reexecução (R7.3, R7.5)
// ---------------------------------------------------------------------------

describe('runSeed — reexecução converge sem duplicatas (R7.3, R7.5)', () => {
  it('aplicar o seed N vezes produz o mesmo estado final', async () => {
    const store = newStore();
    const writers = memoryWriters(store);
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1, [10], [100]), ficha(2, [10], [100])]),
      moves: parsed([move(10)]),
      abilities: parsed([ability(100)]),
    });

    await runSeed({ sources, writers });
    const snapshot = {
      moves: store.moves.size,
      abilities: store.abilities.size,
      species: store.species.size,
      learnable: store.learnable.size,
      pokemonAbilities: store.pokemonAbilities.size,
      baseline: store.baseline.size,
    };

    // Reexecuções sucessivas não devem alterar as contagens (sem duplicatas).
    await runSeed({ sources, writers });
    await runSeed({ sources, writers });

    expect(store.moves.size).toBe(snapshot.moves);
    expect(store.abilities.size).toBe(snapshot.abilities);
    expect(store.species.size).toBe(snapshot.species);
    expect(store.learnable.size).toBe(snapshot.learnable);
    expect(store.pokemonAbilities.size).toBe(snapshot.pokemonAbilities);
    expect(store.baseline.size).toBe(snapshot.baseline);
    // Confirmação concreta das chaves derivadas/deduplicadas.
    expect(store.learnable.size).toBe(2); // (1,10) e (2,10)
    expect(store.baseline.size).toBe(2); // (D1,matchups_36) e (D1,simulation_parameters)
  });
});

// ---------------------------------------------------------------------------
// Conciliação final das relações contra os índices reversos (R4.3, R4.4, R5.3)
// ---------------------------------------------------------------------------

describe('runSeed — conciliação final das relações (R4.3, R4.4, R5.3)', () => {
  it('não reporta divergência quando os conjuntos coincidem com os índices', async () => {
    const store = newStore();
    // Fichas 1 e 2 aprendem o move 10 e têm a ability 100 → derivados {1,2}.
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1, [10], [100]), ficha(2, [10], [100])]),
      moves: parsed([move(10)]),
      abilities: parsed([ability(100)]),
      movesReverseIndex: { '10': [1, 2] },
      abilitiesReverseIndex: { '100': [1, 2] },
    });

    const report = await runSeed({ sources, writers: memoryWriters(store) });

    expect(report.reconDiffs.moves).toHaveLength(0);
    expect(report.reconDiffs.abilities).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it('sinaliza falha e lista only_in_db/only_in_index por id divergente (R4.4, R5.3)', async () => {
    const store = newStore();
    // Derivado move 10 → {1}; índice declara {1,2} → 2 só no índice.
    // Derivado ability 100 → {1}; índice declara {} → 1 só na gravação.
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1, [10], [100])]),
      moves: parsed([move(10)]),
      abilities: parsed([ability(100)]),
      movesReverseIndex: { '10': [1, 2] },
      abilitiesReverseIndex: {},
    });

    const report = await runSeed({ sources, writers: memoryWriters(store) });

    expect(report.ok).toBe(false);
    expect(report.reconDiffs.moves).toEqual([
      { id: 10, only_in_db: [], only_in_index: [2] },
    ]);
    expect(report.reconDiffs.abilities).toEqual([
      { id: 100, only_in_db: [1], only_in_index: [] },
    ]);
    // A divergência de conciliação não impede a execução das seis fases.
    expect(report.phases).toHaveLength(6);
  });

  it('deriva os conjuntos das relações efetivamente gravadas (dedup por par)', async () => {
    const store = newStore();
    // Ficha repete o par (1,10) duas vezes; a dedup produz um único pokemon_id.
    const sources = sourcesWithValidChecksums({
      fichas: parsed([ficha(1, [10, 10], [100])]),
      moves: parsed([move(10)]),
      abilities: parsed([ability(100)]),
      movesReverseIndex: { '10': [1] },
      abilitiesReverseIndex: { '100': [1] },
    });

    const report = await runSeed({ sources, writers: memoryWriters(store) });

    expect(report.reconDiffs.moves).toHaveLength(0);
    expect(report.reconDiffs.abilities).toHaveLength(0);
    expect(report.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkManifestChecksums usado como padrão (coerência com validate.ts)
// ---------------------------------------------------------------------------

describe('runSeed — usa checkManifestChecksums por padrão', () => {
  it('não aborta quando o verificador padrão aprova os checksums', async () => {
    const store = newStore();
    const sources = sourcesWithValidChecksums();
    // Sanidade: o verificador padrão realmente aprova estas fontes.
    expect(checkManifestChecksums(sources.resources, sources.manifest)).toHaveLength(0);

    const report = await runSeed({ sources, writers: memoryWriters(store) });
    expect(report.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Relatório legível
// ---------------------------------------------------------------------------

describe('formatSeedReport', () => {
  it('descreve a abortagem por checksum', () => {
    const text = formatSeedReport({
      ok: false,
      aborted: true,
      checksumIssues: [{ check: 'manifest_sha256', detail: 'sha256 divergente para fichas.json' }],
      sourceRejections: [],
      phases: [],
      reconDiffs: { moves: [], abilities: [] },
    });
    expect(text).toContain('ABORTADO');
    expect(text).toContain('fichas.json');
  });

  it('resume as fases concluídas com rejeições', () => {
    const text = formatSeedReport({
      ok: false,
      aborted: false,
      checksumIssues: [],
      sourceRejections: [{ index: 0, reason: 'x', value: {} }],
      phases: [{ phase: 'moves', result: { inserted: 591, updated: 0, rejected: [] } }],
      reconDiffs: { moves: [], abilities: [] },
    });
    expect(text).toContain('CONCLUÍDO COM REJEIÇÕES');
    expect(text).toContain('[moves] 591 gravada(s)');
    expect(text).toContain('1 registro(s) de origem rejeitado(s)');
  });

  it('lista as divergências de conciliação por id (R4.4, R5.3)', () => {
    const text = formatSeedReport({
      ok: false,
      aborted: false,
      checksumIssues: [],
      sourceRejections: [],
      phases: [],
      reconDiffs: {
        moves: [{ id: 10, only_in_db: [2], only_in_index: [3] }],
        abilities: [{ id: 100, only_in_db: [], only_in_index: [5] }],
      },
    });
    expect(text).toContain('[conciliação golpes]');
    expect(text).toContain('id 10: only_in_db=[2] only_in_index=[3]');
    expect(text).toContain('[conciliação habilidades]');
    expect(text).toContain('id 100: only_in_db=[] only_in_index=[5]');
  });
});
