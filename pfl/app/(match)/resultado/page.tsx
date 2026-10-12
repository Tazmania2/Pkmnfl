'use client';

/**
 * Rota `/resultado` (`app/(match)/resultado/page.tsx`) — Tela_Resultado da spec
 * `pfl-gameday-result-ui`, Task 17.1.
 *
 * Esta página é **pura apresentação da store**: lê o `Log_Partida` (`log`) e o
 * `Placar` (`score`) **já retidos** pela `MatchStore` e os distribui aos cinco
 * componentes "dumb" de `@/components/result`. Ela **não** reenvia a simulação,
 * **não** recalcula placar/estatística e **não** fabrica resultado (R13.1, R14.1,
 * R16.2) — a origem de todo valor exibido é rastreável ao log/placar.
 *
 * Retenção através de refresh/deep-link (R16.2): o `MatchStoreProvider` montado no
 * layout do grupo `(match)` restaura o snapshot de `sessionStorage` de forma
 * síncrona na primeira inicialização, antes do primeiro render. Logo, ao entrar
 * em `/resultado` por refresh ou link direto, `state.log`/`state.score` já chegam
 * preenchidos verbatim — esta página apenas os lê, nunca os reproduz.
 *
 * Estado vazio honesto: quando não há partida retida (deep-link sem partida
 * prévia ou sessão vazia), `log`/`score` são `null`. Nesse caso a página mostra
 * uma mensagem honesta e um caminho para `/game-day`, sem inventar números nem
 * disparar simulação.
 *
 * Composição (todos recebem dados via props, sem recálculo):
 * - `PlacarFinal({ score })` — placar final verbatim (R13.1).
 * - `ResultadoDesfecho({ score })` — desfecho via `determineOutcome` (R13.2, R13.3).
 * - `EstatisticasPartida({ stats: log.stats })` — estatísticas verbatim (R14.1).
 * - `Highlights({ log })` — highlights via `selectHighlights` (R14.2).
 * - `NavegacaoResultado()` — navegação de volta ao Game Day / editar time (R15.1).
 *
 * Anti-slop/acessibilidade: conteúdo dentro de um landmark `<main>` com um
 * cabeçalho de nível 1; o estado vazio oferece um link real para `/game-day`.
 *
 * _Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 15.1, 16.2_
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useMatchStore } from '@/components/match';
import {
  PlacarFinal,
  ResultadoDesfecho,
  EstatisticasPartida,
  Highlights,
  NavegacaoResultado,
} from '@/components/result';

/**
 * Página da Tela_Resultado. Lê `log`+`score` da store (retidos pelo provider,
 * inclusive após restaurar o snapshot em refresh/deep-link) e compõe a tela sem
 * reenviar a simulação (R16.2).
 */
export default function ResultadoPage(): ReactNode {
  const { state } = useMatchStore();
  const { log, score } = state;

  // Estado vazio honesto: sem partida retida não há o que apresentar. Não
  // fabricamos resultado nem disparamos simulação — apenas oferecemos o caminho
  // para iniciar uma no Game Day.
  if (log === null || score === null) {
    return (
      <main>
        <h1>Resultado da partida</h1>
        <p>Nenhuma partida para exibir. Inicie uma simulação no Game Day.</p>
        <Link href="/game-day">Ir para o Game Day</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>Resultado da partida</h1>
      <PlacarFinal score={score} />
      <ResultadoDesfecho score={score} />
      <EstatisticasPartida stats={log.stats} />
      <Highlights log={log} />
      <NavegacaoResultado />
    </main>
  );
}
