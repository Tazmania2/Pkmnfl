import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { modoParaBot, MODOS_SUPORTADOS } from './modo';
import type { ModoAdversario } from './types';
import type { BotMode } from './contracts';

/**
 * Teste de propriedade do mapeamento modo → bot (`lib/match/modo.ts`, Task 2.2).
 *
 * // Feature: pfl-gameday-result-ui, Property 1: Mapeamento modo → bot é total e correto
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 *
 * Para todo `Modo_Adversario` em `MODOS_SUPORTADOS`, `modoParaBot` é definido e
 * retorna exatamente o `BotMode` correspondente
 * (`bot_aleatorio`→`random`, `desafiar_curti`→`curti`, `importar_seed`→`seeded`),
 * e o conjunto de modos ofertados tem cardinalidade exatamente três e distintos —
 * nenhum modo fora desses é construível ou mapeável.
 *
 * A estratégia gera modos exclusivamente de `MODOS_SUPORTADOS` via
 * `fc.constantFrom`, de forma que o espaço de entrada é precisamente o domínio
 * fechado do tipo `ModoAdversario`.
 */

/** Mapeamento esperado modo → bot, independente da implementação sob teste. */
const MAPEAMENTO_ESPERADO: Readonly<Record<ModoAdversario, BotMode>> = {
  bot_aleatorio: 'random',
  desafiar_curti: 'curti',
  importar_seed: 'seeded',
};

describe('modoParaBot — Property 1: mapeamento modo → bot é total e correto', () => {
  it('é total e correto sobre todos os modos suportados', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ModoAdversario>(...MODOS_SUPORTADOS),
        (modo) => {
          const bot = modoParaBot(modo);
          // Totalidade: sempre retorna um dos três BotMode válidos.
          expect(['random', 'curti', 'seeded']).toContain(bot);
          // Correção: cada modo mapeia exatamente para o bot correspondente.
          expect(bot).toBe(MAPEAMENTO_ESPERADO[modo]);
        },
      ),
    );
  });

  it('MODOS_SUPORTADOS tem cardinalidade exatamente três e valores distintos', () => {
    expect(MODOS_SUPORTADOS).toHaveLength(3);
    expect(new Set(MODOS_SUPORTADOS).size).toBe(3);
  });

  it('cobre precisamente os três modos esperados', () => {
    expect(new Set(MODOS_SUPORTADOS)).toEqual(
      new Set<ModoAdversario>(['bot_aleatorio', 'desafiar_curti', 'importar_seed']),
    );
  });
});
