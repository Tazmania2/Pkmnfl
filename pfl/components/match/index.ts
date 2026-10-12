/**
 * Barril de `components/match/` — camada React da store de partida da spec
 * `pfl-gameday-result-ui`. Reexporta o provider, o hook de acesso e a chave do
 * snapshot em `sessionStorage`, para que as telas importem de um ponto único.
 *
 * _Requirements: 16.2, 16.3_
 */

export {
  MatchStoreProvider,
  useMatchStore,
  MATCH_SNAPSHOT_KEY,
} from './MatchStoreProvider';
export type { MatchStoreContextValue } from './MatchStoreProvider';
