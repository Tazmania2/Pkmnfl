/**
 * Escritor idempotente do Catálogo Oficial (spec `pfl-data-catalog`).
 *
 * Este módulo encapsula os *upserts* das entidades base do catálogo —
 * `moves`, `abilities` e `species` — reutilizando o cliente service-role da
 * `pfl-foundation` ({@link createServerClient}). A idempotência vem da chave
 * primária de cada tabela: o upsert tem como alvo o `ON CONFLICT` da PK
 * respectiva (`move_id`, `ability_id`, `pokemon_id`), de modo que uma
 * reexecução atualize os registros existentes sem duplicá-los (R7.1, R7.2).
 *
 * As escritas operam em lotes transacionais. Em falha de um lote, apenas
 * aquele lote é descartado — as linhas são registradas em `rejected` com o
 * motivo do erro — enquanto os lotes já confirmados permanecem íntegros
 * (R7.4). Entradas inválidas (sem chave) são rejeitadas e reportadas sem
 * interromper o processamento das demais.
 *
 * Cada escrita retorna um {@link UpsertResult} com `inserted`/`updated`/
 * `rejected` (R7.3).
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4_
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerClient } from '../supabase/server-client';
import type {
  AbilityRow,
  DesignBaselineRow,
  LearnableMoveRow,
  MoveRow,
  PokemonAbilityRow,
  RejectedRecord,
  SpeciesRow,
  UpsertResult,
} from './types';

/**
 * Nome das tabelas-alvo das escritas de entidade base. Isolar os nomes em
 * constantes torna explícito o destino de cada upsert e evita literais soltos.
 */
export const MOVES_TABLE = 'moves' as const;
export const ABILITIES_TABLE = 'abilities' as const;
export const SPECIES_TABLE = 'species' as const;

/** Coluna de PK, alvo do `ON CONFLICT` do upsert idempotente de cada tabela. */
export const MOVES_CONFLICT_TARGET = 'move_id' as const;
export const ABILITIES_CONFLICT_TARGET = 'ability_id' as const;
export const SPECIES_CONFLICT_TARGET = 'pokemon_id' as const;

/** Tamanho padrão de lote para o upsert em bloco. */
const DEFAULT_BATCH_SIZE = 500;

/**
 * Dependências injetáveis dos escritores. Em produção, o cliente é criado via
 * {@link createServerClient}; os testes podem fornecer um dublê para evitar
 * I/O real.
 */
export interface CatalogWriterDeps {
  /** Cliente Supabase service-role (padrão: {@link createServerClient}). */
  readonly client?: SupabaseClient;
  /** Tamanho de lote para o upsert (padrão: {@link DEFAULT_BATCH_SIZE}). */
  readonly batchSize?: number;
}

/** Resolve o tamanho de lote efetivo, caindo no padrão quando inválido. */
function resolveBatchSize(batchSize: number | undefined): number {
  return batchSize !== undefined && batchSize > 0
    ? Math.floor(batchSize)
    : DEFAULT_BATCH_SIZE;
}

/**
 * Núcleo compartilhado do upsert idempotente em lotes transacionais.
 *
 * Separa as linhas válidas das inválidas (chave ausente/vazia) com base no
 * `keyExtractor`, grava as válidas em lotes com `ON CONFLICT (conflictTarget)`
 * e, em falha de um lote, registra o motivo por linha em `rejected` mantendo
 * os lotes já confirmados (R7.4). Retorna o {@link UpsertResult} agregado.
 *
 * O upsert em bloco não distingue, por padrão, inserções de atualizações; por
 * isso o resultado contabiliza as linhas efetivamente gravadas em `inserted`
 * (semântica de "linhas afetadas") e mantém `updated` em zero. A idempotência
 * é garantida pela chave primária, não pela contagem (R7.1, R7.2).
 *
 * @typeParam Row Tipo da linha de banco a persistir.
 * @param rows Linhas a gravar.
 * @param options Configuração da escrita (tabela, chave, extrator, deps).
 */
async function upsertByKey<Row>(
  rows: readonly Row[],
  options: {
    readonly table: string;
    readonly conflictTarget: string;
    /** Extrai a chave; retorna `null` quando ausente/inválida (rejeita a linha). */
    readonly keyExtractor: (row: Row) => number | string | null;
    readonly deps: CatalogWriterDeps;
  },
): Promise<UpsertResult> {
  const { table, conflictTarget, keyExtractor, deps } = options;
  const batchSize = resolveBatchSize(deps.batchSize);

  const rejected: RejectedRecord[] = [];
  const valid: Row[] = [];

  for (const row of rows) {
    const key = keyExtractor(row);
    if (key === null) {
      rejected.push({
        kind: table,
        key,
        reason: `chave de conciliação (${conflictTarget}) ausente ou inválida`,
      });
      continue;
    }
    valid.push(row);
  }

  if (valid.length === 0) {
    return { inserted: 0, updated: 0, rejected };
  }

  const client = deps.client ?? createServerClient();

  let inserted = 0;
  for (let start = 0; start < valid.length; start += batchSize) {
    const batch = valid.slice(start, start + batchSize);
    const { data, error } = await client
      .from(table)
      // O cliente Supabase exige linhas sem propriedades excedentes; o helper é
      // genérico sobre as linhas tipadas do catálogo, então repassamos como
      // registro simples (a validação de forma vive nos tipos *Row de origem).
      .upsert(batch as unknown as Record<string, unknown>[], { onConflict: conflictTarget })
      .select(conflictTarget);

    if (error !== null) {
      // Falha de lote: rollback do lote (nenhuma linha confirmada), registro do
      // motivo por linha e continuação com os demais lotes (R7.4).
      for (const row of batch) {
        rejected.push({
          kind: table,
          key: keyExtractor(row),
          reason: error.message,
        });
      }
      continue;
    }

    inserted += Array.isArray(data) ? data.length : batch.length;
  }

  return { inserted, updated: 0, rejected };
}

/**
 * Faz o upsert idempotente dos golpes em `moves` com `ON CONFLICT (move_id)`
 * (R7.1). Linhas sem `move_id` válido (não numérico finito) são rejeitadas e
 * reportadas sem interromper as demais.
 *
 * @param rows Linhas de golpe a persistir.
 * @param deps Dependências injetáveis (cliente, lote) para teste.
 * @returns {@link UpsertResult} com totais e eventuais rejeições.
 */
export async function upsertMoves(
  rows: readonly MoveRow[],
  deps: CatalogWriterDeps = {},
): Promise<UpsertResult> {
  return upsertByKey(rows, {
    table: MOVES_TABLE,
    conflictTarget: MOVES_CONFLICT_TARGET,
    keyExtractor: (row) =>
      typeof row.move_id === 'number' && Number.isFinite(row.move_id)
        ? row.move_id
        : null,
    deps,
  });
}

/**
 * Faz o upsert idempotente das habilidades em `abilities` com
 * `ON CONFLICT (ability_id)` (R7.1). Linhas sem `ability_id` válido são
 * rejeitadas e reportadas sem interromper as demais.
 *
 * @param rows Linhas de habilidade a persistir.
 * @param deps Dependências injetáveis (cliente, lote) para teste.
 * @returns {@link UpsertResult} com totais e eventuais rejeições.
 */
export async function upsertAbilities(
  rows: readonly AbilityRow[],
  deps: CatalogWriterDeps = {},
): Promise<UpsertResult> {
  return upsertByKey(rows, {
    table: ABILITIES_TABLE,
    conflictTarget: ABILITIES_CONFLICT_TARGET,
    keyExtractor: (row) =>
      typeof row.ability_id === 'number' && Number.isFinite(row.ability_id)
        ? row.ability_id
        : null,
    deps,
  });
}

/**
 * Faz o upsert idempotente das espécies em `species` com
 * `ON CONFLICT (pokemon_id)` (R7.1). Linhas sem `pokemon_id` válido ou sem
 * `slug` são rejeitadas e reportadas sem interromper as demais (R1.5).
 *
 * @param rows Linhas de espécie a persistir.
 * @param deps Dependências injetáveis (cliente, lote) para teste.
 * @returns {@link UpsertResult} com totais e eventuais rejeições.
 */
export async function upsertSpecies(
  rows: readonly SpeciesRow[],
  deps: CatalogWriterDeps = {},
): Promise<UpsertResult> {
  return upsertByKey(rows, {
    table: SPECIES_TABLE,
    conflictTarget: SPECIES_CONFLICT_TARGET,
    keyExtractor: (row) => {
      const hasId =
        typeof row.pokemon_id === 'number' && Number.isFinite(row.pokemon_id);
      const hasSlug = typeof row.slug === 'string' && row.slug.trim() !== '';
      return hasId && hasSlug ? row.pokemon_id : null;
    },
    deps,
  });
}

// ---------------------------------------------------------------------------
// Escritas de relações com validação de FK (R4.5, R5.4, R7.1, R7.2)
// ---------------------------------------------------------------------------

/** Nome das tabelas-alvo das relações de elegibilidade. */
export const LEARNABLE_MOVES_TABLE = 'pokemon_learnable_moves' as const;
export const POKEMON_ABILITIES_TABLE = 'pokemon_abilities' as const;

/**
 * Chave composta, alvo do `ON CONFLICT` do upsert idempotente de cada relação.
 * A unicidade `(pokemon_id, move_id)` / `(pokemon_id, ability_id)` espelha a
 * restrição `UNIQUE` das migrations, garantindo que a reaplicação atualize o
 * par em vez de duplicá-lo (R7.2).
 */
export const LEARNABLE_MOVES_CONFLICT_TARGET = 'pokemon_id,move_id' as const;
export const POKEMON_ABILITIES_CONFLICT_TARGET =
  'pokemon_id,ability_id' as const;

/**
 * Dependências injetáveis das escritas de relação. Além do cliente/lote
 * herdados de {@link CatalogWriterDeps}, permitem fornecer diretamente os
 * conjuntos de ids já persistidos nas tabelas base. Quando ausentes, os ids
 * são consultados sob demanda no cliente, limitando a busca aos ids de fato
 * referenciados pelas linhas de entrada.
 */
export interface RelationWriterDeps extends CatalogWriterDeps {
  /** `pokemon_id` existentes em `species`; se omitido, consultado no cliente. */
  readonly knownPokemonIds?: ReadonlySet<number>;
  /** `move_id` existentes em `moves`; se omitido, consultado no cliente. */
  readonly knownMoveIds?: ReadonlySet<number>;
  /** `ability_id` existentes em `abilities`; se omitido, consultado no cliente. */
  readonly knownAbilityIds?: ReadonlySet<number>;
}

/**
 * Carrega, do cliente, o subconjunto de ids presentes em `table.column` que
 * pertencem a `candidates`. Restringe a consulta aos ids efetivamente
 * referenciados (via `in`), evitando varrer a tabela inteira. Em caso de erro
 * ou candidatos vazios, retorna um conjunto vazio — o chamador tratará os
 * pares como órfãos, que serão rejeitados sem abortar os demais (R4.5, R5.4).
 */
async function fetchExistingIds(
  client: SupabaseClient,
  table: string,
  column: string,
  candidates: ReadonlySet<number>,
): Promise<Set<number>> {
  if (candidates.size === 0) {
    return new Set<number>();
  }

  const { data, error } = await client
    .from(table)
    .select(column)
    .in(column, Array.from(candidates));

  if (error !== null || !Array.isArray(data)) {
    return new Set<number>();
  }

  const existing = new Set<number>();
  for (const record of data as unknown as Record<string, unknown>[]) {
    const value = record[column];
    if (typeof value === 'number' && Number.isFinite(value)) {
      existing.add(value);
    }
  }
  return existing;
}

/**
 * Núcleo compartilhado das escritas de relação com validação de FK.
 *
 * Fluxo: (1) separa as linhas estruturalmente inválidas (ids ausentes/não
 * finitos), rejeitando-as; (2) resolve os conjuntos de ids existentes nas
 * tabelas base — da injeção `knownIds` ou consultando o cliente apenas pelos
 * ids referenciados; (3) rejeita como órfã toda linha cujo `pokemon_id` ou id
 * de referência não exista, registrando o motivo com a chave composta; (4)
 * delega as linhas válidas ao upsert idempotente em lote, com `ON CONFLICT`
 * na chave composta. As rejeições de FK e estruturais são mescladas ao
 * {@link UpsertResult} final, de modo que uma relação órfã não interrompe as
 * demais (R4.5, R5.4).
 */
async function upsertRelationWithFk<Row>(
  rows: readonly Row[],
  options: {
    readonly table: string;
    readonly conflictTarget: string;
    /** Rótulo da coluna de referência (p.ex. `move_id`) para a mensagem. */
    readonly refColumn: string;
    /** Extrai o `pokemon_id` da linha (ou `null` se ausente/inválido). */
    readonly pokemonIdOf: (row: Row) => number | null;
    /** Extrai o id de referência da linha (ou `null` se ausente/inválido). */
    readonly refIdOf: (row: Row) => number | null;
    /** Nome da tabela base referenciada pelo id de referência. */
    readonly refTable: string;
    /** Conjunto de `pokemon_id` existentes, se injetado. */
    readonly knownPokemonIds?: ReadonlySet<number>;
    /** Conjunto de ids de referência existentes, se injetado. */
    readonly knownRefIds?: ReadonlySet<number>;
    readonly deps: CatalogWriterDeps;
  },
): Promise<UpsertResult> {
  const {
    table,
    conflictTarget,
    refColumn,
    pokemonIdOf,
    refIdOf,
    refTable,
    knownPokemonIds,
    knownRefIds,
    deps,
  } = options;

  const rejected: RejectedRecord[] = [];
  const structurallyValid: Array<{
    row: Row;
    pokemonId: number;
    refId: number;
  }> = [];

  // (1) Rejeita linhas sem chave estrutural completa.
  for (const row of rows) {
    const pokemonId = pokemonIdOf(row);
    const refId = refIdOf(row);
    if (pokemonId === null || refId === null) {
      rejected.push({
        kind: table,
        key: { pokemon_id: pokemonId, [refColumn]: refId },
        reason: `chave de relação (pokemon_id, ${refColumn}) ausente ou inválida`,
      });
      continue;
    }
    structurallyValid.push({ row, pokemonId, refId });
  }

  if (structurallyValid.length === 0) {
    return { inserted: 0, updated: 0, rejected };
  }

  // (2) Resolve os conjuntos de ids existentes nas tabelas base.
  const client = deps.client ?? createServerClient();

  const referencedPokemonIds = new Set<number>();
  const referencedRefIds = new Set<number>();
  for (const { pokemonId, refId } of structurallyValid) {
    referencedPokemonIds.add(pokemonId);
    referencedRefIds.add(refId);
  }

  const existingPokemonIds =
    knownPokemonIds ??
    (await fetchExistingIds(
      client,
      SPECIES_TABLE,
      SPECIES_CONFLICT_TARGET,
      referencedPokemonIds,
    ));
  const existingRefIds =
    knownRefIds ??
    (await fetchExistingIds(client, refTable, refColumn, referencedRefIds));

  // (3) Rejeita pares órfãos (FK ausente da tabela base).
  const validRows: Row[] = [];
  for (const { row, pokemonId, refId } of structurallyValid) {
    const pokemonMissing = !existingPokemonIds.has(pokemonId);
    const refMissing = !existingRefIds.has(refId);
    if (pokemonMissing || refMissing) {
      const missing: string[] = [];
      if (pokemonMissing) missing.push(`pokemon_id=${pokemonId}`);
      if (refMissing) missing.push(`${refColumn}=${refId}`);
      rejected.push({
        kind: table,
        key: { pokemon_id: pokemonId, [refColumn]: refId },
        reason: `FK órfã: ${missing.join(', ')} ausente da tabela base`,
      });
      continue;
    }
    validRows.push(row);
  }

  // (4) Upsert idempotente das linhas válidas pela chave composta.
  //     O extrator sempre devolve a chave composta (já validada acima),
  //     reutilizando o núcleo transacional em lotes (R7.1, R7.2, R7.4).
  const writeResult = await upsertByKey(validRows, {
    table,
    conflictTarget,
    keyExtractor: (row) => {
      const pokemonId = pokemonIdOf(row);
      const refId = refIdOf(row);
      return pokemonId === null || refId === null
        ? null
        : `${pokemonId}:${refId}`;
    },
    deps: { client, batchSize: deps.batchSize },
  });

  return {
    inserted: writeResult.inserted,
    updated: writeResult.updated,
    rejected: [...rejected, ...writeResult.rejected],
  };
}

/**
 * Faz o upsert idempotente das relações de golpes aprendíveis em
 * `pokemon_learnable_moves` com `ON CONFLICT (pokemon_id, move_id)` (R7.1,
 * R7.2). Antes de gravar, valida a integridade referencial: cada par precisa
 * referenciar um `pokemon_id` existente em `species` e um `move_id` existente
 * em `moves`. Pares órfãos (FK ausente) são rejeitados e registrados em
 * `rejected` sem interromper os demais (R4.5).
 *
 * @param rows Linhas de relação golpe×espécie a persistir.
 * @param deps Dependências injetáveis (cliente, lote, conjuntos de ids base).
 * @returns {@link UpsertResult} com totais e eventuais rejeições (FK órfã).
 */
export async function upsertLearnableMoves(
  rows: readonly LearnableMoveRow[],
  deps: RelationWriterDeps = {},
): Promise<UpsertResult> {
  return upsertRelationWithFk(rows, {
    table: LEARNABLE_MOVES_TABLE,
    conflictTarget: LEARNABLE_MOVES_CONFLICT_TARGET,
    refColumn: MOVES_CONFLICT_TARGET,
    refTable: MOVES_TABLE,
    pokemonIdOf: (row) =>
      typeof row.pokemon_id === 'number' && Number.isFinite(row.pokemon_id)
        ? row.pokemon_id
        : null,
    refIdOf: (row) =>
      typeof row.move_id === 'number' && Number.isFinite(row.move_id)
        ? row.move_id
        : null,
    knownPokemonIds: deps.knownPokemonIds,
    knownRefIds: deps.knownMoveIds,
    deps,
  });
}

/**
 * Faz o upsert idempotente das relações de habilidades em `pokemon_abilities`
 * com `ON CONFLICT (pokemon_id, ability_id)` (R7.1, R7.2). Antes de gravar,
 * valida a integridade referencial: cada par precisa referenciar um
 * `pokemon_id` existente em `species` e um `ability_id` existente em
 * `abilities`. Pares órfãos (FK ausente) são rejeitados e registrados em
 * `rejected` sem interromper os demais (R5.4).
 *
 * @param rows Linhas de relação habilidade×espécie a persistir.
 * @param deps Dependências injetáveis (cliente, lote, conjuntos de ids base).
 * @returns {@link UpsertResult} com totais e eventuais rejeições (FK órfã).
 */
export async function upsertPokemonAbilities(
  rows: readonly PokemonAbilityRow[],
  deps: RelationWriterDeps = {},
): Promise<UpsertResult> {
  return upsertRelationWithFk(rows, {
    table: POKEMON_ABILITIES_TABLE,
    conflictTarget: POKEMON_ABILITIES_CONFLICT_TARGET,
    refColumn: ABILITIES_CONFLICT_TARGET,
    refTable: ABILITIES_TABLE,
    pokemonIdOf: (row) =>
      typeof row.pokemon_id === 'number' && Number.isFinite(row.pokemon_id)
        ? row.pokemon_id
        : null,
    refIdOf: (row) =>
      typeof row.ability_id === 'number' && Number.isFinite(row.ability_id)
        ? row.ability_id
        : null,
    knownPokemonIds: deps.knownPokemonIds,
    knownRefIds: deps.knownAbilityIds,
    deps,
  });
}

// ---------------------------------------------------------------------------
// Escrita do Baseline_Design (R11.1, R11.2, R11.3, R11.4)
// ---------------------------------------------------------------------------

/** Nome da tabela-alvo dos artefatos de baseline de design. */
export const DESIGN_BASELINE_TABLE = 'design_baseline' as const;

/**
 * Chave composta `(version, kind)`, alvo do `ON CONFLICT` do upsert idempotente
 * de `design_baseline`. A PK composta permite que os dois artefatos
 * (`matchups_36` e `simulation_parameters`) coexistam sob a mesma `version`,
 * de modo que a reexecução atualize o par existente em vez de duplicá-lo
 * (R11.4).
 */
export const DESIGN_BASELINE_CONFLICT_TARGET = 'version,kind' as const;

/**
 * Faz o upsert idempotente dos artefatos de baseline de design em
 * `design_baseline` com `ON CONFLICT (version, kind)` (R11.4).
 *
 * Registra, sob a `version` do arquivo, os 36 matchups do GDD
 * (`kind='matchups_36'`) e os parâmetros de simulação
 * (`kind='simulation_parameters'`), preservando o `payload` fiel do arquivo
 * (R11.1, R11.2) e o `status` legível do artefato (R11.3). Como a chave de
 * conciliação é a PK composta `(version, kind)`, reexecutar o seed atualiza o
 * registro em vez de criar duplicatas (R11.4).
 *
 * Linhas sem `version` ou `kind` legível (string não vazia) são rejeitadas e
 * reportadas em `rejected` sem interromper o processamento das demais.
 *
 * @param rows Linhas de baseline a persistir.
 * @param deps Dependências injetáveis (cliente, lote) para teste.
 * @returns {@link UpsertResult} com totais e eventuais rejeições.
 */
export async function upsertDesignBaseline(
  rows: readonly DesignBaselineRow[],
  deps: CatalogWriterDeps = {},
): Promise<UpsertResult> {
  return upsertByKey(rows, {
    table: DESIGN_BASELINE_TABLE,
    conflictTarget: DESIGN_BASELINE_CONFLICT_TARGET,
    keyExtractor: (row) => {
      const hasVersion =
        typeof row.version === 'string' && row.version.trim() !== '';
      const hasKind = typeof row.kind === 'string' && row.kind.trim() !== '';
      return hasVersion && hasKind ? `${row.version}:${row.kind}` : null;
    },
    deps,
  });
}
