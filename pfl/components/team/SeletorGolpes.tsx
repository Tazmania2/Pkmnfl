'use client';

/**
 * `SeletorGolpes` (`components/team/SeletorGolpes.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.3.
 *
 * Componente de **apresentação** (burro): expõe os **4 slots** de golpe do
 * atleta, cada um com um `<select>` rotulado e acessível por teclado. As
 * `options` são **exatamente** os golpes aprendíveis pela espécie —
 * `getLearnableMoveIds(pokemonId)` resolvido pelo orquestrador no
 * {@link EligibilitySnapshot} (R6.3). O componente não consulta catálogo nem
 * guarda estado: recebe os ids atuais e a lista de opções, e devolve cada
 * alteração de slot por `onChange(slotIndex, moveId)`.
 *
 * Sempre renderiza {@link MOVE_SLOTS} (4) controles, mesmo quando `moveIds` tem
 * menos de quatro entradas — slots vazios ficam sem seleção, deixando o motor de
 * validação sinalizar `MOVE_COUNT_NOT_FOUR` (R6.4/R7.3). Cada slot aceita um
 * `describedBy` próprio para a {@link FichaAtleta} associar avisos
 * (`MOVE_NOT_LEARNABLE`, `MOVE_DUPLICATE`, `INERT_EFFECT`) por ARIA (R17.7).
 *
 * _Requirements: 6.1, 6.3, 6.4_
 */

import type { ReactNode } from 'react';

/** Número fixo de slots de golpe por atleta (R6.4/R7.3). */
export const MOVE_SLOTS = 4;

/** Opção de golpe: id autoritativo + rótulo legível da `Camada_Leitura`. */
export interface OpcaoGolpe {
  /** `move_id` aprendível pela espécie. */
  readonly id: number;
  /** Rótulo legível (nome resolvido pela `Camada_Leitura`, R17.5). */
  readonly label: string;
}

export interface SeletorGolpesProps {
  /** `move_id`s atuais; cada índice alimenta um slot (0..3). */
  readonly moveIds: readonly number[];
  /** Opções = `getLearnableMoveIds(pokemonId)` resolvidas pelo snapshot (R6.3). */
  readonly options: readonly OpcaoGolpe[];
  /** Chamado com o índice do slot alterado e o `move_id` escolhido. */
  readonly onChange: (slotIndex: number, moveId: number) => void;
  /**
   * `id`(s) de aviso(s) a associar por ARIA a um slot específico (R17.7). O mapa
   * é `slotIndex → describedby`; slots ausentes não recebem associação.
   */
  readonly describedBy?: Readonly<Record<number, string>>;
  /** Prefixo do `id` de cada `<select>` de slot, para associações externas. */
  readonly idPrefix?: string;
}

/** Indicador de foco escopado: `:focus-visible` não é expressável inline. */
const FOCUS_STYLE_ID = 'pfl-seletor-golpes-focus';

const FOCUS_STYLE = `
[data-pfl-seletor-golpes] select:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 2px;
}
`;

const DEFAULT_ID_PREFIX = 'pfl-seletor-golpe';

export function SeletorGolpes({
  moveIds,
  options,
  onChange,
  describedBy,
  idPrefix = DEFAULT_ID_PREFIX,
}: SeletorGolpesProps): ReactNode {
  // Sempre 4 slots: índices fixos 0..3, independentemente de `moveIds.length`.
  const slots = Array.from({ length: MOVE_SLOTS }, (_, index) => index);

  return (
    <fieldset
      data-pfl-seletor-golpes
      style={{ border: 'none', margin: 0, padding: 0 }}
    >
      {/* Indicador de foco visível: escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <legend
        style={{
          fontSize: '0.9375rem',
          fontWeight: 600,
          marginBottom: '0.5rem',
          padding: 0,
        }}
      >
        Golpes ({MOVE_SLOTS} slots)
      </legend>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {slots.map((slotIndex) => {
          const selectId = `${idPrefix}-${slotIndex}`;
          const labelId = `${selectId}-label`;
          // `moveIds` pode ter menos de 4 itens: slot sem valor fica vazio.
          const current = moveIds[slotIndex];
          const value = current ?? '';

          return (
            <div key={slotIndex}>
              <label
                id={labelId}
                htmlFor={selectId}
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  marginBottom: '0.25rem',
                }}
              >
                {`Golpe ${slotIndex + 1}`}
              </label>
              <select
                id={selectId}
                aria-labelledby={labelId}
                aria-describedby={describedBy?.[slotIndex]}
                value={value}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  if (raw !== '') {
                    onChange(slotIndex, Number(raw));
                  }
                }}
                style={{
                  minHeight: '2.75rem',
                  padding: '0.5rem 0.75rem',
                  fontSize: '1rem',
                  border: '1px solid #8a8a8a',
                  borderRadius: '0.5rem',
                  background: '#ffffff',
                  color: '#1a1a1a',
                  minWidth: '14rem',
                }}
              >
                {current === undefined ? (
                  <option value="" disabled>
                    Selecione um golpe
                  </option>
                ) : null}
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
