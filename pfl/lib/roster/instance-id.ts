/**
 * Modelo in-memory do invariante de unicidade de `instance_id` por time
 * (R12.2, R12.3, Correctness Property P-7).
 *
 * No esquema PFL, a tabela de Atleta_Instancia declara
 * `UNIQUE (team_id, instance_id)` (migration
 * `20261009000003_init_teams.sql`). Isto garante que, dentro do escopo de um
 * Time_Usuario, duas atletas-instância nunca compartilham o mesmo
 * `instance_id`, enquanto times diferentes podem reutilizar o mesmo valor.
 *
 * Como a Testing Strategy admite modelar o enforcement do banco de forma
 * equivalente in-memory (não há PostgreSQL de teste garantido), este módulo
 * é um SUT puro: `insertAthlete` rejeita a inserção quando o par
 * `(teamId, instanceId)` já existe, preservando o registro existente, e
 * sinaliza o erro via `ok: false`.
 */

/** Uma atleta-instância, reduzida ao que importa para o invariante P-7. */
export interface AthleteRecord {
  readonly teamId: string;
  readonly instanceId: number;
  /**
   * Payload opaco que acompanha a atleta. Serve para demonstrar que, numa
   * rejeição por duplicidade, o registro originalmente inserido é preservado
   * sem ser sobrescrito pela tentativa posterior.
   */
  readonly payload?: unknown;
}

/**
 * Estado do roster modelado como a sequência de registros aceitos. É tratado
 * de forma imutável: cada inserção aceita produz um novo estado.
 */
export interface RosterState {
  readonly athletes: readonly AthleteRecord[];
}

/** Estado inicial vazio. */
export function emptyRoster(): RosterState {
  return { athletes: [] };
}

/** Resultado de uma tentativa de inserção. */
export type InsertResult =
  | { readonly ok: true; readonly state: RosterState }
  | { readonly ok: false; readonly state: RosterState; readonly reason: 'duplicate_instance_id' };

/**
 * Verifica se já existe uma atleta com o par `(teamId, instanceId)` no estado.
 */
export function hasInstance(
  state: RosterState,
  teamId: string,
  instanceId: number,
): boolean {
  return state.athletes.some(
    (a) => a.teamId === teamId && a.instanceId === instanceId,
  );
}

/**
 * Tenta inserir uma atleta-instância, modelando a restrição
 * `UNIQUE (team_id, instance_id)` do banco.
 *
 * - Se o par `(teamId, instanceId)` ainda não existe, a inserção é aceita e
 *   um novo estado contendo o registro é retornado (`ok: true`).
 * - Se o par já existe no mesmo time, a operação é rejeitada
 *   (`ok: false`, `reason: 'duplicate_instance_id'`), e o estado é devolvido
 *   inalterado, preservando o registro existente.
 *
 * Times diferentes podem reutilizar o mesmo `instanceId` livremente, pois o
 * escopo da unicidade é o par completo `(teamId, instanceId)`.
 */
export function insertAthlete(
  state: RosterState,
  teamId: string,
  instanceId: number,
  payload?: unknown,
): InsertResult {
  if (hasInstance(state, teamId, instanceId)) {
    return { ok: false, state, reason: 'duplicate_instance_id' };
  }

  const record: AthleteRecord = { teamId, instanceId, payload };
  return { ok: true, state: { athletes: [...state.athletes, record] } };
}
