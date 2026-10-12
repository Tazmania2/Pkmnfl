/**
 * Cálculo canônico do Checksum_Seed e validação estrutural do documento
 * `.pflseed.json` (tabela `team_seeds`, migration de catálogo/seed).
 *
 * _Requirements:_
 * - R16.2 — campos obrigatórios não vazios (`schema`, `ruleset`, `athletes`,
 *   `lineups`, `special_teams_full_units`, `strategy`, `checksum`).
 * - R16.3 — Checksum_Seed determinístico/recomputável sobre a forma canônica.
 * - R16.4/R16.5 — proibição de campos de aleatoriedade de partida, logs,
 *   vencedores e resultados (`match_rng`, `logs`, `winners`, `results`).
 * - R16.6 — a importação é aceita sse o checksum recomputado for igual ao
 *   checksum armazenado no documento (propriedade P-5).
 *
 * A forma canônica, por definição do glossário (Checksum_Seed), é o JSON do
 * Seed_Time SEM o campo `checksum`, com chaves ordenadas recursivamente,
 * codificação UTF-8 e separadores compactos `','` e `':'` (sem espaços). O
 * `CHECK` do banco garante apenas o FORMATO do checksum (`^[0-9a-f]{64}$`); a
 * igualdade determinística é responsabilidade desta camada de aplicação.
 */

import { createHash } from 'node:crypto';

/** Campo de checksum, excluído da forma canônica (glossário Checksum_Seed). */
export const SEED_CHECKSUM_FIELD = 'checksum' as const;

/**
 * Campos obrigatórios e não vazios de um Seed_Time (R16.2). A ordem reflete a
 * ordem canônica usada no schema/documentação.
 */
export const SEED_REQUIRED_FIELDS = [
  'schema',
  'ruleset',
  'athletes',
  'lineups',
  'special_teams_full_units',
  'strategy',
  'checksum',
] as const;

/**
 * Campos proibidos num Seed_Time: aleatoriedade de partida, logs, vencedores e
 * resultados (R16.4/R16.5). Sua presença rejeita a persistência/importação.
 */
export const SEED_FORBIDDEN_FIELDS = [
  'match_rng',
  'logs',
  'winners',
  'results',
] as const;

/** Nome de um campo obrigatório do Seed_Time. */
export type SeedRequiredField = (typeof SEED_REQUIRED_FIELDS)[number];

/** Nome de um campo proibido do Seed_Time. */
export type SeedForbiddenField = (typeof SEED_FORBIDDEN_FIELDS)[number];

/** Qualquer valor JSON serializável. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Objeto JSON (documento de seed de topo). */
export type JsonObject = { [key: string]: JsonValue };

/** Documento de Seed_Time, modelado como objeto JSON arbitrário. */
export type SeedDocument = JsonObject;

/** Resultado da validação estrutural de um Seed_Time (R16.2/R16.4/R16.5). */
export interface SeedStructureResult {
  /**
   * `true` sse todos os campos obrigatórios estão presentes e não vazios E
   * nenhum campo proibido está presente.
   */
  readonly accepted: boolean;
  /** Campos obrigatórios ausentes, na ordem canônica. */
  readonly missing: readonly SeedRequiredField[];
  /** Campos obrigatórios presentes porém vazios, na ordem canônica. */
  readonly empty: readonly SeedRequiredField[];
  /** Campos proibidos encontrados, na ordem canônica. */
  readonly forbidden: readonly SeedForbiddenField[];
}

/** Resultado da verificação de integridade do checksum (R16.6). */
export interface SeedChecksumVerification {
  /** `true` sse o checksum recomputado for igual ao armazenado no documento. */
  readonly matches: boolean;
  /** Checksum SHA-256 recomputado sobre a forma canônica (hex minúsculo). */
  readonly computed: string;
  /**
   * Checksum armazenado no campo `checksum` do documento, ou `null` quando o
   * campo está ausente ou não é uma string.
   */
  readonly stored: string | null;
}

/**
 * Serializa um valor JSON em sua forma canônica: chaves de objeto ordenadas
 * lexicograficamente (recursivamente), separadores compactos `','`/`':'`, sem
 * espaços extras. Arrays preservam a ordem (significativa). `undefined` e
 * funções não ocorrem em JSON válido e não são produzidos aqui.
 */
function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    // Primitivos: delega ao JSON.stringify (escapes/UTF-8 corretos).
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(',')}]`;
  }

  // Objeto: ordena as chaves e serializa recursivamente cada entrada.
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => {
    const serializedKey = JSON.stringify(key);
    // `value[key]` é JsonValue; chaves vêm de Object.keys do próprio objeto.
    return `${serializedKey}:${canonicalize(value[key] as JsonValue)}`;
  });
  return `{${entries.join(',')}}`;
}

/**
 * Produz a forma canônica do documento de seed usada para o checksum: o JSON
 * canônico do documento SEM o campo `checksum` de topo (glossário
 * Checksum_Seed). Chaves ordenadas, UTF-8, separadores `','`/`':'`.
 */
export function canonicalizeSeedForChecksum(seedDocument: SeedDocument): string {
  const withoutChecksum: JsonObject = {};
  for (const key of Object.keys(seedDocument)) {
    if (key === SEED_CHECKSUM_FIELD) {
      continue;
    }
    withoutChecksum[key] = seedDocument[key] as JsonValue;
  }
  return canonicalize(withoutChecksum);
}

/**
 * Calcula o Checksum_Seed (R16.3): SHA-256 em hexadecimal minúsculo sobre a
 * forma canônica do documento (sem o campo `checksum`). Determinístico e
 * recomputável — a mesma entrada produz sempre o mesmo valor.
 */
export function computeSeedChecksum(seedDocument: SeedDocument): string {
  const canonical = canonicalizeSeedForChecksum(seedDocument);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Determina se um valor de campo obrigatório conta como "não vazio" (R16.2):
 * strings não podem ser vazias/apenas-espaços; arrays e objetos não podem ser
 * vazios; `null`/`undefined` são sempre vazios. Números e booleanos (inclusive
 * `0`/`false`) contam como presentes.
 */
function isNonEmptyFieldValue(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  // number | boolean
  return true;
}

/**
 * Valida a estrutura de um Seed_Time (R16.2/R16.4/R16.5). Aceita sse todos os
 * campos obrigatórios estão presentes e não vazios E nenhum campo proibido
 * está presente. Reporta ausências, vazios e campos proibidos encontrados.
 */
export function validateSeedStructure(
  seedDocument: SeedDocument,
): SeedStructureResult {
  const missing: SeedRequiredField[] = [];
  const empty: SeedRequiredField[] = [];
  const forbidden: SeedForbiddenField[] = [];

  for (const field of SEED_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(seedDocument, field)) {
      missing.push(field);
      continue;
    }
    if (!isNonEmptyFieldValue(seedDocument[field])) {
      empty.push(field);
    }
  }

  for (const field of SEED_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(seedDocument, field)) {
      forbidden.push(field);
    }
  }

  const accepted =
    missing.length === 0 && empty.length === 0 && forbidden.length === 0;

  return { accepted, missing, empty, forbidden };
}

/**
 * Verifica a integridade do checksum (R16.6): recomputa o Checksum_Seed sobre a
 * forma canônica e compara com o valor armazenado no campo `checksum` do
 * documento. `matches` é `true` sse os dois valores forem iguais.
 */
export function verifySeedChecksum(
  seedDocument: SeedDocument,
): SeedChecksumVerification {
  const computed = computeSeedChecksum(seedDocument);
  const rawStored = seedDocument[SEED_CHECKSUM_FIELD];
  const stored = typeof rawStored === 'string' ? rawStored : null;
  return { matches: stored !== null && stored === computed, computed, stored };
}
