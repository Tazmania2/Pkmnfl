import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createMatchStore } from './store';
import type { ModoAdversario } from './types';
import type { TeamDraft } from './contracts';

/**
 * Teste de propriedade da idempotência da confirmação por partida (Task 8.5).
 *
 * // Feature: pfl-gameday-result-ui, Property 6: Confirmação é idempotente por partida
 *
 * **Validates: Requirements 5.2, 5.3**
 *
 * *Para toda* sequência de `N ≥ 1` acionamentos repetidos de `iniciarSimulacao`,
 * cada um com um `Seed_RNG` possivelmente distinto, sobre uma store que começou
 * em `Selecionando` (com um `modo` já selecionado):
 *
 * - **R5.2 (um clique só)** — o **primeiro** acionamento transita a FSM para
 *   `Simulando` e retém **o primeiro** `Seed_RNG`; é esse o único momento em que
 *   a simulação é iniciada para a Partida corrente.
 * - **R5.3 (idempotência)** — todos os acionamentos subsequentes, mesmo com seeds
 *   diferentes, são **no-ops**: não reiniciam a simulação, não trocam a fase e
 *   **não sobrescrevem** o `Seed_RNG` já fixado. A store permanece em `Simulando`
 *   com a seed do primeiro clique.
 *
 * Complementarmente, acionar `iniciarSimulacao` quando a FSM **não** está em
 * `Selecionando` (ex.: já em `Animando` após `concluirSimulacao`) também é um
 * no-op — a confirmação só nasce da seleção, nunca de um estado posterior.
 *
 * A idempotência é verificada no nível observável da store (`getState()`): a
 * simulação não "roda de novo" porque a única aresta que a inicia
 * (`Selecionando → Simulando`) só é percorrida uma vez; depois disso o estado é
 * invariante sob novos acionamentos de confirmação.
 */

/** Os três `Modo_Adversario` suportados — o modo precisa estar selecionado. */
const arbitraryModo: fc.Arbitrary<ModoAdversario> = fc.constantFrom(
  'bot_aleatorio',
  'desafiar_curti',
  'importar_seed',
);

/**
 * `Seed_RNG` como string decimal uint64. Gerado a partir de um `bigint` em
 * `[0, 2^64−1]`, misturado com casos degenerados (limites e valores pequenos).
 * A store trata o seed como string opaca, então a representação textual basta.
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
 * `GameLog`/`Score` mínimos para exercitar `concluirSimulacao` (a store apenas
 * os retém; esta propriedade não inspeciona seu conteúdo).
 */
const MINIMAL_LOG = { events: [], stats: {} } as never;
const MINIMAL_SCORE = { home: 0, away: 0, final: true, tie: true } as never;

/**
 * Monta uma store em `Selecionando` com `modo` selecionado — a pré-condição da
 * confirmação. No `importar_seed`, também fixa o `adversarioSeedDraft` para que a
 * seleção seja coerente (embora `iniciarSimulacao` não dependa dele).
 */
function storeSelecionando(modo: ModoAdversario) {
  const store = createMatchStore();
  store.selecionarModo(modo);
  if (modo === 'importar_seed') {
    store.setAdversarioSeed(EMPTY_DRAFT);
  }
  return store;
}

describe('createMatchStore — Property 6: confirmação idempotente por partida', () => {
  it('o primeiro iniciarSimulacao transita Selecionando→Simulando e retém o primeiro seed (R5.2)', () => {
    fc.assert(
      fc.property(arbitraryModo, arbitrarySeed, (modo, seed) => {
        const store = storeSelecionando(modo);

        store.iniciarSimulacao(seed);

        const state = store.getState();
        expect(state.phase).toBe('Simulando');
        expect(state.seedRng).toBe(seed);
        expect(state.modo).toBe(modo);
      }),
    );
  });

  it('acionamentos repetidos com seeds variados não trocam fase nem sobrescrevem o seed (R5.3)', () => {
    fc.assert(
      fc.property(
        arbitraryModo,
        arbitrarySeed,
        // N-1 seeds subsequentes (varia a cada repetição); N >= 1 no total.
        fc.array(arbitrarySeed, { minLength: 1, maxLength: 20 }),
        (modo, firstSeed, laterSeeds) => {
          const store = storeSelecionando(modo);

          // Primeiro clique: inicia a simulação com o primeiro seed.
          store.iniciarSimulacao(firstSeed);
          const afterFirst = store.getState();
          expect(afterFirst.phase).toBe('Simulando');
          expect(afterFirst.seedRng).toBe(firstSeed);

          // Cliques subsequentes (mesmo com seeds diferentes): no-ops.
          for (const seed of laterSeeds) {
            store.iniciarSimulacao(seed);
            const state = store.getState();
            // Fase inalterada: continua Simulando, não reinicia.
            expect(state.phase).toBe('Simulando');
            // Seed preservado: nunca sobrescrito pelo seed do clique repetido.
            expect(state.seedRng).toBe(firstSeed);
          }

          // Estado final idêntico ao de após o primeiro clique (invariância).
          expect(store.getState()).toEqual(afterFirst);
        },
      ),
    );
  });

  it('iniciarSimulacao fora de Selecionando é no-op (ex.: já em Animando) (R5.3)', () => {
    fc.assert(
      fc.property(
        arbitraryModo,
        arbitrarySeed,
        arbitrarySeed,
        (modo, firstSeed, otherSeed) => {
          const store = storeSelecionando(modo);

          // Avança até Animando: Selecionando→Simulando→Animando.
          store.iniciarSimulacao(firstSeed);
          store.concluirSimulacao(MINIMAL_LOG, MINIMAL_SCORE);
          const animando = store.getState();
          expect(animando.phase).toBe('Animando');
          expect(animando.seedRng).toBe(firstSeed);

          // Confirmar novamente a partir de Animando não reinicia nem altera nada.
          store.iniciarSimulacao(otherSeed);
          expect(store.getState()).toEqual(animando);
          expect(store.getState().phase).toBe('Animando');
          expect(store.getState().seedRng).toBe(firstSeed);
        },
      ),
    );
  });
});
