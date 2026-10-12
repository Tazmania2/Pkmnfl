/**
 * Bot Curti — preset CURTI (`lib/sim/bots/curtiBot.ts`).
 *
 * Modo "Curti" (R12.3). Usa **sempre** o preset `CURTI` com seu perfil tático
 * documentado em `PRESET_PROFILES.CURTI` (agressivo, levemente inclinado ao
 * passe e a jogadas de risco — passe profundo e play action). A política é
 * fixa: não há sorteio de preset na inicialização.
 *
 * Sem atributos extras (R12.3, R12.1): o bot Curti NÃO recebe atributos
 * ocultos, bônus de atributos nem qualquer vantagem fora do catálogo. O que
 * distingue o modo Curti é apenas o `Strategy.preset = 'CURTI'` e seus pesos
 * situacionais — o motor de seleção, o consumo de RNG e a restrição ao
 * `Catalogo_Jogadas` são idênticos aos de qualquer outra `PlayPolicy`. A
 * política só enxerga o `PlaySelectionContext` público; nunca lê o estado
 * oculto do adversário.
 *
 * Consumo de RNG: nenhum consumo na inicialização (preset fixo). Cada
 * `choosePlay` consome um único `rng.nextFloat()` apenas quando há mais de uma
 * opção com peso positivo, na ordem fixa O→D imposta pelo pipeline.
 *
 * Fonte única da verdade: delega a `presetPolicy('CURTI')`, que reusa
 * `createSituationalPolicy` de `play/select.ts` — sem duplicar a lógica de
 * seleção nem o perfil do preset.
 *
 * Pureza: sem I/O, rede, relógio de sistema ou entropia externa. Toda
 * aleatoriedade vem do `Rng` injetado em `choosePlay`.
 *
 * _Requirements: 12.3_
 */

import { presetPolicy, type PlayPolicy } from './policy';

/** Preset fixo do modo Curti. */
export const CURTI_BOT_PRESET = 'CURTI' as const;

/**
 * Cria a `PlayPolicy` do modo Curti: a política situacional do preset `CURTI`,
 * sem atributos extras e restrita ao catálogo. Não consome RNG na construção.
 *
 * @returns A `PlayPolicy` pura e determinística do preset CURTI.
 */
export function createCurtiBotPolicy(): PlayPolicy {
  return presetPolicy(CURTI_BOT_PRESET);
}
