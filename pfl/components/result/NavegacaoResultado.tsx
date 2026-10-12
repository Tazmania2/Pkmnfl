'use client';

/**
 * `NavegacaoResultado` (`components/result/NavegacaoResultado.tsx`) —
 * Tela_Resultado, Task 15.1.
 *
 * Componente de apresentação com os **controles de navegação** da Tela_Resultado
 * (R15.1): um botão "Voltar ao Game Day" que navega para `/game-day` (R15.2) e um
 * botão "Editar time" que navega para `/time`, a tela Meu Time (R15.3). Usa
 * `useRouter()` de `next/navigation` para a navegação do App Router.
 *
 * Anti-slop (R17.1, R17.2, R17.3): ambos os controles são `<button>` reais com
 * rótulos textuais explícitos, operáveis por teclado e com indicador de foco
 * visível (via CSS do app). Nenhuma lógica de resultado vive aqui — apenas
 * navegação.
 *
 * _Requirements: 15.1, 15.2, 15.3_
 */

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Rota da Tela_Game_Day (R15.2). */
const ROTA_GAME_DAY = '/game-day';
/** Rota da tela Meu Time (R15.3). */
const ROTA_TIME = '/time';

/**
 * Renderiza os dois controles rotulados de navegação (R15.1). Ao acionar, dispara
 * `router.push` para a rota correspondente (R15.2, R15.3).
 */
export function NavegacaoResultado(): ReactNode {
  const router = useRouter();

  return (
    <nav aria-label="Navegação do resultado" className="navegacao-resultado">
      <button type="button" onClick={() => router.push(ROTA_GAME_DAY)}>
        Voltar ao Game Day
      </button>
      <button type="button" onClick={() => router.push(ROTA_TIME)}>
        Editar time
      </button>
    </nav>
  );
}
