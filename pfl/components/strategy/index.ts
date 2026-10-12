/**
 * Barril de `components/strategy/` — componentes de apresentação da
 * Tela_Estrategia da spec `pfl-team-strategy-ui` (Task 10.1).
 *
 * Reexporta os componentes "dumb" da tela de Estratégia para que a rota
 * `/estrategia` (Task 8.4) os importe de um ponto único. Todos recebem estado
 * via props e emitem callbacks (sem acessar store nem rede): os seletores de
 * estilo registram `offenseStyle`/`defenseStyle` e as listas de prioridade
 * emitem permutações dos conjuntos fixos de 6 jogadas por lado. Sem desenhador
 * de jogadas e sem UI de special teams (R12.5/R12.6).
 *
 * _Requirements: 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
 */

export { SeletorEstiloAtaque, ESTILOS_ATAQUE_PADRAO } from './SeletorEstiloAtaque';
export type { SeletorEstiloAtaqueProps, EstiloOption } from './SeletorEstiloAtaque';

export { SeletorEstiloDefesa, ESTILOS_DEFESA_PADRAO } from './SeletorEstiloDefesa';
export type { SeletorEstiloDefesaProps } from './SeletorEstiloDefesa';

export { PrioridadeJogadasAtaque, LABELS_ATAQUE } from './PrioridadeJogadasAtaque';
export type { PrioridadeJogadasAtaqueProps } from './PrioridadeJogadasAtaque';

export { PrioridadeJogadasDefesa, LABELS_DEFESA } from './PrioridadeJogadasDefesa';
export type { PrioridadeJogadasDefesaProps } from './PrioridadeJogadasDefesa';

export { ListaPrioridade } from './ListaPrioridade';
export type { ListaPrioridadeProps } from './ListaPrioridade';
