/**
 * Exportação de seed de time (`lib/seed/export.ts`).
 *
 * Converte um {@link TeamDraft} em edição no documento `.pflseed.json`
 * interoperável e verificável (`SeedDocument`), reusando a canonicalização e o
 * checksum da foundation (`lib/seed/checksum.ts`) — há UMA única forma canônica
 * no projeto. Este módulo é **puro**: sem DOM, sem rede, sem I/O.
 *
 * Conciliação do nome do campo de checksum: a foundation nomeia o campo
 * `checksum` (`SEED_CHECKSUM_FIELD`), enquanto o design/spec desta UI o chama de
 * `checksum_sha256`. Para reusar a mesma canonicalização SEM reimplementar
 * SHA-256, montamos o documento **sem nenhum campo de checksum**, calculamos o
 * valor com `computeSeedChecksum` da foundation (que apenas remove o campo
 * `checksum` — ausente aqui, logo canoniza o objeto inteiro) e anexamos o
 * resultado como `checksum_sha256`. A verificação de round-trip
 * ({@link verifyExportedChecksum}) delega à mesma canonicalização, excluindo o
 * campo `checksum_sha256`, garantindo que recomputar reproduz o mesmo valor.
 *
 * _Requirements: 14.2, 14.3, 14.4, 14.5_
 */

import type { LineupUnit, Role, StrategyDraft, TeamDraft } from '../team/model';
import {
  canonicalizeSeedForChecksum,
  type JsonObject,
  type JsonValue,
} from './checksum';
import { createHash } from 'node:crypto';

/**
 * Identificador de versão de schema do `.pflseed.json` produzido por esta
 * exportação. É o valor que a importação (`lib/seed/import.ts`) compara contra
 * a versão suportada (R15.2). Nota: a foundation não define uma constante de
 * versão de schema; adotamos `pfl-seed-1` como a versão corrente desta UI.
 */
export const SEED_SCHEMA = 'pfl-seed-1' as const;

/**
 * Identificador do conjunto de regras do PFL embutido no seed. Nota: não há
 * constante de ruleset na foundation; adotamos `pfl-mvp-1` como identificador
 * estável do ruleset do MVP.
 */
export const SEED_RULESET = 'pfl-mvp-1' as const;

/**
 * Unidades de special teams, na ordem canônica. São as 6 unidades automáticas
 * (R12.6) exportadas em `special_teams_full_units`, distintas de `offense`/
 * `defense`.
 */
export const SPECIAL_TEAMS_UNITS: readonly LineupUnit[] = [
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
] as const;

/** Atleta serializado no seed (R14.3). */
export interface SeedAthlete {
  instance_id: number;
  pokemon_id: number;
  ability_id: number;
  move_ids: number[];
}

/** Atribuição de escalação serializada no seed. */
export interface SeedLineup {
  unit: LineupUnit;
  role: Role;
  instance_id: number;
}

/**
 * Documento `.pflseed.json` exportado. Contém exatamente os campos definidos
 * pelo design/spec (R14.2) e nenhum campo de aleatoriedade de partida, log,
 * vencedor ou resultado (R14.5).
 */
export interface SeedDocument {
  schema: string;
  ruleset: string;
  athletes: SeedAthlete[];
  lineups: SeedLineup[];
  special_teams_full_units: SeedLineup[];
  strategy: StrategyDraft;
  /** SHA-256 canônico sobre o documento SEM este campo (R14.4). */
  checksum_sha256: string;
}

/** Campo de checksum deste schema, excluído da forma canônica (R14.4). */
const SEED_SHA256_FIELD = 'checksum_sha256' as const;

/**
 * Projeta o roster do draft nos atletas do seed, preservando identidade de
 * instância (inclusive duplicatas de espécie) e os quatro golpes distintos
 * (R14.3). `move_ids` é copiado para desacoplar o documento do draft.
 */
function toSeedAthletes(draft: TeamDraft): SeedAthlete[] {
  return draft.roster.map((athlete) => ({
    instance_id: athlete.instanceId,
    pokemon_id: athlete.pokemonId,
    ability_id: athlete.abilityId,
    move_ids: [...athlete.moveIds],
  }));
}

/** Converte uma atribuição do draft no formato de escalação do seed. */
function toSeedLineup(assignment: {
  unit: LineupUnit;
  role: Role;
  instanceId: number;
}): SeedLineup {
  return {
    unit: assignment.unit,
    role: assignment.role,
    instance_id: assignment.instanceId,
  };
}

/**
 * Separa as atribuições do draft em escalações de ataque/defesa (`lineups`) e
 * de special teams (`special_teams_full_units`), descartando nada: toda unidade
 * reconhecida vai para exatamente um dos dois conjuntos.
 */
function partitionLineups(draft: TeamDraft): {
  lineups: SeedLineup[];
  specialTeams: SeedLineup[];
} {
  const specialTeamsSet = new Set<LineupUnit>(SPECIAL_TEAMS_UNITS);
  const lineups: SeedLineup[] = [];
  const specialTeams: SeedLineup[] = [];
  for (const assignment of draft.lineups) {
    if (specialTeamsSet.has(assignment.unit)) {
      specialTeams.push(toSeedLineup(assignment));
    } else {
      lineups.push(toSeedLineup(assignment));
    }
  }
  return { lineups, specialTeams };
}

/**
 * Calcula o checksum canônico sobre um documento de seed SEM qualquer campo de
 * checksum, reusando a canonicalização da foundation. Delega a
 * `canonicalizeSeedForChecksum` (chaves ordenadas, UTF-8, separadores
 * compactos) e aplica SHA-256 hex minúsculo, idêntico a `computeSeedChecksum`
 * da foundation — mantemos UMA forma canônica (R14.4).
 */
function checksumOverCanonical(withoutChecksum: JsonObject): string {
  const canonical = canonicalizeSeedForChecksum(withoutChecksum);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Exporta um {@link TeamDraft} válido como {@link SeedDocument} (R14.2–R14.5).
 *
 * Monta `schema`, `ruleset`, `athletes`, `lineups`,
 * `special_teams_full_units` e `strategy`, omitindo qualquer aleatoriedade de
 * partida, log, vencedor ou resultado (R14.5 — simplesmente não produzidos
 * aqui). Em seguida calcula `checksum_sha256` sobre a forma canônica do
 * documento sem esse campo e o anexa (R14.4).
 */
export function exportSeed(draft: TeamDraft): SeedDocument {
  const { lineups, specialTeams } = partitionLineups(draft);

  // Documento sem o campo de checksum — base canônica do SHA-256 (R14.4).
  const withoutChecksum = {
    schema: SEED_SCHEMA,
    ruleset: SEED_RULESET,
    athletes: toSeedAthletes(draft),
    lineups,
    special_teams_full_units: specialTeams,
    strategy: {
      offenseStyle: draft.strategy.offenseStyle,
      defenseStyle: draft.strategy.defenseStyle,
      offensePlayPriority: [...draft.strategy.offensePlayPriority],
      defensePlayPriority: [...draft.strategy.defensePlayPriority],
    },
  };

  const checksum_sha256 = checksumOverCanonical(
    withoutChecksum as unknown as JsonObject,
  );

  return { ...withoutChecksum, checksum_sha256 };
}

/**
 * Recomputa o checksum do documento exportado sobre sua forma canônica
 * (excluindo `checksum_sha256`) e o compara ao valor armazenado. `true` sse o
 * documento faz round-trip — recomputar reproduz o `checksum_sha256` presente.
 * Reusa a canonicalização da foundation, exatamente como o export (R14.4).
 */
export function verifyExportedChecksum(doc: SeedDocument): boolean {
  const withoutChecksum: JsonObject = {};
  for (const key of Object.keys(doc)) {
    if (key === SEED_SHA256_FIELD) {
      continue;
    }
    withoutChecksum[key] = (doc as unknown as JsonObject)[key] as JsonValue;
  }
  return checksumOverCanonical(withoutChecksum) === doc.checksum_sha256;
}
