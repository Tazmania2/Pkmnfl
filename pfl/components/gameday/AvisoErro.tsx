'use client';

/**
 * `AvisoErro` (`components/gameday/AvisoErro.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 13.2.
 *
 * Componente de **apresentação** (burro): renderiza uma mensagem de erro
 * **legível** para qualquer `MatchError` (`VALIDATION` | `IMPORT` | `INPUT` |
 * `NETWORK`) e a associa **programaticamente** ao controle de origem, de modo
 * que um leitor de tela a anuncie ao focar o controle (R17.7). A associação é
 * feita publicando um elemento com `id = controlId + "-error"`: o controle alvo
 * referencia esse `id` via `aria-describedby`/`aria-errormessage` (a página de
 * Task 16.1 faz a ligação do lado do controle, usando `errorMessageId`
 * exportado por conveniência).
 *
 * Para erros recuperáveis (entrada inválida do motor — R6.5 — e, sobretudo,
 * falha de comunicação — R7.4), o componente oferece um **retry** (`onRetry`):
 * um `<button>` real, rotulado, que permite nova tentativa preservando o estado
 * da tela (a store mantém modo/seed/seed-do-adversário na fase `Erro`).
 *
 * Anti-slop / acessibilidade:
 * - `role="alert"` + `aria-live="assertive"` para anúncio imediato ao surgir.
 * - Estado de erro distinguível por mais de um recurso: texto do motivo, ícone
 *   textual ("⚠"), rótulo da categoria e borda espessa — não só cor (R17.6).
 * - Botão de retry focável/operável por teclado com foco visível (R17.2).
 *
 * _Requirements: 6.5, 7.4, 17.7_
 */

import type { ReactNode } from 'react';
import type { MatchError, MatchErrorKind } from '@/lib/match';

/**
 * Deriva o `id` do elemento de mensagem de erro a partir do `id` do controle de
 * origem. A página liga esse `id` ao controle via
 * `aria-describedby`/`aria-errormessage` (R17.7). Exportado para que o controle
 * e o `AvisoErro` concordem sobre o mesmo `id` sem acoplamento adicional.
 */
export function errorMessageId(controlId: string): string {
  return `${controlId}-error`;
}

/** Rótulo legível por categoria de erro, exibido como contexto do motivo. */
const ROTULO_CATEGORIA: Readonly<Record<MatchErrorKind, string>> = {
  VALIDATION: 'Validação do elenco',
  IMPORT: 'Importação de seed',
  INPUT: 'Entrada inválida',
  NETWORK: 'Falha de comunicação',
};

export interface AvisoErroProps {
  /** Erro a exibir, ou `null`/`undefined` para não renderizar nada. */
  readonly error: MatchError | null | undefined;
  /**
   * `id` do controle ao qual este aviso se associa (R17.7). O elemento de
   * mensagem recebe `errorMessageId(controlId)`; o controle deve referenciar
   * esse `id` em `aria-describedby`/`aria-errormessage`.
   */
  readonly controlId: string;
  /**
   * Acionado para nova tentativa (R7.4). Quando omitido, o botão de retry não é
   * exibido (ex.: erros que não comportam retry imediato).
   */
  readonly onRetry?: () => void;
  /** Rótulo do botão de retry. Padrão: "Tentar novamente". */
  readonly retryLabel?: string;
}

const FOCUS_STYLE_ID = 'pfl-aviso-erro-focus';

const FOCUS_STYLE = `
[data-pfl-aviso-erro] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

export function AvisoErro({
  error,
  controlId,
  onRetry,
  retryLabel = 'Tentar novamente',
}: AvisoErroProps): ReactNode {
  if (error === null || error === undefined) {
    return null;
  }

  const msgId = errorMessageId(controlId);
  const categoria = ROTULO_CATEGORIA[error.kind];

  return (
    <div
      data-pfl-aviso-erro
      style={{
        marginTop: '0.75rem',
        padding: '0.875rem 1rem',
        // Estado distinguível por borda espessa (não só cor) — R17.6.
        border: '3px solid #8a1a1a',
        borderRadius: '0.5rem',
        background: '#fdf0f0',
      }}
    >
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      {/* Mensagem associada por ARIA ao controle (R17.7): o controle referencia
          `msgId` via aria-describedby/aria-errormessage. role="alert" garante
          anúncio imediato ao surgir. */}
      <p
        id={msgId}
        role="alert"
        aria-live="assertive"
        style={{
          margin: 0,
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: '#8a1a1a',
        }}
      >
        <span aria-hidden="true">⚠ </span>
        {categoria}: {error.message}
      </p>

      {/* Retry opcional (R7.4): preserva o estado da tela; nova tentativa. */}
      {onRetry !== undefined ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: '0.75rem',
            minHeight: '2.75rem',
            padding: '0.5rem 1.25rem',
            fontSize: '0.9375rem',
            fontWeight: 600,
            border: '2px solid #8a1a1a',
            borderRadius: '0.5rem',
            background: '#ffffff',
            color: '#8a1a1a',
            cursor: 'pointer',
          }}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
