/**
 * Tipos específicos da ingestão de dados de regras/matchups da NFL
 * (spec `pfl-data-catalog`).
 *
 * Os `Dados_Matchup_NFL` são insumo de calibração de heurísticas, não dados de
 * jogo. Nenhuma linha aqui representa atleta/roster. A idempotência vem da
 * `natural_key`; todo registro carrega `captured_at` em UTC e a `source`.
 *
 * _Requirements: 10.1, 10.2, 10.3_
 */

/**
 * Linha da tabela `nfl_matchup_data`.
 *
 * - `natural_key`: chave natural estável (ex.: `offense|defense|season`),
 *   usada como alvo de `ON CONFLICT` para o upsert idempotente.
 * - `captured_at`: carimbo ISO 8601 em UTC do momento da captura.
 * - `source`: origem dos dados (ex.: `"https://nfl.balldontlie.io"`).
 */
export interface NflMatchupRow {
  readonly natural_key: string;
  readonly offense_scheme: string;
  readonly defense_scheme: string;
  readonly payload: unknown;
  readonly captured_at: string;
  readonly source: string;
}
