/**
 * Pipeline de importação de seed (`lib/seed/import.ts`).
 *
 * Recebe os bytes crus de um `.pflseed.json` e um {@link EligibilitySnapshot}
 * síncrono e devolve um {@link ImportResult}: ou um {@link TeamDraft} carregado
 * (sucesso) ou uma {@link ImportRejection} legível identificando a **primeira**
 * etapa violada (recusa). A função é **pura**: sem DOM, sem rede, sem I/O, e
 * não muta nenhum estado externo — o chamador preserva o time corrente em caso
 * de recusa (R15.10/R15.11).
 *
 * As etapas são executadas **em ordem** e a primeira violação encerra o
 * pipeline, nomeando a causa (R15.13 — recusa legível):
 *
 *   SIZE → PARSE → STRUCTURE → SCHEMA_VERSION → ROSTER_CAP → ALLOWED_IDS →
 *   MOVES → ABILITY → LINEUP_IDENTITIES → FORBIDDEN_CONTENT → CHECKSUM
 *
 * As etapas de regra (`ALLOWED_IDS`, `MOVES`, `ABILITY`, `LINEUP_IDENTITIES`)
 * reusam o motor de validação puro (`lib/validation/`) — a mesma definição de
 * "válido" da ficha e do salvamento, evitando divergência (R15.4–R15.7). As
 * etapas `FORBIDDEN_CONTENT` e `CHECKSUM` reusam a foundation de seed
 * (`lib/seed/checksum.ts`) e a mesma canonicalização do export
 * (`verifyExportedChecksum`), mantendo UMA forma canônica no projeto
 * (R15.8/R15.9).
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10,
 * 15.11, 15.12, 15.13_
 */

import {
  canonicalizeSeedForChecksum,
  SEED_FORBIDDEN_FIELDS,
  type JsonObject,
  type JsonValue,
} from './checksum';
import { SEED_SCHEMA, type SeedDocument } from './export';
import {
  DEFAULT_ANATOMY_CONVENTIONS,
  validateRoster,
  validateLineups,
  validateAthlete,
  type ValidationWarning,
  type WarningCode,
} from '../validation';
import type { EligibilitySnapshot } from '../team/eligibility-adapter';
import type {
  AthleteDraft,
  LineupAssignment,
  TeamDraft,
} from '../team/model';
import { createHash } from 'node:crypto';

/** Teto do roster: nunca excede 53 atletas (R15.3). */
const ROSTER_CAP = 53;

/** Limite de tamanho do payload de importação: 5 MiB (R15.1). */
const MAX_SEED_BYTES = 5 * 1024 * 1024; // 5.242.880 bytes

/** Campo de checksum deste schema, excluído da forma canônica (R15.8). */
const SEED_SHA256_FIELD = 'checksum_sha256' as const;

/**
 * Etapas do pipeline de importação, na ordem exata de execução. Cada etapa
 * recusa a importação exatamente quando sua regra é violada (R15.13).
 */
export type ImportStep =
  | 'SIZE'
  | 'PARSE'
  | 'STRUCTURE'
  | 'SCHEMA_VERSION'
  | 'ROSTER_CAP'
  | 'ALLOWED_IDS'
  | 'MOVES'
  | 'ABILITY'
  | 'LINEUP_IDENTITIES'
  | 'FORBIDDEN_CONTENT'
  | 'CHECKSUM';

/**
 * Recusa de importação: identifica a etapa violada, uma mensagem legível e um
 * detalhe opcional estruturado (ex.: contagem recebida vs. limite, avisos do
 * motor) para diagnóstico (R15.13).
 */
export interface ImportRejection {
  /** Etapa do pipeline em que a importação foi recusada. */
  step: ImportStep;
  /** Mensagem específica e legível identificando a causa (R15.13). */
  message: string;
  /** Detalhe estruturado opcional da violação. */
  detail?: unknown;
}

/**
 * Resultado da importação: ou um {@link TeamDraft} carregado (sucesso, R15.10)
 * ou uma {@link ImportRejection} legível (recusa, R15.11).
 */
export type ImportResult =
  | { ok: true; draft: TeamDraft }
  | { ok: false; reason: ImportRejection };

/** Campos obrigatórios do documento `.pflseed.json` (R15.13). */
const REQUIRED_FIELDS = [
  'schema',
  'ruleset',
  'athletes',
  'lineups',
  'special_teams_full_units',
  'strategy',
  'checksum_sha256',
] as const;

/** Atalho para construir uma recusa de importação. */
function reject(
  step: ImportStep,
  message: string,
  detail?: unknown,
): { ok: false; reason: ImportRejection } {
  const reason: ImportRejection =
    detail === undefined ? { step, message } : { step, message, detail };
  return { ok: false, reason };
}

/** Verdadeiro para objetos JSON simples (não array, não null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

/**
 * Importa um documento `.pflseed.json` a partir de seus bytes crus.
 *
 * Executa as etapas em ordem; a **primeira** violação encerra o pipeline com
 * uma {@link ImportRejection}. Não há mutação de estado externo: o chamador
 * mantém o time corrente intacto em caso de recusa (R15.10/R15.11). Em caso de
 * sucesso, carrega o {@link TeamDraft} preservando atletas, escalações e
 * estratégia (R15.10).
 *
 * @param rawBytes Bytes crus (UTF-8) do documento importado.
 * @param elig Snapshot síncrono de elegibilidade da `Camada_Leitura`.
 */
export function importSeed(
  rawBytes: Uint8Array,
  elig: EligibilitySnapshot,
): ImportResult {
  // Etapa SIZE (R15.1): rejeita payloads acima de 5 MiB.
  if (rawBytes.length > MAX_SEED_BYTES) {
    return reject(
      'SIZE',
      `O arquivo tem ${rawBytes.length} bytes, acima do limite de ${MAX_SEED_BYTES} bytes (5 MiB).`,
      { received: rawBytes.length, limit: MAX_SEED_BYTES },
    );
  }

  // Etapa PARSE (R15.12): decodifica UTF-8 e faz JSON.parse.
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    parsed = JSON.parse(text);
  } catch (error) {
    return reject('PARSE', 'O conteúdo não é um JSON UTF-8 legível.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  // Etapa STRUCTURE (R15.13): objeto com todos os campos obrigatórios.
  if (!isPlainObject(parsed)) {
    return reject(
      'STRUCTURE',
      'O documento de seed deve ser um objeto JSON.',
    );
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) {
      return reject(
        'STRUCTURE',
        `O documento de seed não contém o campo obrigatório "${field}".`,
        { missing: field },
      );
    }
  }

  // Documento com campos presentes; tratamos como SeedDocument e validamos
  // semântica nas etapas seguintes.
  const doc = parsed as unknown as SeedDocument;

  // Etapa SCHEMA_VERSION (R15.2): versão de schema deve ser a suportada.
  if (doc.schema !== SEED_SCHEMA) {
    return reject(
      'SCHEMA_VERSION',
      `Versão de schema incompatível: recebido "${String(doc.schema)}", suportado "${SEED_SCHEMA}".`,
      { received: doc.schema, supported: SEED_SCHEMA },
    );
  }

  // A partir daqui precisamos interpretar o roster/escalações. Validamos a
  // forma dos arrays antes de projetá-los no TeamDraft.
  if (!Array.isArray(doc.athletes)) {
    return reject('STRUCTURE', 'O campo "athletes" deve ser uma lista.', {
      missing: 'athletes',
    });
  }

  // Etapa ROSTER_CAP (R15.3): no máximo 53 atletas.
  if (doc.athletes.length > ROSTER_CAP) {
    return reject(
      'ROSTER_CAP',
      `O roster tem ${doc.athletes.length} atletas, acima do limite de ${ROSTER_CAP}.`,
      { count: doc.athletes.length, cap: ROSTER_CAP },
    );
  }

  // Projeta o documento num TeamDraft candidato (loadFromSeed-style). Erros de
  // forma dos elementos são reportados como STRUCTURE.
  const projection = projectDraft(doc);
  if (!projection.ok) {
    return reject('STRUCTURE', projection.message, projection.detail);
  }
  const draft = projection.draft;

  // Etapas de regra reusam o motor de validação puro (R15.4–R15.7). Separamos
  // os avisos por etapa para que a recusa nomeie a causa correta.
  const rosterWarnings = validateRoster(draft, elig);
  const athleteWarnings: ValidationWarning[] = [];
  for (const athlete of draft.roster) {
    athleteWarnings.push(
      ...validateAthlete(athlete, elig, DEFAULT_ANATOMY_CONVENTIONS),
    );
  }
  const lineupWarnings = validateLineups(draft);

  // Etapa ALLOWED_IDS (R15.4): pokemon_id ∈ allowedSpecies (SPECIES_NOT_ALLOWED).
  const allowedViolation = firstBlockingWithCode(rosterWarnings, [
    'SPECIES_NOT_ALLOWED',
  ]);
  if (allowedViolation) {
    return reject('ALLOWED_IDS', allowedViolation.message, allowedViolation);
  }

  // Etapa MOVES (R15.5): 4 golpes distintos e aprendíveis.
  const movesViolation = firstBlockingWithCode(athleteWarnings, [
    'MOVE_NOT_LEARNABLE',
    'MOVE_COUNT_NOT_FOUR',
    'MOVE_DUPLICATE',
  ]);
  if (movesViolation) {
    return reject('MOVES', movesViolation.message, movesViolation);
  }

  // Etapa ABILITY (R15.6): habilidade disponível para a espécie.
  const abilityViolation = firstBlockingWithCode(athleteWarnings, [
    'ABILITY_NOT_AVAILABLE',
  ]);
  if (abilityViolation) {
    return reject('ABILITY', abilityViolation.message, abilityViolation);
  }

  // Etapa LINEUP_IDENTITIES (R15.7): 11 identidades distintas por unidade.
  const lineupViolation = firstBlockingWithCode(lineupWarnings, [
    'UNIT_INCOMPLETE',
    'DUPLICATE_IDENTITY_SNAP',
  ]);
  if (lineupViolation) {
    return reject(
      'LINEUP_IDENTITIES',
      lineupViolation.message,
      lineupViolation,
    );
  }

  // Etapa FORBIDDEN_CONTENT (R15.9): nenhum campo de aleatoriedade/log/
  // vencedor/resultado presente.
  for (const field of SEED_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(doc, field)) {
      return reject(
        'FORBIDDEN_CONTENT',
        `O documento de seed contém o campo proibido "${field}".`,
        { forbidden: field },
      );
    }
  }

  // Etapa CHECKSUM (R15.8): checksum recomputado deve igualar o armazenado.
  const checksum = verifyChecksum(doc);
  if (!checksum.matches) {
    return reject(
      'CHECKSUM',
      'O checksum recomputado não corresponde ao checksum do documento.',
      { computed: checksum.computed, stored: checksum.stored },
    );
  }

  return { ok: true, draft };
}

/**
 * Retorna o primeiro aviso bloqueante cujo código está em `codes`, ou
 * `undefined`. Mantém a ordem do motor, de modo que a recusa reporte a primeira
 * violação relevante da etapa.
 */
function firstBlockingWithCode(
  warnings: readonly ValidationWarning[],
  codes: readonly WarningCode[],
): ValidationWarning | undefined {
  const codeSet = new Set<WarningCode>(codes);
  return warnings.find((w) => w.blocking && codeSet.has(w.code));
}

/** Resultado da projeção do documento num TeamDraft candidato. */
type ProjectionResult =
  | { ok: true; draft: TeamDraft }
  | { ok: false; message: string; detail?: unknown };

/**
 * Projeta um {@link SeedDocument} num {@link TeamDraft} (loadFromSeed-style):
 * `athletes` → `roster`, `lineups` + `special_teams_full_units` →
 * `draft.lineups`, `strategy` → `strategy`. Preserva a identidade de instância
 * (incl. duplicatas de espécie) e os golpes. Como o seed não carrega
 * `positionDesignation`, o atleta importado recebe `''` (livre, R15.10 sobre os
 * campos representáveis).
 *
 * Valida a forma estrutural dos elementos; qualquer desvio produz uma falha de
 * projeção reportada como STRUCTURE pelo chamador.
 */
function projectDraft(doc: SeedDocument): ProjectionResult {
  const roster: AthleteDraft[] = [];
  for (const [index, rawAthlete] of doc.athletes.entries()) {
    if (!isPlainObject(rawAthlete)) {
      return {
        ok: false,
        message: `O atleta na posição ${index} não é um objeto.`,
        detail: { index },
      };
    }
    const { instance_id, pokemon_id, ability_id, move_ids } = rawAthlete;
    if (
      typeof instance_id !== 'number' ||
      typeof pokemon_id !== 'number' ||
      typeof ability_id !== 'number' ||
      !Array.isArray(move_ids) ||
      !move_ids.every((m) => typeof m === 'number')
    ) {
      return {
        ok: false,
        message: `O atleta na posição ${index} tem campos inválidos (instance_id, pokemon_id, ability_id, move_ids).`,
        detail: { index },
      };
    }
    roster.push({
      instanceId: instance_id,
      pokemonId: pokemon_id,
      abilityId: ability_id,
      moveIds: [...move_ids],
      positionDesignation: '',
    });
  }

  const lineups: LineupAssignment[] = [];
  const projectLineups = (raw: unknown, label: string): string | null => {
    if (!Array.isArray(raw)) {
      return `O campo "${label}" deve ser uma lista.`;
    }
    for (const [index, rawLineup] of raw.entries()) {
      if (!isPlainObject(rawLineup)) {
        return `A escalação "${label}" na posição ${index} não é um objeto.`;
      }
      const { unit, role, instance_id } = rawLineup;
      if (
        typeof unit !== 'string' ||
        typeof role !== 'string' ||
        typeof instance_id !== 'number'
      ) {
        return `A escalação "${label}" na posição ${index} tem campos inválidos.`;
      }
      lineups.push({
        unit: unit as LineupAssignment['unit'],
        role,
        instanceId: instance_id,
      });
    }
    return null;
  };

  const lineupsError = projectLineups(doc.lineups, 'lineups');
  if (lineupsError !== null) {
    return { ok: false, message: lineupsError };
  }
  const specialError = projectLineups(
    doc.special_teams_full_units,
    'special_teams_full_units',
  );
  if (specialError !== null) {
    return { ok: false, message: specialError };
  }

  const rawStrategy = doc.strategy as unknown;
  if (!isPlainObject(rawStrategy)) {
    return { ok: false, message: 'O campo "strategy" deve ser um objeto.' };
  }
  const {
    offenseStyle,
    defenseStyle,
    offensePlayPriority,
    defensePlayPriority,
  } = rawStrategy;
  if (
    typeof offenseStyle !== 'string' ||
    typeof defenseStyle !== 'string' ||
    !Array.isArray(offensePlayPriority) ||
    !Array.isArray(defensePlayPriority)
  ) {
    return { ok: false, message: 'O campo "strategy" tem campos inválidos.' };
  }

  const rawName = (doc as unknown as JsonObject)['name'];
  const draft: TeamDraft = {
    name: typeof rawName === 'string' ? rawName : '',
    roster,
    lineups,
    strategy: {
      offenseStyle,
      defenseStyle,
      offensePlayPriority: [
        ...(offensePlayPriority as TeamDraft['strategy']['offensePlayPriority']),
      ],
      defensePlayPriority: [
        ...(defensePlayPriority as TeamDraft['strategy']['defensePlayPriority']),
      ],
    },
  };

  return { ok: true, draft };
}

/** Resultado da verificação de checksum na etapa CHECKSUM. */
interface ChecksumVerification {
  matches: boolean;
  computed: string;
  stored: string | null;
}

/**
 * Recomputa o checksum do documento sobre sua forma canônica (excluindo
 * `checksum_sha256`) e compara com o valor armazenado. Reusa exatamente a
 * canonicalização da foundation e o mesmo algoritmo do export
 * (`verifyExportedChecksum`), garantindo UMA única forma canônica (R15.8).
 */
function verifyChecksum(doc: SeedDocument): ChecksumVerification {
  const withoutChecksum: JsonObject = {};
  for (const key of Object.keys(doc)) {
    if (key === SEED_SHA256_FIELD) {
      continue;
    }
    withoutChecksum[key] = (doc as unknown as JsonObject)[key] as JsonValue;
  }
  const canonical = canonicalizeSeedForChecksum(withoutChecksum);
  const computed = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const rawStored = (doc as unknown as JsonObject)[SEED_SHA256_FIELD];
  const stored = typeof rawStored === 'string' ? rawStored : null;
  return { matches: stored !== null && stored === computed, computed, stored };
}
