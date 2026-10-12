/**
 * Layout comum ao grupo de rotas `(match)` — Tela_Game_Day (`/game-day`) e
 * Tela_Resultado (`/resultado`) da spec `pfl-gameday-result-ui`.
 *
 * O grupo de rotas `(match)` **não** acrescenta segmento à URL: `/game-day` e
 * `/resultado` continuam no topo do caminho. Seu papel é montar, acima das duas
 * telas, o provider da `MatchStore` (React Context), de modo que a navegação Game
 * Day → Resultado **não reenvie a simulação** e o `log`+`score` retidos sobrevivam
 * à transição (design: "Estado da partida compartilhado entre telas"). O provider
 * é um Client Component (`MatchStoreProvider`) que também espelha o estado em
 * `sessionStorage`, sobrevivendo a refresh/deep-link em `/resultado` (R16.2) e
 * mantendo o `Seed_RNG` exibido rastreável (R16.3).
 *
 * Este layout permanece um Server Component: ele apenas monta o provider cliente
 * acima dos filhos, preservando a separação apresentação × orquestração do design.
 *
 * _Requirements: 16.2, 16.3_
 */

import type { ReactNode } from 'react';
import { MatchStoreProvider } from '@/components/match/MatchStoreProvider';

/**
 * Invólucro das rotas de partida: monta o `MatchStoreProvider` acima das páginas
 * `/game-day` e `/resultado`, dando a elas uma store de partida compartilhada por
 * sessão.
 *
 * @param children As páginas `/game-day` e `/resultado` renderizadas sob o grupo.
 */
export default function MatchLayout({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <MatchStoreProvider>{children}</MatchStoreProvider>;
}
