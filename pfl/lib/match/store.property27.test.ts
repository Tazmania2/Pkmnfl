import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createMatchStore, type MatchStore, type MatchState } from './store';
import type { ModoAdversario } from './types';
import type { GameLog, Score, TeamDraft } from './contracts';

/**
 * Teste de propriedade: a exibição de andamento só ocorre com log recebido (Task 8.7).
 *
 * // Feature: pfl-gameday-result-ui, Property 27: Exibição de andamento só ocorre com log recebido
 *
 * **Validates: Requirements 7.3**
 *
 * R7.3 exige que a Tela_Game_Day **abstenha-se** de exibir placar, estatísticas
 * ou andamento da Partida **enquanto o `Log_Partida` correspondente não tiver
 * sido recebido**. Na store/FSM esse "andamento exibível" existe **sse e somente
 * se** `log`/`score` estão retidos — e isso só acontece em `concluirSimulacao`,
 * que transita `Simulando → Animando`. As demais fases (`Selecionando`,
 * `Validando`, `Simulando`, `Erro`) **nunca** têm `log`/`score`; apenas
 * `Animando` e `Resultado` (após o log) os possuem.
 *
 * *Para toda* sequência de transições válidas, aplicadas em qualquer ordem
 * (`selecionarModo`, `setAdversarioSeed`, `iniciarSimulacao`, `concluirSimulacao`,
 * `registrarErro`, `irParaResultado`, `reset`), o invariante R7.3 vale **após
 * cada passo**:
 *
 * 1. SE `phase ∈ {Selecionando, Validando, Simulando, Erro}` ENTÃO
 *    `log === null` E `score === null` — não há andamento a exibir.
 * 2. SE `log !== null` (andamento disponível) ENTÃO
 *    `phase ∈ {Animando, Resultado}` — o log só vira exibível depois de recebido.
 *
 * Como a store é a única fonte de "andamento exibível" para a tela, provar esse
 * invariante prova que a UI não tem como exibir placar/andamento antes do log.
 */

/** Os três `Modo_Adversario` suportados. */
const arbitraryModo: fc.Arbitrary<ModoAdversario> = fc.constantFrom(
  'bot_aleatorio',
  'desafiar_curti',
  'importar_seed',
);

/**
 * `Seed_RNG` como string decimal uint64 (mesmo padrão de `store.property6.test`),
 * misturado com casos degenerados. A store trata o seed como string opaca.
 */
const arbitrarySeed: fc.Arbitrary<string> = fc.oneof(
  fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((n) => n.toString()),
  fc.constantFrom('0', '1', '18446744073709551615'),
);

/** `TeamDraft` mínimo para o modo `importar_seed` (apenas a forma consumida). */
const EMPTY_DRAFT: TeamDraft = {
  lineup: { units: { offense: [], defense: [], specialTeams: [] } },
  strategy: { preset: 'EQUILIBRADO' },
};

/**
 * `GameLog`/`Score` opacos para exercitar `concluirSimulacao` — esta propriedade
 * só observa a presença/ausência (`!== null`), nunca o conteúdo. Marcados como
 * não-nulos de propósito, para que a asserção do invariante tenha significado.
 */
const OPAQUE_LOG = { events: [], stats: {} } as unknown as GameLog;
const OPAQUE_SCORE = { home: 0, away: 0 } as unknown as Score;

/** Fases nas quais nenhum andamento pode ser exibido (log/score devem ser null). */
const FASES_SEM_LOG = new Set(['Selecionando', 'Validando', 'Simulando', 'Erro']);
/** Fases nas quais o andamento é exibível (log já recebido). */
const FASES_COM_LOG = new Set(['Animando', 'Resultado']);

/**
 * As transições que compõem o passeio aleatório sobre a FSM. Cada comando é um
 * nome e os argumentos necessários; o executor abaixo os aplica à store. Chamadas
 * fora da fase de origem são no-ops na própria store, então qualquer ordem é
 * "válida" (a store nunca lança).
 */
type Step =
  | { readonly kind: 'selecionarModo'; readonly modo: ModoAdversario }
  | { readonly kind: 'setAdversarioSeed' }
  | { readonly kind: 'iniciarSimulacao'; readonly seed: string }
  | { readonly kind: 'concluirSimulacao' }
  | { readonly kind: 'registrarErro' }
  | { readonly kind: 'irParaResultado' }
  | { readonly kind: 'reset' };

const arbitraryStep: fc.Arbitrary<Step> = fc.oneof(
  arbitraryModo.map((modo) => ({ kind: 'selecionarModo', modo }) as const),
  fc.constant({ kind: 'setAdversarioSeed' } as const),
  arbitrarySeed.map((seed) => ({ kind: 'iniciarSimulacao', seed }) as const),
  fc.constant({ kind: 'concluirSimulacao' } as const),
  fc.constant({ kind: 'registrarErro' } as const),
  fc.constant({ kind: 'irParaResultado' } as const),
  fc.constant({ kind: 'reset' } as const),
);

/** Aplica um passo à store, delegando às transições públicas da FSM. */
function applyStep(store: MatchStore, step: Step): void {
  switch (step.kind) {
    case 'selecionarModo':
      store.selecionarModo(step.modo);
      break;
    case 'setAdversarioSeed':
      store.setAdversarioSeed(EMPTY_DRAFT);
      break;
    case 'iniciarSimulacao':
      store.iniciarSimulacao(step.seed);
      break;
    case 'concluirSimulacao':
      store.concluirSimulacao(OPAQUE_LOG, OPAQUE_SCORE);
      break;
    case 'registrarErro':
      store.registrarErro({ kind: 'NETWORK', message: 'falha de comunicação' });
      break;
    case 'irParaResultado':
      store.irParaResultado();
      break;
    case 'reset':
      store.reset();
      break;
  }
}

/** O invariante R7.3 sobre um `MatchState` observado. Lança via `expect` se violado. */
function assertInvarianteR73(state: MatchState): void {
  if (FASES_SEM_LOG.has(state.phase)) {
    // (1) Fases pré-log: nenhum andamento exibível — log e score são null.
    expect(state.log, `fase ${state.phase} não pode reter log`).toBeNull();
    expect(state.score, `fase ${state.phase} não pode reter score`).toBeNull();
  }

  if (state.log !== null) {
    // (2) Há andamento exibível: só é possível em Animando/Resultado (pós-log).
    expect(
      FASES_COM_LOG.has(state.phase),
      `log presente exige fase Animando/Resultado, mas estava em ${state.phase}`,
    ).toBe(true);
  }
}

describe('createMatchStore — Property 27: andamento só é exibível com log recebido (R7.3)', () => {
  it('o invariante vale no estado inicial (sem log/score, fase Selecionando)', () => {
    const store = createMatchStore();
    const state = store.getState();
    expect(state.phase).toBe('Selecionando');
    expect(state.log).toBeNull();
    expect(state.score).toBeNull();
    assertInvarianteR73(state);
  });

  it('o invariante vale após CADA passo de uma sequência arbitrária de transições', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryStep, { minLength: 1, maxLength: 40 }),
        (steps) => {
          const store = createMatchStore();

          // Invariante no estado inicial, antes de qualquer passo.
          assertInvarianteR73(store.getState());

          for (const step of steps) {
            applyStep(store, step);
            // Após cada transição (válida ou no-op), R7.3 continua valendo.
            assertInvarianteR73(store.getState());
          }
        },
      ),
    );
  });

  it('log/score permanecem null em todo caminho que nunca atinge Animando (sem concluirSimulacao)', () => {
    fc.assert(
      fc.property(
        // Passos que jamais retêm log: tudo menos `concluirSimulacao`.
        fc.array(
          fc.oneof(
            arbitraryModo.map((modo) => ({ kind: 'selecionarModo', modo }) as const),
            fc.constant({ kind: 'setAdversarioSeed' } as const),
            arbitrarySeed.map((seed) => ({ kind: 'iniciarSimulacao', seed }) as const),
            fc.constant({ kind: 'registrarErro' } as const),
            fc.constant({ kind: 'irParaResultado' } as const),
            fc.constant({ kind: 'reset' } as const),
          ),
          { minLength: 1, maxLength: 40 },
        ),
        (steps) => {
          const store = createMatchStore();
          for (const step of steps) {
            applyStep(store, step);
            const state = store.getState();
            // Sem nunca receber log, nenhum andamento pode ser exibido.
            expect(state.log).toBeNull();
            expect(state.score).toBeNull();
            expect(FASES_SEM_LOG.has(state.phase)).toBe(true);
            assertInvarianteR73(state);
          }
        },
      ),
    );
  });

  it('uma vez em Animando/Resultado o log está presente; voltar a reset reestabelece o pré-log', () => {
    fc.assert(
      fc.property(arbitraryModo, arbitrarySeed, (modo, seed) => {
        const store = createMatchStore();
        store.selecionarModo(modo);
        if (modo === 'importar_seed') {
          store.setAdversarioSeed(EMPTY_DRAFT);
        }
        store.iniciarSimulacao(seed);
        // Antes do log: pré-log, sem andamento.
        assertInvarianteR73(store.getState());
        expect(store.getState().log).toBeNull();

        // Recebe o log: agora o andamento é exibível (Animando).
        store.concluirSimulacao(OPAQUE_LOG, OPAQUE_SCORE);
        expect(store.getState().phase).toBe('Animando');
        expect(store.getState().log).not.toBeNull();
        assertInvarianteR73(store.getState());

        // Avança ao Resultado: log segue presente e exibível.
        store.irParaResultado();
        expect(store.getState().phase).toBe('Resultado');
        expect(store.getState().log).not.toBeNull();
        assertInvarianteR73(store.getState());

        // reset: volta ao pré-log — nada de andamento até um novo log.
        store.reset();
        expect(store.getState().phase).toBe('Selecionando');
        expect(store.getState().log).toBeNull();
        expect(store.getState().score).toBeNull();
        assertInvarianteR73(store.getState());
      }),
    );
  });
});
