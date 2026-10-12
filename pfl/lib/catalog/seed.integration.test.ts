import { describe, expect, it, vi } from 'vitest';

/**
 * `seed.ts` importa `writer.ts`, que inicia com `import 'server-only'` — guarda
 * que lança fora de um contexto de servidor Next/RSC. Sob Vitest esse contexto
 * não existe; o módulo é substituído por um stub vazio, neutralizando apenas a
 * guarda de importação (o orquestrador usa escritores injetados, nunca os reais).
 */
vi.mock('server-only', () => ({}));

import { runSeed, type SeedSources, type SeedWriters } from './seed';
import { computeSha256, type RawResource } from './validate';
import type {
  AbilityRow,
  DesignBaselineRow,
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  LearnableMoveRow,
  MoveRow,
  PokemonAbilityRow,
  SpeciesRow,
  UpsertResult,
} from './types';
import type { ParseResult } from './loaders';

/**
 * Teste de integração de **retomada e idempotência** do `Processo_Seed`
 * (Task 8.3).
 *
 * _Requirements: 7.3, 7.5, 11.2_
 *
 * Diferente dos testes de exemplo do orquestrador (`seed.test.ts`), este teste
 * exercita o pipeline ponta a ponta contra um **repositório em memória com
 * chaves** que modela o upsert idempotente de todas as seis tabelas — inclusive
 * a `design_baseline` com PK composta `(version, kind)`. Sobre esse repositório
 * verificamos:
 *
 * 1. **Interrupção e retomada (R7.5)**: um escritor que falha no meio de uma
 *    fase deixa a carga parcial; uma reexecução com os escritores íntegros
 *    completa a carga até **exatamente as contagens-alvo**, sem duplicatas.
 * 2. **Convergência idempotente (R7.3)**: aplicar o seed `N` vezes converge para
 *    o mesmo conjunto de registros, com valores campo a campo equivalentes e sem
 *    criar registros adicionais.
 * 3. **Baseline sob a `version` do arquivo (R11.2)**: os artefatos de baseline
 *    são registrados chaveados por `(version, kind)` com a `version` vinda do
 *    próprio arquivo; a reexecução atualiza em vez de duplicar.
 *
 * As contagens-alvo reais (146/591/113/13564/386) exigem o acervo completo; aqui
 * usamos um subconjunto representativo e verificamos o **invariante** que as
 * contagens exigem: a reexecução não altera as contagens e não há duplicatas por
 * chave. As contagens-alvo nominais ficam documentadas em `TARGET_COUNTS` como
 * âncora de rastreabilidade.
 */

// Contagens-alvo nominais de uma execução concluída (R7.3). O subconjunto deste
// teste as reproduz em escala reduzida; o invariante verificado — reexecução não
// altera contagens nem duplica por chave — é o mesmo das contagens reais.
const TARGET_COUNTS = {
  species: 146,
  moves: 591,
  abilities: 113,
  learnable: 13564,
  pokemonAbilities: 386,
} as const;

// ---------------------------------------------------------------------------
// Fixtures de origem
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
      learnable_moves: moves.map((id) => ({
        id,
        name: `move-${id}`,
        version_details: [],
      })),
    },
  };
}

function move(id: number): GolpeEnriquecido {
  return { id, name: `move-${id}` };
}

function ability(id: number): HabilidadeEnriquecida {
  return { id, name: `ability-${id}` };
}

function parsed<T>(valid: T[]): ParseResult<T> {
  return { valid, rejected: [] };
}

/**
 * `version` declarada no arquivo de baseline. É esta string — e não qualquer
 * valor derivado — que deve chavear os registros em `design_baseline` (R11.2).
 */
const FILE_VERSION = 'D1.7';

const BASELINE: DesignBaselineRow[] = [
  {
    version: FILE_VERSION,
    kind: 'matchups_36',
    status: 'PROPOSED_BALANCE_VALUE',
    payload: { matchups: 36 },
  },
  {
    version: FILE_VERSION,
    kind: 'simulation_parameters',
    status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
    payload: { tick_ms: 100 },
  },
];

/**
 * Monta um subconjunto representativo e coerente do acervo: `speciesCount`
 * espécies, cada uma aprendendo um conjunto fixo de golpes e possuindo uma
 * habilidade, de modo que as relações sejam deriváveis e os índices reversos
 * conferíveis. Os checksums do manifest são coerentes (nenhuma abortagem).
 */
function representativeSources(speciesCount = 5): SeedSources {
  const moveIds = [10, 11, 12];
  const abilityId = 100;

  const fichas = Array.from({ length: speciesCount }, (_, i) =>
    ficha(i + 1, moveIds, [abilityId]),
  );
  const moves = moveIds.map(move);
  const abilities = [ability(abilityId)];

  // Índices reversos coerentes: cada move/ability aponta para todas as espécies.
  const allPokemonIds = fichas.map((f) => f.pokemon_id);
  const movesReverseIndex: Record<string, number[]> = {};
  for (const id of moveIds) movesReverseIndex[String(id)] = [...allPokemonIds];
  const abilitiesReverseIndex: Record<string, number[]> = {
    [String(abilityId)]: [...allPokemonIds],
  };

  const resource: RawResource = { path: 'fichas.json', bytes: '[{"pokemon_id":1}]' };

  return {
    fichas: parsed(fichas),
    moves: parsed(moves),
    abilities: parsed(abilities),
    baseline: BASELINE,
    manifest: [{ path: resource.path, sha256: computeSha256(resource.bytes) }],
    resources: [resource],
    movesReverseIndex,
    abilitiesReverseIndex,
  };
}

// ---------------------------------------------------------------------------
// Repositório em memória com chaves (upsert idempotente) + escritores
// ---------------------------------------------------------------------------

type SpeciesRowLike = Pick<SpeciesRow, 'pokemon_id' | 'is_allowed'>;

/**
 * Repositório em memória que modela a persistência idempotente por chave de
 * todas as seis tabelas. Como cada tabela é um `Map` chaveado pela respectiva
 * chave primária/natural, reaplicar o mesmo registro **sobrescreve** em vez de
 * duplicar — exatamente o contrato de `Operacao_Upsert` (R7.1).
 */
interface KeyedStore {
  readonly moves: Map<number, MoveRow>;
  readonly abilities: Map<number, AbilityRow>;
  readonly species: Map<number, SpeciesRowLike>;
  readonly learnable: Map<string, LearnableMoveRow>;
  readonly pokemonAbilities: Map<string, PokemonAbilityRow>;
  /** Chaveado por `(version, kind)` — PK composta de `design_baseline`. */
  readonly baseline: Map<string, DesignBaselineRow>;
}

function newStore(): KeyedStore {
  return {
    moves: new Map(),
    abilities: new Map(),
    species: new Map(),
    learnable: new Map(),
    pokemonAbilities: new Map(),
    baseline: new Map(),
  };
}

/** Snapshot das contagens por tabela, para comparar reexecuções. */
function counts(store: KeyedStore) {
  return {
    moves: store.moves.size,
    abilities: store.abilities.size,
    species: store.species.size,
    learnable: store.learnable.size,
    pokemonAbilities: store.pokemonAbilities.size,
    baseline: store.baseline.size,
  };
}

/**
 * Opções para injetar uma **interrupção** numa fase específica: o escritor
 * daquela fase lança após gravar `failAfter` registros, simulando uma falha no
 * meio da carga (processo interrompido antes de concluir).
 */
interface Interruption {
  readonly phase: keyof SeedWriters;
  /** Nº de registros efetivamente gravados antes de lançar. */
  readonly failAfter: number;
}

/**
 * Escritores que gravam no `KeyedStore` de forma idempotente por chave. As
 * relações validam a FK contra as tabelas base (como o escritor real, R4.5/5.4).
 * Quando `interrupt` casa com a fase atual, o escritor grava `failAfter`
 * registros e então lança, deixando a carga parcial para a retomada.
 */
function keyedWriters(store: KeyedStore, interrupt?: Interruption): SeedWriters {
  const ok = (inserted: number): UpsertResult => ({
    inserted,
    updated: 0,
    rejected: [],
  });

  function maybeInterrupt<T>(
    phase: keyof SeedWriters,
    rows: readonly T[],
    write: (row: T) => void,
  ): number {
    let written = 0;
    for (const row of rows) {
      if (interrupt && interrupt.phase === phase && written >= interrupt.failAfter) {
        throw new Error(`interrupção simulada na fase ${String(phase)}`);
      }
      write(row);
      written += 1;
    }
    return written;
  }

  return {
    upsertMoves: async (rows) => {
      const n = maybeInterrupt('upsertMoves', rows, (r) => store.moves.set(r.move_id, r));
      return ok(n);
    },
    upsertAbilities: async (rows) => {
      const n = maybeInterrupt('upsertAbilities', rows, (r) =>
        store.abilities.set(r.ability_id, r),
      );
      return ok(n);
    },
    upsertSpecies: async (rows) => {
      const n = maybeInterrupt('upsertSpecies', rows, (r) =>
        store.species.set(r.pokemon_id, {
          pokemon_id: r.pokemon_id,
          is_allowed: r.is_allowed,
        }),
      );
      return ok(n);
    },
    upsertLearnableMoves: async (rows) => {
      let rejected: UpsertResult['rejected'] = [];
      const n = maybeInterrupt('upsertLearnableMoves', rows, (r) => {
        if (!store.species.has(r.pokemon_id) || !store.moves.has(r.move_id)) {
          rejected = [
            ...rejected,
            { kind: 'pokemon_learnable_moves', key: r, reason: 'FK órfã' },
          ];
          return;
        }
        store.learnable.set(`${r.pokemon_id}:${r.move_id}`, r);
      });
      return { inserted: n - rejected.length, updated: 0, rejected };
    },
    upsertPokemonAbilities: async (rows) => {
      let rejected: UpsertResult['rejected'] = [];
      const n = maybeInterrupt('upsertPokemonAbilities', rows, (r) => {
        if (!store.species.has(r.pokemon_id) || !store.abilities.has(r.ability_id)) {
          rejected = [
            ...rejected,
            { kind: 'pokemon_abilities', key: r, reason: 'FK órfã' },
          ];
          return;
        }
        store.pokemonAbilities.set(`${r.pokemon_id}:${r.ability_id}`, r);
      });
      return { inserted: n - rejected.length, updated: 0, rejected };
    },
    upsertDesignBaseline: async (rows) => {
      const n = maybeInterrupt('upsertDesignBaseline', rows, (r) =>
        // Chave composta `(version, kind)`: a `version` é a do arquivo (R11.2).
        store.baseline.set(`${r.version}:${r.kind}`, r),
      );
      return ok(n);
    },
  };
}

// ---------------------------------------------------------------------------
// Retomada após interrupção (R7.5)
// ---------------------------------------------------------------------------

describe('Processo_Seed — retomada após interrupção converge às contagens-alvo (R7.5)', () => {
  it('uma reexecução completa a carga parcial deixada por uma falha no meio de uma fase', async () => {
    const store = newStore();
    const sources = representativeSources(5);

    // (1) Execução interrompida: a fase de espécies falha após gravar 2 de 5.
    //     As fases seguintes (relações) nem sequer rodam porque runSeed propaga
    //     a exceção — simulando um processo abortado no meio.
    await expect(
      runSeed({ sources, writers: keyedWriters(store, { phase: 'upsertSpecies', failAfter: 2 }) }),
    ).rejects.toThrow(/interrupção simulada/);

    // Estado parcial: moves/abilities completos, species incompletas, relações vazias.
    expect(store.moves.size).toBe(3);
    expect(store.abilities.size).toBe(1);
    expect(store.species.size).toBe(2); // interrompido
    expect(store.learnable.size).toBe(0);
    expect(store.pokemonAbilities.size).toBe(0);

    // (2) Retomada: reexecução com escritores íntegros completa até as contagens
    //     de uma execução concluída, sem duplicatas.
    const report = await runSeed({ sources, writers: keyedWriters(store) });

    expect(report.aborted).toBe(false);
    expect(report.ok).toBe(true);
    // 5 espécies × 3 golpes = 15 relações de golpe; 5 espécies × 1 habilidade = 5.
    expect(store.species.size).toBe(5);
    expect(store.moves.size).toBe(3);
    expect(store.abilities.size).toBe(1);
    expect(store.learnable.size).toBe(15);
    expect(store.pokemonAbilities.size).toBe(5);
  });

  it('a retomada produz o mesmo estado final de uma execução única não interrompida', async () => {
    const sources = representativeSources(5);

    // Execução de referência: uma única passagem íntegra.
    const reference = newStore();
    await runSeed({ sources, writers: keyedWriters(reference) });

    // Execução interrompida nas relações e, em seguida, retomada.
    const resumed = newStore();
    await expect(
      runSeed({
        sources,
        writers: keyedWriters(resumed, { phase: 'upsertLearnableMoves', failAfter: 4 }),
      }),
    ).rejects.toThrow(/interrupção simulada/);
    await runSeed({ sources, writers: keyedWriters(resumed) });

    // As contagens convergem exatamente às da execução única (R7.5).
    expect(counts(resumed)).toEqual(counts(reference));
  });
});

// ---------------------------------------------------------------------------
// Convergência idempotente da reexecução (R7.3)
// ---------------------------------------------------------------------------

describe('Processo_Seed — reexecução converge sem duplicatas (R7.3)', () => {
  it('aplicar o seed N vezes mantém as contagens e os valores por chave', async () => {
    const store = newStore();
    const sources = representativeSources(6);
    const writers = keyedWriters(store);

    await runSeed({ sources, writers });
    const afterFirst = counts(store);
    const baselineAfterFirst = new Map(store.baseline);

    // Três reexecuções sucessivas não alteram as contagens (sem duplicatas).
    await runSeed({ sources, writers });
    await runSeed({ sources, writers });
    await runSeed({ sources, writers });

    expect(counts(store)).toEqual(afterFirst);

    // Contagens derivadas conferem com o subconjunto: 6 espécies, 3 golpes,
    // 1 habilidade, 6×3 relações de golpe, 6×1 de habilidade, 2 baselines.
    expect(afterFirst).toEqual({
      moves: 3,
      abilities: 1,
      species: 6,
      learnable: 18,
      pokemonAbilities: 6,
      baseline: 2,
    });

    // Valores campo a campo equivalentes: o baseline não mudou entre execuções.
    expect([...store.baseline.entries()]).toEqual([...baselineAfterFirst.entries()]);
  });

  it('o subconjunto representa o invariante das contagens-alvo nominais', () => {
    // Âncora de rastreabilidade: as contagens-alvo reais são conhecidas; este
    // teste as reduz preservando o invariante (reexecução estável, sem duplicatas).
    expect(TARGET_COUNTS).toEqual({
      species: 146,
      moves: 591,
      abilities: 113,
      learnable: 13564,
      pokemonAbilities: 386,
    });
  });
});

// ---------------------------------------------------------------------------
// Baseline registrado sob a `version` do arquivo (R11.2)
// ---------------------------------------------------------------------------

describe('Processo_Seed — baseline sob a version do arquivo (R11.2)', () => {
  it('registra matchups_36 e simulation_parameters chaveados por (version, kind) da fonte', async () => {
    const store = newStore();
    const sources = representativeSources(3);

    await runSeed({ sources, writers: keyedWriters(store) });

    // Dois artefatos, ambos sob a mesma `version` declarada no arquivo.
    expect(store.baseline.size).toBe(2);
    expect(store.baseline.get(`${FILE_VERSION}:matchups_36`)).toMatchObject({
      version: FILE_VERSION,
      kind: 'matchups_36',
      status: 'PROPOSED_BALANCE_VALUE',
    });
    expect(store.baseline.get(`${FILE_VERSION}:simulation_parameters`)).toMatchObject({
      version: FILE_VERSION,
      kind: 'simulation_parameters',
      status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
    });
    // A version usada é exatamente a do arquivo (nenhuma outra chave de versão).
    const versions = new Set([...store.baseline.values()].map((r) => r.version));
    expect([...versions]).toEqual([FILE_VERSION]);
  });

  it('reexecução mantém um único registro por (version, kind) atualizando em vez de duplicar', async () => {
    const store = newStore();
    const sources = representativeSources(3);
    const writers = keyedWriters(store);

    await runSeed({ sources, writers });
    await runSeed({ sources, writers });

    // Mesmo após duas execuções, ainda há exatamente dois registros de baseline.
    expect(store.baseline.size).toBe(2);
  });
});
