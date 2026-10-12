/**
 * Modelo in-memory da regra "exatamente 4 golpes distintos por atleta" (D-2).
 *
 * A imposição real vive no banco, na migration
 * `20261009000004_init_athlete_moves.sql`:
 *   - `UNIQUE(athlete_id, move_id)` garante que os golpes de um atleta são
 *     distintos entre si (R12.8);
 *   - um `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED`
 *     (`enforce_exactly_4_moves`) conta as linhas por atleta no commit e
 *     rejeita a transação se o total for diferente de 4 (R12.7);
 *   - a FK `move_id -> moves(move_id)` cobre a existência do golpe (R12.6),
 *     tratada separadamente pela integridade referencial (Property 2).
 *
 * Como a estratégia de testes permite modelar o enforcement do banco por um
 * SUT equivalente in-memory para as iterações de propriedade (sem Postgres
 * garantido), este módulo é a formalização pura dessa lógica: um conjunto de
 * `move_id` atribuído a um atleta é aceito se e somente se contém exatamente
 * quatro identificadores e todos são distintos entre si.
 */

/** Cardinalidade exigida de golpes por atleta (R12.7). */
export const REQUIRED_MOVE_COUNT = 4;

/** Resultado detalhado da validação de uma atribuição de golpes. */
export interface AssignMovesResult {
  /** `true` se e somente se a atribuição é aceita pelo schema. */
  readonly valid: boolean;
  /** Quantidade de `move_id` fornecidos. */
  readonly count: number;
  /** `true` quando todos os `move_id` são distintos entre si. */
  readonly allDistinct: boolean;
}

/**
 * Avalia uma atribuição de golpes e devolve o diagnóstico completo.
 *
 * Modela o par (UNIQUE(athlete_id, move_id), trigger de cardinalidade = 4):
 *   - `count` reproduz a contagem de linhas que o trigger faria no commit;
 *   - `allDistinct` reproduz o efeito da restrição UNIQUE.
 *
 * A atribuição é aceita (`valid`) apenas quando `count === 4` e todos os
 * `move_id` são distintos.
 */
export function evaluateAssignMoves(moveIds: readonly number[]): AssignMovesResult {
  const count = moveIds.length;
  const allDistinct = new Set(moveIds).size === count;
  const valid = count === REQUIRED_MOVE_COUNT && allDistinct;

  return { valid, count, allDistinct };
}

/**
 * Predicado de permissão da atribuição de golpes de um atleta.
 *
 * Retorna `true` se e somente se `moveIds` contém exatamente quatro `move_id`
 * e todos são distintos entre si; caso contrário retorna `false` (número de
 * golpes diferente de quatro — R12.7 — ou golpes repetidos — R12.8).
 */
export function assignMovesIsValid(moveIds: readonly number[]): boolean {
  return evaluateAssignMoves(moveIds).valid;
}
