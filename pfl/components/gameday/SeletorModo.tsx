'use client';

/**
 * `SeletorModo` (`components/gameday/SeletorModo.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 13.1.
 *
 * Componente de **apresentação** (burro): recebe o `Modo_Adversario` selecionado
 * e um callback `onSelect`, e renderiza **exatamente três** `<button>` grandes e
 * rotulados — "Bot aleatório", "Desafiar Curti", "Importar seed" — um por modo
 * suportado (R1.1). Acionar um botão chama `onSelect(modo)`; a orquestração (a
 * página de Task 16.1) é quem registra a seleção na store (R1.2). O modo
 * atualmente selecionado é exibido antes da confirmação (R1.3).
 *
 * Anti-slop / acessibilidade (R17.2, R17.3, R17.6):
 * - **Alvos grandes com rótulo textual explícito** (R17.3): cada botão tem rótulo
 *   de texto e área ampla de toque.
 * - **Seleção distinguível por mais de um recurso visual, não só cor** (R17.6):
 *   o botão selecionado combina (a) `aria-pressed="true"` para leitores de tela,
 *   (b) um indicador textual visível ("● Selecionado") e (c) borda mais espessa
 *   e peso de fonte maior. A cor é apenas reforço, nunca o único sinal.
 * - **Operável por teclado com foco visível** (R17.2): são `<button>` reais, logo
 *   focáveis e acionáveis por Enter/Espaço; um contorno de foco visível é aplicado
 *   via `:focus-visible` (ver `focusStyleId`).
 *
 * Fonte dos modos: `MODOS_SUPORTADOS` de `@/lib/match` (conjunto fechado de três),
 * garantindo que a UI ofereça apenas os três modos suportados (R2.4) e na ordem
 * de apresentação definida pelo design.
 *
 * _Requirements: 1.1, 1.2, 1.3, 17.2, 17.3, 17.6_
 */

import type { ReactNode } from 'react';
import { MODOS_SUPORTADOS, type ModoAdversario } from '@/lib/match';

/**
 * Rótulos textuais exibidos em cada botão, na ordem exata exigida por R1.1.
 * Mapa fechado sobre `ModoAdversario` — o compilador exige um rótulo por modo.
 */
const ROTULOS: Readonly<Record<ModoAdversario, string>> = {
  bot_aleatorio: 'Bot aleatório',
  desafiar_curti: 'Desafiar Curti',
  importar_seed: 'Importar seed',
};

export interface SeletorModoProps {
  /** Modo atualmente selecionado, ou `null` quando nenhum foi escolhido ainda. */
  readonly selected: ModoAdversario | null;
  /** Chamado ao acionar um dos três botões, com o modo correspondente (R1.2). */
  readonly onSelect: (modo: ModoAdversario) => void;
}

/**
 * Identificador do bloco de estilos de foco visível injetado uma única vez.
 * `:focus-visible` não é expressável por estilo inline; um `<style>` escopado por
 * `data-pfl-seletor-modo` garante o indicador de foco (R17.2) sem CSS global.
 */
const FOCUS_STYLE_ID = 'pfl-seletor-modo-focus';

const FOCUS_STYLE = `
[data-pfl-seletor-modo] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

export function SeletorModo({ selected, onSelect }: SeletorModoProps): ReactNode {
  return (
    <div data-pfl-seletor-modo>
      {/* Indicador de foco visível (R17.2): escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <fieldset
        style={{
          border: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        <legend
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            marginBottom: '0.75rem',
            padding: 0,
          }}
        >
          Escolha o adversário
        </legend>

        <div
          role="group"
          aria-label="Modo de adversário"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          {MODOS_SUPORTADOS.map((modo) => {
            const isSelected = selected === modo;
            return (
              <button
                key={modo}
                type="button"
                // Transmite a seleção a leitores de tela (R17.6, 1º recurso).
                aria-pressed={isSelected}
                onClick={() => onSelect(modo)}
                style={{
                  // Alvo grande (R17.3): área ampla, texto legível.
                  flex: '1 1 12rem',
                  minHeight: '5rem',
                  padding: '1rem 1.25rem',
                  fontSize: '1.0625rem',
                  // 2º recurso visual: peso de fonte reforça a seleção.
                  fontWeight: isSelected ? 700 : 500,
                  // 3º recurso visual: borda mais espessa quando selecionado.
                  border: isSelected ? '3px solid #1a1a1a' : '1px solid #8a8a8a',
                  borderRadius: '0.5rem',
                  // Cor é apenas reforço, nunca o único sinal (R17.6).
                  background: isSelected ? '#eef3ff' : '#ffffff',
                  color: '#1a1a1a',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.375rem',
                }}
              >
                <span>{ROTULOS[modo]}</span>
                {/* Indicador textual visível de seleção (R17.6, recurso independente de cor). */}
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: '0.8125rem',
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

        {/* Exibe a seleção corrente antes da confirmação (R1.3), de forma textual
            e rastreável — não depende de cor. */}
        <p
          aria-live="polite"
          style={{ marginTop: '0.75rem', fontSize: '0.9375rem' }}
        >
          {selected === null
            ? 'Nenhum adversário selecionado.'
            : `Adversário selecionado: ${ROTULOS[selected]}.`}
        </p>
      </fieldset>
    </div>
  );
}
