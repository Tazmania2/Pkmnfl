/**
 * Orquestrador do `Processo_Seed` do Catálogo Oficial (spec `pfl-data-catalog`).
 *
 * Implementa o "Pipeline de ingestão do catálogo" do design: carrega os
 * arquivos locais em memória, **confere os checksums SHA-256 do manifest antes
 * de qualquer escrita** (abortando com relatório de divergência) e, em seguida,
 * executa seis fases de upsert idempotente na ordem ditada pelas chaves
 * estrangeiras:
 *
 * - Fase 1 — `moves` (chave `move_id`);
 * - Fase 2 — `abilities` (chave `ability_id`);
 * - Fase 3 — `species` (chave `pokemon_id`, com `is_allowed` derivado);
 * - Fase 4 — `pokemon_learnable_moves` (chave `(pokemon_id, move_id)`, FK validada);
 * - Fase 5 — `pokemon_abilities` (chave `(pokemon_id, ability_id)`, FK validada);
 * - Fase 6 — `design_baseline` (`matchups_36` + `simulation_parameters`,
 *   chave `(version, kind)`).
 *
 * Registros inválidos (fichas sem `pokemon_id`/`slug`, relações com FK órfã)
 * são **rejeitados e registrados** sem interromper o processamento dos demais
 * (Reqs. 1.5, 4.5, 5.4): as rejeições dos leitores e dos escritores são
 * agregadas no {@link SeedReport}. Como toda escrita é um upsert por chave, uma
 * reexecução converge para as contagens-alvo sem criar duplicatas (Reqs. 7.3,
 * 7.5): aplicar o seed N vezes produz o mesmo estado final.
 *
 * O núcleo (`runSeed`) recebe suas dependências por injeção (fontes já
 * carregadas, verificador de checksums e escritores) para ser unitariamente
 * testável sem disco nem Supabase reais. O ponto de entrada de produção
 * (`createDefaultSeedDeps`) liga os leitores de arquivo, o verificador do
 * manifest e os escritores concretos a partir de uma configuração de caminhos.
 *
 * Após as cinco fases de relação, o seed concilia (task 8.2) os pares de golpe
 * aprendível e habilidade disponível derivados das fichas contra os índices
 * reversos (`moves_to_pokemon_ids.json`, `abilities_to_pokemon_ids.json`):
 * deriva, por `id`, o conjunto de `pokemon_id` gravados e chama
 * {@link reconcile}. Qualquer divergência torna `ok=false` e é reportada por id
 * em {@link SeedReport.reconDiffs} com `only_in_db`/`only_in_index` exatos
 * (Reqs. 4.3, 4.4, 5.3).
 *
 * Fora de escopo desta task: o teste de integração de retomada (task 8.3).
 *
 * _Requirements: 1.1, 1.5, 2.1, 3.1, 4.1, 5.1, 6.1, 6.4, 7.3, 7.5, 11.1, 11.2_
 */

import {
  loadAbilitiesWithRejections,
  loadFichasWithRejections,
  loadManifest,
  loadMovesWithRejections,
  loadReverseIndex,
  type ParseResult,
  type RejectedSourceRecord,
} from './loaders';
import { reconcile, type ReconDiff } from './reconcile';
import {
  toAbilityRow,
  toLearnableMoveRows,
  toMoveRow,
  toPokemonAbilityRows,
  toSpeciesRow,
} from './transform';
import {
  upsertAbilities as defaultUpsertAbilities,
  upsertDesignBaseline as defaultUpsertDesignBaseline,
  upsertLearnableMoves as defaultUpsertLearnableMoves,
  upsertMoves as defaultUpsertMoves,
  upsertPokemonAbilities as defaultUpsertPokemonAbilities,
  upsertSpecies as defaultUpsertSpecies,
} from './writer';
import { checkManifestChecksums, type RawResource } from './validate';
import type {
  AbilityRow,
  DesignBaselineRow,
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  IndiceReverso,
  LearnableMoveRow,
  ManifestEntry,
  MoveRow,
  PokemonAbilityRow,
  SpeciesRow,
  UpsertResult,
  ValidationIssue,
} from './types';

// ---------------------------------------------------------------------------
// Dados de origem já carregados (fronteira pura/efeito do orquestrador)
// ---------------------------------------------------------------------------

/**
 * Fontes do catálogo já lidas em memória, com seus registros válidos e
 * rejeitados. Separar o carregamento (efeito) da orquestração (lógica) mantém
 * `runSeed` testável sem disco: os testes fornecem estas estruturas
 * diretamente; a produção as obtém via {@link loadSeedSources}.
 */
export interface SeedSources {
  /** Fichas de espécie válidas/rejeitadas (`fichas_146_pfl_v16.json`). */
  readonly fichas: ParseResult<FichaEspecie>;
  /** Golpes enriquecidos válidos/rejeitados (`moves_591_enriched.json`). */
  readonly moves: ParseResult<GolpeEnriquecido>;
  /** Habilidades enriquecidas válidas/rejeitadas (`abilities_113_enriched.json`). */
  readonly abilities: ParseResult<HabilidadeEnriquecida>;
  /** Artefatos de baseline de design a persistir na Fase 6. */
  readonly baseline: readonly DesignBaselineRow[];
  /** Entradas do `manifest.json` com os checksums de referência. */
  readonly manifest: readonly ManifestEntry[];
  /** Conteúdo cru dos recursos a conferir contra o manifest (pré-escrita). */
  readonly resources: readonly RawResource[];
  /**
   * Índice reverso de golpes (`moves_to_pokemon_ids.json`): `move_id (string) →
   * pokemon_ids`. Usado apenas para **conferir** (nunca como fonte de verdade)
   * a conciliação final da Fase 4 (Reqs. 4.3, 4.4). Padrão `{}` quando ausente.
   */
  readonly movesReverseIndex: IndiceReverso;
  /**
   * Índice reverso de habilidades (`abilities_to_pokemon_ids.json`):
   * `ability_id (string) → pokemon_ids`. Confere a conciliação final da Fase 5
   * (Req. 5.3). Padrão `{}` quando ausente.
   */
  readonly abilitiesReverseIndex: IndiceReverso;
}

/**
 * Escritores idempotentes injetáveis. Em produção são os de
 * `lib/catalog/writer.ts`; nos testes, dublês em memória evitam o Supabase.
 * Cada fase delega a estes escritores, que já implementam a idempotência por
 * chave e a validação de FK das relações.
 */
export interface SeedWriters {
  readonly upsertMoves: (rows: readonly MoveRow[]) => Promise<UpsertResult>;
  readonly upsertAbilities: (rows: readonly AbilityRow[]) => Promise<UpsertResult>;
  readonly upsertSpecies: (rows: readonly SpeciesRow[]) => Promise<UpsertResult>;
  readonly upsertLearnableMoves: (
    rows: readonly LearnableMoveRow[],
  ) => Promise<UpsertResult>;
  readonly upsertPokemonAbilities: (
    rows: readonly PokemonAbilityRow[],
  ) => Promise<UpsertResult>;
  readonly upsertDesignBaseline: (
    rows: readonly DesignBaselineRow[],
  ) => Promise<UpsertResult>;
}

/** Dependências completas de {@link runSeed}: fontes, checksums e escritores. */
export interface SeedDeps {
  /** Fontes do catálogo já carregadas em memória. */
  readonly sources: SeedSources;
  /**
   * Verifica os checksums dos recursos crus contra o manifest, retornando os
   * problemas encontrados (vazio quando íntegro). Padrão:
   * {@link checkManifestChecksums}. Injeção facilita os testes de abortagem.
   */
  readonly verifyChecksums?: (
    resources: readonly RawResource[],
    manifest: readonly ManifestEntry[],
  ) => ValidationIssue[];
  /** Escritores idempotentes das seis fases. */
  readonly writers: SeedWriters;
}

// ---------------------------------------------------------------------------
// Relatório do seed
// ---------------------------------------------------------------------------

/** Identificador estável de cada fase do pipeline, para o relatório. */
export type SeedPhaseName =
  | 'moves'
  | 'abilities'
  | 'species'
  | 'learnable_moves'
  | 'pokemon_abilities'
  | 'design_baseline';

/** Resultado de uma fase individual do seed. */
export interface SeedPhaseResult {
  /** Nome da fase (ordem de execução preservada no relatório). */
  readonly phase: SeedPhaseName;
  /** Resultado agregado do upsert desta fase. */
  readonly result: UpsertResult;
}

/**
 * Relatório agregado do `Processo_Seed`.
 *
 * - `ok`: verdadeiro quando o seed não abortou e nenhuma rejeição ocorreu (nem
 *   nos leitores, nem nos escritores). Falsas rejeições parciais tornam `ok`
 *   falso sem ter interrompido as demais fases.
 * - `aborted`: verdadeiro quando o seed abortou **antes de escrever** por
 *   divergência de checksum; neste caso `phases` fica vazio.
 * - `checksumIssues`: problemas de checksum detectados na pré-escrita.
 * - `sourceRejections`: fichas/golpes/habilidades rejeitados na leitura (R1.5).
 * - `phases`: resultado de cada fase executada, na ordem do pipeline.
 * - `reconDiffs`: divergências da conciliação final das relações contra os
 *   índices reversos, separadas por golpe/habilidade (Reqs. 4.3, 4.4, 5.3).
 *   Qualquer divergência (em qualquer dos dois lados) torna `ok` falso.
 */
export interface SeedReport {
  readonly ok: boolean;
  readonly aborted: boolean;
  readonly checksumIssues: ValidationIssue[];
  readonly sourceRejections: RejectedSourceRecord[];
  readonly phases: SeedPhaseResult[];
  readonly reconDiffs: SeedReconDiffs;
}

/**
 * Resultado da conciliação final do seed: as divergências por `id` de cada tipo
 * de relação contra o seu índice reverso. Listas vazias significam conjuntos
 * coincidentes (conciliação bem-sucedida).
 */
export interface SeedReconDiffs {
  /** Divergências por `move_id` (gravação × `moves_to_pokemon_ids.json`). */
  readonly moves: ReconDiff[];
  /** Divergências por `ability_id` (gravação × `abilities_to_pokemon_ids.json`). */
  readonly abilities: ReconDiff[];
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

/**
 * Executa o pipeline de ingestão do catálogo sobre as fontes fornecidas.
 *
 * Fluxo (design "Pipeline de ingestão do catálogo"):
 * 1. **Conferência de checksums (pré-escrita)**: recomputa os SHA-256 dos
 *    recursos crus e os compara ao manifest. Havendo qualquer divergência, o
 *    seed **aborta antes de escrever**, devolvendo `aborted: true` e os
 *    problemas em `checksumIssues`, sem executar nenhuma fase (Req. 8.5 /
 *    design "Error Handling").
 * 2. **Fase 1 → 6**: na ordem ditada pelas FKs, transforma os registros válidos
 *    em linhas e delega aos escritores idempotentes. As espécies recebem
 *    `is_allowed` via `toSpeciesRow` (Reqs. 6.1, 6.4). As relações são
 *    derivadas e deduplicadas das fichas (Reqs. 4.1, 5.1) e os escritores
 *    validam a FK, rejeitando órfãs sem interromper as demais (Reqs. 4.5, 5.4).
 *
 * As rejeições dos leitores (fichas/golpes/habilidades malformados) e dos
 * escritores (chave inválida, FK órfã, falha de lote) são agregadas no
 * relatório. Como todo upsert é idempotente por chave, reexecutar `runSeed`
 * converge para o mesmo estado — as contagens-alvo sem duplicatas (Reqs. 7.3,
 * 7.5).
 *
 * @param deps Fontes carregadas, verificador de checksums e escritores.
 * @returns Relatório agregado do seed (abortagem, rejeições e fases).
 */
export async function runSeed(deps: SeedDeps): Promise<SeedReport> {
  const { sources, writers } = deps;
  const verifyChecksums = deps.verifyChecksums ?? checkManifestChecksums;

  // (1) Conferência de checksums ANTES de qualquer escrita (Req. 8.5).
  const checksumIssues = verifyChecksums(sources.resources, sources.manifest);
  if (checksumIssues.length > 0) {
    return {
      ok: false,
      aborted: true,
      checksumIssues,
      sourceRejections: collectSourceRejections(sources),
      phases: [],
      reconDiffs: { moves: [], abilities: [] },
    };
  }

  // Transformações puras das fontes válidas em linhas de banco.
  const moveRows = sources.moves.valid.map(toMoveRow);
  const abilityRows = sources.abilities.valid.map(toAbilityRow);
  const speciesRows = sources.fichas.valid.map(toSpeciesRow);
  const learnableMoveRows = toLearnableMoveRows([...sources.fichas.valid]);
  const pokemonAbilityRows = toPokemonAbilityRows([...sources.fichas.valid]);

  // (2) Fases na ordem de dependência de FK. Cada fase é aguardada antes da
  //     próxima para respeitar a ordem exigida (moves/abilities antes de
  //     species; species antes das relações).
  const phases: SeedPhaseResult[] = [];

  phases.push({ phase: 'moves', result: await writers.upsertMoves(moveRows) });
  phases.push({
    phase: 'abilities',
    result: await writers.upsertAbilities(abilityRows),
  });
  phases.push({
    phase: 'species',
    result: await writers.upsertSpecies(speciesRows),
  });
  phases.push({
    phase: 'learnable_moves',
    result: await writers.upsertLearnableMoves(learnableMoveRows),
  });
  phases.push({
    phase: 'pokemon_abilities',
    result: await writers.upsertPokemonAbilities(pokemonAbilityRows),
  });
  phases.push({
    phase: 'design_baseline',
    result: await writers.upsertDesignBaseline(sources.baseline),
  });

  // (3) Conciliação final das relações contra os índices reversos. Deriva, a
  //     partir das linhas gravadas, o mapa `id → conjunto de pokemon_id` e o
  //     confere por igualdade de conjuntos (Reqs. 4.3, 4.4, 5.3). As divergências
  //     são reportadas por id com as diferenças exatas; não há escrita aqui.
  const reconDiffs: SeedReconDiffs = {
    moves: reconcile(
      deriveReverseSets(learnableMoveRows, (r) => r.move_id),
      sources.movesReverseIndex,
    ),
    abilities: reconcile(
      deriveReverseSets(pokemonAbilityRows, (r) => r.ability_id),
      sources.abilitiesReverseIndex,
    ),
  };

  const sourceRejections = collectSourceRejections(sources);
  const hasWriteRejections = phases.some((p) => p.result.rejected.length > 0);
  const hasReconDiffs =
    reconDiffs.moves.length > 0 || reconDiffs.abilities.length > 0;
  const ok = sourceRejections.length === 0 && !hasWriteRejections && !hasReconDiffs;

  return {
    ok,
    aborted: false,
    checksumIssues: [],
    sourceRejections,
    phases,
    reconDiffs,
  };
}

/**
 * Deriva, a partir das linhas de relação, o mapa `id → conjunto de pokemon_id`
 * esperado pela {@link reconcile}. Agrupa os `pokemon_id` por `id` (um `move_id`
 * ou `ability_id`, obtido via `keyOf`), eliminando repetições pela natureza de
 * conjunto — a conciliação é por igualdade de conjuntos, não por contagem.
 */
function deriveReverseSets<T extends { readonly pokemon_id: number }>(
  rows: readonly T[],
  keyOf: (row: T) => number,
): Map<number, Set<number>> {
  const sets = new Map<number, Set<number>>();
  for (const row of rows) {
    const id = keyOf(row);
    const set = sets.get(id) ?? new Set<number>();
    set.add(row.pokemon_id);
    sets.set(id, set);
  }
  return sets;
}

/** Reúne as rejeições de leitura das três fontes "por registro" (R1.5). */
function collectSourceRejections(sources: SeedSources): RejectedSourceRecord[] {
  return [
    ...sources.fichas.rejected,
    ...sources.moves.rejected,
    ...sources.abilities.rejected,
  ];
}

// ---------------------------------------------------------------------------
// Ligação de produção (leitores + escritores concretos)
// ---------------------------------------------------------------------------

/**
 * Caminhos dos arquivos locais do Catálogo Oficial consumidos pelo seed. Isolar
 * os caminhos em configuração mantém o orquestrador independente do layout de
 * disco e permite apontar para subconjuntos de teste.
 */
export interface SeedPaths {
  /** `fichas_146_pfl_v16.json`. */
  readonly fichas: string;
  /** `moves_591_enriched.json`. */
  readonly moves: string;
  /** `abilities_113_enriched.json`. */
  readonly abilities: string;
  /** `moves_to_pokemon_ids.json` (índice reverso de golpes, conciliação). */
  readonly movesReverseIndex: string;
  /** `abilities_to_pokemon_ids.json` (índice reverso de habilidades). */
  readonly abilitiesReverseIndex: string;
  /** `manifest.json` com os checksums de referência. */
  readonly manifest: string;
  /** `matchups_36.json` (baseline de design, `kind='matchups_36'`). */
  readonly matchups36: string;
  /** `simulation_parameters.json` (baseline, `kind='simulation_parameters'`). */
  readonly simulationParameters: string;
}

/**
 * Lê (efeito) os recursos crus referenciados pelo manifest, para a conferência
 * de checksums da pré-escrita. Mantido injetável para os testes.
 */
export type RawResourceReader = (
  manifest: readonly ManifestEntry[],
) => RawResource[];

/**
 * Carrega as fontes do catálogo do disco em {@link SeedSources}, preservando as
 * rejeições por registro dos leitores (R1.5). Os artefatos de baseline são
 * lidos como `payload` fiel e versionados sob a `version` declarada no próprio
 * arquivo (Reqs. 11.1, 11.2).
 *
 * @param paths Caminhos dos arquivos do catálogo.
 * @param readRawResources Lê os bytes crus dos recursos do manifest (checksum).
 * @param loadBaseline Lê os artefatos de baseline em linhas `design_baseline`.
 */
export function loadSeedSources(
  paths: SeedPaths,
  readRawResources: RawResourceReader,
  loadBaseline: (paths: SeedPaths) => DesignBaselineRow[],
): SeedSources {
  const manifest = loadManifest(paths.manifest);
  return {
    fichas: loadFichasWithRejections(paths.fichas),
    moves: loadMovesWithRejections(paths.moves),
    abilities: loadAbilitiesWithRejections(paths.abilities),
    baseline: loadBaseline(paths),
    manifest,
    resources: readRawResources(manifest),
    movesReverseIndex: loadReverseIndexOrEmpty(paths.movesReverseIndex),
    abilitiesReverseIndex: loadReverseIndexOrEmpty(paths.abilitiesReverseIndex),
  };
}

/**
 * Lê um índice reverso do disco, retornando `{}` se o arquivo estiver
 * ausente/ilegível. Um índice reverso é opcional para o seed: sem ele, a
 * conciliação simplesmente não aponta divergência contra um índice vazio em vez
 * de abortar a carga.
 */
function loadReverseIndexOrEmpty(path: string): IndiceReverso {
  try {
    return loadReverseIndex(path);
  } catch {
    return {};
  }
}

/**
 * Liga os escritores de produção (service-role da foundation) em
 * {@link SeedWriters}, adaptando as assinaturas com `deps` opcional dos
 * escritores à forma de um argumento único esperada pelo orquestrador.
 */
export function createDefaultSeedWriters(): SeedWriters {
  return {
    upsertMoves: (rows) => defaultUpsertMoves(rows),
    upsertAbilities: (rows) => defaultUpsertAbilities(rows),
    upsertSpecies: (rows) => defaultUpsertSpecies(rows),
    upsertLearnableMoves: (rows) => defaultUpsertLearnableMoves(rows),
    upsertPokemonAbilities: (rows) => defaultUpsertPokemonAbilities(rows),
    upsertDesignBaseline: (rows) => defaultUpsertDesignBaseline(rows),
  };
}

/**
 * Formata o {@link SeedReport} em um resumo legível para impressão no CLI.
 * Distingue abortagem por checksum, rejeições de leitura e o resultado de cada
 * fase. Não expõe conteúdo sensível (apenas contagens e identificadores).
 */
export function formatSeedReport(report: SeedReport): string {
  const lines: string[] = [];

  if (report.aborted) {
    lines.push(
      `Processo_Seed — ABORTADO antes de escrever: ${report.checksumIssues.length} ` +
        'divergência(s) de checksum no manifest.',
    );
    for (const issue of report.checksumIssues) {
      lines.push(`  [checksum] ${issue.detail}`);
    }
    return lines.join('\n');
  }

  lines.push(
    `Processo_Seed — ${report.ok ? 'SUCESSO' : 'CONCLUÍDO COM REJEIÇÕES'}: ` +
      `${report.phases.length} fase(s) executada(s).`,
  );

  if (report.sourceRejections.length > 0) {
    lines.push(
      `  [leitura] ${report.sourceRejections.length} registro(s) de origem rejeitado(s).`,
    );
  }

  for (const { phase, result } of report.phases) {
    const rejected =
      result.rejected.length > 0 ? `, ${result.rejected.length} rejeitada(s)` : '';
    lines.push(`  [${phase}] ${result.inserted} gravada(s)${rejected}`);
  }

  appendReconDiffs(lines, 'golpes', report.reconDiffs.moves);
  appendReconDiffs(lines, 'habilidades', report.reconDiffs.abilities);

  return lines.join('\n');
}

/**
 * Acrescenta ao relatório as divergências de conciliação de um lado (golpes ou
 * habilidades), listando por `id` os `pokemon_id` presentes apenas na gravação
 * (`only_in_db`) e apenas no índice (`only_in_index`) (Reqs. 4.4, 5.3). Nada é
 * acrescentado quando não há divergência.
 */
function appendReconDiffs(
  lines: string[],
  label: string,
  diffs: readonly ReconDiff[],
): void {
  if (diffs.length === 0) {
    return;
  }
  lines.push(
    `  [conciliação ${label}] ${diffs.length} id(s) divergente(s):`,
  );
  for (const diff of diffs) {
    lines.push(
      `    id ${diff.id}: only_in_db=[${diff.only_in_db.join(', ')}] ` +
        `only_in_index=[${diff.only_in_index.join(', ')}]`,
    );
  }
}
