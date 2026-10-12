/**
 * Leitores de arquivo do Catálogo Oficial v1.7 (spec `pfl-data-catalog`).
 *
 * Este módulo implementa a camada de **leitura e validação estrutural** dos
 * arquivos locais do acervo (`fichas_146_pfl_v16.json`, `moves_591_enriched.json`,
 * `abilities_113_enriched.json`, `moves_to_pokemon_ids.json`,
 * `abilities_to_pokemon_ids.json`, `manifest.json`), devolvendo estruturas
 * tipadas prontas para a transformação pura em `lib/catalog/transform.ts`.
 *
 * Princípio de design (design.md §1 "Leitores de catálogo"): **o I/O de arquivo
 * é separado da lógica de validação/transformação**. Cada entidade tem:
 *
 * - uma função **pura** `parse*` que recebe o JSON já desserializado e valida a
 *   sua forma, sem tocar o disco — fácil de exercitar por testes de exemplo e
 *   PBT (tarefa 2.3); e
 * - uma função **efeito** `load*` que lê o arquivo do disco (`node:fs`),
 *   desserializa e delega à `parse*` correspondente.
 *
 * As `parse*` separam registros válidos dos **rejeitados** (ex.: ficha sem
 * `pokemon_id`/`slug`, R1.5) sem lançar exceção, de modo que o chamador decida
 * registrar a rejeição e seguir com os demais (design.md "Error Handling").
 * As funções `load*` públicas expõem apenas as estruturas válidas tipadas,
 * conforme as assinaturas do design; a contraparte `*WithRejections` expõe
 * também os registros rejeitados para a camada de seed/validação.
 *
 * _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_ (R1.5 — rejeição de ficha inválida)
 */

import { readFileSync } from 'node:fs';

import type {
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  IndiceReverso,
  ManifestEntry,
} from './types';

// ---------------------------------------------------------------------------
// Rejeições e resultado de parse
// ---------------------------------------------------------------------------

/**
 * Registro de origem descartado durante a leitura por não satisfazer a forma
 * mínima esperada (ex.: ficha sem `pokemon_id`/`slug`). Preserva o índice do
 * registro na fonte, o motivo legível e o valor cru para auditoria posterior.
 */
export interface RejectedSourceRecord {
  /** Posição (0-based) do registro no array/arquivo de origem. */
  readonly index: number;
  /** Descrição legível do porquê o registro foi rejeitado. */
  readonly reason: string;
  /** O valor cru rejeitado, para inspeção/registro. */
  readonly value: unknown;
}

/**
 * Resultado de uma leitura: os registros válidos tipados e os rejeitados.
 * Nunca lança por registro inválido — a decisão de abortar/registrar é do
 * chamador (seed), permitindo processar os demais (R1.5, design "Error Handling").
 */
export interface ParseResult<T> {
  readonly valid: readonly T[];
  readonly rejected: readonly RejectedSourceRecord[];
}

// ---------------------------------------------------------------------------
// Utilitários puros de forma
// ---------------------------------------------------------------------------

/** `true` sse `value` é um objeto não nulo e não um array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `true` sse `value` é um inteiro finito (id de entidade do catálogo). */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** `true` sse `value` é uma string não vazia (após trim). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Desserializa o conteúdo de um arquivo JSON do disco. Isola o único ponto de
 * I/O (efeito) das funções `parse*` puras. Erros de leitura/parse propagam ao
 * chamador — um arquivo ilegível ou JSON corrompido é uma falha de pré-carga,
 * não um registro rejeitável.
 */
function readJsonFile(path: string): unknown {
  const content = readFileSync(path, 'utf8');
  return JSON.parse(content) as unknown;
}

// ---------------------------------------------------------------------------
// Fichas de espécie (fichas_146_pfl_v16.json)
// ---------------------------------------------------------------------------

const STAT_NAMES = [
  'hp',
  'attack',
  'defense',
  'special-attack',
  'special-defense',
  'speed',
] as const;

/** Valida o bloco `official` de uma ficha; `null` se a forma for inválida. */
function validateOfficial(value: unknown): FichaEspecie['official'] | null {
  if (!isRecord(value)) {
    return null;
  }

  const { types, stats, height_dm, weight_hg, ability_options, learnable_moves } =
    value;

  if (!Array.isArray(types) || !types.every(isNonEmptyString)) {
    return null;
  }
  if (!isRecord(stats) || !STAT_NAMES.every((s) => isInteger(stats[s]))) {
    return null;
  }
  if (!isInteger(height_dm) || !isInteger(weight_hg)) {
    return null;
  }
  if (!Array.isArray(ability_options) || !Array.isArray(learnable_moves)) {
    return null;
  }

  // A estrutura é fiel à origem; o cast reflete a validação acima.
  return value as unknown as FichaEspecie['official'];
}

/**
 * Valida uma única ficha de espécie. Retorna a ficha tipada quando possui, no
 * mínimo, `pokemon_id` inteiro, `slug` não vazio e um bloco `official` íntegro;
 * caso contrário retorna o motivo da rejeição (R1.5).
 */
function validateFicha(
  value: unknown,
): { ok: true; ficha: FichaEspecie } | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: 'ficha não é um objeto' };
  }
  if (!isInteger(value.pokemon_id)) {
    return { ok: false, reason: 'pokemon_id ausente ou não inteiro' };
  }
  if (!isNonEmptyString(value.slug)) {
    return { ok: false, reason: 'slug ausente ou vazio' };
  }
  const official = validateOfficial(value.official);
  if (official === null) {
    return { ok: false, reason: 'bloco official ausente ou malformado' };
  }
  return { ok: true, ficha: value as unknown as FichaEspecie };
}

/**
 * Função **pura**: valida um array já desserializado de fichas, separando as
 * válidas das rejeitadas (R1.5). Entrada que não seja um array resulta em
 * nenhuma ficha válida e uma rejeição única descrevendo o problema.
 */
export function parseFichas(data: unknown): ParseResult<FichaEspecie> {
  if (!Array.isArray(data)) {
    return {
      valid: [],
      rejected: [{ index: -1, reason: 'arquivo de fichas não é um array', value: data }],
    };
  }

  const valid: FichaEspecie[] = [];
  const rejected: RejectedSourceRecord[] = [];

  data.forEach((entry, index) => {
    const result = validateFicha(entry);
    if (result.ok) {
      valid.push(result.ficha);
    } else {
      rejected.push({ index, reason: result.reason, value: entry });
    }
  });

  return { valid, rejected };
}

/**
 * **Efeito**: lê o arquivo de fichas do disco e retorna as fichas válidas e as
 * rejeitadas. Útil para o seed, que registra rejeições e segue (R1.5).
 */
export function loadFichasWithRejections(path: string): ParseResult<FichaEspecie> {
  return parseFichas(readJsonFile(path));
}

/**
 * **Efeito**: lê e valida o arquivo de fichas, retornando apenas as válidas
 * tipadas (assinatura do design.md §1).
 */
export function loadFichas(path: string): FichaEspecie[] {
  return [...loadFichasWithRejections(path).valid];
}

// ---------------------------------------------------------------------------
// Golpes enriquecidos (moves_591_enriched.json)
// ---------------------------------------------------------------------------

/**
 * Valida uma entidade "nomeada por id" (golpe/habilidade): exige `id` inteiro e
 * `name` não vazio, preservando o restante da estrutura fiel.
 */
function validateIdName<T>(
  value: unknown,
): { ok: true; entity: T } | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: 'registro não é um objeto' };
  }
  if (!isInteger(value.id)) {
    return { ok: false, reason: 'id ausente ou não inteiro' };
  }
  if (!isNonEmptyString(value.name)) {
    return { ok: false, reason: 'name ausente ou vazio' };
  }
  return { ok: true, entity: value as unknown as T };
}

/** Função **pura**: valida um array desserializado de golpes enriquecidos. */
export function parseMoves(data: unknown): ParseResult<GolpeEnriquecido> {
  return parseIdNameArray<GolpeEnriquecido>(data, 'golpes');
}

/** Função **pura**: valida um array desserializado de habilidades enriquecidas. */
export function parseAbilities(data: unknown): ParseResult<HabilidadeEnriquecida> {
  return parseIdNameArray<HabilidadeEnriquecida>(data, 'habilidades');
}

/** Núcleo compartilhado de parsing para entidades `{ id, name, ... }`. */
function parseIdNameArray<T>(data: unknown, label: string): ParseResult<T> {
  if (!Array.isArray(data)) {
    return {
      valid: [],
      rejected: [
        { index: -1, reason: `arquivo de ${label} não é um array`, value: data },
      ],
    };
  }

  const valid: T[] = [];
  const rejected: RejectedSourceRecord[] = [];

  data.forEach((entry, index) => {
    const result = validateIdName<T>(entry);
    if (result.ok) {
      valid.push(result.entity);
    } else {
      rejected.push({ index, reason: result.reason, value: entry });
    }
  });

  return { valid, rejected };
}

/** **Efeito**: lê golpes do disco, retornando válidos e rejeitados. */
export function loadMovesWithRejections(path: string): ParseResult<GolpeEnriquecido> {
  return parseMoves(readJsonFile(path));
}

/** **Efeito**: lê e valida golpes, retornando apenas os válidos (design §1). */
export function loadMoves(path: string): GolpeEnriquecido[] {
  return [...loadMovesWithRejections(path).valid];
}

/** **Efeito**: lê habilidades do disco, retornando válidas e rejeitadas. */
export function loadAbilitiesWithRejections(
  path: string,
): ParseResult<HabilidadeEnriquecida> {
  return parseAbilities(readJsonFile(path));
}

/** **Efeito**: lê e valida habilidades, retornando apenas as válidas (design §1). */
export function loadAbilities(path: string): HabilidadeEnriquecida[] {
  return [...loadAbilitiesWithRejections(path).valid];
}

// ---------------------------------------------------------------------------
// Índice reverso (moves_to_pokemon_ids.json, abilities_to_pokemon_ids.json)
// ---------------------------------------------------------------------------

/**
 * Função **pura**: valida um índice reverso desserializado. Mantém apenas as
 * entradas cuja chave representa um id e cujo valor é um array de `pokemon_id`
 * inteiros; entradas malformadas são descartadas silenciosamente da estrutura
 * tipada (um índice reverso não é "um registro por linha" de domínio).
 */
export function parseReverseIndex(data: unknown): IndiceReverso {
  if (!isRecord(data)) {
    return {};
  }

  const index: IndiceReverso = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (Array.isArray(value) && value.every(isInteger)) {
      index[key] = value as number[];
    }
  }
  return index;
}

/** **Efeito**: lê e valida um índice reverso do disco (design §1). */
export function loadReverseIndex(path: string): IndiceReverso {
  return parseReverseIndex(readJsonFile(path));
}

// ---------------------------------------------------------------------------
// Manifest (manifest.json — caminhos relativos + SHA-256)
// ---------------------------------------------------------------------------

/**
 * Normaliza uma entrada de manifest em `{ path, sha256 }`. Aceita tanto a chave
 * `path` quanto `file` (o acervo registra `file`), exigindo um `sha256` string.
 */
function normalizeManifestEntry(value: unknown): ManifestEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawPath = isNonEmptyString(value.path)
    ? value.path
    : isNonEmptyString(value.file)
      ? value.file
      : null;
  if (rawPath === null || !isNonEmptyString(value.sha256)) {
    return null;
  }
  return { path: rawPath, sha256: value.sha256 };
}

/**
 * Função **pura**: valida um manifest desserializado em uma lista de
 * `ManifestEntry`. Aceita tanto um array de entradas no topo quanto um objeto
 * com a lista em `endpoints` (forma usada pelos manifests de captura do acervo).
 * Entradas sem `path`/`file` ou sem `sha256` são descartadas.
 */
export function parseManifest(data: unknown): ManifestEntry[] {
  const rawEntries: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.endpoints)
      ? data.endpoints
      : [];

  const entries: ManifestEntry[] = [];
  for (const raw of rawEntries) {
    const entry = normalizeManifestEntry(raw);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

/** **Efeito**: lê e valida o manifest do disco (design §1). */
export function loadManifest(path: string): ManifestEntry[] {
  return parseManifest(readJsonFile(path));
}
