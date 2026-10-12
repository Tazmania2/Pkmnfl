/**
 * Teste de integração — salvar com revalidação server-side e recarregar
 * (`lib/team/persistence.integration.test.ts`), Task 8.5 de
 * `pfl-team-strategy-ui`.
 *
 * Exercita o núcleo `saveTeam` (extraído de `app/api/team/route.ts`) de ponta a
 * ponta — **revalidação server-side (`validateDraft`) + persistência nas 5
 * tabelas da foundation** — **sem Supabase real** nem rede. A fronteira impura é
 * substituída por um **dublê in-memory** do cliente Supabase que:
 *
 * 1. registra os inserts em `user_teams`, `athletes`, `athlete_moves`,
 *    `lineups` e `strategy`;
 * 2. **reconstitui** um {@link TeamDraft} a partir do que foi gravado
 *    (reload round-trip); e
 * 3. **impõe os invariantes-chave dos triggers/constraints da foundation**
 *    — exatamente 4 golpes por atleta (via `slot`), 11 identidades distintas por
 *    unidade, teto do roster (≤53) e unicidade de `(team, unit, role)` — de modo
 *    que o teste demonstra que o servidor respeita essas regras no commit.
 *
 * Cobre:
 * - **R9.2**: salvar um draft **válido** com um snapshot que o aceita →
 *   `saveTeam` revalida (sem bloqueio) e persiste; o reload reproduz atletas
 *   (`instanceId`/`pokemonId`), a habilidade por atleta, os **4 golpes na ordem
 *   de slot**, a `positionDesignation` e as escalações (unidade/papel/instância).
 * - **R9.3**: salvar um draft com defeito **bloqueante** (golpe não aprendível
 *   dado o snapshot) → `saveTeam` recusa (`BlockingValidationError`) e **nada é
 *   persistido** (o dublê não registra nenhuma linha).
 */

import { describe, expect, it } from 'vitest';

import { clonePresetToDraft } from '../presets';
import type { EligibilitySnapshot } from './eligibility-adapter';
import {
  OFFENSE_PLAYS,
  DEFENSE_PLAYS,
  type LineupUnit,
  type TeamDraft,
} from './model';
import {
  OFFENSE_PLAY_ID,
  DEFENSE_PLAY_ID,
  mapPlayPriority,
  saveTeam,
  BlockingValidationError,
} from './persistence';

// ---------------------------------------------------------------------------
// Snapshot de elegibilidade que ACEITA um draft dado.
// ---------------------------------------------------------------------------

/**
 * Constrói um {@link EligibilitySnapshot} que aceita integralmente `draft`:
 * toda espécie usada é permitida, e para cada `pokemonId` os conjuntos de
 * golpes aprendíveis e de habilidades disponíveis são a **união** do que o
 * roster usa para aquela espécie (lidando com duplicatas de espécie que tenham
 * loadouts distintos). Nenhum efeito inerte é marcado (sem avisos informativos
 * que poluam a asserção), e nomes legíveis são sintetizados.
 */
function acceptingSnapshot(draft: TeamDraft): EligibilitySnapshot {
  const allowedSpecies = new Set<number>();
  const learnable = new Map<number, Set<number>>();
  const abilities = new Map<number, Set<number>>();
  const moveName = new Map<number, string>();
  const abilityName = new Map<number, string>();

  for (const athlete of draft.roster) {
    allowedSpecies.add(athlete.pokemonId);

    const moves = learnable.get(athlete.pokemonId) ?? new Set<number>();
    for (const moveId of athlete.moveIds) {
      moves.add(moveId);
      moveName.set(moveId, `move-${moveId}`);
    }
    learnable.set(athlete.pokemonId, moves);

    const abis = abilities.get(athlete.pokemonId) ?? new Set<number>();
    abis.add(athlete.abilityId);
    abilityName.set(athlete.abilityId, `ability-${athlete.abilityId}`);
    abilities.set(athlete.pokemonId, abis);
  }

  return {
    allowedSpecies,
    learnable,
    abilities,
    moveName,
    abilityName,
    inertEffects: new Set<string>(),
  };
}

// ---------------------------------------------------------------------------
// Dublê in-memory do cliente Supabase (fronteira impura isolada).
//
// Implementa o subconjunto da API `.from(table).insert(...).select(...).single()`
// / `.delete().eq(...)` usado por `persistDraft`, registrando as linhas e
// impondo os invariantes-chave da foundation no "commit" de cada insert.
// ---------------------------------------------------------------------------

interface TeamRow {
  id: string;
  user_id: string;
  name: string;
}
interface AthleteRow {
  id: string;
  team_id: string;
  instance_id: number;
  pokemon_id: number;
  ability_id: number;
  position_designation: string;
}
interface MoveRow {
  athlete_id: string;
  move_id: number;
  slot: number;
}
interface LineupRow {
  team_id: string;
  unit: LineupUnit;
  role: string;
  athlete_id: string;
}
interface StrategyRow {
  team_id: string;
  offense_play_ids: number[];
  defense_play_ids: number[];
}

/** Teto do roster da foundation (constraint `athletes` ≤ 53 por time). */
const ROSTER_CAP = 53;
/** Identidades distintas exigidas por unidade preenchida (trigger). */
const UNIT_IDENTITIES = 11;
/** Golpes exigidos por atleta (trigger `enforce_exactly_4_moves`). */
const EXACT_MOVES = 4;

/**
 * Erro que emula a rejeição de uma constraint/trigger da foundation no commit.
 */
class TriggerViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerViolation';
  }
}

/**
 * Store in-memory das 5 tabelas, com reconstrução do {@link TeamDraft} e
 * imposição dos invariantes da foundation. Exposto ao `saveTeam` por meio de um
 * objeto que imita a cadeia fluente do `SupabaseClient`.
 */
class FakeSupabase {
  readonly teams: TeamRow[] = [];
  readonly athletes: AthleteRow[] = [];
  readonly moves: MoveRow[] = [];
  readonly lineups: LineupRow[] = [];
  readonly strategies: StrategyRow[] = [];

  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  /** Imita `client.from(table)` devolvendo o builder apropriado. */
  from(table: string): unknown {
    switch (table) {
      case 'user_teams':
        return this.teamBuilder();
      case 'athletes':
        return this.athleteBuilder();
      case 'athlete_moves':
        return this.simpleInsertBuilder((rows) => this.commitMoves(rows as MoveRow[]));
      case 'lineups':
        return this.simpleInsertBuilder((rows) => this.commitLineups(rows as LineupRow[]));
      case 'strategy':
        return this.simpleInsertBuilder((rows) =>
          this.commitStrategy(rows as StrategyRow[]),
        );
      default:
        throw new Error(`FakeSupabase: tabela inesperada '${table}'`);
    }
  }

  // --- user_teams: insert().select('id').single()  e  delete().eq('id', …) ---
  private teamBuilder() {
    return {
      insert: (row: { user_id: string; name: string }) => ({
        select: () => ({
          single: async () => {
            // Teto do roster é verificado quando os atletas são inseridos;
            // aqui apenas criamos o time.
            const id = this.nextId('team');
            this.teams.push({ id, user_id: row.user_id, name: row.name });
            return { data: { id }, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (column: string, value: string) => {
          if (column === 'id') {
            this.cascadeDelete(value);
          }
          return { data: null, error: null };
        },
      }),
    };
  }

  // --- athletes: insert(rows).select('id, instance_id') ---
  private athleteBuilder() {
    return {
      insert: (rows: Omit<AthleteRow, 'id'>[]) => ({
        select: async () => {
          try {
            const inserted = this.commitAthletes(rows);
            return {
              data: inserted.map((a) => ({ id: a.id, instance_id: a.instance_id })),
              error: null,
            };
          } catch (err) {
            return {
              data: null,
              error: { message: err instanceof Error ? err.message : String(err) },
            };
          }
        },
      }),
    };
  }

  /**
   * Builder genérico de insert sem `.select()`: resolve direto para
   * `{ error }`, convertendo violações de invariante em `error.message`.
   */
  private simpleInsertBuilder(commit: (rows: unknown[]) => void) {
    return {
      // Supabase aceita um único objeto OU um array; normalizamos para array.
      async insert(rows: unknown) {
        try {
          commit(Array.isArray(rows) ? rows : [rows]);
          return { error: null };
        } catch (err) {
          return { error: { message: err instanceof Error ? err.message : String(err) } };
        }
      },
    };
  }

  // --- Commits com imposição de invariantes da foundation ---

  private commitAthletes(rows: Omit<AthleteRow, 'id'>[]): AthleteRow[] {
    const first = rows[0];
    if (first === undefined) {
      return [];
    }
    const teamId = first.team_id;
    const existing = this.athletes.filter((a) => a.team_id === teamId).length;
    // Constraint: teto do roster ≤ 53 por time.
    if (existing + rows.length > ROSTER_CAP) {
      throw new TriggerViolation(
        `roster cap excedido: ${existing + rows.length} > ${ROSTER_CAP}`,
      );
    }
    const inserted: AthleteRow[] = rows.map((r) => ({ id: this.nextId('athlete'), ...r }));
    this.athletes.push(...inserted);
    return inserted;
  }

  private commitMoves(rows: MoveRow[]): void {
    this.moves.push(...rows);
    // Trigger `enforce_exactly_4_moves`: cada atleta tocado deve ter exatamente
    // 4 golpes com slots distintos no commit.
    const byAthlete = new Map<string, Set<number>>();
    for (const row of rows) {
      let slots = byAthlete.get(row.athlete_id);
      if (slots === undefined) {
        slots = new Set<number>();
        byAthlete.set(row.athlete_id, slots);
      }
      if (slots.has(row.slot)) {
        throw new TriggerViolation(
          `slot duplicado ${row.slot} para o atleta ${row.athlete_id}`,
        );
      }
      slots.add(row.slot);
    }
    for (const [athleteId, slots] of byAthlete) {
      if (slots.size !== EXACT_MOVES) {
        throw new TriggerViolation(
          `atleta ${athleteId} tem ${slots.size} golpes; exigidos ${EXACT_MOVES}`,
        );
      }
    }
  }

  private commitLineups(rows: LineupRow[]): void {
    this.lineups.push(...rows);
    // Constraint de unicidade (team, unit, role) + trigger de 11 identidades
    // distintas por unidade preenchida.
    const seenRole = new Set<string>();
    const identitiesByUnit = new Map<string, Set<string>>();
    const teamUnits = new Map<string, Set<LineupUnit>>();
    for (const row of this.lineups) {
      const roleKey = `${row.team_id}|${row.unit}|${row.role}`;
      if (seenRole.has(roleKey)) {
        throw new TriggerViolation(
          `papel duplicado (unicidade team/unit/role): ${roleKey}`,
        );
      }
      seenRole.add(roleKey);

      const unitKey = `${row.team_id}|${row.unit}`;
      const ids = identitiesByUnit.get(unitKey) ?? new Set<string>();
      ids.add(row.athlete_id);
      identitiesByUnit.set(unitKey, ids);

      const units = teamUnits.get(row.team_id) ?? new Set<LineupUnit>();
      units.add(row.unit);
      teamUnits.set(row.team_id, units);
    }
    for (const [unitKey, ids] of identitiesByUnit) {
      if (ids.size !== UNIT_IDENTITIES) {
        throw new TriggerViolation(
          `unidade ${unitKey} tem ${ids.size} identidades; exigidas ${UNIT_IDENTITIES}`,
        );
      }
    }
  }

  private commitStrategy(rows: StrategyRow[]): void {
    this.strategies.push(...rows);
  }

  private cascadeDelete(teamId: string): void {
    const athleteIds = new Set(
      this.athletes.filter((a) => a.team_id === teamId).map((a) => a.id),
    );
    this.removeWhere(this.teams, (t) => t.id === teamId);
    this.removeWhere(this.athletes, (a) => a.team_id === teamId);
    this.removeWhere(this.moves, (m) => athleteIds.has(m.athlete_id));
    this.removeWhere(this.lineups, (l) => l.team_id === teamId);
    this.removeWhere(this.strategies, (s) => s.team_id === teamId);
  }

  private removeWhere<T>(arr: T[], pred: (v: T) => boolean): void {
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      const item = arr[i];
      if (item !== undefined && pred(item)) {
        arr.splice(i, 1);
      }
    }
  }

  /** `true` se nenhuma linha foi registrada em nenhuma tabela. */
  isEmpty(): boolean {
    return (
      this.teams.length === 0 &&
      this.athletes.length === 0 &&
      this.moves.length === 0 &&
      this.lineups.length === 0 &&
      this.strategies.length === 0
    );
  }

  /**
   * Reconstitui o {@link TeamDraft} persistido do time `teamId` lendo as 5
   * tabelas de volta (reload round-trip). Os golpes são ordenados por `slot`
   * (preservando a ordem salva); as escalações, pela instância referenciada.
   */
  reload(teamId: string): TeamDraft {
    const team = this.teams.find((t) => t.id === teamId);
    if (team === undefined) {
      throw new Error(`reload: time ${teamId} não encontrado`);
    }

    const athleteRows = this.athletes.filter((a) => a.team_id === teamId);
    const instanceByAthleteId = new Map<string, number>();
    for (const a of athleteRows) {
      instanceByAthleteId.set(a.id, a.instance_id);
    }

    const roster = athleteRows.map((a) => {
      const moveIds = this.moves
        .filter((m) => m.athlete_id === a.id)
        .sort((x, y) => x.slot - y.slot)
        .map((m) => m.move_id);
      return {
        instanceId: a.instance_id,
        pokemonId: a.pokemon_id,
        abilityId: a.ability_id,
        moveIds,
        positionDesignation: a.position_designation,
      };
    });

    const lineups = this.lineups
      .filter((l) => l.team_id === teamId)
      .map((l) => ({
        unit: l.unit,
        role: l.role,
        instanceId: instanceByAthleteId.get(l.athlete_id)!,
      }));

    const strategyRow = this.strategies.find((s) => s.team_id === teamId);
    const strategy = {
      offenseStyle: '',
      defenseStyle: '',
      // Reconstrói a prioridade de PlayId a partir dos ids inteiros salvos,
      // preservando a ordem persistida.
      offensePlayPriority: idsToPlays(strategyRow?.offense_play_ids ?? [], OFFENSE_PLAY_ID),
      defensePlayPriority: idsToPlays(strategyRow?.defense_play_ids ?? [], DEFENSE_PLAY_ID),
    };

    return { teamId, name: team.name, roster, lineups, strategy };
  }
}

/** Inverte um mapa PlayId→int e projeta uma lista de ids de volta em PlayIds. */
function idsToPlays(
  ids: readonly number[],
  table: ReadonlyMap<(typeof OFFENSE_PLAYS)[number] | (typeof DEFENSE_PLAYS)[number], number>,
) {
  const inverse = new Map<number, (typeof OFFENSE_PLAYS)[number] | (typeof DEFENSE_PLAYS)[number]>();
  for (const [play, id] of table) {
    inverse.set(id, play);
  }
  return ids.map((id) => inverse.get(id)!).filter((p) => p !== undefined);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = '00000000-0000-0000-0000-000000000001';

/** Draft válido base: clone do preset `balanced` (22 atletas, 8 unidades × 11). */
function validDraft(): TeamDraft {
  return clonePresetToDraft('balanced');
}

// Cast do dublê para o tipo esperado por `saveTeam` (só o subconjunto usado).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asClient(fake: FakeSupabase): any {
  return fake;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('saveTeam — revalidação server-side + persistência/reload (integração, R9.2/R9.3)', () => {
  it('R9.2: salva um draft válido (revalida sem bloqueio) e o reload reproduz atletas, habilidade, 4 golpes ordenados, posições e escalações', async () => {
    const draft = validDraft();
    const snapshot = acceptingSnapshot(draft);
    const fake = new FakeSupabase();

    const result = await saveTeam(USER_ID, draft, { client: asClient(fake), snapshot });

    // Persistiu e confirmou o teamId; nenhum aviso bloqueante remanescente.
    expect(result.teamId).toBeTruthy();
    expect(result.warnings.some((w) => w.blocking)).toBe(false);

    // O servidor respeitou os invariantes da foundation (sem violação de trigger):
    // todas as 8 unidades com 11 identidades e 22 atletas com 4 golpes cada.
    expect(fake.athletes).toHaveLength(draft.roster.length);
    expect(fake.moves).toHaveLength(draft.roster.length * 4);

    // Reload round-trip.
    const reloaded = fake.reload(result.teamId);

    // Atletas: instanceId/pokemonId, habilidade, 4 golpes na ordem de slot e posição.
    const byInstance = new Map(reloaded.roster.map((a) => [a.instanceId, a]));
    expect(reloaded.roster).toHaveLength(draft.roster.length);
    for (const original of draft.roster) {
      const got = byInstance.get(original.instanceId);
      expect(got).toBeDefined();
      expect(got!.pokemonId).toBe(original.pokemonId);
      expect(got!.abilityId).toBe(original.abilityId);
      expect(got!.moveIds).toEqual(original.moveIds); // ordem de slot preservada
      expect(got!.moveIds).toHaveLength(4);
      expect(got!.positionDesignation).toBe(original.positionDesignation);
    }

    // Escalações: mesmo conjunto de (unidade, papel, instância).
    const key = (l: { unit: string; role: string; instanceId: number }) =>
      `${l.unit}|${l.role}|${l.instanceId}`;
    expect(new Set(reloaded.lineups.map(key))).toEqual(new Set(draft.lineups.map(key)));

    // Estratégia: prioridades preservadas na ordem (round-trip dos ids inteiros).
    expect(reloaded.strategy.offensePlayPriority).toEqual(draft.strategy.offensePlayPriority);
    expect(reloaded.strategy.defensePlayPriority).toEqual(draft.strategy.defensePlayPriority);
  });

  it('R9.3: recusa salvar um draft com defeito bloqueante (golpe não aprendível) e nada é persistido', async () => {
    const draft = validDraft();
    const snapshot = acceptingSnapshot(draft);
    const fake = new FakeSupabase();

    // Introduz um defeito BLOQUEANTE: remove um golpe real do conjunto
    // aprendível da espécie do primeiro atleta, tornando-o não aprendível.
    const victim = draft.roster[0];
    if (victim === undefined || victim.moveIds[0] === undefined) {
      throw new Error('fixture inválida: roster vazio ou atleta sem golpes');
    }
    const learnableForSpecies = new Set(snapshot.learnable.get(victim.pokemonId));
    learnableForSpecies.delete(victim.moveIds[0]);
    const blockingSnapshot: EligibilitySnapshot = {
      ...snapshot,
      learnable: new Map(snapshot.learnable).set(victim.pokemonId, learnableForSpecies),
    };

    await expect(
      saveTeam(USER_ID, draft, { client: asClient(fake), snapshot: blockingSnapshot }),
    ).rejects.toBeInstanceOf(BlockingValidationError);

    // Nada foi persistido: a recusa precede qualquer escrita (R9.3).
    expect(fake.isEmpty()).toBe(true);
  });

  it('mapeia PlayId → ids inteiros autoritativos preservando a ordem de prioridade (sanidade do contrato)', () => {
    const draft = validDraft();
    const offenseIds = mapPlayPriority(draft.strategy.offensePlayPriority, OFFENSE_PLAY_ID);
    const defenseIds = mapPlayPriority(draft.strategy.defensePlayPriority, DEFENSE_PLAY_ID);
    // Ataque usa ids 1..6; defesa 7..12.
    expect(offenseIds).toHaveLength(OFFENSE_PLAYS.length);
    expect(defenseIds).toHaveLength(DEFENSE_PLAYS.length);
    expect(Math.max(...offenseIds)).toBeLessThanOrEqual(OFFENSE_PLAYS.length);
    expect(Math.min(...defenseIds)).toBeGreaterThan(OFFENSE_PLAYS.length);
  });
});
