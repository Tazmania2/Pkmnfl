'use client';

/**
 * `AvisoAnatomico` (`components/team/AvisoAnatomico.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.2.
 *
 * Componente de **apresentação** (burro): exibe um {@link AnatomyFinding}
 * quando a função esportiva essencial da posição não é fisicamente cumprível
 * pela espécie, conforme as convenções de `ANATOMY_DECISIONS_FINAL.md` (R5.3).
 * O aviso é **informativo e nunca bloqueante**: o jogador decide **manter** ou
 * **alterar** a atribuição — por isso o componente oferece dois controles
 * opcionais (`onKeep`/`onChange`), sem jamais impedir a atribuição em si.
 *
 * O `finding` é derivado a montante por `anatomyWarning(pokemonId, position)`
 * em `lib/anatomy` (Task 3.1). Quando `null`, nada é renderizado.
 *
 * Acessibilidade / anti-slop (R17.6):
 * - `role="status"` + `aria-live="polite"` para anunciar o aviso ao surgir.
 *   Prefixo textual "Aviso anatômico:" reforça o estado além da cor; a função
 *   essencial não cumprível e o motivo legível são expostos no texto. Controles
 *   são `<button>` reais, operáveis por teclado, com rótulos explícitos.
 *
 * _Requirements: 5.3_
 */

import type { ReactNode } from 'react';
import type { AnatomyFinding } from '@/lib/anatomy';

export interface AvisoAnatomicoProps {
  /** Achado anatômico a exibir, ou `null`/ausente quando não há limitação. */
  readonly finding: AnatomyFinding | null;
  /** `id` opcional para associação por `aria-describedby` (11.2). */
  readonly id?: string;
  /** Quando presente, renderiza o controle "Manter mesmo assim" (R5.3). */
  readonly onKeep?: () => void;
  /** Quando presente, renderiza o controle "Alterar atribuição" (R5.3). */
  readonly onChange?: () => void;
}

const FOCUS_STYLE_ID = 'pfl-aviso-anatomico-focus';

const FOCUS_STYLE = `
[data-pfl-aviso-anatomico] button:focus-visible {
  outline: 3px solid #5a3d00;
  outline-offset: 2px;
}
`;

export function AvisoAnatomico({
  finding,
  id,
  onKeep,
  onChange,
}: AvisoAnatomicoProps): ReactNode {
  if (finding === null) {
    return null;
  }

  const temAcoes = Boolean(onKeep) || Boolean(onChange);

  return (
    <div
      data-pfl-aviso-anatomico
      id={id}
      role="status"
      aria-live="polite"
      style={{
        margin: '0.5rem 0 0',
        padding: '0.625rem 0.875rem',
        border: '2px solid #8a5a00',
        borderRadius: '0.5rem',
        background: '#fff6e5',
        color: '#5a3d00',
        fontSize: '0.875rem',
        lineHeight: 1.4,
      }}
    >
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <p style={{ margin: 0 }}>
        {/* Prefixo textual reforça o estado além da cor (R17.6). */}
        <strong>Aviso anatômico:</strong> em {finding.position}, a função
        essencial de {finding.essentialFunction} pode não ser cumprida —{' '}
        {finding.reason}. A atribuição continua permitida.
      </p>

      {temAcoes ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginTop: '0.5rem',
          }}
        >
          {onKeep ? (
            <button
              type="button"
              onClick={onKeep}
              style={{
                minHeight: '2.5rem',
                padding: '0.5rem 0.875rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                border: '1px solid #8a5a00',
                borderRadius: '0.375rem',
                background: '#ffffff',
                color: '#5a3d00',
                cursor: 'pointer',
              }}
            >
              Manter mesmo assim
            </button>
          ) : null}
          {onChange ? (
            <button
              type="button"
              onClick={onChange}
              style={{
                minHeight: '2.5rem',
                padding: '0.5rem 0.875rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                border: '2px solid #5a3d00',
                borderRadius: '0.375rem',
                background: '#ffffff',
                color: '#5a3d00',
                cursor: 'pointer',
              }}
            >
              Alterar atribuição
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
