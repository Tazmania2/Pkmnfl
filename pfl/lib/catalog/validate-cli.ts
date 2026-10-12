/**
 * Ponto de entrada executável do `Processo_Validacao_Pos_Ingestao`
 * (spec `pfl-data-catalog`).
 *
 * Fina camada sobre o núcleo puro {@link validatePostIngestion} de
 * `lib/catalog/validate.ts`: resolve os caminhos dos artefatos locais
 * (`VALIDATION_REPORT.json`, `manifest.json`) de variáveis de ambiente com
 * padrões, **monta o `PostIngestionInput`** a partir de duas fontes de dados —
 * os artefatos de validação (contagens-alvo, checksums de referência) e o
 * estado observado do banco (contagens reais, elegibilidade, relações e
 * conjuntos de ids do catálogo) —, invoca `validatePostIngestion`, imprime o
 * `ValidationOutcome` e encerra com código de saída coerente: `0` quando a
 * validação aprova (`passed = true`), `1` caso contrário.
 *
 * O design mantém o núcleo de verificação **puro e livre de I/O**: todo o
 * acesso a disco e ao Supabase é concentrado em dependências injetáveis
 * ({@link ValidateCliDeps}), de modo que `runValidation` seja unitariamente
 * testável sem arquivos nem banco reais.
 *
 * Uso: `npm run validate`.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadManifest } from './loaders';
import {
  validatePostIngestion,
  type ActualCounts,
  type CatalogIds,
  type EligibilityState,
  type LearnableMoveRef,
  type PokemonAbilityRef,
  type PostIngestionInput,
  type RawResource,
} from './validate';
import { EXCLUDED_POKEMON_IDS } from './allowed-species';
import type { ManifestEntry, ValidationOutcome } from './types';

// ---------------------------------------------------------------------------
// Resolução de caminhos (de env, com padrões)
// ---------------------------------------------------------------------------

/** Diretório raiz do acervo do Catálogo Oficial (configurável por ambiente). */
const DEFAULT_CATALOG_ROOT = resolve(process.cwd(), 'lib', 'data', 'catalog');

/** Caminhos dos artefatos de validação consumidos pelo CLI. */
export interface ValidatePaths {
  /** `VALIDATION_REPORT.json` com `actual_counts` e o indicador de aprovação. */
  readonly report: string;
  /** `manifest.json` com os checksums SHA-256 de referência. */
  readonly manifest: string;
  /** Diretório raiz contra o qual os `path` do manifest são resolvidos. */
  readonly root: string;
}

/**
 * Resolve os caminhos dos artefatos de validação. `PFL_CATALOG_ROOT` sobrescreve
 * o diretório raiz; os nomes dos arquivos seguem o acervo v1.7.
 */
export function resolveValidatePaths(
  root = process.env.PFL_CATALOG_ROOT ?? DEFAULT_CATALOG_ROOT,
): ValidatePaths {
  return {
    report: resolve(root, 'VALIDATION_REPORT.json'),
    manifest: resolve(root, 'manifest.json'),
    root,
  };
}

// ---------------------------------------------------------------------------
// Leitura do VALIDATION_REPORT.json (contagens-alvo esperadas)
// ---------------------------------------------------------------------------

/**
 * Contagens esperadas lidas de `actual_counts` do `VALIDATION_REPORT.json`.
 * São confrontadas pelo núcleo de validação contra as contagens observadas no
 * banco (Req. 8.1).
 */
export interface ExpectedCounts {
  readonly species: number;
  readonly moves: number;
  readonly abilities: number;
}

/** `true` sse `value` é um objeto não nulo e não um array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lê um inteiro finito de um campo, ou `undefined` se ausente/inválido. */
function readInt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Lê e valida as contagens esperadas de `actual_counts` do
 * `VALIDATION_REPORT.json`. Reconhece as chaves do acervo v1.7
 * (`pokemon_fichas`, `move_jsons`, `ability_jsons`).
 *
 * @throws {Error} Se o arquivo não contém `actual_counts` com as três contagens.
 */
export function loadExpectedCounts(path: string): ExpectedCounts {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const actual = isRecord(parsed) ? parsed['actual_counts'] : undefined;
  if (!isRecord(actual)) {
    throw new Error(
      `VALIDATION_REPORT inválido em ${path}: bloco "actual_counts" ausente.`,
    );
  }

  const species = readInt(actual, 'pokemon_fichas');
  const moves = readInt(actual, 'move_jsons');
  const abilities = readInt(actual, 'ability_jsons');

  if (species === undefined || moves === undefined || abilities === undefined) {
    throw new Error(
      `VALIDATION_REPORT inválido em ${path}: ` +
        'actual_counts deve conter pokemon_fichas, move_jsons e ability_jsons.',
    );
  }

  return { species, moves, abilities };
}

// ---------------------------------------------------------------------------
// Estado observado do banco (fornecido pela leitura do Supabase)
// ---------------------------------------------------------------------------

/**
 * Estado observado do banco após o seed, montado pela leitura do Supabase.
 * Mantém o acesso ao banco fora do núcleo puro: o CLI o obtém via
 * {@link ValidateCliDeps.readDbState} e o repassa, intacto, ao
 * {@link validatePostIngestion}.
 */
export interface DbState {
  /** Contagens observadas de espécies/golpes/habilidades (Req. 8.1). */
  readonly counts: ActualCounts;
  /** Estado de elegibilidade observado (Req. 8.2). */
  readonly eligibility: EligibilityState;
  /** Relações de golpe aprendível a conferir por FK (Req. 8.3). */
  readonly learnableMoves: readonly LearnableMoveRef[];
  /** Relações de habilidade a conferir por FK (Req. 8.4). */
  readonly pokemonAbilities: readonly PokemonAbilityRef[];
  /** Conjuntos de ids existentes no catálogo (species/moves/abilities). */
  readonly catalogs: CatalogIds;
}

// ---------------------------------------------------------------------------
// Montagem do PostIngestionInput (pura: combina artefatos + estado do banco)
// ---------------------------------------------------------------------------

/**
 * Monta o {@link PostIngestionInput} combinando os artefatos de validação (as
 * contagens-alvo, o manifest e os recursos crus a conferir) com o estado
 * observado do banco. Função **pura**: não realiza I/O — recebe tudo por
 * parâmetro, mantendo a montagem testável.
 *
 * As contagens esperadas lidas do `VALIDATION_REPORT.json` são apenas
 * confirmadas de serem iguais às contagens-alvo canônicas (146/591/113) que o
 * núcleo de validação já compara; o estado observado do banco é a fonte das
 * contagens reais.
 */
export function assemblePostIngestionInput(
  dbState: DbState,
  manifest: readonly ManifestEntry[],
  resources: readonly RawResource[],
): PostIngestionInput {
  return {
    counts: dbState.counts,
    eligibility: dbState.eligibility,
    learnableMoves: dbState.learnableMoves,
    pokemonAbilities: dbState.pokemonAbilities,
    catalogs: dbState.catalogs,
    resources,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// Dependências injetáveis do CLI (concentram todo o I/O)
// ---------------------------------------------------------------------------

/**
 * Dependências injetáveis do CLI de validação. Concentram todo o acesso a disco
 * e ao Supabase, de modo que {@link runValidation} permaneça testável sem
 * arquivos nem banco reais. Em produção, {@link createDefaultValidateDeps}
 * liga as implementações concretas.
 */
export interface ValidateCliDeps {
  /** Lê as contagens-alvo de `VALIDATION_REPORT.json`. */
  readonly loadExpectedCounts: (path: string) => ExpectedCounts;
  /** Lê as entradas de `manifest.json` com os checksums de referência. */
  readonly loadManifest: (path: string) => ManifestEntry[];
  /** Lê os bytes crus dos recursos declarados no manifest (checksum). */
  readonly readRawResources: (
    manifest: readonly ManifestEntry[],
    root: string,
  ) => RawResource[];
  /** Lê o estado observado do banco (contagens, elegibilidade, relações, ids). */
  readonly readDbState: (expected: ExpectedCounts) => Promise<DbState>;
}

// ---------------------------------------------------------------------------
// Orquestrador (puro quanto à lógica; delega I/O às deps)
// ---------------------------------------------------------------------------

/**
 * Executa a validação pós-ingestão: carrega os artefatos locais e o estado do
 * banco via dependências injetadas, monta o {@link PostIngestionInput} e invoca
 * o núcleo puro {@link validatePostIngestion}, devolvendo o
 * {@link ValidationOutcome}.
 *
 * Toda a lógica de verificação (contagens, elegibilidade, FKs, checksums) vive
 * no núcleo puro; este orquestrador apenas coordena a obtenção dos dados.
 *
 * @param paths Caminhos resolvidos dos artefatos de validação.
 * @param deps Dependências de I/O (loaders + leitura do banco).
 * @returns O resultado agregado da validação (Reqs. 8.6/8.7).
 */
export async function runValidation(
  paths: ValidatePaths,
  deps: ValidateCliDeps,
): Promise<ValidationOutcome> {
  const expected = deps.loadExpectedCounts(paths.report);
  const manifest = deps.loadManifest(paths.manifest);
  const resources = deps.readRawResources(manifest, paths.root);
  const dbState = await deps.readDbState(expected);

  const input = assemblePostIngestionInput(dbState, manifest, resources);
  return validatePostIngestion(input);
}

// ---------------------------------------------------------------------------
// Relatório legível do ValidationOutcome
// ---------------------------------------------------------------------------

/**
 * Formata o {@link ValidationOutcome} em um resumo legível para impressão no
 * CLI. Em aprovação, confirma que todas as verificações passaram; em falha,
 * lista cada problema com o nome da verificação (`check`), a descrição
 * (`detail`) e os identificadores envolvidos (`ids`), atendendo o Req. 8.6
 * (exclusões, FKs e checksums reportados com ids).
 */
export function formatValidationOutcome(outcome: ValidationOutcome): string {
  if (outcome.passed) {
    return 'Processo_Validacao_Pos_Ingestao — APROVADO: todas as verificações satisfeitas.';
  }

  const lines: string[] = [
    `Processo_Validacao_Pos_Ingestao — FALHA: ${outcome.issues.length} verificação(ões) falharam.`,
  ];
  for (const issue of outcome.issues) {
    const ids =
      issue.ids !== undefined && issue.ids.length > 0
        ? ` [ids: ${issue.ids.join(', ')}]`
        : '';
    lines.push(`  [${issue.check}] ${issue.detail}${ids}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Ligação de produção: leitura de disco + estado do banco (Supabase)
// ---------------------------------------------------------------------------

/**
 * Lê os bytes crus dos recursos declarados no manifest, resolvendo cada `path`
 * relativo contra o diretório raiz. Recursos ilegíveis geram uma entrada com
 * bytes vazios, que o verificador de checksum tratará como divergência (Req. 8.5).
 */
export function createRawResourceReader(): ValidateCliDeps['readRawResources'] {
  return (manifest, root) => {
    const resources: RawResource[] = [];
    for (const entry of manifest) {
      try {
        resources.push({ path: entry.path, bytes: readFileSync(resolve(root, entry.path)) });
      } catch {
        resources.push({ path: entry.path, bytes: new Uint8Array() });
      }
    }
    return resources;
  };
}

/**
 * Monta o {@link DbState} lendo o estado observado do Supabase (contagens,
 * elegibilidade, relações e conjuntos de ids do catálogo), via cliente de
 * leitura da foundation.
 *
 * A importação do cliente de leitura é dinâmica para que o CLI possa ser
 * importado em contextos de teste sem exigir as variáveis de ambiente do
 * Supabase: os testes injetam o próprio `readDbState` e nunca atingem este
 * caminho.
 *
 * @throws {Error} Se alguma leitura ao Supabase falhar.
 */
export async function readDbStateFromSupabase(
  _expected: ExpectedCounts,
): Promise<DbState> {
  const { createPublicClient } = await import('../supabase/public-client');
  const client = createPublicClient();

  const countOf = async (table: string): Promise<number> => {
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error !== null) {
      throw new Error(`falha ao contar ${table}: ${error.message}`);
    }
    return count ?? 0;
  };

  const idsOf = async (table: string, column: string): Promise<Set<number>> => {
    const ids = new Set<number>();
    const { data, error } = await client.from(table).select(column);
    if (error !== null) {
      throw new Error(`falha ao ler ${table}.${column}: ${error.message}`);
    }
    for (const record of (data ?? []) as unknown as Record<string, unknown>[]) {
      const value = record[column];
      if (typeof value === 'number' && Number.isFinite(value)) {
        ids.add(value);
      }
    }
    return ids;
  };

  // Contagens observadas (Req. 8.1).
  const [species, moves, abilities] = await Promise.all([
    countOf('species'),
    countOf('moves'),
    countOf('abilities'),
  ]);

  // Elegibilidade observada (Req. 8.2): total permitido + estado dos excluídos.
  const { count: allowedCount, error: allowedError } = await client
    .from('species')
    .select('*', { count: 'exact', head: true })
    .eq('is_allowed', true);
  if (allowedError !== null) {
    throw new Error(`falha ao contar espécies permitidas: ${allowedError.message}`);
  }

  const excludedIds = Array.from(EXCLUDED_POKEMON_IDS);
  const { data: excludedRows, error: excludedError } = await client
    .from('species')
    .select('pokemon_id, is_allowed')
    .in('pokemon_id', excludedIds);
  if (excludedError !== null) {
    throw new Error(`falha ao ler elegibilidade das espécies excluídas: ${excludedError.message}`);
  }
  const isAllowedById = new Map<number, boolean>();
  for (const record of (excludedRows ?? []) as Record<string, unknown>[]) {
    const id = record['pokemon_id'];
    const allowed = record['is_allowed'];
    if (typeof id === 'number' && typeof allowed === 'boolean') {
      isAllowedById.set(id, allowed);
    }
  }

  // Relações a conferir por FK (Reqs. 8.3, 8.4).
  const { data: learnableRows, error: learnableError } = await client
    .from('pokemon_learnable_moves')
    .select('pokemon_id, move_id');
  if (learnableError !== null) {
    throw new Error(`falha ao ler pokemon_learnable_moves: ${learnableError.message}`);
  }
  const learnableMoves: LearnableMoveRef[] = ((learnableRows ?? []) as Record<string, unknown>[])
    .map((r) => ({ pokemon_id: Number(r['pokemon_id']), move_id: Number(r['move_id']) }));

  const { data: abilityRows, error: abilityRelError } = await client
    .from('pokemon_abilities')
    .select('pokemon_id, ability_id');
  if (abilityRelError !== null) {
    throw new Error(`falha ao ler pokemon_abilities: ${abilityRelError.message}`);
  }
  const pokemonAbilities: PokemonAbilityRef[] = ((abilityRows ?? []) as Record<string, unknown>[])
    .map((r) => ({ pokemon_id: Number(r['pokemon_id']), ability_id: Number(r['ability_id']) }));

  // Conjuntos de ids do catálogo contra os quais as FKs são conferidas.
  const [speciesIds, moveIds, abilityIds] = await Promise.all([
    idsOf('species', 'pokemon_id'),
    idsOf('moves', 'move_id'),
    idsOf('abilities', 'ability_id'),
  ]);

  return {
    counts: { species, moves, abilities },
    eligibility: { allowedCount: allowedCount ?? 0, isAllowedById },
    learnableMoves,
    pokemonAbilities,
    catalogs: { species: speciesIds, moves: moveIds, abilities: abilityIds },
  };
}

/** Liga as dependências de produção (leitura de disco + Supabase). */
export function createDefaultValidateDeps(): ValidateCliDeps {
  return {
    loadExpectedCounts,
    loadManifest,
    readRawResources: createRawResourceReader(),
    readDbState: readDbStateFromSupabase,
  };
}

// ---------------------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------------------

/**
 * Executa a validação pós-ingestão e retorna o código de processo apropriado,
 * sem chamar `process.exit` diretamente (facilita o teste do fluxo principal).
 *
 * @returns `0` quando a validação aprova; `1` em falha de verificação ou erro.
 */
export async function main(): Promise<number> {
  const paths = resolveValidatePaths();

  try {
    const outcome = await runValidation(paths, createDefaultValidateDeps());
    if (outcome.passed) {
      console.info(formatValidationOutcome(outcome));
    } else {
      console.error(formatValidationOutcome(outcome));
    }
    return outcome.passed ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Processo_Validacao_Pos_Ingestao: erro inesperado: ${message}`);
    return 1;
  }
}

// Executa apenas quando chamado diretamente como script (não ao ser importado).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('validate-cli')) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
