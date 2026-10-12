'use client';

/**
 * `SeletorOrigem` (`components/team/SeletorOrigem.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.1.
 *
 * Componente de **apresentação** (burro): oferece o ponto de partida da
 * montagem do time. Renderiza um controle rotulado "Usar preset" que expõe os
 * quatro `preset_id` suportados (`balanced`, `ground`, `aerial`, `curti`) e um
 * controle rotulado "Começar do zero" (R1.1). Acionar um preset chama
 * `onUsePreset(presetId)`; acionar "Começar do zero" chama `onStartEmpty()`. A
 * orquestração (página/store, tarefas 8.4/11.1) é quem efetivamente carrega o
 * Roster — este componente não guarda estado nem lógica de store.
 *
 * Anti-slop / acessibilidade (R17.2, R17.3 — passagem completa em 11.2):
 * - `<button>` reais, operáveis por teclado (Enter/Espaço) e foco visível via
 *   `:focus-visible` escopado, sem CSS global.
 * - Alvos amplos com rótulo textual explícito; nada depende só de cor.
 *
 * As definições de preset (ids e rótulos legíveis) são o conjunto fechado do
 * design ("Preset"), garantindo que a UI ofereça exatamente os quatro presets.
 *
 * _Requirements: 1.1, 1.2, 1.3_
 */

import type { ReactNode } from 'react';
import type { PresetId } from '@/lib/team/model';

/**
 * Rótulos legíveis de cada `preset_id`, na ordem de apresentação do design.
 * Mapa fechado sobre `PresetId` — o compilador exige um rótulo por preset.
 */
const ROTULOS_PRESET: Readonly<Record<PresetId, string>> = {
  balanced: 'Equilibrado Kanto',
  ground: 'Trincheira de Kanto',
  aerial: 'Domínio Aéreo',
  curti: 'Time do Curti',
};

/** Ordem canônica de apresentação dos presets (conjunto fechado). */
const ORDEM_PRESETS: readonly PresetId[] = [
  'balanced',
  'ground',
  'aerial',
  'curti',
] as const;

export interface SeletorOrigemProps {
  /** Chamado ao acionar um preset, com o `preset_id` escolhido (R1.3). */
  readonly onUsePreset: (presetId: PresetId) => void;
  /** Chamado ao acionar "Começar do zero" (R1.2). */
  readonly onStartEmpty: () => void;
}

/**
 * Identificador e bloco de estilos de foco visível injetado uma única vez.
 * `:focus-visible` não é expressável por estilo inline; um `<style>` escopado
 * por `data-pfl-seletor-origem` garante o indicador de foco sem CSS global.
 */
const FOCUS_STYLE_ID = 'pfl-seletor-origem-focus';

const FOCUS_STYLE = `
[data-pfl-seletor-origem] button:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

export function SeletorOrigem({
  onUsePreset,
  onStartEmpty,
}: SeletorOrigemProps): ReactNode {
  return (
    <div data-pfl-seletor-origem>
      {/* Indicador de foco visível: escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            marginBottom: '0.75rem',
            padding: 0,
          }}
        >
          Como começar o time
        </legend>

        {/* Controle "Usar preset": um botão por `preset_id` (R1.1/R1.3). */}
        <div
          role="group"
          aria-label="Usar preset"
          style={{ marginBottom: '1rem' }}
        >
          <p
            id="pfl-origem-preset-label"
            style={{ fontSize: '0.9375rem', fontWeight: 600, margin: '0 0 0.5rem' }}
          >
            Usar preset
          </p>
          <div
            aria-labelledby="pfl-origem-preset-label"
            role="group"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}
          >
            {ORDEM_PRESETS.map((presetId) => (
              <button
                key={presetId}
                type="button"
                onClick={() => onUsePreset(presetId)}
                style={{
                  flex: '1 1 10rem',
                  minHeight: '4rem',
                  padding: '0.875rem 1.125rem',
                  fontSize: '1rem',
                  fontWeight: 500,
                  border: '1px solid #8a8a8a',
                  borderRadius: '0.5rem',
                  background: '#ffffff',
                  color: '#1a1a1a',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {ROTULOS_PRESET[presetId]}
              </button>
            ))}
          </div>
        </div>

        {/* Controle "Começar do zero" (R1.1/R1.2). */}
        <button
          type="button"
          onClick={onStartEmpty}
          style={{
            minHeight: '3.5rem',
            padding: '0.875rem 1.25rem',
            fontSize: '1rem',
            fontWeight: 600,
            border: '2px solid #1a1a1a',
            borderRadius: '0.5rem',
            background: '#ffffff',
            color: '#1a1a1a',
            cursor: 'pointer',
          }}
        >
          Começar do zero
        </button>
      </fieldset>
    </div>
  );
}
