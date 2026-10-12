'use client';

/**
 * `SeletorHabilidade` (`components/team/SeletorHabilidade.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.3.
 *
 * Componente de **apresentação** (burro): expõe a única habilidade do atleta via
 * um `<select>` rotulado e acessível por teclado. As `options` são **exatamente**
 * as habilidades disponíveis para a espécie — `getAvailableAbilities(pokemonId)`
 * resolvido pelo orquestrador no {@link EligibilitySnapshot} (R6.2). O componente
 * não consulta catálogo nem guarda estado: recebe o id atual e a lista de opções,
 * e devolve a escolha por `onChange`.
 *
 * O controle aceita `aria-describedby` para que a {@link FichaAtleta} associe o
 * aviso de validação correspondente (p.ex. `ABILITY_NOT_AVAILABLE` ou
 * `INERT_EFFECT`) a este seletor por ARIA (R17.7).
 *
 * Anti-slop / acessibilidade: `<select>` nativo rotulado por `<label>`
 * explícito, operável por teclado, com foco visível via `:focus-visible`
 * escopado (sem CSS global) e distinto de erro/seleção (R17.2, R17.4).
 *
 * _Requirements: 6.1, 6.2_
 */

import type { ReactNode } from 'react';

/** Opção de habilidade: id autoritativo + rótulo legível da `Camada_Leitura`. */
export interface OpcaoHabilidade {
  /** `ability_id` disponível para a espécie. */
  readonly id: number;
  /** Rótulo legível (nome resolvido pela `Camada_Leitura`, R17.5). */
  readonly label: string;
}

export interface SeletorHabilidadeProps {
  /** `ability_id` atualmente escolhido, ou `null` quando ainda não definido. */
  readonly abilityId: number | null;
  /** Opções = `getAvailableAbilities(pokemonId)` resolvidas pelo snapshot (R6.2). */
  readonly options: readonly OpcaoHabilidade[];
  /** Chamado com o `ability_id` escolhido. */
  readonly onChange: (abilityId: number) => void;
  /** `id`(s) de aviso(s) a associar por ARIA a este controle (R17.7). */
  readonly describedBy?: string;
  /** `id` do elemento `<select>`, para rótulos/associações externas. */
  readonly selectId?: string;
}

/** Indicador de foco escopado: `:focus-visible` não é expressável inline. */
const FOCUS_STYLE_ID = 'pfl-seletor-habilidade-focus';

const FOCUS_STYLE = `
[data-pfl-seletor-habilidade] select:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 2px;
}
`;

const DEFAULT_SELECT_ID = 'pfl-seletor-habilidade';

export function SeletorHabilidade({
  abilityId,
  options,
  onChange,
  describedBy,
  selectId = DEFAULT_SELECT_ID,
}: SeletorHabilidadeProps): ReactNode {
  const labelId = `${selectId}-label`;

  return (
    <div data-pfl-seletor-habilidade>
      {/* Indicador de foco visível: escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <label
        id={labelId}
        htmlFor={selectId}
        style={{
          display: 'block',
          fontSize: '0.9375rem',
          fontWeight: 600,
          marginBottom: '0.375rem',
        }}
      >
        Habilidade
      </label>
      <select
        id={selectId}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        value={abilityId ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value !== '') {
            onChange(Number(value));
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
        {/* Placeholder só aparece enquanto nenhuma habilidade está escolhida. */}
        {abilityId === null ? (
          <option value="" disabled>
            Selecione uma habilidade
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
}
