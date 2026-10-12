'use client';

/**
 * `ResultadoDesfecho` (`components/result/ResultadoDesfecho.tsx`) —
 * Tela_Resultado, Task 15.1.
 *
 * Componente de apresentação que exibe o **desfecho** da Partida — qual time
 * venceu ou se houve empate — derivando-o **exclusivamente** do `Placar` via a
 * função pura `determineOutcome(score)` (R13.2, R13.3, R13.4). Não recalcula o
 * placar nem inventa resultado; apenas apresenta o `Outcome` já determinado.
 *
 * Anti-slop (R17.6): os estados "vitória" e "empate" são distinguidos por **mais
 * de um recurso visual** — texto explícito ("Vitória da casa", "Empate", ...) e
 * um atributo `data-outcome`/`data-team` para estilo — nunca apenas por cor. A
 * região usa marcação semântica e rótulo acessível.
 *
 * _Requirements: 13.4_ (consome `determineOutcome` que atende 13.2/13.3)
 */

import type { ReactNode } from 'react';
import { determineOutcome, type Score, type Team } from '@/lib/match';

export interface ResultadoDesfechoProps {
  /** `Placar` da Partida; único insumo do desfecho (R13.4). */
  readonly score: Score;
}

/** Rótulo textual explícito do time vencedor (R17.6: não depender de cor). */
function rotuloTime(team: Team): string {
  return team === 'home' ? 'casa' : 'visitante';
}

/**
 * Renderiza o desfecho a partir de `determineOutcome(score)`. Distingue
 * vencedor de empate por texto e por `data-outcome`, mantendo a origem do
 * resultado rastreável ao `Placar` (R13.4).
 */
export function ResultadoDesfecho({ score }: ResultadoDesfechoProps): ReactNode {
  const outcome = determineOutcome(score);

  if (outcome.kind === 'tie') {
    return (
      <section aria-labelledby="desfecho-titulo" data-outcome="tie">
        <h2 id="desfecho-titulo">Desfecho</h2>
        <p className="desfecho desfecho--empate" role="status">
          Empate
        </p>
      </section>
    );
  }

  const time = rotuloTime(outcome.team);
  return (
    <section aria-labelledby="desfecho-titulo" data-outcome="winner" data-team={outcome.team}>
      <h2 id="desfecho-titulo">Desfecho</h2>
      <p className="desfecho desfecho--vitoria" role="status">
        {`Vitória da ${time}`}
      </p>
    </section>
  );
}
