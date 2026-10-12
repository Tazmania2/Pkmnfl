import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { runSimulation } from './simulate-client';
import { createMatchStore } from './store';
import type { ModoAdversario, SimulateInput } from './types';
import type { TeamDraft } from './contracts';

/**
 * Teste de propriedade: erros de entrada e de comunicação não animam nem
 * navegam, e preservam a retomada (Task 9.4).
 *
 * // Feature: pfl-gameday-result-ui, Property 26: Erros de entrada e de
 * // comunicação não animam nem navegam, e preservam a retomada
 *
 * **Validates: Requirements 6.5, 7.4**
 *
 * *Para toda* resposta de erro da chamada ao motor — `INPUT` (entrada
 * inválida/incompleta, 400 do motor) ou `NETWORK` (falha de comunicação) — vale
 * a composição de duas garantias independentes:
 *
 * 1. **Adaptador** (`runSimulation`, borda de rede): um `HTTP 400 { error, field }`
 *    é normalizado em `{ ok:false, kind:'INPUT' }` (R6.5); uma exceção lançada
 *    pelo `fetch` (rede/timeout) é normalizada em `{ ok:false, kind:'NETWORK' }`
 *    (R7.4). Em **nenhum** dos dois casos o resultado é `ok:true` — ou seja, não
 *    há `log`/`score` para animar nem desfecho para navegar.
 *
 * 2. **Store/FSM** (`registrarErro`): a partir de `Simulando`, registrar o erro
 *    transita para `Erro` exibindo o motivo legível, **sem** definir `log`/`score`
 *    (nada a animar — Estado_Carregamento encerrado sem exibir andamento, R7.3/R7.4)
 *    e **preservando** `modo`, `seedRng` e `adversarioSeedDraft` para permitir
 *    nova tentativa sem recomeçar a seleção (retomada, R7.4). A partir de `Erro`,
 *    a FSM nunca avança para `Animando`/`Resultado`.
 *
 * O teste exercita as duas garantias em conjunto: para cada outcome de erro
 * produzido pelo adaptador, dirige uma store até `Simulando` e registra o erro
 * correspondente, verificando os invariantes de não-animação, não-navegação e
 * retomada preservada.
 */

// ---------------------------------------------------------------------------
// Arbitrários
// ---------------------------------------------------------------------------

/** Os três `Modo_Adversario` suportados. */
const arbitraryModo: fc.Arbitrary<ModoAdversario> = fc.constantFrom(
  'bot_aleatorio',
  'desafiar_curti',
  'importar_seed',
);

/**
 * `Seed_RNG` como string decimal uint64 (mesma convenção da Property 6):
 * `bigint` em `[0, 2^64−1]` misturado com casos degenerados (limites e pequenos).
 */
const arbitrarySeed: fc.Arbitrary<string> = fc.oneof(
  fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((n) => n.toString()),
  fc.constantFrom('0', '1', '18446744073709551615'),
);

/** Mensagem de erro legível arbitrária (do motor ou da falha de rede). */
const arbitraryMessage: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 80 });

/** Campo/alvo ARIA arbitrário (opcional) do erro de entrada. */
const arbitraryField: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 40 });

/** `TeamDraft` mínimo para o modo `importar_seed` (apenas forma consumida). */
const EMPTY_DRAFT: TeamDraft = {
  lineup: { units: { offense: [], defense: [], specialTeams: [] } },
  strategy: { preset: 'EQUILIBRADO' },
};

/** `SimulateInput` mínimo e bem-formado; o conteúdo é irrelevante para esta propriedade. */
const MINIMAL_INPUT: SimulateInput = {
  playerLineup: { units: { offense: [], defense: [], specialTeams: [] } },
  playerStrategy: { preset: 'EQUILIBRADO' },
  adversaryLineup: { units: { offense: [], defense: [], specialTeams: [] } },
  adversaryStrategy: { preset: 'EQUILIBRADO' },
  seedRng: '42',
  botModeAway: 'random',
};

/** `GameLog`/`Score` mínimos, usados apenas para exercitar o caminho de sucesso. */
const MINIMAL_LOG = { events: [], stats: {} } as never;
const MINIMAL_SCORE = { home: 0, away: 0, final: true, tie: true } as never;

/**
 * Instala um `fetch` falso que resolve com um `HTTP 400 { error, field? }`,
 * simulando a recusa de entrada do motor (R6.5).
 */
function stubFetchHttp400(error: string, field?: string): void {
  const payload = field !== undefined ? { error, field } : { error };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

/**
 * Instala um `fetch` falso que **lança**, simulando uma falha de rede/timeout
 * (R7.4) — a exceção deve cair no `catch` do adaptador e virar `NETWORK`.
 */
function stubFetchThrows(message: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(message);
    }),
  );
}

/** Monta uma store em `Simulando` com modo/seed fixados (e seed do adversário no importar_seed). */
function storeSimulando(modo: ModoAdversario, seed: string) {
  const store = createMatchStore();
  store.selecionarModo(modo);
  if (modo === 'importar_seed') {
    store.setAdversarioSeed(EMPTY_DRAFT);
  }
  store.iniciarSimulacao(seed);
  return store;
}

describe('runSimulation + store — Property 26: erros não animam nem navegam, preservam a retomada', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('HTTP 400 → outcome INPUT (nunca ok:true), e registrarErro não anima/navega e preserva a retomada (R6.5, R7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryModo,
        arbitrarySeed,
        arbitraryMessage,
        fc.option(arbitraryField, { nil: undefined }),
        async (modo, seed, message, field) => {
          stubFetchHttp400(message, field);

          // (1) Adaptador: 400 vira INPUT; nunca é ok:true (nada a animar/navegar).
          const outcome = await runSimulation(MINIMAL_INPUT);
          expect(outcome.ok).toBe(false);
          if (outcome.ok) return; // narrowing; a asserção acima já falharia.
          expect(outcome.kind).toBe('INPUT');
          if (outcome.kind !== 'INPUT') return; // narrowing p/ a arm INPUT (tem `field`).
          expect(outcome.message).toBe(message);
          if (field !== undefined) {
            expect(outcome.field).toBe(field);
          }

          // (2) Store: Simulando → Erro, sem log/score, preservando a retomada.
          const store = storeSimulando(modo, seed);
          expect(store.getState().phase).toBe('Simulando');

          store.registrarErro({
            kind: outcome.kind,
            message: outcome.message,
            ...(outcome.field !== undefined ? { field: outcome.field } : {}),
          });

          const state = store.getState();
          // Fase de erro (Estado_Carregamento encerrado).
          expect(state.phase).toBe('Erro');
          // Motivo legível retido.
          expect(state.erro).not.toBeNull();
          expect(state.erro?.kind).toBe('INPUT');
          expect(state.erro?.message).toBe(message);
          // NÃO animou: nenhum andamento/placar foi produzido (R7.3/R7.4).
          expect(state.log).toBeNull();
          expect(state.score).toBeNull();
          // Retomada preservada: modo/seed/seed-adversário intactos (R7.4).
          expect(state.modo).toBe(modo);
          expect(state.seedRng).toBe(seed);
          if (modo === 'importar_seed') {
            expect(state.adversarioSeedDraft).toEqual(EMPTY_DRAFT);
          } else {
            expect(state.adversarioSeedDraft).toBeNull();
          }

          // A partir de Erro, a FSM nunca avança para Animando/Resultado.
          store.irParaResultado();
          expect(store.getState().phase).toBe('Erro');
          store.concluirSimulacao(MINIMAL_LOG, MINIMAL_SCORE);
          expect(store.getState().phase).toBe('Erro');
          expect(store.getState().log).toBeNull();
          expect(store.getState().score).toBeNull();
        },
      ),
    );
  });

  it('fetch lançando → outcome NETWORK (nunca ok:true), e registrarErro não anima/navega e preserva a retomada (R7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryModo,
        arbitrarySeed,
        arbitraryMessage,
        async (modo, seed, message) => {
          stubFetchThrows(message);

          // (1) Adaptador: exceção de rede vira NETWORK; nunca é ok:true.
          const outcome = await runSimulation(MINIMAL_INPUT);
          expect(outcome.ok).toBe(false);
          if (outcome.ok) return;
          expect(outcome.kind).toBe('NETWORK');
          // A mensagem legível vem do erro lançado.
          expect(outcome.message).toBe(message);

          // (2) Store: Simulando → Erro, sem log/score, preservando a retomada.
          const store = storeSimulando(modo, seed);
          expect(store.getState().phase).toBe('Simulando');

          store.registrarErro({ kind: outcome.kind, message: outcome.message });

          const state = store.getState();
          expect(state.phase).toBe('Erro');
          expect(state.erro?.kind).toBe('NETWORK');
          expect(state.erro?.message).toBe(message);
          // NÃO animou.
          expect(state.log).toBeNull();
          expect(state.score).toBeNull();
          // Retomada preservada (nova tentativa possível sem recomeçar seleção).
          expect(state.modo).toBe(modo);
          expect(state.seedRng).toBe(seed);
          if (modo === 'importar_seed') {
            expect(state.adversarioSeedDraft).toEqual(EMPTY_DRAFT);
          } else {
            expect(state.adversarioSeedDraft).toBeNull();
          }

          // Nunca navega a partir de Erro.
          store.irParaResultado();
          expect(store.getState().phase).toBe('Erro');
          store.concluirSimulacao(MINIMAL_LOG, MINIMAL_SCORE);
          expect(store.getState().phase).toBe('Erro');
        },
      ),
    );
  });

  it('após o erro, a retomada é possível: reset + nova seleção/início conduzem de volta a Simulando (R7.4)', () => {
    fc.assert(
      fc.property(arbitraryModo, arbitrarySeed, arbitrarySeed, (modo, firstSeed, retrySeed) => {
        // Chega em Erro a partir de Simulando (sem precisar da rede: a store é pura).
        const store = storeSimulando(modo, firstSeed);
        store.registrarErro({ kind: 'NETWORK', message: 'falha de comunicação' });
        expect(store.getState().phase).toBe('Erro');

        // Caminho de retomada consistente com a FSM: reset → selecionar modo → iniciar.
        store.reset();
        expect(store.getState().phase).toBe('Selecionando');
        store.selecionarModo(modo);
        if (modo === 'importar_seed') {
          store.setAdversarioSeed(EMPTY_DRAFT);
        }
        store.iniciarSimulacao(retrySeed);

        const state = store.getState();
        expect(state.phase).toBe('Simulando');
        expect(state.seedRng).toBe(retrySeed);
        expect(state.erro).toBeNull();
        expect(state.log).toBeNull();
        expect(state.score).toBeNull();
      }),
    );
  });
});
