'use client';

/**
 * `SeletorEstiloDefesa` (`components/strategy/SeletorEstiloDefesa.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 10.1.
 *
 * Componente de **apresentação** (burro) da Tela_Estrategia: recebe o
 * `Estilo_Defesa` atualmente registrado (`value`) e um callback `onChange`, e
 * renderiza um grupo de opções rotuladas que registram o `defenseStyle` na
 * `StrategyDraft` quando o jogador seleciona (R11.1/R11.3). Não acessa a store
 * nem a rede: a orquestração (Task 11.1) fia o `onChange` à store
 * (`setDefenseStyle`).
 *
 * Opções de estilo: por padrão usa {@link ESTILOS_DEFESA_PADRAO} — os valores
 * rastreáveis aos arquivos de preset (`PRESET_*.json`: `defense_style` =
 * `balanced`, `run_fit`, `zone`, `rush`). A página pode fornecer uma lista
 * própria via `options`. Os textos exibidos são **rótulos de UI** (R17.5).
 *
 * Anti-slop / acessibilidade: `role="radiogroup"` com `<button role="radio">`
 * operáveis por teclado, foco visível e seleção sinalizada por mais de um
 * recurso visual (R17.1, R17.2, R17.4). Espelha o `SeletorEstiloAtaque`.
 *
 * _Requirements: 11.1, 11.3_
 */

import type { ReactNode } from 'react';
import type { EstiloOption } from './SeletorEstiloAtaque';

/**
 * Estilos de defesa padrão, rastreáveis aos `PRESET_*.json`
 * (`defense_style`): `balanced`, `run_fit`, `zone`, `rush`. Rótulos de UI.
 */
export const ESTILOS_DEFESA_PADRAO: readonly EstiloOption[] = [
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'run_fit', label: 'Contenção de corrida' },
  { value: 'zone', label: 'Zona' },
  { value: 'rush', label: 'Pressão' },
] as const;

export interface SeletorEstiloDefesaProps {
  /** `defenseStyle` atualmente registrado; `''` quando nenhum foi escolhido. */
  readonly value: string;
  /** Chamado com o novo estilo ao selecionar uma opção (R11.3). */
  readonly onChange: (style: string) => void;
  /** Opções oferecidas; por padrão {@link ESTILOS_DEFESA_PADRAO}. */
  readonly options?: readonly EstiloOption[];
}

const FOCUS_STYLE_ID = 'pfl-seletor-estilo-defesa-focus';
const FOCUS_STYLE = `
[data-pfl-seletor-estilo-defesa] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

export function SeletorEstiloDefesa({
  value,
  onChange,
  options = ESTILOS_DEFESA_PADRAO,
}: SeletorEstiloDefesaProps): ReactNode {
  return (
    <div data-pfl-seletor-estilo-defesa>
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
          Estilo de defesa
        </legend>

        <div
          role="radiogroup"
          aria-label="Estilo de defesa"
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
