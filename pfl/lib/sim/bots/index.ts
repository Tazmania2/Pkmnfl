/**
 * Dispatcher dos modos de bot (`lib/sim/bots/index.ts`).
 *
 * Expõe os **três** modos de bot suportados (`'random' | 'curti' | 'seeded'`,
 * `BotMode`) por trás de uma única fábrica `botPolicy`, reusando as fábricas de
 * cada módulo (`randomBot`, `curtiBot`, `seededBot`) sem duplicar lógica. É a
 * camada que a orquestração usa para obter a `PlayPolicy` do controlador de um
 * time quando esse controlador é um bot.
 *
 * Mapeamento (ver design, "Bots"):
 * - `'random'` → sorteia 1 dos 4 presets na inicialização (consome um
 *   `rng.nextInt`) e usa sua `PlayPolicy` situacional.
 * - `'curti'`  → preset `CURTI` fixo, sem atributos extras (sem consumo de RNG
 *   na inicialização).
 * - `'seeded'` → preset padrão `BALANCED` sobre o time importado preservado
 *   (sem consumo de RNG na inicialização; a escalação não é modificada).
 *
 * Rejeição de modo não suportado (R12.6): `botPolicy` lança `UnsupportedBotModeError`
 * para qualquer `BotMode` fora dos três acima. A mensagem de erro **voltada ao
 * usuário** ("modo inválido") e a preservação de estado são responsabilidade do
 * **adaptador** (Task 17); aqui a política apenas sinaliza, de forma pura e
 * determinística, que o modo não é suportado. A validação da seed de terceiros
 * inválida (R12.5) também é do adaptador — a política só expõe os três modos.
 *
 * Pureza: sem I/O, rede, relógio de sistema ou entropia externa. O único
 * consumo de RNG na inicialização ocorre no modo `'random'`.
 *
 * _Requirements: 12.2, 12.3, 12.4_
 */

import type { Rng } from '../rng';
import type { BotMode } from '../types';
import type { PlayPolicy } from './policy';
import { createRandomBotPolicy } from './randomBot';
import { createCurtiBotPolicy } from './curtiBot';
import { createSeededBotPolicy } from './seededBot';

// Reexporta as fábricas e constantes de cada modo para um ponto único de acesso.
export {
  createRandomBotPolicy,
  drawRandomPreset,
  RANDOM_PRESET_POOL,
  type RandomBotPolicy,
} from './randomBot';
export { createCurtiBotPolicy, CURTI_BOT_PRESET } from './curtiBot';
export {
  createSeededBotPolicy,
  preserveImportedLineup,
  SEEDED_BOT_DEFAULT_PRESET,
} from './seededBot';
export type { PlayPolicy } from './policy';

/** Os três modos de bot efetivamente suportados pela política. */
export const SUPPORTED_BOT_MODES: readonly BotMode[] = [
  'random',
  'curti',
  'seeded',
] as const;

/**
 * Erro de modo de bot não suportado. É lançado pela política pura; o adaptador
 * (Task 17) o traduz na resposta voltada ao usuário ("modo inválido", R12.6) e
 * preserva o estado sem iniciar a partida.
 */
export class UnsupportedBotModeError extends Error {
  readonly mode: string;

  constructor(mode: string) {
    super(`Unsupported bot mode: ${mode}`);
    this.name = 'UnsupportedBotModeError';
    this.mode = mode;
  }
}

/**
 * Dispatcher dos modos de bot: devolve a `PlayPolicy` do modo pedido.
 *
 * - `'random'`: consome um único `rng.nextInt(0, 3)` para sortear o preset na
 *   inicialização; por isso exige o `Rng` compartilhado.
 * - `'curti'` e `'seeded'`: não consomem RNG na inicialização (preset fixo);
 *   `rng` é opcional e ignorado nesses modos.
 *
 * Para qualquer outro valor, lança `UnsupportedBotModeError` (R12.6) — a
 * tradução para a resposta ao usuário fica a cargo do adaptador.
 *
 * @param mode Modo de bot (`'random' | 'curti' | 'seeded'`).
 * @param rng  Gerador_RNG compartilhado (obrigatório para `'random'`).
 * @returns A `PlayPolicy` situacional do modo.
 */
export function botPolicy(mode: BotMode, rng?: Rng): PlayPolicy {
  switch (mode) {
    case 'random': {
      if (!rng) {
        throw new TypeError("bot mode 'random' requires a shared Rng");
      }
      return createRandomBotPolicy(rng).policy;
    }
    case 'curti':
      return createCurtiBotPolicy();
    case 'seeded':
      return createSeededBotPolicy();
    default:
      // Modo fora dos três suportados: sinaliza de forma pura (R12.6). O
      // adaptador traduz em "modo inválido" e preserva o estado.
      throw new UnsupportedBotModeError(mode as string);
  }
}
