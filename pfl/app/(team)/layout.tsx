/**
 * Layout comum ao grupo de rotas `(team)` — Tela_Meu_Time (`/time`) e
 * Tela_Estrategia (`/estrategia`) da spec `pfl-team-strategy-ui`.
 *
 * O grupo de rotas `(team)` **não** acrescenta segmento à URL: `/time` e
 * `/estrategia` continuam no topo do caminho. Seu papel é montar, acima das duas
 * telas, o provider do `TeamDraft` em edição ({@link TeamDraftProvider}, um
 * Client Component), de modo que a navegação `/time` ↔ `/estrategia` **não
 * descarte o rascunho do time** (design: "Store do time em edição compartilhada
 * entre telas"). Como o App Router preserva a instância de um layout entre
 * navegações para páginas irmãs do mesmo subárvore, o roster e a estratégia em
 * edição sobrevivem à transição sem recomeçar do zero (R3.1, R11.1, R12.1,
 * R12.2 — roster e estratégia são o mesmo documento, editado em telas
 * distintas).
 *
 * Este layout permanece um Server Component: apenas monta o provider cliente
 * acima dos filhos, preservando a separação apresentação × orquestração do
 * design.
 *
 * _Requirements: 3.1, 11.1, 12.1, 12.2_
 */

import type { ReactNode } from 'react';
import { TeamDraftProvider } from '@/components/team/TeamDraftProvider';

/**
 * Invólucro das rotas de montagem do time: monta o `TeamDraftProvider` acima das
 * páginas `/time` e `/estrategia`, dando a elas uma store de time compartilhada
 * por sessão de navegação.
 *
 * @param children As páginas `/time` e `/estrategia` renderizadas sob o grupo.
 */
export default function TeamLayout({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <TeamDraftProvider>{children}</TeamDraftProvider>;
}
