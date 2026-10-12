'use client';

/**
 * `SeletorEstiloAtaque` (`components/strategy/SeletorEstiloAtaque.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 10.1.
 *
 * Componente de **apresentação** (burro) da Tela_Estrategia: recebe o
 * `Estilo_Ataque` atualmente registrado (`value`) e um callback `onChange`, e
 * renderiza um grupo de opções rotuladas que registram o `offenseStyle` na
 * `StrategyDraft` quando o jogador seleciona (R11.1/R11.2). Não acessa a store
 * nem a rede: a orquestração (Task 11.1) fia o `onChange` à store
 * (`setOffenseStyle`).
 *
 * Opções de estilo: por padrão usa {@link ESTILOS_ATAQUE_PADRAO} — os valores
 * rastreáveis aos arquivos de preset (`PRESET_*.json`: `balanced`, `ground`,
 * `aerial`). A página pode fornecer uma lista própria via `options`. Os textos
 * exibidos são **rótulos de UI**, não números de catálogo, logo não há questão
 * de honestidade de valores (R17.5).
 *
 * Anti-slop / acessibilidade:
 * - Grupo de `<button role="radio">` dentro de um `role="radiogroup"`: operável
 *   por teclado (Tab para o grupo, Enter/Espaço para selecionar) e anunciável por
 *   leitores de tela (R17.1, R17.2).
 * - A seleção é sinalizada por **mais de um recurso visual** (`aria-checked`,
 *   indicador textual "● Selecionado", borda e peso de fonte), nunca só por cor
 *   (R17.4).
 *
 * _Requirements: 11.1, 11.2_
 */

import type { ReactNode } from 'react';

/** Uma opção de estilo: `value` persistido, `label` exibido ao jogador. */
export interface EstiloOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Estilos de ataque padrão, rastreáveis aos `PRESET_*.json`
 * (`offense_style`): `balanced`, `ground`, `aerial`. Os rótulos são textos de UI.
 */
export const ESTILOS_ATAQUE_PADRAO: readonly EstiloOption[] = [
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'ground', label: 'Terrestre' },
  { value: 'aerial', label: 'Aéreo' },
] as const;

export interface SeletorEstiloAtaqueProps {
  /** `offenseStyle` atualmente registrado; `''` quando nenhum foi escolhido. */
  readonly value: string;
  /** Chamado com o novo estilo ao selecionar uma opção (R11.2). */
  readonly onChange: (style: string) => void;
  /** Opções oferecidas; por padrão {@link ESTILOS_ATAQUE_PADRAO}. */
  readonly options?: readonly EstiloOption[];
}

const FOCUS_STYLE_ID = 'pfl-seletor-estilo-ataque-focus';
const FOCUS_STYLE = `
[data-pfl-seletor-estilo-ataque] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

export function SeletorEstiloAtaque({
  value,
  onChange,
  options = ESTILOS_ATAQUE_PADRAO,
}: SeletorEstiloAtaqueProps): ReactNode {
  return (
    <div data-pfl-seletor-estilo-ataque>
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend
          style={{
            fontSize: '1.0625rem',
            fontWeight: 600,
            marginBottom: '0.5rem',
            padding: 0,
          }}
        >
          Estilo de ataque
        </legend>

        <div
          role="radiogroup"
          aria-label="Estilo de ataque"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
        >
          {options.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(opt.value)}
                style={{
                  minHeight: '3rem',
                  padding: '0.625rem 1rem',
                  fontSize: '1rem',
                  fontWeight: isSelected ? 700 : 500,
                  border: isSelected ? '3px solid #1a1a1a' : '1px solid #8a8a8a',
                  borderRadius: '0.5rem',
                  background: isSelected ? '#eef3ff' : '#ffffff',
                  color: '#1a1a1a',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  textAlign: 'left',
                }}
              >
                <span>{opt.label}</span>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    visibility: isSelected ? 'visible' : 'hidden',
                  }}
                >
                  ● Selecionado
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
