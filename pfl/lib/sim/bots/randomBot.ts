/**
 * Bot aleatório — sorteia 1 dos 4 presets (`lib/sim/bots/randomBot.ts`).
 *
 * Modo "Aleatório" (R12.2). Na **inicialização**, sorteia **exatamente um** dos
 * quatro presets do `Catalogo_Jogadas` de estilos (BALANCED, GROUND, AERIAL,
 * CURTI) usando o `Gerador_RNG` compartilhado e, a partir daí, delega toda a
 * seleção de jogada à `PlayPolicy` situacional desse preset (via
 * `presetPolicy`). O preset escolhido é fixo pelo resto da partida — o sorteio
 * acontece uma única vez, na construção da política.
 *
 * Consumo de RNG (determinístico e documentado):
 * - **Exatamente um** `rng.nextInt(0, 3)` é consumido no momento da
 *   inicialização (`createRandomBotPolicy`), mapeando o inteiro `[0, 3]` para o
 *   preset de mesmo índice em `RANDOM_PRESET_POOL`. Como o RNG é a única fonte
 *   de entropia (R1.2) e é compartilhado/semeado pelo `Seed_RNG`, o sorteio é
 *   reproduzível byte a byte: mesmo seed + mesma ordem de criação ⇒ mesmo
 *   preset.
 * - Após o sorteio, cada `choosePlay` consome o RNG exatamente como qualquer
 *   outra `PlayPolicy` situacional (um `nextFloat()` só quando há mais de uma
 *   opção com peso positivo), na ordem fixa O→D imposta pelo pipeline.
 *
 * Restrição ao catálogo (R12.2): a política resultante é a de `presetPolicy`,
 * que reusa `createSituationalPolicy` de `play/select.ts`; nenhuma jogada fora
 * das 18 do `Catalogo_Jogadas` é jamais produzida.
 *
 * Sem vantagem oculta (R12.1): o bot roda sob o mesmo motor, RNG, Fadiga e
 * Esfera que o jogador; não há atributos ocultos nem leitura do estado oculto
 * do adversário — a `PlayPolicy` só enxerga o `PlaySelectionContext` público.
 *
 * Pureza: sem I/O, rede, relógio de sistema ou entropia externa. Toda
 * aleatoriedade vem do `Rng` injetado.
 *
 * _Requirements: 12.2_
 */

import type { Rng } from '../rng';
import type { Preset } from '../types';
import { presetPolicy, type PlayPolicy } from './policy';

/**
 * Pool canônico e ordenado dos quatro presets sorteáveis pelo modo aleatório. A
 * ordem é fixa e determinística: o inteiro sorteado em `[0, 3]` indexa este
 * array, de modo que o mapeamento sorteio→preset é estável entre plataformas.
 */
export const RANDOM_PRESET_POOL: readonly Preset[] = [
  'BALANCED',
  'GROUND',
  'AERIAL',
  'CURTI',
] as const;

/**
 * Sorteia **exatamente um** preset do `RANDOM_PRESET_POOL` consumindo um único
 * `rng.nextInt(0, 3)`. Função isolada para tornar o único ponto de consumo de
 * RNG do modo aleatório explícito e testável.
 *
 * @param rng Gerador_RNG determinístico compartilhado (única fonte de entropia).
 * @returns O `Preset` sorteado (um dos quatro).
 */
export function drawRandomPreset(rng: Rng): Preset {
  // RNG consume #1 (modo aleatório): sorteia o índice do preset em [0, 3],
  // inteiro uniforme sem viés de módulo. Único consumo de RNG na inicialização.
  const index = rng.nextInt(0, RANDOM_PRESET_POOL.length - 1);
  return RANDOM_PRESET_POOL[index]!;
}

/**
 * Resultado da inicialização do bot aleatório: a política situacional pronta
 * para o pipeline e o `preset` efetivamente sorteado (para log/auditoria).
 */
export interface RandomBotPolicy {
  /** `PlayPolicy` situacional do preset sorteado (restrita ao catálogo). */
  readonly policy: PlayPolicy;
  /** Preset efetivamente sorteado na inicialização. */
  readonly preset: Preset;
}

/**
 * Cria a `PlayPolicy` do modo aleatório: sorteia um preset na inicialização
 * (consumindo um único `rng.nextInt`) e devolve a `PlayPolicy` situacional
 * correspondente, junto do preset sorteado para registro no log.
 *
 * @param rng Gerador_RNG determinístico compartilhado.
 * @returns `{ policy, preset }` com a política situacional e o preset sorteado.
 */
export function createRandomBotPolicy(rng: Rng): RandomBotPolicy {
  const preset = drawRandomPreset(rng);
  return { policy: presetPolicy(preset), preset };
}
