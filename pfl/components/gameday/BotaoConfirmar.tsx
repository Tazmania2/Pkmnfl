'use client';

/**
 * `BotaoConfirmar` (`components/gameday/BotaoConfirmar.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 13.2.
 *
 * Componente de **apresentação** (burro): renderiza o **único** controle de
 * confirmação de simulação da Tela_Game_Day (R5.1). É um `<button>` real,
 * grande e rotulado, habilitado **somente** quando `habilitado === true` — valor
 * derivado upstream por `confirmarHabilitado` (store), nunca recalculado aqui.
 *
 * Idempotência de um clique só (R5.2, R5.3): enquanto `simulando === true`, o
 * botão fica desabilitado e `onConfirmar` **não** é disparado, de modo que
 * cliques repetidos durante a fase `Simulando` não reenviam a simulação. O
 * `onClick` também curto-circuita como salvaguarda caso o estado desabilitado
 * ainda não tenha propagado.
 *
 * Anti-slop / acessibilidade:
 * - **Alvo grande com rótulo textual explícito** (R17.3).
 * - **Foco visível** por `:focus-visible`, operável por teclado (Enter/Espaço)
 *   por ser um `<button>` real (R17.2).
 * - **Estado distinguível por mais de um recurso visual** (R17.6): o estado
 *   desabilitado combina `disabled` (semântica/leitor de tela), rótulo que muda
 *   para "Simulando…" quando aplicável, opacidade e cursor — não apenas cor.
 *
 * _Requirements: 4.5, 5.1, 5.2, 5.3, 17.3_
 */

import type { ReactNode } from 'react';

export interface BotaoConfirmarProps {
  /**
   * Se o controle está habilitado — derivado por `confirmarHabilitado` upstream
   * (modo selecionado + validação sem bloqueio + seed aprovada no importar_seed)
   * (R4.5, R5.1).
   */
  readonly habilitado: boolean;
  /** Se uma simulação está em andamento (fase `Simulando`): torna o botão idempotente (R5.3). */
  readonly simulando: boolean;
  /** Acionado ao confirmar — invocado no máximo uma vez por partida (R5.2). */
  readonly onConfirmar: () => void;
}

const FOCUS_STYLE_ID = 'pfl-botao-confirmar-focus';

const FOCUS_STYLE = `
[data-pfl-botao-confirmar]:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

export function BotaoConfirmar({
  habilitado,
  simulando,
  onConfirmar,
}: BotaoConfirmarProps): ReactNode {
  // Desabilitado se não habilitado OU se já está simulando (idempotência, R5.3).
  const desabilitado = !habilitado || simulando;

  function handleClick(): void {
    // Salvaguarda de idempotência: no-op quando desabilitado/simulando (R5.3).
    if (desabilitado) {
      return;
    }
    onConfirmar();
  }

  return (
    <>
      {/* Indicador de foco visível (R17.2): escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <button
        type="button"
        data-pfl-botao-confirmar
        disabled={desabilitado}
        aria-disabled={desabilitado}
        // Comunica o progresso da ação a leitores de tela durante `Simulando`.
        aria-busy={simulando}
        onClick={handleClick}
        style={{
          // Alvo grande com rótulo textual (R17.3).
          minHeight: '3.5rem',
          minWidth: '14rem',
          padding: '1rem 1.5rem',
          fontSize: '1.125rem',
          fontWeight: 700,
          border: '3px solid #1a1a1a',
          borderRadius: '0.5rem',
          // Cor é só reforço; estado também muda rótulo/opacidade/cursor (R17.6).
          background: desabilitado ? '#e6e6e6' : '#1a1a1a',
          color: desabilitado ? '#5a5a5a' : '#ffffff',
          opacity: desabilitado ? 0.75 : 1,
          cursor: desabilitado ? 'not-allowed' : 'pointer',
        }}
      >
        {simulando ? 'Simulando…' : 'Confirmar e simular'}
      </button>
    </>
  );
}
