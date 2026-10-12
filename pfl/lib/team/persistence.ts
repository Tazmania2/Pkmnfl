/**
 * Núcleo testável de salvamento de time (`lib/team/persistence.ts`).
 *
 * Este módulo isola a lógica de **revalidação server-side + persistência** do
 * Route Handler `app/api/team/route.ts`, para que ela seja exercível por testes
 * de integração **sem Supabase real** nem rede. O handler HTTP permanece
 * responsável apenas por parsear/validar a forma do corpo e traduzir o
 * resultado em respostas; aqui mora a regra de negócio da fronteira de
 * confiança (R9.2/R9.3/R9.4):
 *
 * 1. **Revalidação**: reexecuta `validateDraft` (o mesmo motor puro da ficha e
 *    da importação) sobre o {@link TeamDraft} recebido, contra um
 *    {@link EligibilitySnapshot} resolvido server-side. Se houver qualquer aviso
 *    bloqueante (`hasBlocking`), **nada** é persistido (R9.3).
 * 2. **Persistência**: só quando a revalidação passa, grava o time nas cinco
 *    tabelas da foundation (`user_teams`, `athletes`, `athlete_moves`,
 *    `lineups`, `strategy`), preservando a ordem dos golpes (slot 1-based) e das
 *    prioridades de jogada (R9.4).
 *
 * A fronteira impura (cliente Supabase e fonte de elegibilidade) é **injetável**
 * via {@link SaveTeamDeps}, permitindo que os testes forneçam um cliente
 * in-memory e um snapshot/fonte controlados. Em produção o Route Handler injeta
 * `createPublicClient()` e `createEligibilitySource()`.
 *
 * ## Mapeamento de jogadas autoritativas
 *
 * A `strategy` da foundation guarda `offense_play_ids` / `defense_play_ids` como
 * `integer[]`. Os {@link PlayId} autoritativos (`O_RUN_INSIDE`, `D_RUN_FIT`, …)
 * são mapeados para esses inteiros pela **posição 1-based na ordem canônica do
 * `play_catalog_18.json`** (que coincide com {@link OFFENSE_PLAYS}/
 * {@link DEFENSE_PLAYS}). A **ordem das prioridades** do draft é preservada no
 * array persistido.
 *
 * _Requirements: 9.2, 9.3, 9.4_
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveEligibilitySnapshot,
  type EligibilitySnapshot,
  type EligibilitySource,
} from './eligibility-adapter';
import {
  OFFENSE_PLAYS,
  DEFENSE_PLAYS,
  type PlayId,
  type TeamDraft,
  type LineupUnit,
} from './model';
import {
  validateDraft,
  hasBlocking,
  DEFAULT_ANATOMY_CONVENTIONS,
  type ValidationWarning,
} from '../validation';
import type { AnatomyConventions } from '../anatomy';

// ---------------------------------------------------------------------------
// Mapa autoritativo PlayId → id inteiro do play_catalog_18.json
// ---------------------------------------------------------------------------

/**
 * Ordinais 1-based autoritativos dos jogos de ataque, na ordem canônica do
 * `play_catalog_18.json` (= {@link OFFENSE_PLAYS}). Usados como `integer` id na
 * coluna `strategy.offense_play_ids`.
 */
export const OFFENSE_PLAY_ID: ReadonlyMap<PlayId, number> = new Map(
  OFFENSE_PLAYS.map((play, index) => [play, index + 1] as const),
);

/**
 * Ordinais 1-based autoritativos dos jogos de defesa, na ordem canônica do
 * `play_catalog_18.json` (= {@link DEFENSE_PLAYS}). Os jogos de defesa seguem os
 * de ataque no catálogo, logo recebem ids 7..12.
 */
export const DEFENSE_PLAY_ID: ReadonlyMap<PlayId, number> = new Map(
  DEFENSE_PLAYS.map((play, index) => [play, OFFENSE_PLAYS.length + index + 1] as const),
);

/**
 * Projeta uma permutação de {@link PlayId} nos ids inteiros autoritativos,
 * **preservando a ordem** (prioridade) do array de entrada (R12.3/R12.4).
 */
export function mapPlayPriority(
  priority: readonly PlayId[],
  table: ReadonlyMap<PlayId, number>,
): number[] {
  const out: number[] = [];
  for (const play of priority) {
    const id = table.get(play);
    if (id !== undefined) {
      out.push(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Erro de persistência
// ---------------------------------------------------------------------------

/**
 * Erro de persistência: envolve a falha de uma operação de banco e carrega a
 * referência do time recém-criado para que o chamador possa tentar reverter
 * (best-effort) antes de propagar.
 */
export class PersistenceError extends Error {
  readonly teamId?: string;

  constructor(message: string, teamId?: string) {
    super(message);
    this.name = 'PersistenceError';
    this.teamId = teamId;
  }
}

/**
 * Erro de revalidação: o {@link TeamDraft} possui avisos bloqueantes e **não
 * pode ser salvo** (R9.3). Carrega a lista completa de avisos para o chamador
 * reexibir os motivos. Nada é persistido quando este erro é lançado.
 */
export class BlockingValidationError extends Error {
  readonly warnings: readonly ValidationWarning[];

  constructor(warnings: readonly ValidationWarning[]) {
    super('o time possui avisos bloqueantes e não pode ser salvo');
    this.name = 'BlockingValidationError';
    this.warnings = warnings;
  }
}

// ---------------------------------------------------------------------------
// Persistência best-effort transacional nas 5 tabelas da foundation
// ---------------------------------------------------------------------------

/**
 * Persiste o {@link TeamDraft} validado nas tabelas da foundation, nesta ordem:
 *
 * 1. `user_teams` — cria o time (id gerado) e devolve o `teamId`.
 * 2. `athletes` — uma linha por atleta do roster (mapeando `instance_id`,
 *    `pokemon_id`, `ability_id`, `position_designation`). Guarda o id gerado por
 *    `instanceId` para ligar golpes e escalações.
 * 3. `athlete_moves` — até 4 linhas por atleta, com `slot` 1-based preservando a
 *    ordem dos golpes do draft (o trigger `enforce_exactly_4_moves` valida a
 *    cardinalidade no commit).
 * 4. `lineups` — uma linha por atribuição (`unit`, `role`, `athlete_id`).
 * 5. `strategy` — insert 1:1 com `offense_play_ids`/`defense_play_ids` como
 *    arrays de ids autoritativos **na ordem de prioridade**.
 *
 * Como o cliente público não expõe transação multi-statement, a persistência é
 * **best-effort transacional**: em falha após criar o time, removemos o
 * `user_teams` (o `ON DELETE CASCADE` limpa atletas, golpes e escalações),
 * deixando o estado anterior preservado.
 */
export async function persistDraft(
  client: SupabaseClient,
  userId: string,
  draft: TeamDraft,
): Promise<string> {
  // (1) user_teams
  const teamInsert = await client
    .from('user_teams')
    .insert({ user_id: userId, name: draft.name })
    .select('id')
    .single();

  if (teamInsert.error !== null || teamInsert.data === null) {
    throw new PersistenceError(
      `falha ao criar user_teams: ${teamInsert.error?.message ?? 'sem id retornado'}`,
    );
  }
  const teamId = (teamInsert.data as { id: string }).id;

  try {
    // (2) athletes — insere em lote e recupera os ids por instance_id.
    const athleteRows = draft.roster.map((athlete) => ({
      team_id: teamId,
      instance_id: athlete.instanceId,
      pokemon_id: athlete.pokemonId,
      ability_id: athlete.abilityId,
      position_designation: athlete.positionDesignation,
    }));

    const athleteIdByInstance = new Map<number, string>();
    if (athleteRows.length > 0) {
      const athleteInsert = await client
        .from('athletes')
        .insert(athleteRows)
        .select('id, instance_id');
      if (athleteInsert.error !== null || athleteInsert.data === null) {
        throw new PersistenceError(
          `falha ao inserir athletes: ${athleteInsert.error?.message ?? 'sem dados'}`,
          teamId,
        );
      }
      for (const row of athleteInsert.data as { id: string; instance_id: number }[]) {
        athleteIdByInstance.set(row.instance_id, row.id);
      }
    }

    // (3) athlete_moves — slot 1-based preservando a ordem dos golpes.
    const moveRows: { athlete_id: string; move_id: number; slot: number }[] = [];
    for (const athlete of draft.roster) {
      const athleteId = athleteIdByInstance.get(athlete.instanceId);
      if (athleteId === undefined) {
        continue;
      }
      athlete.moveIds.forEach((moveId, index) => {
        moveRows.push({ athlete_id: athleteId, move_id: moveId, slot: index + 1 });
      });
    }
    if (moveRows.length > 0) {
      const moveInsert = await client.from('athlete_moves').insert(moveRows);
      if (moveInsert.error !== null) {
        throw new PersistenceError(
          `falha ao inserir athlete_moves: ${moveInsert.error.message}`,
          teamId,
        );
      }
    }

    // (4) lineups — uma linha por atribuição de papel.
    const lineupRows: { team_id: string; unit: LineupUnit; role: string; athlete_id: string }[] = [];
    for (const assignment of draft.lineups) {
      const athleteId = athleteIdByInstance.get(assignment.instanceId);
      if (athleteId === undefined) {
        throw new PersistenceError(
          `escalação referencia instance_id inexistente no roster: ${assignment.instanceId}`,
          teamId,
        );
      }
      lineupRows.push({
        team_id: teamId,
        unit: assignment.unit,
        role: assignment.role,
        athlete_id: athleteId,
      });
    }
    if (lineupRows.length > 0) {
      const lineupInsert = await client.from('lineups').insert(lineupRows);
      if (lineupInsert.error !== null) {
        throw new PersistenceError(
          `falha ao inserir lineups: ${lineupInsert.error.message}`,
          teamId,
        );
      }
    }

    // (5) strategy — ids autoritativos na ordem de prioridade (insert 1:1).
    const strategyInsert = await client.from('strategy').insert({
      team_id: teamId,
      offense_play_ids: mapPlayPriority(draft.strategy.offensePlayPriority, OFFENSE_PLAY_ID),
      defense_play_ids: mapPlayPriority(draft.strategy.defensePlayPriority, DEFENSE_PLAY_ID),
    });
    if (strategyInsert.error !== null) {
      throw new PersistenceError(
        `falha ao inserir strategy: ${strategyInsert.error.message}`,
        teamId,
      );
    }

    return teamId;
  } catch (err) {
    // Rollback best-effort: remover o time cascateia atletas/golpes/escalações.
    await client.from('user_teams').delete().eq('id', teamId);
    if (err instanceof PersistenceError) {
      throw err;
    }
    throw new PersistenceError(
      err instanceof Error ? err.message : 'erro inesperado na persistência',
      teamId,
    );
  }
}

// ---------------------------------------------------------------------------
// Orquestração injetável: resolver elegibilidade + revalidar + persistir
// ---------------------------------------------------------------------------

/**
 * Dependências injetáveis do salvamento de time. Em produção o Route Handler
 * injeta o cliente público do Supabase e a fonte de elegibilidade de produção;
 * nos testes de integração, dublês in-memory substituem ambos sem rede nem DB.
 *
 * A elegibilidade pode ser fornecida de duas formas (mutuamente exclusivas):
 * - `snapshot`: um {@link EligibilitySnapshot} já resolvido (caminho mais direto
 *   para testes que controlam exatamente o que é elegível); ou
 * - `eligibilitySource`: uma {@link EligibilitySource} assíncrona, da qual o
 *   snapshot é resolvido para as espécies/golpes/habilidades do draft (caminho
 *   de produção).
 */
export interface SaveTeamDeps {
  /** Cliente Supabase (ou dublê in-memory) para a persistência. */
  readonly client: SupabaseClient;
  /** Snapshot de elegibilidade já resolvido (precedência sobre a fonte). */
  readonly snapshot?: EligibilitySnapshot;
  /** Fonte assíncrona da qual resolver o snapshot (caminho de produção). */
  readonly eligibilitySource?: EligibilitySource;
  /** Convenções de anatomia; padrão: {@link DEFAULT_ANATOMY_CONVENTIONS}. */
  readonly anatomy?: AnatomyConventions;
}

/**
 * Resultado de um salvamento bem-sucedido.
 */
export interface SaveTeamResult {
  /** Id do time persistido em `user_teams`. */
  readonly teamId: string;
  /** Avisos **não bloqueantes** emitidos pela revalidação (informativos). */
  readonly warnings: readonly ValidationWarning[];
}

/**
 * Resolve o {@link EligibilitySnapshot} efetivo das dependências: usa o
 * `snapshot` injetado quando presente, caso contrário o resolve da
 * `eligibilitySource` para as entidades referenciadas pelo draft.
 */
async function resolveSnapshot(
  draft: TeamDraft,
  deps: SaveTeamDeps,
): Promise<EligibilitySnapshot> {
  if (deps.snapshot !== undefined) {
    return deps.snapshot;
  }
  if (deps.eligibilitySource !== undefined) {
    return resolveEligibilitySnapshot(deps.eligibilitySource, {
      pokemonIds: draft.roster.map((a) => a.pokemonId),
      moveIds: draft.roster.flatMap((a) => a.moveIds),
      abilityIds: draft.roster.map((a) => a.abilityId),
    });
  }
  throw new Error(
    'SaveTeamDeps requer `snapshot` ou `eligibilitySource` para revalidar o time.',
  );
}

/**
 * Núcleo do salvamento: **revalida** o draft server-side e, se não houver aviso
 * bloqueante, **persiste** nas tabelas da foundation (R9.2/R9.3/R9.4).
 *
 * - Resolve o {@link EligibilitySnapshot} (injetado ou derivado da fonte).
 * - Reexecuta `validateDraft`; se `hasBlocking`, lança
 *   {@link BlockingValidationError} **sem tocar o banco** (R9.3).
 * - Caso contrário, chama {@link persistDraft} e devolve o `teamId` com os
 *   avisos não bloqueantes remanescentes (informativos, R8).
 *
 * Esta função não conhece HTTP: lança erros tipados que o Route Handler traduz
 * em respostas. Em teste, o `client` é um dublê in-memory e o `snapshot` é
 * fornecido diretamente — nenhum Supabase real é exercido.
 */
export async function saveTeam(
  userId: string,
  draft: TeamDraft,
  deps: SaveTeamDeps,
): Promise<SaveTeamResult> {
  const snapshot = await resolveSnapshot(draft, deps);
  const anatomy = deps.anatomy ?? DEFAULT_ANATOMY_CONVENTIONS;

  const warnings = validateDraft(draft, snapshot, anatomy);

  // (R9.3) Gate de persistência: avisos bloqueantes recusam o salvamento.
  if (hasBlocking(warnings)) {
    throw new BlockingValidationError(warnings);
  }

  const teamId = await persistDraft(deps.client, userId, draft);
  return { teamId, warnings };
}
