/**
 * Mapeamento modo → bot (`lib/match/modo.ts`) — spec `pfl-gameday-result-ui`.
 *
 * Converte o `Modo_Adversario` escolhido na Tela_Game_Day no `BotMode` que o
 * motor espera, e expõe o conjunto fechado dos modos ofertados. É a tradução
 * pura exigida pelo Requirement 2: cada modo aciona exatamente o bot
 * correspondente do motor, e nenhum modo fora dos três suportados é ofertável
 * (design → "Mapeamento modo → bot").
 *
 * Princípios refletidos:
 * - **Função pura e total** (Property 1): `modoParaBot` é definida para todos os
 *   valores de `ModoAdversario`. Como `ModoAdversario` é um tipo-união fechado
 *   nos três modos, o `switch` cobre o domínio inteiro e o compilador rejeita a
 *   adição de um modo sem o caso correspondente.
 * - **Contratos reusados, nunca redefinidos**: `ModoAdversario` vem de `./types`
 *   e `BotMode` de `./contracts` (reexport de `@/lib/sim/types`); nada é copiado.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4_
 */

import type { ModoAdversario } from './types';
import type { BotMode } from './contracts';

/**
 * O conjunto fechado dos três `Modo_Adversario` ofertados pela Tela_Game_Day,
 * com cardinalidade exatamente três (R2.4). A ordem reflete a apresentação dos
 * botões (R1.1): "Bot aleatório", "Desafiar Curti", "Importar seed". É a única
 * fonte de modos selecionáveis — nenhum modo fora desta lista é construível.
 */
export const MODOS_SUPORTADOS: readonly ModoAdversario[] = [
  'bot_aleatorio',
  'desafiar_curti',
  'importar_seed',
] as const;

/**
 * Traduz um `Modo_Adversario` no `BotMode` do motor, de forma pura e total
 * sobre os três modos suportados (R2.4):
 *
 * - `bot_aleatorio`  → `'random'` — Bot aleatório do motor (R2.1)
 * - `desafiar_curti` → `'curti'`  — Bot Curti, baseado no preset CURTI (R2.2)
 * - `importar_seed`  → `'seeded'` — Bot de seed de terceiros (R2.3)
 *
 * Nenhuma entrada fora do tipo fechado `ModoAdversario` é representável; o
 * `switch` é exaustivo e o caso `never` garante, em tempo de compilação, que
 * qualquer novo modo exija tratamento explícito.
 */
export function modoParaBot(modo: ModoAdversario): BotMode {
  switch (modo) {
    case 'bot_aleatorio':
      return 'random';
    case 'desafiar_curti':
      return 'curti';
    case 'importar_seed':
      return 'seeded';
    default: {
      // Exaustividade: inatingível enquanto `ModoAdversario` for a união fechada
      // dos três modos. Mantido para falhar a compilação se um modo for adicionado
      // sem o mapeamento correspondente.
      const _exhaustive: never = modo;
      return _exhaustive;
    }
  }
}
