'use client';

/**
 * `ListaPrioridade` (`components/strategy/ListaPrioridade.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 10.1 (bloco interno compartilhado).
 *
 * Lista ordenada **operável por teclado** usada por `PrioridadeJogadasAtaque` e
 * `PrioridadeJogadasDefesa` para priorizar as 6 jogadas de um lado. Cada item
 * exibe o rótulo legível da jogada e expõe dois botões "mover para cima" /
 * "mover para baixo" com `aria-label` específico; acioná-los emite uma nova
 * ordem via `onReorder`.
 *
 * A reordenação é uma **troca adjacente** (swap com o vizinho), de modo que a
 * saída é sempre uma **permutação completa do mesmo conjunto fixo** de 6 jogadas
 * — nenhum id é adicionado ou removido (R12.3/R12.4). O componente não acessa a
 * store; a página fia `onReorder` a `reorderOffensePlays`/`reorderDefensePlays`.
 *
 * Acessibilidade: `<ol>`/`<li>` dão a semântica de lista ordenada; os controles
 * são `<button>` reais (Enter/Espaço) com rótulos específicos ("Mover
 * {jogada} para cima"); o botão desabilitado nas extremidades evita ação sem
 * efeito. A posição de cada item é anunciada textualmente ("1º", "2º", ...),
 * não apenas pela ordem visual (R17.1, R17.2, R17.4, R17.6).
 *
 * _Requirements: 12.1, 12.2, 12.3, 12.4_
 */

import type { CSSProperties, ReactNode } from 'react';
import type { PlayId } from '@/lib/team/model';

/** Estilo "visualmente oculto" porém anunciável por leitores de tela. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface ListaPrioridadeProps {
  /** Ordem atual das jogadas (permutação do conjunto fixo do lado). */
  readonly order: readonly PlayId[];
  /** Rótulo legível por jogada (mapa de UI, não números de catálogo). */
  readonly labels: Readonly<Record<PlayId, string>>;
  /** Rótulo acessível do grupo (ex.: "Prioridade das jogadas de ataque"). */
  readonly groupLabel: string;
  /** Emite a nova ordem completa após uma troca adjacente (R12.3/R12.4). */
  readonly onReorder: (order: PlayId[]) => void;
  /** Prefixo único dos ids/estilos de foco para evitar colisão entre instâncias. */
  readonly scope: string;
}

/**
 * Troca os itens das posições `i` e `j`, retornando um novo array. Chamado
 * apenas com índices válidos (os botões de extremidade ficam desabilitados),
 * então os acessos indexados são seguros; o guarda apenas satisfaz o
 * `noUncheckedIndexedAccess` do tsconfig estrito.
 */
function swap(order: readonly PlayId[], i: number, j: number): PlayId[] {
  const next = [...order];
  const a = next[i];
  const b = next[j];
  if (a === undefined || b === undefined) {
    return next;
  }
  next[i] = b;
  next[j] = a;
  return next;
}

export function ListaPrioridade({
  order,
  labels,
  groupLabel,
  onReorder,
  scope,
}: ListaPrioridadeProps): ReactNode {
  const focusStyle = `
[data-pfl-lista-prioridade="${scope}"] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 2px;
}
`;

  return (
    <div data-pfl-lista-prioridade={scope}>
      <style id={`pfl-lista-prioridade-${scope}-focus`}>{focusStyle}</style>

      <ol
        aria-label={groupLabel}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.375rem',
        }}
      >
        {order.map((playId, index) => {
          const isFirst = index === 0;
          const isLast = index === order.length - 1;
          const label = labels[playId];
          const posicao = `${index + 1}º`;

          return (
            <li
              key={playId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid #8a8a8a',
                borderRadius: '0.5rem',
                background: '#ffffff',
              }}
            >
              {/* Posição anunciada textualmente, não só pela ordem visual (R17.4). */}
              <span
                aria-hidden="true"
                style={{ fontWeight: 700, minWidth: '2ch' }}
              >
                {posicao}
              </span>
              <span style={{ flex: '1 1 auto', color: '#1a1a1a' }}>
                {/* Prefixo de posição exclusivo para leitores de tela
                    (visualmente oculto; a posição já aparece à esquerda). */}
                <span style={VISUALLY_HIDDEN}>{`Prioridade ${posicao}: `}</span>
                {label}
              </span>

              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <button
                  type="button"
                  aria-label={`Mover ${label} para cima`}
                  disabled={isFirst}
                  onClick={() => onReorder(swap(order, index, index - 1))}
                  style={{
                    minWidth: '2.5rem',
                    minHeight: '2.5rem',
                    fontSize: '1.125rem',
                    border: '1px solid #8a8a8a',
                    borderRadius: '0.375rem',
                    background: isFirst ? '#f0f0f0' : '#ffffff',
                    color: isFirst ? '#9a9a9a' : '#1a1a1a',
                    cursor: isFirst ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span aria-hidden="true">▲</span>
                </button>
                <button
                  type="button"
                  aria-label={`Mover ${label} para baixo`}
                  disabled={isLast}
                  onClick={() => onReorder(swap(order, index, index + 1))}
                  style={{
                    minWidth: '2.5rem',
                    minHeight: '2.5rem',
                    fontSize: '1.125rem',
                    border: '1px solid #8a8a8a',
                    borderRadius: '0.375rem',
                    background: isLast ? '#f0f0f0' : '#ffffff',
                    color: isLast ? '#9a9a9a' : '#1a1a1a',
                    cursor: isLast ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span aria-hidden="true">▼</span>
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
