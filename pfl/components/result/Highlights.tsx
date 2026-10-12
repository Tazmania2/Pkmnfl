'use client';

/**
 * `Highlights` (`components/result/Highlights.tsx`) — Tela_Resultado, Task 15.1.
 *
 * Componente de apresentação que exibe o resumo de eventos relevantes
 * (`Highlights`) da Partida, derivado **exclusivamente** do `Log_Partida` pela
 * função pura `selectHighlights(log)` (R14.2, R14.3). Não inventa eventos: cada
 * item vem de um `Highlight` que referencia um `eventIndex` existente do log.
 * Cada entrada mostra o período (quarto), o relógio, o tipo (`kind`) e o texto,
 * todos rastreáveis ao log (R14.3, R17.5).
 *
 * Quando `selectHighlights` retorna uma lista vazia (nenhum evento relevante no
 * log), renderiza um **estado vazio honesto** — não fabrica entradas.
 *
 * Anti-slop (R17.5): lista semântica (`<ol>`), rótulos textuais, nenhum conteúdo
 * sem origem no log.
 *
 * _Requirements: 14.2, 14.3_
 */

import type { ReactNode } from 'react';
import { selectHighlights, type GameLog } from '@/lib/match';

export interface HighlightsProps {
  /** `Log_Partida` do qual os highlights são derivados (R14.2). */
  readonly log: GameLog;
}

/**
 * Renderiza `selectHighlights(log)` como lista ordenada (R14.2). Lista vazia →
 * estado vazio honesto, sem fabricar eventos (R14.3). A `key` usa `eventIndex`,
 * que é único e rastreável ao `LogEvent` de origem.
 */
export function Highlights({ log }: HighlightsProps): ReactNode {
  const highlights = selectHighlights(log);

  if (highlights.length === 0) {
    return (
      <section aria-labelledby="highlights-titulo">
        <h2 id="highlights-titulo">Highlights</h2>
        <p className="highlights__vazio">Nenhum evento relevante registrado nesta partida.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="highlights-titulo">
      <h2 id="highlights-titulo">Highlights</h2>
      <ol className="highlights">
        {highlights.map((highlight) => (
          <li key={highlight.eventIndex} className="highlights__item">
            <span className="highlights__tempo">{`Q${highlight.quarter} ${highlight.clock}`}</span>
            <span className="highlights__kind">{highlight.kind}</span>
            <span className="highlights__texto">{highlight.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
