/**
 * Tipos compartilhados do Catálogo Oficial v1.7 (spec `pfl-data-catalog`).
 *
 * Este módulo centraliza os contratos de dados reutilizados pelos leitores,
 * transformadores, escritor idempotente, validador e pela camada de leitura.
 * Mantê-los num único ponto evita divergência de forma entre produtor e
 * consumidor e preserva a fidelidade da estrutura de origem em `raw_data`.
 *
 * Tipos específicos de NFL vivem em `lib/nfl/types.ts`.
 *
 * _Requirements: 1.2, 2.2, 3.2, 4.1, 5.1, 10.1, 11.1_
 */

// ---------------------------------------------------------------------------
// Estruturas de origem (arquivos locais do Catálogo Oficial)
// ---------------------------------------------------------------------------

/** Nome canônico de cada uma das seis estatísticas base da PokéAPI. */
export type StatName =
  | 'hp'
  | 'attack'
  | 'defense'
  | 'special-attack'
  | 'special-defense'
  | 'speed';

/** Opção de habilidade de uma espécie, conforme o bloco `official` da ficha. */
export interface AbilityOption {
  readonly name: string;
  readonly id: number;
  readonly is_hidden: boolean;
  readonly slot: number;
}

/** Golpe aprendível de uma espécie, conforme o bloco `official` da ficha. */
export interface LearnableMove {
  readonly id: number;
  readonly name: string;
  readonly version_details: unknown[];
}

/**
 * Ficha de espécie do Catálogo Oficial (`fichas_146_pfl_v16.json`).
 * O bloco `official` preserva fielmente a estrutura de origem da PokéAPI.
 */
export interface FichaEspecie {
  readonly pokemon_id: number;
  readonly slug: string;
  readonly name_display: string;
  readonly eligible: boolean;
  readonly source_uri: string;
  readonly species_source_uri: string;
  readonly official: {
    readonly types: string[];
    readonly stats: Record<StatName, number>;
    readonly height_dm: number;
    readonly weight_hg: number;
    readonly ability_options: AbilityOption[];
    readonly learnable_moves: LearnableMove[];
  };
}

/** Golpe enriquecido (`moves_591_enriched.json`); estrutura preservada fiel. */
export interface GolpeEnriquecido {
  readonly id: number;
  readonly name: string;
  readonly [k: string]: unknown;
}

/** Habilidade enriquecida (`abilities_113_enriched.json`); estrutura fiel. */
export interface HabilidadeEnriquecida {
  readonly id: number;
  readonly name: string;
  readonly [k: string]: unknown;
}

/**
 * Índice reverso (`moves_to_pokemon_ids.json`,
 * `abilities_to_pokemon_ids.json`): chave = id (string), valor = pokemon_ids.
 */
export type IndiceReverso = Record<string, number[]>;

/**
 * Entrada do `manifest.json`: caminho relativo de um JSON cru e o seu checksum
 * SHA-256, usados pela validação pós-ingestão para conferir integridade.
 */
export interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
}

// ---------------------------------------------------------------------------
// Linhas de banco produzidas pela transformação
// ---------------------------------------------------------------------------

/**
 * Linha da tabela `species`. As Anotações PFL vivem em colunas dedicadas;
 * `raw_data` guarda a ficha original sem conversão.
 */
export interface SpeciesRow {
  readonly pokemon_id: number;
  readonly slug: string;
  readonly types: string[];
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly special_attack: number;
  readonly special_defense: number;
  readonly speed: number;
  readonly height: number;
  readonly weight: number;
  readonly is_allowed: boolean;
  readonly raw_data: unknown;
}

/** Linha da tabela `moves`; `raw_data` preserva o golpe de origem fiel. */
export interface MoveRow {
  readonly move_id: number;
  readonly name: string;
  readonly raw_data: unknown;
}

/** Linha da tabela `abilities`; `raw_data` preserva a habilidade de origem. */
export interface AbilityRow {
  readonly ability_id: number;
  readonly name: string;
  readonly raw_data: unknown;
}

/** Linha da relação `pokemon_learnable_moves` (par deduplicado). */
export interface LearnableMoveRow {
  readonly pokemon_id: number;
  readonly move_id: number;
  readonly version_details: unknown;
}

/** Linha da relação `pokemon_abilities` (par deduplicado). */
export interface PokemonAbilityRow {
  readonly pokemon_id: number;
  readonly ability_id: number;
  readonly is_hidden: boolean;
  readonly slot: number;
}

/** Tipo de artefato de baseline de design armazenado em `design_baseline`. */
export type DesignBaselineKind = 'matchups_36' | 'simulation_parameters';

/**
 * Linha da tabela `design_baseline`. PK composta `(version, kind)`; `payload`
 * guarda o conteúdo fiel do arquivo e `status` sinaliza, de forma legível, que
 * os valores ainda não foram calibrados empiricamente.
 */
export interface DesignBaselineRow {
  readonly version: string;
  readonly kind: DesignBaselineKind;
  readonly status: string;
  readonly payload: unknown;
}

// ---------------------------------------------------------------------------
// Contratos de escrita e leitura
// ---------------------------------------------------------------------------

/** Registro rejeitado por um escritor (ficha/relação inválida ou FK órfã). */
export interface RejectedRecord {
  readonly kind: string;
  readonly key: unknown;
  readonly reason: string;
}

/** Resultado de um upsert idempotente em lote. */
export interface UpsertResult {
  readonly inserted: number;
  readonly updated: number;
  readonly rejected: RejectedRecord[];
}

/**
 * Resultado de leitura que distingue presença de ausência sem lançar exceção.
 * `found: false` representa identificador inexistente ou espécie não permitida.
 */
export type Result<T> = { found: true; value: T } | { found: false };

// ---------------------------------------------------------------------------
// Projeções da camada de leitura (`lib/data/`)
// ---------------------------------------------------------------------------

/**
 * Registro de golpe retornado pela camada de leitura (`lib/data/registry.ts`).
 * Expõe a identidade (`move_id`, `name`) e o `raw_data` preservado fielmente,
 * sem conversão — reconstrução campo a campo do golpe de origem (Req. 12.5).
 */
export interface MoveRecord {
  readonly move_id: number;
  readonly name: string;
  readonly raw_data: unknown;
}

/**
 * Registro de habilidade retornado pela camada de leitura
 * (`lib/data/registry.ts`). Expõe a identidade (`ability_id`, `name`) e o
 * `raw_data` preservado fielmente, sem conversão (Req. 12.5).
 */
export interface AbilityRecord {
  readonly ability_id: number;
  readonly name: string;
  readonly raw_data: unknown;
}

/**
 * Projeção de leitura de uma espécie permitida (`is_allowed = true`), exposta
 * pela Camada_Leitura (`lib/data/species.ts`).
 *
 * Contém apenas a identidade (`pokemon_id`, `slug`), os `types` e as seis
 * estatísticas base — sem `raw_data`, `is_allowed`, altura ou peso — conforme
 * o contrato de leitura (Req. 12.1). As stats usam os nomes de coluna da
 * tabela `species` (`special_attack`/`special_defense`).
 */
export interface SpeciesSummary {
  readonly pokemon_id: number;
  readonly slug: string;
  readonly types: string[];
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly special_attack: number;
  readonly special_defense: number;
  readonly speed: number;
}

// ---------------------------------------------------------------------------
// Contratos de validação pós-ingestão (`lib/catalog/validate.ts`)
// ---------------------------------------------------------------------------

/**
 * Um problema detectado por uma verificação do Processo_Validacao_Pos_Ingestao.
 * `check` nomeia a verificação que falhou, `detail` descreve o problema de
 * forma legível e `ids` carrega os identificadores dos registros envolvidos
 * (ex.: `pokemon_id` em exclusão incorreta, `path` de recurso com checksum
 * divergente).
 */
export interface ValidationIssue {
  readonly check: string;
  readonly detail: string;
  readonly ids?: (number | string)[];
}

/**
 * Resultado agregado da validação pós-ingestão. `passed` é `true` se e somente
 * se `issues` estiver vazio (todas as verificações satisfeitas); qualquer falha
 * produz `passed: false` com os problemas listados em `issues` (Reqs. 8.6/8.7).
 */
export interface ValidationOutcome {
  readonly passed: boolean;
  readonly issues: ValidationIssue[];
}
