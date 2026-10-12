'use client';

/**
 * `EstadoCarregamento` (`components/gameday/EstadoCarregamento.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 13.2.
 *
 * Componente de **apresentação** (burro): o indicador de carregamento **honesto**
 * exibido enquanto a `Funcao_Simulacao` está sendo executada e o `Log_Partida`
 * ainda não chegou (R7.1). Mostra uma mensagem clara ("Simulando a partida…") e
 * **nada mais**: nenhum placar, estatística, andamento ou barra de progresso
 * falsa (R7.2, R7.3). O componente não inventa números nem simula progresso —
 * ele apenas sinaliza que o sistema está processando.
 *
 * A região usa `role="status"` + `aria-live="polite"` para que leitores de tela
 * anunciem o início do carregamento sem roubar o foco. A animação de "pulsar" é
 * puramente decorativa (`aria-hidden`) e respeita `prefers-reduced-motion`.
 *
 * Acessibilidade / anti-slop:
 * - Texto legível, estado anunciado por `role="status"`.
 * - Nenhum valor sem origem exibido (R7.3, R17.5).
 *
 * _Requirements: 7.1, 7.2, 7.3_
 */

import type { ReactNode } from 'react';

const PULSE_STYLE_ID = 'pfl-estado-carregamento-pulse';

/**
 * Animação decorativa de "pulsar" do indicador. Respeita
 * `prefers-reduced-motion` desligando o movimento para quem o preferir.
 */
const PULSE_STYLE = `
@keyframes pfl-carregamento-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
[data-pfl-carregamento-ponto] {
  animation: pfl-carregamento-pulse 1.1s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  [data-pfl-carregamento-ponto] {
    animation: none;
    opacity: 1;
  }
}
`;

export interface EstadoCarregamentoProps {
  /**
   * Mensagem exibida. Padrão: "Simulando a partida…". Sempre uma frase honesta
   * de progresso — nunca um valor de jogo (R7.3).
   */
  readonly mensagem?: string;
}

export function EstadoCarregamento({
  mensagem = 'Simulando a partida…',
}: EstadoCarregamentoProps): ReactNode {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '1.25rem',
        fontSize: '1.0625rem',
        fontWeight: 600,
        color: '#1a1a1a',
      }}
    >
      <style id={PULSE_STYLE_ID}>{PULSE_STYLE}</style>

      {/* Indicador decorativo (não transmite informação de valor) — R7.3. */}
      <span
        aria-hidden="true"
        data-pfl-carregamento-ponto
        style={{
          display: 'inline-block',
          width: '0.875rem',
          height: '0.875rem',
          borderRadius: '50%',
          background: '#1a1a1a',
          flex: '0 0 auto',
        }}
      />
      <span>{mensagem}</span>
    </div>
  );
}
