import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createMatchStore } from './store';
import type { ModoAdversario } from './types';
import type { GameLog, Score, TeamDraft } from './contracts';

/**
 * Teste de propriedade: sucesso retém log/placar e avança (Task 8.6).
 *
 * // Feature: pfl-gameday-result-ui, Property 9: Sucesso retém log e placar e avança para a animação
 *
 * **Validates: Requirements 6.3**
 *
 * R6.3 — "WHEN a Funcao_Simulacao conclui com sucesso, THE Tela_Game_Day SHALL
 * receber e **reter** o Log_Partida e o Placar retornados." A store nunca
 * recalcula placar/estatística: ela trata `log`/`score` como **payloads
 * opacos** devolvidos pelo motor e os guarda **verbatim**
 * (`concluirSimulacao`, R6.3/R6.4).
 *
 * *Para toda* store avançada a `Simulando` (via `selecionarModo` →
 * `iniciarSimulacao`) e *para todo* par `log`/`score` arbitrário:
 *
 * - **transição** — `concluirSimulacao(log, score)` leva a FSM de `Simulando`
 *   para `Animando` (a única aresta que torna a Animacao_8bit possível);
 * - **retenção verbatim** — `getState().log` é **a mesma referência** do `log`
 *   passado e `getState().score` é **a mesma referência** do `score` passado
 *   (igualdade de referência): o motor é a única fonte da verdade, a store não
 *   transforma, normaliza nem recomputa nada;
 * - **integridade** — o conteúdo retido é **deep-equal** ao insumo original
 *   (nenhum campo de placar/estatística foi alterado pela store).
 *
 * Complementarmente, chamar `concluirSimulacao` **fora** de `Simulando` (ex.:
 * ainda em `Selecionando`) é **no-op**: a FSM permanece na fase corrente e não
 * define `log`/`score` — a conclusão só nasce de uma simulação em andamento,
 * nunca sobrescreve um resultado inexistente ou já consumido.
 */

/** Os três `Modo_Adversario` suportados — o modo precisa estar selecionado. */
const arbitraryModo: fc.Arbitrary<ModoAdversario> = fc.constantFrom(
  'bot_aleatorio',
  'desafiar_curti',
  'importar_seed',
);

/**
 * `Seed_RNG` como string decimal uint64. Gerado a partir de um `bigint` em
 * `[0, 2^64−1]`, misturado com casos degenerados. A store trata o seed como
 * string opaca, então a representação textual basta (mesmo padrão de property6).
 */
const arbitrarySeed: fc.Arbitrary<string> = fc.oneof(
  fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((n) => n.toString()),
  fc.constantFrom('0', '1', '18446744073709551615'),
);

/** `TeamDraft` mínimo para o modo `importar_seed` (apenas forma consumida). */
const EMPTY_DRAFT: TeamDraft = {
  lineup: { units: { offense: [], defense: [], specialTeams: [] } },
  strategy: { preset: 'EQUILIBRADO' },
};

/**
 * `GameLog`/`Score` arbitrários **opacos**: a store só os retém, nunca inspeciona
 * seu conteúdo. Geramos objetos arbitrários (profundidade e chaves variadas) e
 * os tratamos como os payloads do motor via `as never` — exatamente o contrato
 * de "o log é a única verdade" (a store não assume forma interna alguma).
 */
const arbitraryLog: fc.Arbitrary<GameLog> = fc
  .object({ maxDepth: 3 })
  .map((o) => o as never);

const arbitraryScore: fc.Arbitrary<Score> = fc
  .object({ maxDepth: 3 })
  .map((o) => o as never);

/**
 * Monta uma store em `Simulando`: `selecionarModo(modo)` →
 * `iniciarSimulacao(seed)`. No `importar_seed`, fixa também o
 * `adversarioSeedDraft` para que a seleção seja coerente.
 */
function storeSimulando(modo: ModoAdversario, seed: string) {
  const store = createMatchStore();
  store.selecionarModo(modo);
  if (modo === 'importar_seed') {
    store.setAdversarioSeed(EMPTY_DRAFT);
  }
  store.iniciarSimulacao(seed);
  return store;
}

describe('createMatchStore — Property 9: sucesso retém log/placar e avança', () => {
  it('concluirSimulacao em Simulando avança para Animando e retém log/score verbatim (R6.3)', () => {
    fc.assert(
      fc.property(
        arbitraryModo,
        arbitrarySeed,
        arbitraryLog,
        arbitraryScore,
        (modo, seed, log, score) => {
          const store = storeSimulando(modo, seed);

          // Snapshot profundo do insumo ANTES da transição, para provar depois
          // que a store não alterou nem o log nem o score que recebeu.
          const logBefore = structuredClone(log);
          const scoreBefore = structuredClone(score);

          expect(store.getState().phase).toBe('Simulando');

          store.concluirSimulacao(log, score);

          const state = store.getState();

          // (1) Transição: Simulando → Animando.
          expect(state.phase).toBe('Animando');

          // (2) Retenção verbatim: MESMA referência (não transformada/clonada).
          expect(state.log).toBe(log);
          expect(state.score).toBe(score);

          // (3) Integridade: conteúdo retido é deep-equal ao insumo original;
          //     a store não computou/alterou placar nem estatística.
          expect(state.log).toStrictEqual(logBefore);
          expect(state.score).toStrictEqual(scoreBefore);

          // O seed da partida corrente permanece intocado pela conclusão.
          expect(state.seedRng).toBe(seed);
        },
      ),
    );
  });

  it('concluirSimulacao fora de Simulando (ainda em Selecionando) é no-op: não define log/score nem muda de fase', () => {
    fc.assert(
      fc.property(
        arbitraryModo,
        arbitraryLog,
        arbitraryScore,
        (modo, log, score) => {
          const store = createMatchStore();
          store.selecionarModo(modo);
          if (modo === 'importar_seed') {
            store.setAdversarioSeed(EMPTY_DRAFT);
          }

          // Ainda em Selecionando: a simulação nunca começou.
          const before = store.getState();
          expect(before.phase).toBe('Selecionando');
          expect(before.log).toBeNull();
          expect(before.score).toBeNull();

          store.concluirSimulacao(log, score);

          const after = store.getState();
          // Fase inalterada: a conclusão não nasce de fora de Simulando.
          expect(after.phase).toBe('Selecionando');
          // log/score permanecem nulos: nada foi retido indevidamente.
          expect(after.log).toBeNull();
          expect(after.score).toBeNull();
          // Estado observável idêntico ao de antes da chamada ignorada.
          expect(after).toEqual(before);
        },
      ),
    );
  });
});
