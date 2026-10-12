'use client';

/**
 * `PainelAndamento` (HUD de andamento) — `components/gameday/PainelAndamento.tsx`,
 * spec `pfl-gameday-result-ui`, Task 13.3.
 *
 * Componente de **apresentação** (burro) que exibe o andamento da Partida para o
 * Snap corrente. Recebe o `Log_Partida` e o `eventIndex` por props e projeta o
 * estado via `progressAt(log, eventIndex)` — **nunca** calcula placar, estatística
 * ou qualquer valor próprio: tudo é lido/derivado do log (R6.4, R8.5, R17.5).
 *
 * O que exibe, para o Snap corrente (todos vindos do `ProgressFrame`):
 * - **placar** de cada time (R8.1);
 * - **quarto**, **relógio** (via `formatClock`, décimos → mm:ss), **down**,
 *   **distância** e **posse** (R8.2);
 * - **clima** da Partida — apenas exibido, nunca sorteado (R8.4);
 * - **narrativa** do Snap (R8.3);
 * - **avisos** de Efeito_Inerte/supressão do Snap, exibidos **junto** à narrativa
 *   conforme o log, sem introduzir bônus silencioso (R12.1).
 *
 * Anti-slop/acessibilidade: estrutura semântica com rótulos textuais explícitos
 * para cada valor (`<dl>`/`<dt>`/`<dd>` e `aria-label`), de modo que a origem de
 * cada número seja identificável; nenhum valor é fabricado (R8.5, R17.5).
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 12.1_
 */

import { progressAt, formatClock } from '@/lib/match';
import type { GameLog, ProgressFrame, Team, Weather } from '@/lib/match';

/**
 * Rótulos legíveis em pt-BR para cada `Weather` registrado no log. A tela apenas
 * **exibe** o clima do log (R8.4): o mapa traduz o enum para texto, sem sortear
 * nem alterar. Clima desconhecido cai no próprio código (nunca inventa um valor).
 */
const WEATHER_LABELS: Readonly<Record<Weather, string>> = {
  CLEAR: 'Tempo limpo',
  RAIN: 'Chuva',
  WIND: 'Vento',
  HEAT: 'Calor',
  COLD: 'Frio',
};

/** Rótulos legíveis em pt-BR para o lado com a posse (R8.2). */
const POSSESSION_LABELS: Readonly<Record<Team, string>> = {
  home: 'Mandante',
  away: 'Visitante',
};

/**
 * Props do `PainelAndamento`. Recebe os dados por props (NÃO acessa a store
 * diretamente), preservando a separação apresentação × orquestração do design.
 */
export interface PainelAndamentoProps {
  /** `Log_Partida` retido pela store — única fonte de verdade do andamento. */
  readonly log: GameLog;
  /** Índice do `LogEvent` do Snap corrente a ser projetado no HUD. */
  readonly eventIndex: number;
}

/**
 * HUD de andamento da Tela_Game_Day. Projeta o Snap de índice `eventIndex` num
 * `ProgressFrame` e o renderiza com marcação semântica. Fora de faixa (`eventIndex`
 * inválido), `progressAt` lança `RangeError`; o orquestrador só monta o HUD com um
 * índice válido do log, então não há estado "vazio" a inventar aqui.
 */
export function PainelAndamento({ log, eventIndex }: PainelAndamentoProps): React.ReactElement {
  const frame: ProgressFrame = progressAt(log, eventIndex);

  const relogio = formatClock(frame.gameClockDeci);
  const climaLabel = WEATHER_LABELS[frame.weather] ?? frame.weather;
  const posseLabel = POSSESSION_LABELS[frame.possession] ?? frame.possession;

  return (
    <section className="pfl-hud" aria-label="Andamento da partida">
      {/* Placar corrente de cada time (R8.1). */}
      <div className="pfl-hud__placar" role="group" aria-label="Placar">
        <p className="pfl-hud__time">
          <span className="pfl-hud__time-rotulo">Mandante</span>
          <span className="pfl-hud__time-pontos" aria-label="Pontos do mandante">
            {frame.score.home}
          </span>
        </p>
        <span className="pfl-hud__placar-sep" aria-hidden="true">
          ×
        </span>
        <p className="pfl-hud__time">
          <span className="pfl-hud__time-rotulo">Visitante</span>
          <span className="pfl-hud__time-pontos" aria-label="Pontos do visitante">
            {frame.score.away}
          </span>
        </p>
      </div>

      {/* Período, relógio, down/distância, posse e clima (R8.2, R8.4). Cada par
          rótulo→valor é um <dt>/<dd> para que a origem de cada número seja
          programaticamente identificável (R8.5, R17.5). */}
      <dl className="pfl-hud__estado">
        <div className="pfl-hud__item">
          <dt>Quarto</dt>
          <dd>{frame.quarter}</dd>
        </div>
        <div className="pfl-hud__item">
          <dt>Relógio</dt>
          {/* mm:ss para humanos; o valor cru (décimos) fica no title para auditoria. */}
          <dd>
            <time title={`${frame.gameClockDeci} décimos de segundo`}>{relogio}</time>
          </dd>
        </div>
        <div className="pfl-hud__item">
          <dt>Down</dt>
          <dd>{frame.down}</dd>
        </div>
        <div className="pfl-hud__item">
          <dt>Distância</dt>
          <dd>{frame.distance}</dd>
        </div>
        <div className="pfl-hud__item">
          <dt>Posse</dt>
          <dd>{posseLabel}</dd>
        </div>
        <div className="pfl-hud__item">
          <dt>Clima</dt>
          <dd>{climaLabel}</dd>
        </div>
      </dl>

      {/* Narrativa do Snap corrente (R8.3), com os avisos de efeito inerte/supressão
          exibidos JUNTO à narrativa conforme o log (R12.1). Nenhum bônus é
          representado além do que o log registra (R12.2, R12.3). */}
      <div className="pfl-hud__narrativa">
        <p className="pfl-hud__narrativa-texto">{frame.narrative}</p>
        {frame.warnings.length > 0 ? (
          <ul className="pfl-hud__avisos" aria-label="Avisos do lance">
            {frame.warnings.map((aviso, i) => (
              <li key={`${eventIndex}-aviso-${i}`} className="pfl-hud__aviso">
                {aviso}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export default PainelAndamento;
