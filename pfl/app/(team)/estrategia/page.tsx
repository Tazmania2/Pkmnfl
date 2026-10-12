/**
 * Shell da Tela_Estrategia (`app/(team)/estrategia/page.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 8.4.
 *
 * **Server Component** que monta o island cliente ({@link EstrategiaIsland}), o
 * qual consome o **mesmo** `TeamDraft` compartilhado pelo provider do layout
 * `(team)` que a Tela_Meu_Time. Como o provider vive no layout comum, navegar
 * `/time` ↔ `/estrategia` não remonta a store: estilos e prioridades em edição
 * sobrevivem à transição (R11.1, R12.1, R12.2).
 *
 * A tela de estratégia opera só sobre o sub-objeto `strategy` do draft (estilos
 * + prioridades de jogada), sem elegibilidade de catálogo — por isso o shell não
 * hidrata nada do servidor. A UI real (seletores de estilo e priorização
 * operável por teclado) chega na tarefa 10.x.
 *
 * _Requirements: 3.1, 11.1, 12.1, 12.2_
 */

import type { ReactNode } from 'react';
import { EstrategiaIsland } from '@/components/team/EstrategiaIsland';

/**
 * Página `/estrategia`. Renderiza o island cliente de Estratégia sob o provider
 * compartilhado do grupo `(team)`.
 */
export default function EstrategiaPage(): ReactNode {
  return <EstrategiaIsland />;
}
