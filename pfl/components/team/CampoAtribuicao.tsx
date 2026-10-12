'use client';

/**
 * `CampoAtribuicao` (`components/team/CampoAtribuicao.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.2.
 *
 * Componente de **apresentação** (burro): o campo com os 11 papéis da
 * {@link LineupUnit} ativa. Cada papel é um **slot** que aceita a atribuição de
 * uma `AthleteDraft` por dois caminhos **equivalentes** (R4.1/R4.2/R17.3):
 *
 * 1. **Arrastar e soltar**: soltar um cartão do Roster sobre o slot dispara
 *    `onDropAthlete(unit, role, event)` — a leitura do `instanceId` a partir do
 *    `dataTransfer` fica a cargo da orquestração (o `ItemRoster` já grava o
 *    `instanceId` em `text/plain` no `dragStart`).
 * 2. **Seletor por teclado**: um `<select>` nativo por slot, operável só com o
 *    teclado, lista as mesmas opções do Roster; escolher uma produz
 *    `onAssign(unit, role, instanceId)` — **o mesmo resultado** do drop.
 *
 * Qualquer espécie permitida pode ocupar qualquer papel: não há proibição por
 * espécie (R4.4). Em uma atribuição válida emite `onAssign` (R4.3); limpar um
 * slot emite `onClear`. Este componente não guarda estado nem faz IO — recebe
 * as atribuições correntes e as opções por prop e delega aos callbacks.
 *
 * Acessibilidade / anti-slop (R17.3 — passagem completa em 11.2):
 * - O `<select>` é a alternativa de teclado **equivalente** ao arrastar; nenhum
 *   fluxo depende exclusivamente de drag.
 * - Slots atribuídos sinalizam o estado por mais de um recurso visual (borda,
 *   fundo e rótulo textual), nunca só por cor. Foco visível escopado via
 *   `:focus-visible`.
 *
 * _Requirements: 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 17.3_
 */

import { useId, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import type { LineupUnit, Role } from '@/lib/team/model';

/** Opção de atribuição derivada do Roster (uma por instância elegível). */
export interface RosterOption {
  /** `instanceId` da `AthleteDraft` (identidade distinta no Roster). */
  readonly instanceId: number;
  /** Rótulo legível (p.ex. nome resolvido pela Camada_Leitura). */
  readonly label: string;
}

export interface CampoAtribuicaoProps {
  /** Unidade ativa cujos papéis são exibidos (R3.2/R3.3/R3.4). */
  readonly unit: LineupUnit;
  /** Os papéis da unidade (tipicamente 11); um slot por papel. */
  readonly roles: readonly Role[];
  /** Mapa `role → instanceId` da atribuição corrente (ou `null` se vazio). */
  readonly assignmentsByRole: Readonly<Record<string, number | null>>;
  /** Opções de atribuição (instâncias do Roster) oferecidas ao seletor. */
  readonly rosterOptions: readonly RosterOption[];
  /** Atribui uma instância a um papel (seletor por teclado) — R4.2/R4.3. */
  readonly onAssign: (unit: LineupUnit, role: Role, instanceId: number) => void;
  /** Limpa a atribuição de um papel. */
  readonly onClear: (unit: LineupUnit, role: Role) => void;
  /**
   * Soltar um cartão arrastado sobre o papel (R4.1). O `instanceId` é lido do
   * `dataTransfer` pela orquestração; aqui apenas repassamos unidade/papel/ev.
   */
  readonly onDropAthlete?: (
    unit: LineupUnit,
    role: Role,
    event: DragEvent<HTMLDivElement>,
  ) => void;
}

const FOCUS_STYLE_ID = 'pfl-campo-atribuicao-focus';

const FOCUS_STYLE = `
[data-pfl-campo-atribuicao] select:focus-visible,
[data-pfl-campo-atribuicao] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 2px;
}
`;

export function CampoAtribuicao({
  unit,
  roles,
  assignmentsByRole,
  rosterOptions,
  onAssign,
  onClear,
  onDropAthlete,
}: CampoAtribuicaoProps): ReactNode {
  // Realce de qual slot está sob o cursor durante o arrasto (feedback visual).
  const [dragOverRole, setDragOverRole] = useState<Role | null>(null);
  const baseId = useId();

  const buscaRotulo = (instanceId: number): string => {
    const opt = rosterOptions.find((o) => o.instanceId === instanceId);
    return opt?.label ?? `instância ${instanceId}`;
  };

  const handleDrop = (role: Role, event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOverRole(null);
    onDropAthlete?.(unit, role, event);
  };

  const handleDragOver = (
    role: Role,
    event: DragEvent<HTMLDivElement>,
  ): void => {
    // Necessário para que o slot seja um alvo de drop válido.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverRole !== role) {
      setDragOverRole(role);
    }
  };

  return (
    <div data-pfl-campo-atribuicao>
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <ul
        aria-label={`Papéis da unidade (${roles.length})`}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
          gap: '0.75rem',
        }}
      >
        {roles.map((role, i) => {
          const assigned = assignmentsByRole[role] ?? null;
          const isOver = dragOverRole === role;
          const selectId = `${baseId}-sel-${i}`;
          const statusId = `${baseId}-st-${i}`;

          return (
            <li key={role}>
              {/*
                Zona de drop (R4.1). O realce de arrasto e o estado atribuído
                são sinalizados por borda + fundo + texto (R17.6), não só cor.
              */}
              <div
                onDragOver={(e) => handleDragOver(role, e)}
                onDragLeave={() => setDragOverRole(null)}
                onDrop={(e) => handleDrop(role, e)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  border: isOver
                    ? '3px dashed #1a1a1a'
                    : assigned !== null
                      ? '2px solid #1a6a2e'
                      : '1px solid #8a8a8a',
                  borderRadius: '0.5rem',
                  background: isOver
                    ? '#eef3ff'
                    : assigned !== null
                      ? '#eef7ee'
                      : '#ffffff',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                    {role}
                  </span>
                  {/* Estado textual: segundo sinal, além da cor da borda. */}
                  <span
                    id={statusId}
                    style={{ fontSize: '0.8125rem', color: '#4a4a4a' }}
                  >
                    {assigned !== null
                      ? `Atribuído: ${buscaRotulo(assigned)}`
                      : 'Vazio — solte um atleta ou use o seletor'}
                  </span>
                </div>

                {/*
                  Seletor por teclado: alternativa EQUIVALENTE ao arrastar
                  (R4.2/R17.3). Qualquer instância pode ir a qualquer papel —
                  sem proibição por espécie (R4.4).
                */}
                <label
                  htmlFor={selectId}
                  style={{ fontSize: '0.8125rem', fontWeight: 600 }}
                >
                  Atribuir ao papel {role}
                </label>
                <select
                  id={selectId}
                  aria-describedby={statusId}
                  value={assigned !== null ? String(assigned) : ''}
                  onChange={(e) => {
                    const { value } = e.target;
                    if (value === '') {
                      onClear(unit, role);
                      return;
                    }
                    onAssign(unit, role, Number(value));
                  }}
                  style={{
                    minHeight: '2.5rem',
                    padding: '0.375rem 0.5rem',
                    fontSize: '0.875rem',
                    border: '1px solid #8a8a8a',
                    borderRadius: '0.375rem',
                    background: '#ffffff',
                    color: '#1a1a1a',
                  }}
                >
                  <option value="">Vazio</option>
                  {rosterOptions.map((opt) => (
                    <option key={opt.instanceId} value={String(opt.instanceId)}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {assigned !== null ? (
                  <button
                    type="button"
                    onClick={() => onClear(unit, role)}
                    style={{
                      alignSelf: 'flex-start',
                      minHeight: '2.25rem',
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      border: '1px solid #8a8a8a',
                      borderRadius: '0.375rem',
                      background: '#ffffff',
                      color: '#1a1a1a',
                      cursor: 'pointer',
                    }}
                  >
                    Limpar papel
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
