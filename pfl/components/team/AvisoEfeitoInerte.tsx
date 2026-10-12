'use client';

/**
 * `AvisoEfeitoInerte` (`components/team/AvisoEfeitoInerte.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.3.
 *
 * Componente de **apresentação** (burro): renderiza um aviso **visível e não
 * bloqueante** de efeito inerte — um golpe/habilidade equipável, porém sem regra
 * executável no motor (sem bônus esportivo). O jogador pode mantê-lo; o aviso
 * nunca impede salvar/exportar (R8.1/R8.3).
 *
 * O elemento recebe um `id` estável para que a {@link FichaAtleta} o associe por
 * `aria-describedby` ao controle (seletor de habilidade ou de golpe) que o
 * originou (R17.7). Usa `role="note"` para expor o aviso à tecnologia assistiva
 * sem interromper o fluxo, e reforça o estado por mais de um recurso visual
 * (ícone textual + borda + rótulo "Aviso"), nunca só por cor (R17.4/R17.6).
 *
 * _Requirements: 8.1, 8.3_
 */

import type { ReactNode } from 'react';

export interface AvisoEfeitoInerteProps {
  /** Mensagem específica do aviso (produzida pelo motor de validação, R17.6). */
  readonly message: string;
  /** `id` estável do elemento, para associação por `aria-describedby` (R17.7). */
  readonly id?: string;
}

export function AvisoEfeitoInerte({
  message,
  id,
}: AvisoEfeitoInerteProps): ReactNode {
  return (
    <p
      id={id}
      role="note"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        margin: '0.5rem 0 0',
        padding: '0.625rem 0.875rem',
        border: '2px dashed #5a4a00',
        borderRadius: '0.5rem',
        background: '#fffbe6',
        color: '#4a3d00',
        fontSize: '0.9375rem',
      }}
    >
      {/* Ícone textual (não apenas cor) sinaliza o tipo de aviso (R17.4). */}
      <span aria-hidden="true">⚠</span>
      <span>
        {/* Prefixo textual reforça o estado além da cor/borda (R17.6). */}
        <strong>Efeito inerte:</strong> {message}
      </span>
    </p>
  );
}
