'use client';

/**
 * `ItemRoster` (`components/team/ItemRoster.tsx`) — spec `pfl-team-strategy-ui`,
 * Task 9.1.
 *
 * Componente de **apresentação** (burro): o cartão de **uma** `AthleteDraft` do
 * Roster. Cada cartão representa uma instância distinta — mesmo quando dois
 * cartões compartilham o mesmo `pokemonId` (duplicata de espécie), são itens
 * separados identificados por `instanceId` (R2.1/R2.2). Acionar o cartão abre a
 * `FichaAtleta` via `onOpen(instanceId)` (R6.1). O cartão é **arrastável** para
 * permitir a atribuição por drag até um papel da unidade (R4.1) e, por
 * acessibilidade, também é **ativável por teclado** (Enter/Espaço → `onOpen`),
 * de modo a nunca ser inacessível (a passagem completa de a11y é a Task 11.2).
 *
 * Este componente não resolve nome de espécie, sprite ou validação; recebe o
 * necessário por props e delega qualquer efeito aos callbacks. O rótulo textual
 * exibido é fornecido por quem orquestra (p.ex. resolvido pela Camada_Leitura),
 * mantendo o componente livre de I/O.
 *
 * _Requirements: 2.1, 2.2, 4.1, 6.1_
 */

import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';
import type { AthleteDraft } from '@/lib/team/model';

export interface ItemRosterProps {
  /** A instância representada por este cartão (distinta por `instanceId`). */
  readonly athlete: AthleteDraft;
  /**
   * Rótulo legível do cartão (p.ex. nome da espécie resolvido pela
   * Camada_Leitura). Opcional; na ausência, usa um rótulo rastreável derivado
   * do `pokemonId`, sem inventar números (R17.5).
   */
  readonly label?: string;
  /** `true` quando este cartão corresponde à instância aberta na ficha. */
  readonly selected?: boolean;
  /** Abre a `FichaAtleta` da instância (clique ou teclado) — R6.1. */
  readonly onOpen: (instanceId: number) => void;
  /**
   * Início do arrasto do cartão para atribuição por drag (R4.1). Recebe o
   * `instanceId` e o evento, deixando o `dataTransfer` a cargo do orquestrador.
   */
  readonly onDragStart?: (
    instanceId: number,
    event: DragEvent<HTMLDivElement>,
  ) => void;
}

export function ItemRoster({
  athlete,
  label,
  selected = false,
  onOpen,
  onDragStart,
}: ItemRosterProps): ReactNode {
  const texto = label ?? `Espécie #${athlete.pokemonId}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Equivalente de teclado ao clique: Enter/Espaço abrem a ficha (a11y).
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onOpen(athlete.instanceId);
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    // Fallback padrão: carrega o `instanceId` no dataTransfer para o drop.
    event.dataTransfer.setData('text/plain', String(athlete.instanceId));
    event.dataTransfer.effectAllowed = 'move';
    onDragStart?.(athlete.instanceId, event);
  };

  const style: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    minHeight: '4rem',
    padding: '0.75rem 0.875rem',
    // Borda mais espessa como recurso visual independente de cor para seleção.
    border: selected ? '3px solid #1a1a1a' : '1px solid #8a8a8a',
    borderRadius: '0.5rem',
    background: selected ? '#eef3ff' : '#ffffff',
    color: '#1a1a1a',
    cursor: 'grab',
    textAlign: 'left',
    fontSize: '0.9375rem',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Atleta ${texto} (instância ${athlete.instanceId})`}
      draggable
      onClick={() => onOpen(athlete.instanceId)}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      data-instance-id={athlete.instanceId}
      style={style}
    >
      <span style={{ fontWeight: 600 }}>{texto}</span>
      <span style={{ fontSize: '0.8125rem', color: '#4a4a4a' }}>
        {athlete.positionDesignation
          ? `Posição: ${athlete.positionDesignation}`
          : 'Sem posição'}
      </span>
    </div>
  );
}
