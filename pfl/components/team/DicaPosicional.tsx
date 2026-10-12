'use client';

/**
 * `DicaPosicional` (`components/team/DicaPosicional.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.2.
 *
 * Componente de **apresentação** (burro): renderiza, de forma acessível, uma
 * {@link https://| Dica_Posicional} — o texto **orientador** específico ao par
 * (espécie, posição) exibido quando o jogador inicia a atribuição de um atleta
 * a um papel (R5.1). A dica é sempre **não bloqueante** (R5.2): este componente
 * apenas apresenta o texto; não há botão de ação, não impede atribuição.
 *
 * O texto é computado a montante por `positionalHint(pokemonId, position)` em
 * `lib/anatomy` (Task 3.1) e repassado via prop `hint` — este componente é
 * livre de lógica/IO e não reconhece espécie nem posição.
 *
 * Acessibilidade / anti-slop (R17.6):
 * - `role="note"` + `aria-live="polite"` para anunciar a dica quando aparece,
 *   sem roubar o foco. Prefixo textual "Dica:" reforça a natureza do conteúdo
 *   além de qualquer cor. Fica oculto (não renderiza nada) quando não há dica.
 *
 * _Requirements: 5.1, 5.2_
 */

import type { ReactNode } from 'react';

export interface DicaPosicionalProps {
  /**
   * Texto orientador do par (espécie, posição), já computado por
   * `positionalHint` em `lib/anatomy`. Quando vazio/ausente, nada é renderizado.
   */
  readonly hint: string;
  /**
   * `id` opcional para permitir que o controle de atribuição associe a dica por
   * `aria-describedby` (associação completa feita pela orquestração em 11.2).
   */
  readonly id?: string;
}

export function DicaPosicional({ hint, id }: DicaPosicionalProps): ReactNode {
  const texto = hint.trim();
  if (texto.length === 0) {
    return null;
  }

  return (
    <p
      id={id}
      role="note"
      aria-live="polite"
      style={{
        margin: '0.5rem 0 0',
        padding: '0.5rem 0.75rem',
        border: '1px solid #4a6fa5',
        borderLeft: '4px solid #4a6fa5',
        borderRadius: '0.375rem',
        background: '#eef3ff',
        color: '#1a2a40',
        fontSize: '0.875rem',
        lineHeight: 1.4,
      }}
    >
      {/* Prefixo textual sinaliza a natureza orientadora além da cor (R17.6). */}
      <strong>Dica:</strong> {texto}
    </p>
  );
}
