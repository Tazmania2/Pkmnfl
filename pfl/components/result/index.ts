/**
 * Barril de `components/result/` — componentes de apresentação da Tela_Resultado
 * da spec `pfl-gameday-result-ui` (Task 15.1).
 *
 * Reexporta os cinco componentes "dumb" da tela de Resultado para que a rota
 * `/resultado` (Task 17.1) os importe de um ponto único. Todos recebem dados via
 * props (`score`/`log`/`stats`) e consomem as funções puras de `@/lib/match`
 * (`determineOutcome`, `selectHighlights`), sem recalcular nem inventar valores.
 *
 * _Requirements: 13.1, 13.4, 14.1, 14.3, 15.1, 15.2, 15.3_
 */

export { PlacarFinal } from './PlacarFinal';
export type { PlacarFinalProps } from './PlacarFinal';

export { ResultadoDesfecho } from './ResultadoDesfecho';
export type { ResultadoDesfechoProps } from './ResultadoDesfecho';

export { EstatisticasPartida } from './EstatisticasPartida';
export type { EstatisticasPartidaProps } from './EstatisticasPartida';

export { Highlights } from './Highlights';
export type { HighlightsProps } from './Highlights';

export { NavegacaoResultado } from './NavegacaoResultado';
