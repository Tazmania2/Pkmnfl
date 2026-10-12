'use client';

/**
 * `PlacarFinal` (`components/result/PlacarFinal.tsx`) — Tela_Resultado, Task 15.1.
 *
 * Componente de apresentação ("dumb") que exibe o **Placar final** de cada time
 * **diretamente** do `Score` retornado pela `Funcao_Simulacao` (R13.1, R13.4).
 * Não recalcula, não deriva e não inventa nenhum valor: os números `home`/`away`
 * são renderizados verbatim do `score`. O desfecho (vencedor/empate) é
 * responsabilidade de `ResultadoDesfecho`; aqui apenas o placar.
 *
 * Anti-slop (R17.5, R17.6): usa elementos semânticos reais, rótulos textuais
 * explícitos por time e apresenta apenas valores rastreáveis ao `Placar`.
 *
 * _Requirements: 13.1, 13.4_
 */

import type { ReactNode } from 'react';
import type { Score } from '@/lib/match';

export interface PlacarFinalProps {
  /** `Placar` retornado pela `Funcao_Simulacao`; renderizado sem recálculo. */
  readonly score: Score;
}

/**
 * Renderiza o placar final de cada time direto do `Score` (R13.1). Cada lado tem
 * um rótulo textual explícito ("Casa"/"Visitante") além do número, de modo que a
 * leitura não dependa de posição ou cor (R17.6).
 */
export function PlacarFinal({ score }: PlacarFinalProps): ReactNode {
  return (
    <section aria-labelledby="placar-final-titulo">
      <h2 id="placar-final-titulo">Placar final</h2>
      <dl className="placar-final">
        <div className="placar-final__time">
          <dt>Casa</dt>
          <dd aria-label={`Casa: ${score.home} pontos`}>{score.home}</dd>
        </div>
        <div className="placar-final__time">
          <dt>Visitante</dt>
          <dd aria-label={`Visitante: ${score.away} pontos`}>{score.away}</dd>
        </div>
      </dl>
    </section>
  );
}
