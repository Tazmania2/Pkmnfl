/**
 * Interface `PlayPolicy` + presets de bot (`lib/sim/bots/policy.ts`).
 *
 * Fase (a) do pipeline do ponto de vista dos **bots** (ver design, "Bots"). Este
 * módulo é a camada fina que os três modos de bot (`randomBot`, `curtiBot`,
 * `seededBot` — Task 15.2) compartilham: ele reusa integralmente o motor de
 * seleção situacional de `play/select.ts` e apenas declara, de forma explícita e
 * documentada, o **perfil tático de cada preset** (BALANCED, GROUND, AERIAL,
 * CURTI).
 *
 * Invariante central (R12.1): **todo bot roda sob o mesmo motor, as mesmas
 * regras, o mesmo `Gerador_RNG`, a mesma Fadiga e a mesma Esfera_Supressao** que
 * o time do jogador. Um bot NÃO recebe atributos ocultos, bônus de atributos nem
 * leitura do estado oculto do adversário. A `PlayPolicy` recebe **apenas** o
 * `PlaySelectionContext` (situação pública: down, distância, posição no campo,
 * relógio, clima, fadiga compartilhada e posse), o `PlayCatalog` (as 18 jogadas)
 * e o `Rng` compartilhado. Não há parâmetro que exponha a escalação, os atributos
 * ou a jogada escolhida pelo adversário — por construção, a política é cega ao
 * estado oculto do oponente. A única diferença entre um bot e o jogador é o
 * `Strategy.preset` escolhido; o motor de pesos, o consumo de RNG e a restrição
 * ao catálogo são idênticos (R4.3, R12.2, R12.7).
 *
 * Fonte única da verdade: a interface `PlayPolicy`, o `PlaySelectionContext`, o
 * `PlayCatalog`, o sorteio ponderado e a fábrica `createSituationalPolicy` vivem
 * em `play/select.ts`. Este módulo **reexporta** esses contratos (sem redeclarar)
 * e constrói os perfis de preset sobre o MESMO `PRESET_RUN_PASS_BIAS` que
 * `select.ts` aplica internamente, evitando qualquer divergência entre a seleção
 * efetiva e a documentação dos presets.
 *
 * Pureza (fronteira de arquitetura): sem I/O, rede, relógio de sistema ou
 * entropia externa. Toda aleatoriedade vem do `Rng` injetado.
 *
 * _Requirements: 12.1_
 */

import type { Preset, Strategy } from '../types';
import {
  createSituationalPolicy,
  PRESET_RUN_PASS_BIAS,
} from '../play/select';

// ---------------------------------------------------------------------------
// Reexport dos contratos canônicos (ÚNICA fonte da verdade: play/select.ts)
// ---------------------------------------------------------------------------

// A `PlayPolicy`, o contexto de seleção, o catálogo e o sorteio ponderado NÃO são
// redeclarados aqui: são reexportados de `play/select.ts` para que bots e jogador
// compartilhem exatamente o mesmo contrato (R12.1).
export type {
  PlayPolicy,
  PlaySelectionContext,
  PlayCatalog,
  WeightedCandidate,
} from '../play/select';

export {
  PLAY_CATALOG,
  OFFENSIVE_PLAYS,
  DEFENSIVE_PLAYS,
  SPECIAL_TEAMS_PLAYS,
  isInCatalog,
  weightedChoice,
  chooseOffense,
  chooseDefense,
  createSituationalPolicy,
} from '../play/select';

// ---------------------------------------------------------------------------
// Perfis táticos por preset (BALANCED, GROUND, AERIAL, CURTI)
// ---------------------------------------------------------------------------

/**
 * Perfil tático documentado de um preset. Descreve, em termos legíveis, como o
 * preset inclina a seleção situacional de jogadas. O `bias` é o MESMO objeto de
 * viés corrida/passe aplicado por `play/select.ts` (reusado, não duplicado), de
 * modo que o perfil aqui descrito corresponde exatamente ao comportamento real
 * do motor de seleção. `playWeights` são ajustes explícitos opcionais por jogada
 * que o preset adiciona por cima do viés situacional (multiplicam o peso; `0`
 * remove a jogada do sorteio positivo), sempre restritos ao `Catalogo_Jogadas`.
 */
export interface PresetProfile {
  readonly preset: Preset;
  /** Descrição legível do estilo do preset (para log/documentação). */
  readonly description: string;
  /** Viés corrida/passe reusado de `play/select.ts` (fonte única da verdade). */
  readonly bias: { readonly run: number; readonly pass: number };
  /** Ajustes explícitos por jogada do preset (opcional; nomes do catálogo). */
  readonly playWeights?: Readonly<Record<string, number>>;
}

/**
 * Mapa canônico dos quatro perfis de preset. Cada perfil reusa o `bias` de
 * `PRESET_RUN_PASS_BIAS` (de `play/select.ts`) como fonte única da verdade do
 * viés tático; `playWeights` adiciona apenas inclinações explícitas opcionais
 * sobre jogadas específicas do catálogo.
 *
 * - BALANCED: neutro, sem viés nem ajustes por jogada.
 * - GROUND: forte viés de corrida; favorece as duas corridas do catálogo.
 * - AERIAL: forte viés de passe; favorece passes curto/intermediário/profundo.
 * - CURTI: perfil agressivo, levemente inclinado ao passe e a jogadas de risco
 *   (passe profundo e play action), sem qualquer vantagem oculta.
 */
export const PRESET_PROFILES: Readonly<Record<Preset, PresetProfile>> =
  Object.freeze({
    BALANCED: {
      preset: 'BALANCED',
      description:
        'Equilíbrio corrida/passe; sem inclinação explícita por jogada.',
      bias: PRESET_RUN_PASS_BIAS.BALANCED,
    },
    GROUND: {
      preset: 'GROUND',
      description:
        'Jogo de chão: prioriza corridas (inside/outside) e defesas de corrida.',
      bias: PRESET_RUN_PASS_BIAS.GROUND,
      playWeights: Object.freeze({
        O_RUN_INSIDE: 1.3,
        O_RUN_OUTSIDE: 1.3,
      }),
    },
    AERIAL: {
      preset: 'AERIAL',
      description:
        'Jogo aéreo: prioriza passes (curto/intermediário/profundo) e defesas de passe.',
      bias: PRESET_RUN_PASS_BIAS.AERIAL,
      playWeights: Object.freeze({
        O_PASS_SHORT: 1.2,
        O_PASS_INTERMEDIATE: 1.3,
        O_PASS_DEEP: 1.2,
      }),
    },
    CURTI: {
      preset: 'CURTI',
      description:
        'Agressivo: leve inclinação ao passe e a jogadas de risco (passe profundo, play action).',
      bias: PRESET_RUN_PASS_BIAS.CURTI,
      playWeights: Object.freeze({
        O_PASS_DEEP: 1.25,
        O_PLAY_ACTION: 1.25,
      }),
    },
  });

/**
 * Monta a `Estrategia` canônica de um preset: o preset escolhido mais os
 * `playWeights` explícitos do perfil. É a `Strategy` que os bots (e o jogador)
 * entregam a `createSituationalPolicy` — o motor de seleção aplica o viés do
 * preset e multiplica pelos pesos explícitos, sempre dentro do catálogo.
 *
 * @param preset Preset de estilo (BALANCED, GROUND, AERIAL ou CURTI).
 * @returns `Strategy` imutável derivada do perfil do preset.
 */
export function presetStrategy(preset: Preset): Strategy {
  const profile = PRESET_PROFILES[preset];
  const strategy: Strategy = {
    preset,
    ...(profile.playWeights ? { playWeights: profile.playWeights } : {}),
  };
  return strategy;
}

/**
 * Conveniência: cria diretamente a `PlayPolicy` situacional de um preset, pronta
 * para ser injetada no pipeline. Delega a `createSituationalPolicy` de
 * `play/select.ts` com a `Strategy` do preset — garantindo que o bot use o mesmo
 * motor, o mesmo consumo de RNG e a mesma restrição ao catálogo do jogador
 * (R12.1, R12.7).
 *
 * @param preset Preset de estilo do bot.
 * @returns Uma `PlayPolicy` pura e determinística para o preset.
 */
export function presetPolicy(preset: Preset) {
  return createSituationalPolicy(presetStrategy(preset));
}
