/**
 * Modelo in-memory da lógica de enforcement do Roster_Cap = 53 (decisão D-3,
 * R13).
 *
 * No banco, o invariante é imposto por um trigger `BEFORE INSERT` em `athletes`
 * (migration `20261009000005_init_roster_cap.sql`) que conta os atletas do
 * mesmo `team_id` e aborta a inserção quando já existem 53. Como o aborto
 * ocorre antes do INSERT, o estado anterior do Roster é preservado.
 *
 * Este módulo reproduz essa lógica de enforcement como um SUT equivalente,
 * puro e in-memory, permitindo validar a Correctness Property P-3 com testes
 * de propriedade sem depender de um PostgreSQL ativo. O estado é modelado como
 * a contagem de atletas por `team_id`; `insertAthlete` rejeita (sem alterar o
 * estado) quando o time referenciado já atingiu o teto.
 */

/** Teto máximo inclusivo de atletas por Time_Usuario (R13.1). */
export const ROSTER_CAP = 53;

/**
 * Estado do roster: contagem de atletas por `team_id`. Imutável do ponto de
 * vista das operações — cada inserção aceita produz um novo estado, deixando o
 * anterior intacto.
 */
export type RosterState = ReadonlyMap<string, number>;

/** Resultado de uma tentativa de inserção. */
export type InsertResult =
  | { readonly accepted: true; readonly state: RosterState }
  | { readonly accepted: false; readonly state: RosterState; readonly reason: string };

/** Estado inicial vazio do roster. */
export function emptyRoster(): RosterState {
  return new Map<string, number>();
}

/** Contagem atual de atletas de um time. */
export function rosterCount(state: RosterState, teamId: string): number {
  return state.get(teamId) ?? 0;
}

/**
 * Tenta inserir um atleta no time `teamId`.
 *
 * Reproduz o trigger `enforce_roster_cap`: se o time já possui
 * `ROSTER_CAP` (53) atletas, a inserção é rejeitada e o estado anterior é
 * preservado (R13.2/R13.3). Caso contrário, retorna um novo estado com a
 * contagem incrementada, deixando o estado de entrada inalterado.
 */
export function insertAthlete(state: RosterState, teamId: string): InsertResult {
  const current = rosterCount(state, teamId);

  if (current >= ROSTER_CAP) {
    // Rejeita a inserção e preserva o estado anterior (nenhuma cópia nova).
    return {
      accepted: false,
      state,
      reason: `Roster_Cap excedido: o time ${teamId} já possui ${current} atletas (máximo ${ROSTER_CAP}).`,
    };
  }

  // Inserção aceita: novo estado com a contagem incrementada; o estado de
  // entrada permanece inalterado.
  const next = new Map(state);
  next.set(teamId, current + 1);
  return { accepted: true, state: next };
}
