'use client';

/**
 * `AbasUnidade` (`components/team/AbasUnidade.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.2.
 *
 * Componente de **apresentação** (burro): o seletor em abas que alterna a
 * visualização entre a unidade de **Ataque** (`offense`), a de **Defesa**
 * (`defense`) e **Especiais** — expondo as 6 {@link LineupUnit} de special
 * teams (`kickoff`, `kick_return`, `punt`, `punt_return`, `field_goal`,
 * `field_goal_block`) sob o grupo "Especiais" (R3.1–R3.4). Acionar uma aba
 * chama `onSelect(unit)`; o componente não guarda estado — a unidade ativa vem
 * por prop e a orquestração (store, Task 11.1) é quem a atualiza.
 *
 * Acessibilidade / anti-slop (R17.2/R17.3 — passagem completa em 11.2):
 * - Padrão WAI-ARIA de abas: `role="tablist"` com `role="tab"`,
 *   `aria-selected` e `tabIndex` roving para navegação por setas; Home/End vão
 *   à primeira/última aba. Enter/Espaço (nativos de `<button>`) selecionam.
 * - Foco visível distinto da seleção (`:focus-visible` escopado) e estado ativo
 *   sinalizado por mais de um recurso visual (peso, borda inferior, fundo),
 *   nunca só por cor.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4_
 */

import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { LineupUnit } from '@/lib/team/model';

/** Rótulos legíveis de cada {@link LineupUnit} (conjunto fechado). */
const ROTULOS_UNIDADE: Readonly<Record<LineupUnit, string>> = {
  offense: 'Ataque',
  defense: 'Defesa',
  kickoff: 'Kickoff',
  kick_return: 'Retorno de Kickoff',
  punt: 'Punt',
  punt_return: 'Retorno de Punt',
  field_goal: 'Field Goal',
  field_goal_block: 'Bloqueio de Field Goal',
};

/** As 6 unidades de special teams expostas sob "Especiais" (R3.4). */
const SPECIAL_UNITS: readonly LineupUnit[] = [
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
] as const;

/**
 * Ordem canônica de todas as abas: Ataque, Defesa e as 6 de special teams. É a
 * sequência de navegação por teclado e a ordem de tabulação visual.
 */
const ORDEM_ABAS: readonly LineupUnit[] = [
  'offense',
  'defense',
  ...SPECIAL_UNITS,
] as const;

export interface AbasUnidadeProps {
  /** Unidade atualmente ativa (R3.2/R3.3/R3.4). */
  readonly active: LineupUnit;
  /** Chamado ao selecionar uma aba de unidade (R3.1). */
  readonly onSelect: (unit: LineupUnit) => void;
}

const FOCUS_STYLE_ID = 'pfl-abas-unidade-focus';

const FOCUS_STYLE = `
[data-pfl-abas-unidade] [role="tab"]:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 2px;
}
`;

/** Deriva o `id` da aba a partir da unidade (para ARIA e foco programático). */
function tabId(unit: LineupUnit): string {
  return `pfl-aba-${unit}`;
}

export function AbasUnidade({ active, onSelect }: AbasUnidadeProps): ReactNode {
  // Referências às abas para mover o foco na navegação por setas (roving).
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const foca = (unit: LineupUnit): void => {
    tabRefs.current[unit]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = ORDEM_ABAS.indexOf(active);
    if (index < 0) {
      return;
    }

    let alvo: LineupUnit | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        alvo = ORDEM_ABAS[(index + 1) % ORDEM_ABAS.length] ?? null;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        alvo =
          ORDEM_ABAS[(index - 1 + ORDEM_ABAS.length) % ORDEM_ABAS.length] ??
          null;
        break;
      case 'Home':
        alvo = ORDEM_ABAS[0] ?? null;
        break;
      case 'End':
        alvo = ORDEM_ABAS[ORDEM_ABAS.length - 1] ?? null;
        break;
      default:
        return;
    }

    if (alvo !== null) {
      event.preventDefault();
      onSelect(alvo);
      foca(alvo);
    }
  };

  const renderTab = (unit: LineupUnit): ReactNode => {
    const selected = unit === active;
    return (
      <button
        key={unit}
        ref={(node) => {
          tabRefs.current[unit] = node;
        }}
        type="button"
        role="tab"
        id={tabId(unit)}
        aria-selected={selected}
        // Roving tabindex: só a aba ativa é tabulável; as demais via setas.
        tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(unit)}
        onKeyDown={handleKeyDown}
        style={{
          minHeight: '2.75rem',
          padding: '0.625rem 1rem',
          fontSize: '0.9375rem',
          // Peso tipográfico reforça o estado ativo além da cor (R17.6).
          fontWeight: selected ? 700 : 500,
          border: '1px solid #8a8a8a',
          // Borda inferior espessa como segundo sinal visual da seleção.
          borderBottom: selected ? '3px solid #1a1a1a' : '1px solid #8a8a8a',
          borderRadius: '0.375rem 0.375rem 0 0',
          background: selected ? '#eef3ff' : '#ffffff',
          color: '#1a1a1a',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {ROTULOS_UNIDADE[unit]}
      </button>
    );
  };

  const especiaisAtivo = SPECIAL_UNITS.includes(active);

  return (
    <div data-pfl-abas-unidade>
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <div
        role="tablist"
        aria-label="Unidade do time"
        aria-orientation="horizontal"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '0.375rem',
          borderBottom: '2px solid #d0d0d0',
          paddingBottom: '0.25rem',
        }}
      >
        {renderTab('offense')}
        {renderTab('defense')}

        {/* Grupo "Especiais": rótulo textual seguido das 6 abas de ST (R3.4). */}
        <div
          role="group"
          aria-label="Especiais"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: especiaisAtivo ? '#1a1a1a' : '#4a4a4a',
              padding: '0 0.25rem',
            }}
          >
            Especiais
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            {SPECIAL_UNITS.map((unit) => renderTab(unit))}
          </div>
        </div>
      </div>
    </div>
  );
}
