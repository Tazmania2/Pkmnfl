'use client';

/**
 * `EstatisticasPartida` (`components/result/EstatisticasPartida.tsx`) —
 * Tela_Resultado, Task 15.1.
 *
 * Componente de apresentação que exibe as **Estatisticas_Partida** sucintas —
 * corridas, passes, turnovers e faltas — **exatamente** como registradas em
 * `GameStats` do `Log_Partida` (`log.stats`), sem recalcular nem fabricar
 * números (R14.1, R14.3). Recebe o `GameStats` já pronto via prop e o renderiza
 * verbatim; a origem de todo valor é rastreável ao log (R14.3, R17.5).
 *
 * Anti-slop (R17.5, R17.6): tabela/`<dl>` semântica com rótulos textuais
 * explícitos para cada métrica; nenhum número sem origem no `GameStats`.
 *
 * _Requirements: 14.1, 14.3_
 */

import type { ReactNode } from 'react';
import type { GameStats } from '@/lib/match';

export interface EstatisticasPartidaProps {
  /** `GameStats` do `Log_Partida` (`log.stats`); exibido sem recálculo. */
  readonly stats: GameStats;
}

/**
 * Renderiza as estatísticas sucintas direto de `stats` (R14.1). Cada linha
 * mostra o rótulo e o valor lido verbatim do `GameStats`:
 * - **Corridas**: tentativas e jardas (`stats.rushes`);
 * - **Passes**: completos/tentativas, jardas e interceptações (`stats.passes`);
 * - **Turnovers**: total (`stats.turnovers`);
 * - **Faltas**: total (`stats.fouls`).
 */
export function EstatisticasPartida({ stats }: EstatisticasPartidaProps): ReactNode {
  return (
    <section aria-labelledby="estatisticas-titulo">
      <h2 id="estatisticas-titulo">Estatísticas da partida</h2>
      <dl className="estatisticas">
        <div className="estatisticas__item">
          <dt>Corridas (tentativas)</dt>
          <dd>{stats.rushes.attempts}</dd>
        </div>
        <div className="estatisticas__item">
          <dt>Corridas (jardas)</dt>
          <dd>{stats.rushes.yards}</dd>
        </div>
        <div className="estatisticas__item">
          <dt>Passes (completos / tentativas)</dt>
          <dd>{`${stats.passes.completions} / ${stats.passes.attempts}`}</dd>
        </div>
        <div className="estatisticas__item">
          <dt>Passes (jardas)</dt>
          <dd>{stats.passes.yards}</dd>
        </div>
        <div className="estatisticas__item">
          <dt>Interceptações</dt>
          <dd>{stats.passes.interceptions}</dd>
        </div>
        <div className="estatisticas__item">
          <dt>Turnovers</dt>
          <dd>{stats.turnovers}</dd>
        </div>
        <div className="estatisticas__item">
          <dt>Faltas</dt>
          <dd>{stats.fouls}</dd>
        </div>
      </dl>
    </section>
  );
}
