/**
 * Validador pós-ingestão do catálogo (`Processo_Validacao_Pos_Ingestao`).
 *
 * Este módulo implementa as verificações do Processo_Validacao_Pos_Ingestao
 * como funções **puras e unitariamente testáveis**: cada checagem recebe os
 * dados por parâmetro (contagens, flags de elegibilidade, conteúdo cru) e
 * retorna a lista de `ValidationIssue` encontrados — vazia quando a verificação
 * passa. A orquestração (ler do Supabase / dos arquivos) fica a cargo do CLI
 * `Processo_Validacao_Pos_Ingestao` (task 9.1), mantendo a lógica livre de I/O.
 *
 * Escopo desta task (7.1):
 * - Recomputação de SHA-256 do JSON cru e comparação com o `manifest.json`
 *   (Req. 8.5, Property 12).
 * - Contagens de espécies/golpes/habilidades contra `actual_counts`
 *   (Req. 8.1, Property 11).
 * - Elegibilidade: exatamente 146 espécies `is_allowed = true` e exclusões
 *   {144,145,146,150,151} com `is_allowed = false` (Req. 8.2, Property 11).
 *
 * A checagem de integridade referencial e a montagem do `ValidationOutcome`
 * agregado são adicionadas na task 7.4, que anexa a este mesmo arquivo. Por
 * isso as funções de checagem abaixo são independentes e combináveis: cada uma
 * produz `ValidationIssue[]`, e 7.4 pode concatenar seus resultados com os das
 * demais verificações e derivar `passed = issues.length === 0`.
 *
 * _Requirements: 8.1, 8.2, 8.5_
 */

import { createHash } from 'node:crypto';

import { EXCLUDED_POKEMON_IDS } from './allowed-species';
import type {
  ManifestEntry,
  ValidationIssue,
  ValidationOutcome,
} from './types';

// ---------------------------------------------------------------------------
// Contagens-alvo e constantes de elegibilidade (fonte: VALIDATION_REPORT.json)
// ---------------------------------------------------------------------------

/** Contagem-alvo de espécies no catálogo completo. */
export const EXPECTED_SPECIES_COUNT = 146;

/** Contagem-alvo de golpes no catálogo completo. */
export const EXPECTED_MOVES_COUNT = 591;

/** Contagem-alvo de habilidades no catálogo completo. */
export const EXPECTED_ABILITIES_COUNT = 113;

/** Quantidade-alvo de espécies com `is_allowed = true` (Especies_Permitidas). */
export const EXPECTED_ALLOWED_COUNT = 146;

// ---------------------------------------------------------------------------
// Nomes canônicos das verificações (usados em ValidationIssue.check)
// ---------------------------------------------------------------------------

/** Nomes estáveis das verificações, para `ValidationIssue.check`. */
export const VALIDATION_CHECKS = {
  speciesCount: 'species_count',
  movesCount: 'moves_count',
  abilitiesCount: 'abilities_count',
  allowedCount: 'allowed_species_count',
  exclusionEligibility: 'excluded_species_eligibility',
  checksum: 'manifest_sha256',
  learnableMoveFk: 'learnable_move_referential_integrity',
  pokemonAbilityFk: 'pokemon_ability_referential_integrity',
} as const;

// ---------------------------------------------------------------------------
// Contratos de entrada das checagens (dados fornecidos por parâmetro)
// ---------------------------------------------------------------------------

/**
 * Contagens observadas no banco após o seed, confrontadas com as contagens-alvo
 * (equivalente a `actual_counts` do Relatorio_Validacao).
 */
export interface ActualCounts {
  readonly species: number;
  readonly moves: number;
  readonly abilities: number;
}

/**
 * Estado de elegibilidade observado: total de espécies com `is_allowed = true`
 * e o estado de `is_allowed` por `pokemon_id` relevante para as exclusões.
 */
export interface EligibilityState {
  /** Número de espécies com `is_allowed = true` no banco. */
  readonly allowedCount: number;
  /**
   * Mapa `pokemon_id → is_allowed` observado no banco. Precisa conter ao menos
   * os ids excluídos {144,145,146,150,151} para a checagem de exclusões; um id
   * ausente é tratado como violação (não se pôde confirmar `is_allowed=false`).
   */
  readonly isAllowedById: ReadonlyMap<number, boolean>;
}

/**
 * Conteúdo cru de um recurso a conferir contra o manifest: o `path` relativo
 * (chave de correlação com o `ManifestEntry`) e os `bytes` lidos do arquivo.
 */
export interface RawResource {
  readonly path: string;
  readonly bytes: Uint8Array | string;
}

// ---------------------------------------------------------------------------
// SHA-256 — recomputação e comparação com o manifest (Req. 8.5, Property 12)
// ---------------------------------------------------------------------------

/**
 * Recomputa o checksum SHA-256 (hex minúsculo) de um conteúdo cru. Determinístico
 * e byte-sensível: qualquer alteração de byte produz um digest diferente.
 */
export function computeSha256(bytes: Uint8Array | string): string {
  const hash = createHash('sha256');
  if (typeof bytes === 'string') {
    hash.update(bytes, 'utf8');
  } else {
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/**
 * Verifica os checksums SHA-256 dos recursos crus contra o `manifest.json`
 * (Req. 8.5). Para cada recurso presente no manifest, recomputa o `sha256` dos
 * bytes e compara (case-insensitive no hex) ao valor registrado.
 *
 * Reporta um `ValidationIssue` por divergência:
 * - checksum diferente do registrado (conteúdo alterado);
 * - recurso presente no manifest mas ausente dos recursos fornecidos.
 *
 * Recursos fornecidos que não constam do manifest são ignorados (a condição
 * WHERE da Req. 8.5 só se aplica quando há entrada de manifest para o recurso).
 */
export function checkManifestChecksums(
  resources: readonly RawResource[],
  manifest: readonly ManifestEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byPath = new Map<string, RawResource>(
    resources.map((resource) => [resource.path, resource]),
  );

  for (const entry of manifest) {
    const resource = byPath.get(entry.path);

    if (resource === undefined) {
      issues.push({
        check: VALIDATION_CHECKS.checksum,
        detail: `recurso ausente para o path do manifest: ${entry.path}`,
        ids: [entry.path],
      });
      continue;
    }

    const computed = computeSha256(resource.bytes);
    if (computed.toLowerCase() !== entry.sha256.toLowerCase()) {
      issues.push({
        check: VALIDATION_CHECKS.checksum,
        detail:
          `sha256 divergente para ${entry.path}: ` +
          `esperado ${entry.sha256}, obtido ${computed}`,
        ids: [entry.path],
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Contagens — species/moves/abilities vs. actual_counts (Req. 8.1)
// ---------------------------------------------------------------------------

/**
 * Verifica as contagens de espécies (146), golpes (591) e habilidades (113)
 * contra os valores observados (Req. 8.1). Reporta um `ValidationIssue` por
 * entidade cuja contagem observada difere da alvo, carregando a quantidade
 * esperada e a obtida em `ids`.
 */
export function checkCounts(actual: ActualCounts): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checks: ReadonlyArray<{
    check: string;
    entity: string;
    expected: number;
    got: number;
  }> = [
    {
      check: VALIDATION_CHECKS.speciesCount,
      entity: 'espécies',
      expected: EXPECTED_SPECIES_COUNT,
      got: actual.species,
    },
    {
      check: VALIDATION_CHECKS.movesCount,
      entity: 'golpes',
      expected: EXPECTED_MOVES_COUNT,
      got: actual.moves,
    },
    {
      check: VALIDATION_CHECKS.abilitiesCount,
      entity: 'habilidades',
      expected: EXPECTED_ABILITIES_COUNT,
      got: actual.abilities,
    },
  ];

  for (const { check, entity, expected, got } of checks) {
    if (got !== expected) {
      issues.push({
        check,
        detail: `contagem de ${entity} incorreta: esperado ${expected}, obtido ${got}`,
        ids: [expected, got],
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Elegibilidade — 146 allowed + exclusões (Req. 8.2)
// ---------------------------------------------------------------------------

/**
 * Verifica a elegibilidade das espécies (Req. 8.2):
 * - exatamente {@link EXPECTED_ALLOWED_COUNT} (146) espécies com
 *   `is_allowed = true`;
 * - cada id excluído {144,145,146,150,151} com `is_allowed = false`.
 *
 * Reporta:
 * - um `ValidationIssue` se a contagem de permitidas difere de 146 (com os ids
 *   `[esperado, obtido]`);
 * - um `ValidationIssue` listando todos os ids excluídos que não estão
 *   confirmados como `is_allowed = false` (ausentes do mapa ou marcados `true`).
 */
export function checkEligibility(state: EligibilityState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (state.allowedCount !== EXPECTED_ALLOWED_COUNT) {
    issues.push({
      check: VALIDATION_CHECKS.allowedCount,
      detail:
        `quantidade de espécies permitidas incorreta: ` +
        `esperado ${EXPECTED_ALLOWED_COUNT}, obtido ${state.allowedCount}`,
      ids: [EXPECTED_ALLOWED_COUNT, state.allowedCount],
    });
  }

  const wronglyEligible: number[] = [];
  for (const excludedId of EXCLUDED_POKEMON_IDS) {
    // Exclusão só é confirmada quando o id está presente e marcado como false.
    if (state.isAllowedById.get(excludedId) !== false) {
      wronglyEligible.push(excludedId);
    }
  }

  if (wronglyEligible.length > 0) {
    wronglyEligible.sort((a, b) => a - b);
    issues.push({
      check: VALIDATION_CHECKS.exclusionEligibility,
      detail:
        `espécies excluídas sem is_allowed = false confirmado: ` +
        wronglyEligible.join(', '),
      ids: wronglyEligible,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Integridade referencial — relações vs. catálogos (Req. 8.3, 8.4; Property 10)
// ---------------------------------------------------------------------------

/**
 * Catálogos de identificadores existentes contra os quais as relações são
 * conferidas: os `pokemon_id` de `species`, os `move_id` de `moves` e os
 * `ability_id` de `abilities`. Uma relação é íntegra quando cada uma das suas
 * FKs resolve para um id presente no catálogo correspondente.
 */
export interface CatalogIds {
  /** `species.pokemon_id` existentes. */
  readonly species: ReadonlySet<number>;
  /** `moves.move_id` existentes. */
  readonly moves: ReadonlySet<number>;
  /** `abilities.ability_id` existentes. */
  readonly abilities: ReadonlySet<number>;
}

/** Par de relação de golpe aprendível a conferir (`pokemon_id`, `move_id`). */
export interface LearnableMoveRef {
  readonly pokemon_id: number;
  readonly move_id: number;
}

/** Par de relação de habilidade a conferir (`pokemon_id`, `ability_id`). */
export interface PokemonAbilityRef {
  readonly pokemon_id: number;
  readonly ability_id: number;
}

/**
 * Verifica a integridade referencial das relações de golpe aprendível (Req. 8.3):
 * toda relação deve referenciar um `move_id` existente em `moves` e um
 * `pokemon_id` existente em `species`.
 *
 * Reporta um `ValidationIssue` por relação órfã, carregando em `ids` o par
 * `[pokemon_id, move_id]` e descrevendo em `detail` qual(is) FK(s) não
 * resolveram. A ausência de um `move_id` e de um `pokemon_id` na mesma relação
 * é reportada num único issue (ambas as FKs listadas).
 */
export function checkLearnableMoveIntegrity(
  relations: readonly LearnableMoveRef[],
  catalogs: CatalogIds,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const relation of relations) {
    const missing: string[] = [];
    if (!catalogs.species.has(relation.pokemon_id)) {
      missing.push(`pokemon_id ${relation.pokemon_id}`);
    }
    if (!catalogs.moves.has(relation.move_id)) {
      missing.push(`move_id ${relation.move_id}`);
    }

    if (missing.length > 0) {
      issues.push({
        check: VALIDATION_CHECKS.learnableMoveFk,
        detail:
          `relação de golpe aprendível órfã ` +
          `(pokemon_id=${relation.pokemon_id}, move_id=${relation.move_id}): ` +
          `referência(s) inexistente(s): ${missing.join(', ')}`,
        ids: [relation.pokemon_id, relation.move_id],
      });
    }
  }

  return issues;
}

/**
 * Verifica a integridade referencial das relações de habilidade (Req. 8.4):
 * toda relação deve referenciar um `ability_id` existente em `abilities` e um
 * `pokemon_id` existente em `species`.
 *
 * Reporta um `ValidationIssue` por relação órfã, carregando em `ids` o par
 * `[pokemon_id, ability_id]` e descrevendo em `detail` qual(is) FK(s) não
 * resolveram.
 */
export function checkPokemonAbilityIntegrity(
  relations: readonly PokemonAbilityRef[],
  catalogs: CatalogIds,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const relation of relations) {
    const missing: string[] = [];
    if (!catalogs.species.has(relation.pokemon_id)) {
      missing.push(`pokemon_id ${relation.pokemon_id}`);
    }
    if (!catalogs.abilities.has(relation.ability_id)) {
      missing.push(`ability_id ${relation.ability_id}`);
    }

    if (missing.length > 0) {
      issues.push({
        check: VALIDATION_CHECKS.pokemonAbilityFk,
        detail:
          `relação de habilidade órfã ` +
          `(pokemon_id=${relation.pokemon_id}, ability_id=${relation.ability_id}): ` +
          `referência(s) inexistente(s): ${missing.join(', ')}`,
        ids: [relation.pokemon_id, relation.ability_id],
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Resultado agregado — ValidationOutcome (Req. 8.6, 8.7)
// ---------------------------------------------------------------------------

/**
 * Entrada agregada do Processo_Validacao_Pos_Ingestao: os dados observados que
 * alimentam cada verificação. Permanece livre de I/O — o CLI (task 9.1) lê do
 * Supabase / dos arquivos e monta este objeto, mantendo a lógica pura e testável.
 */
export interface PostIngestionInput {
  /** Contagens observadas de espécies/golpes/habilidades (Req. 8.1). */
  readonly counts: ActualCounts;
  /** Estado de elegibilidade observado (Req. 8.2). */
  readonly eligibility: EligibilityState;
  /** Relações de golpe aprendível a conferir por FK (Req. 8.3). */
  readonly learnableMoves: readonly LearnableMoveRef[];
  /** Relações de habilidade a conferir por FK (Req. 8.4). */
  readonly pokemonAbilities: readonly PokemonAbilityRef[];
  /** Catálogos de ids existentes contra os quais as relações são conferidas. */
  readonly catalogs: CatalogIds;
  /** Recursos crus a conferir contra o manifest (Req. 8.5). */
  readonly resources: readonly RawResource[];
  /** Entradas do `manifest.json` com os checksums de referência (Req. 8.5). */
  readonly manifest: readonly ManifestEntry[];
}

/**
 * Executa todas as verificações do Processo_Validacao_Pos_Ingestao e monta o
 * `ValidationOutcome` agregado (Reqs. 8.6/8.7).
 *
 * Concatena, na ordem contagens → elegibilidade → FK de golpes → FK de
 * habilidades → checksums, os `ValidationIssue[]` de cada checagem. O resultado
 * é `passed: true` com `issues` vazio se e somente se **todas** as verificações
 * forem satisfeitas; qualquer falha produz `passed: false` com a lista completa
 * de problemas (cada um com o nome da verificação e os identificadores dos
 * registros envolvidos).
 *
 * Função pura: recebe os dados por parâmetro e não realiza I/O.
 */
export function validatePostIngestion(
  input: PostIngestionInput,
): ValidationOutcome {
  const issues: ValidationIssue[] = [
    ...checkCounts(input.counts),
    ...checkEligibility(input.eligibility),
    ...checkLearnableMoveIntegrity(input.learnableMoves, input.catalogs),
    ...checkPokemonAbilityIntegrity(input.pokemonAbilities, input.catalogs),
    ...checkManifestChecksums(input.resources, input.manifest),
  ];

  return { passed: issues.length === 0, issues };
}
