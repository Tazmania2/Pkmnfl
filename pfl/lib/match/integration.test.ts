import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSimulation } from './simulate-client';
import { createMatchStore } from './store';
import { buildAnimationScenes } from './animation';
import { orquestrarPreSimulacao } from './pre-simulacao';
import type { PreSimulacaoDeps, PreSimulacaoInput } from './pre-simulacao';
import type { SimulateInput } from './types';
import type {
  GameLog,
  ImportResult,
  LineupInput,
  Score,
  StrategyInput,
  TeamDraft,
} from './contracts';

/**
 * Testes de integração de ponta a ponta das telas Game Day → Resultado
 * (Task 18.1) — spec `pfl-gameday-result-ui`.
 *
 * Exercitam a borda `lib/match` **inteira** contra um **mock determinístico** de
 * `POST /api/simulate` (`fetch` global stubado com `vi.stubGlobal`), em ambiente
 * `node` (sem DOM): o adaptador de rede (`runSimulation`), a store/FSM
 * (`createMatchStore`), o planejador de cenas (`buildAnimationScenes`) e a
 * orquestração pré-simulação (`orquestrarPreSimulacao` com `importSeed` injetada).
 *
 * Cobre:
 *  1. **Reprodução por seed (R16.1)** — o mesmo `SimulateInput` (= mesmo request
 *     body) devolve o mesmo `{ log, score }`; a store retém estado idêntico entre
 *     duas execuções; `buildAnimationScenes(log)` produz a mesma sequência de
 *     cenas (corolário de R16.2).
 *  2. **400 → INPUT sem animar/navegar (R6.5)** — `runSimulation` normaliza para
 *     `{ ok:false, kind:'INPUT' }`; a store vai `Simulando → Erro` sem `log`/`score`
 *     e nunca avança para `Animando`/`Resultado`.
 *  3. **Exceção de rede → NETWORK com retry (R7.4)** — `fetch` lança →
 *     `{ ok:false, kind:'NETWORK' }`; a store preserva `modo`/`seedRng` para
 *     retomada; um retry bem-sucedido (200) alcança `Animando`.
 *  4. **Modo_Importar_Seed com `.pflseed.json` válido e inválido (R3.1–R3.3)** —
 *     `importSeed` injetada parseia os bytes como dados; válido →
 *     `{ ok:true, adversarioDraft }` retido via `setAdversarioSeed`; inválido →
 *     `{ ok:false, error.kind:'IMPORT' }` com o motivo específico, simulação
 *     bloqueada.
 *  5. **Smoke de segurança (R3.4)** — uma seed maliciosa (com `__proto__`,
 *     strings que parecem código) é apenas parseada como dados; nenhum sentinela
 *     global é jamais invocado — nada é `eval`/`Function`-ado.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 6.5, 7.4, 16.1_
 */

// ---------------------------------------------------------------------------
// SimulateInput realista mínimo (formas de contracts.ts)
// ---------------------------------------------------------------------------

/** Monta um `AthleteInput` mínimo e bem-formado (4 golpes, seis stats). */
function athlete(instanceId: number, pokemonId: number) {
  return {
    instanceId,
    pokemonId,
    types: ['normal'] as ReadonlyArray<string>,
    stats: {
      hp: 100,
      attack: 100,
      defense: 100,
      specialAttack: 100,
      specialDefense: 100,
      speed: 100,
    },
    abilityId: 1,
    moveIds: [1, 2, 3, 4] as ReadonlyArray<number>,
    positionDesignation: 'QB',
  };
}

/** `LineupInput` realista mínimo: uma unidade com um atleta por lado. */
function lineup(seedId: string, baseId: number): LineupInput {
  return {
    teamSeedId: seedId,
    units: {
      offense: [athlete(baseId + 1, 25)],
      defense: [athlete(baseId + 2, 6)],
      specialTeams: [athlete(baseId + 3, 9)],
    },
  };
}

const STRATEGY_PLAYER: StrategyInput = { preset: 'EQUILIBRADO' };
const STRATEGY_ADVERSARY: StrategyInput = { preset: 'AGRESSIVO' };

/** `SimulateInput` canônico usado nos round-trips (conteúdo estável). */
function makeInput(seedRng: string): SimulateInput {
  return {
    playerLineup: lineup('time-jogador', 100),
    playerStrategy: STRATEGY_PLAYER,
    adversaryLineup: lineup('time-adversario', 200),
    adversaryStrategy: STRATEGY_ADVERSARY,
    seedRng,
    botModeAway: 'random',
  };
}

// ---------------------------------------------------------------------------
// Log/Placar determinísticos derivados do request (função pura do body)
// ---------------------------------------------------------------------------

/**
 * Hash estável e determinístico de uma string (djb2) — serve de fonte de
 * variação para o log/placar sintéticos sem usar relógio ou aleatoriedade. O
 * mesmo body sempre produz o mesmo número.
 */
function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * `GameLog`/`Score` **determinísticos** derivados puramente do corpo do request.
 * O mock de `/api/simulate` usa isto para garantir que o **mesmo request** (mesmo
 * `SimulateInput` serializado) produza sempre o **mesmo** `{ log, score }` — o
 * invariante de Reproducao_Por_Seed (R16.1). Dois Snaps são emitidos para que
 * `buildAnimationScenes` tenha cenas a comparar.
 */
function deterministicResult(body: string): { log: GameLog; score: Score } {
  const h = stableHash(body);
  const homePts = h % 7;
  const awayPts = (h >> 3) % 7;
  const seedUsed = String(h);

  const baseState = {
    quarter: 1,
    gameClock: 9000,
    down: 1,
    distance: 10,
    ballOn: 25,
    possession: 'home' as const,
    score: { home: 0, away: 0 },
    weather: 'CLEAR' as const,
  };

  const log: GameLog = {
    seedUsed,
    baselineVersion: 'test-baseline-v1',
    baselineStatus: 'FROZEN_MVP_TEST',
    events: [
      {
        seq: 0,
        type: 'MATCH_INIT',
        state: baseState,
        narrative: 'Início da partida',
        detail: {},
      },
      {
        seq: 1,
        type: 'SNAP',
        snap: 1,
        state: { ...baseState, gameClock: 8900 },
        narrative: 'Primeiro snap',
        detail: {
          offensePokemonIds: [25],
          defensePokemonIds: [6],
          offense: 'RUN',
        },
      },
      {
        seq: 2,
        type: 'PLAY_RESULT',
        snap: 1,
        state: { ...baseState, gameClock: 8800 },
        narrative: 'Corrida de 5 jardas',
        detail: { offense: 'RUN', gain: 5 },
      },
      {
        seq: 3,
        type: 'SNAP',
        snap: 2,
        state: {
          ...baseState,
          gameClock: 8600,
          score: { home: homePts, away: awayPts },
        },
        narrative: 'Segundo snap',
        detail: {
          offensePokemonIds: [25],
          defensePokemonIds: [6],
          offense: 'PASS',
          completed: true,
        },
      },
    ],
    stats: {
      rushes: { attempts: 1, yards: 5 },
      passes: { attempts: 1, completions: 1, yards: 12, interceptions: 0 },
      turnovers: 0,
      fouls: 0,
      scoringSummary: [],
    },
  };

  const score: Score = {
    home: homePts,
    away: awayPts,
    final: true,
    tie: homePts === awayPts,
  };

  return { log, score };
}

// ---------------------------------------------------------------------------
// Mock determinístico de POST /api/simulate
// ---------------------------------------------------------------------------

/**
 * Instala um `fetch` falso **determinístico**: para qualquer POST a
 * `/api/simulate`, calcula o `{ log, score }` como função pura do corpo do
 * request (via `deterministicResult`). O mesmo corpo ⇒ a mesma resposta (R16.1).
 * Devolve o `vi.fn` para inspeção (contagem de chamadas, bodies).
 */
function stubFetchDeterministic() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const bodyStr = typeof init?.body === 'string' ? init.body : '';
    const { log, score } = deterministicResult(bodyStr);
    return new Response(JSON.stringify({ log, score }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Instala um `fetch` que resolve com `HTTP 400 { error, field? }` (R6.5). */
function stubFetchHttp400(error: string, field?: string) {
  const payload = field !== undefined ? { error, field } : { error };
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Instala um `fetch` que **lança**, simulando falha de rede/timeout (R7.4). */
function stubFetchThrows(message: string) {
  const fetchMock = vi.fn(async () => {
    throw new Error(message);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Integração lib/match — Game Day → Resultado (Task 18.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // 1. Reprodução por seed (R16.1) + animação determinística (R16.2)
  // -------------------------------------------------------------------------

  it('mesmo request (mesmo SimulateInput) → mesmo log/score, estado da store idêntico e mesmas cenas de animação (R16.1, R16.2)', async () => {
    stubFetchDeterministic();

    const input = makeInput('123456789');

    // Duas chamadas com entrada idêntica.
    const first = await runSimulation(input);
    const second = await runSimulation(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Mesmo log e mesmo placar (round-trip de reprodução, R16.1).
    expect(first.log).toEqual(second.log);
    expect(first.score).toEqual(second.score);

    // Dirige a store duas vezes de forma idêntica e compara o estado retido.
    function runThroughStore(outcomeLog: GameLog, outcomeScore: Score) {
      const store = createMatchStore();
      store.selecionarModo('bot_aleatorio');
      store.iniciarSimulacao(input.seedRng);
      store.concluirSimulacao(outcomeLog, outcomeScore);
      return store.getState();
    }

    const stateA = runThroughStore(first.log, first.score);
    const stateB = runThroughStore(second.log, second.score);

    expect(stateA.phase).toBe('Animando');
    expect(stateB).toEqual(stateA); // estado retido idêntico entre execuções

    // Animação determinística: mesmas cenas a partir do mesmo log (R16.2).
    const scenesA = buildAnimationScenes(first.log);
    const scenesB = buildAnimationScenes(second.log);
    expect(scenesA).toEqual(scenesB);
    // Sanidade: há cenas (um Snap → uma cena); a sequência é não-vazia.
    expect(scenesA.length).toBe(2);
    expect(scenesA.map((s) => s.snap)).toEqual([1, 2]);

    // E a mesma cena também é estável ao reconstruir do log retido na store.
    expect(buildAnimationScenes(stateA.log as GameLog)).toEqual(scenesA);
  });

  it('seeds diferentes podem divergir, mas cada seed é estável consigo mesma (R16.1)', async () => {
    stubFetchDeterministic();

    const a1 = await runSimulation(makeInput('1'));
    const a2 = await runSimulation(makeInput('1'));
    const b1 = await runSimulation(makeInput('2'));

    expect(a1.ok && a2.ok && b1.ok).toBe(true);
    if (!a1.ok || !a2.ok || !b1.ok) return;

    // Estável consigo mesma.
    expect(a1.score).toEqual(a2.score);
    expect(a1.log).toEqual(a2.log);
    // A seed participa do corpo, logo o log registra seeds distintas por request.
    expect(a1.log.seedUsed).not.toBe(b1.log.seedUsed);
  });

  // -------------------------------------------------------------------------
  // 2. 400 → INPUT sem animar/navegar (R6.5)
  // -------------------------------------------------------------------------

  it('HTTP 400 → outcome INPUT; store vai Simulando → Erro sem log/score e não avança para Animando/Resultado (R6.5)', async () => {
    stubFetchHttp400('escalação inválida', 'offense');

    const outcome = await runSimulation(makeInput('42'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe('INPUT');
    if (outcome.kind !== 'INPUT') return;
    expect(outcome.message).toBe('escalação inválida');
    expect(outcome.field).toBe('offense');

    // Store: dirige até Simulando e registra o erro.
    const store = createMatchStore();
    store.selecionarModo('bot_aleatorio');
    store.iniciarSimulacao('42');
    expect(store.getState().phase).toBe('Simulando');

    store.registrarErro({
      kind: outcome.kind,
      message: outcome.message,
      field: outcome.field,
    });

    const state = store.getState();
    expect(state.phase).toBe('Erro');
    expect(state.erro?.kind).toBe('INPUT');
    expect(state.erro?.message).toBe('escalação inválida');
    // Nada a animar: sem log/score (R6.5 — não anima nem exibe andamento).
    expect(state.log).toBeNull();
    expect(state.score).toBeNull();

    // A FSM não avança a partir de Erro: nem anima nem navega.
    store.irParaResultado();
    expect(store.getState().phase).toBe('Erro');

    // Nada a animar: cenas vazias do log nulo não existem — não há log retido.
    expect(store.getState().log).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3. Exceção de rede → NETWORK com retry (R7.4)
  // -------------------------------------------------------------------------

  it('exceção de rede → outcome NETWORK; estado preservado para retry; retry bem-sucedido alcança Animando (R7.4)', async () => {
    // Primeira tentativa: a rede falha.
    const throwMock = stubFetchThrows('conexão perdida');

    const store = createMatchStore();
    store.selecionarModo('bot_aleatorio');
    store.iniciarSimulacao('777');
    expect(store.getState().phase).toBe('Simulando');

    const firstOutcome = await runSimulation(makeInput('777'));
    expect(firstOutcome.ok).toBe(false);
    if (firstOutcome.ok) return;
    expect(firstOutcome.kind).toBe('NETWORK');
    expect(firstOutcome.message).toBe('conexão perdida');
    expect(throwMock).toHaveBeenCalledTimes(1);

    store.registrarErro({ kind: 'NETWORK', message: firstOutcome.message });
    let state = store.getState();
    expect(state.phase).toBe('Erro');
    // Estado preservado para retomada (R7.4): modo/seed intactos, sem log/score.
    expect(state.modo).toBe('bot_aleatorio');
    expect(state.seedRng).toBe('777');
    expect(state.log).toBeNull();
    expect(state.score).toBeNull();

    // Retry: a rede volta (200 determinístico). Caminho da FSM: reset → seleciona → inicia.
    const okMock = stubFetchDeterministic();
    store.reset();
    store.selecionarModo('bot_aleatorio');
    store.iniciarSimulacao('777');
    expect(store.getState().phase).toBe('Simulando');
    expect(store.getState().erro).toBeNull();

    const retryOutcome = await runSimulation(makeInput('777'));
    expect(retryOutcome.ok).toBe(true);
    if (!retryOutcome.ok) return;
    expect(okMock).toHaveBeenCalledTimes(1);

    store.concluirSimulacao(retryOutcome.log, retryOutcome.score);
    state = store.getState();
    // Retry bem-sucedido alcança Animando com log/score retidos.
    expect(state.phase).toBe('Animando');
    expect(state.log).toEqual(retryOutcome.log);
    expect(state.score).toEqual(retryOutcome.score);

    // E agora há cenas de animação a reproduzir.
    expect(buildAnimationScenes(retryOutcome.log).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 4. Modo_Importar_Seed com .pflseed.json válido e inválido (R3.1–R3.3)
  // -------------------------------------------------------------------------

  // Codifica um objeto JSON como bytes de `.pflseed.json` (R3.1 — passado como dados).
  function encodeSeed(obj: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  /**
   * `importSeed` fake determinística: **apenas** parseia os bytes como JSON
   * (dados), nunca executa nada. Reconhece a forma mínima
   * `{ lineup, strategy, teamSeedId? }` como `.pflseed.json` válido; qualquer
   * outra coisa (JSON inválido, forma errada) é recusada com motivo específico.
   * Por construção, nenhum conteúdo da seed é executado — o importador só
   * interpreta como dados (R3.4); o smoke de segurança comprova isso via o
   * sentinela global do caso de teste.
   */
  function makeFakeImportSeed() {
    return (bytes: Uint8Array): ImportResult => {
      let text: string;
      try {
        text = new TextDecoder().decode(bytes);
      } catch {
        return { ok: false, reason: { step: 'decode', message: 'bytes ilegíveis' } };
      }

      let parsed: unknown;
      try {
        // PARSE-ONLY: trata o conteúdo como dados. Nunca eval/Function.
        parsed = JSON.parse(text);
      } catch {
        return {
          ok: false,
          reason: { step: 'parse', message: 'JSON malformado no .pflseed.json' },
        };
      }

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return {
          ok: false,
          reason: { step: 'shape', message: 'estrutura de seed inesperada' },
        };
      }

      const obj = parsed as Record<string, unknown>;
      if (
        typeof obj.lineup !== 'object' ||
        obj.lineup === null ||
        typeof obj.strategy !== 'object' ||
        obj.strategy === null
      ) {
        return {
          ok: false,
          reason: {
            step: 'validate',
            message: 'seed sem escalação e estratégia válidas',
          },
        };
      }

      const draft: TeamDraft = {
        lineup: obj.lineup as TeamDraft['lineup'],
        strategy: obj.strategy as TeamDraft['strategy'],
        ...(typeof obj.teamSeedId === 'string'
          ? { teamSeedId: obj.teamSeedId }
          : {}),
      };
      return { ok: true, draft };
    };
  }

  const VALID_SEED_PAYLOAD = {
    teamSeedId: 'seed-adversario-xyz',
    lineup: lineup('seed-adversario-xyz', 300),
    strategy: { preset: 'DEFENSIVO' },
  };

  it('seed válida → orquestrarPreSimulacao ok com adversarioDraft; store.setAdversarioSeed o retém (R3.1, R3.3)', () => {
    const importSeed = makeFakeImportSeed();

    const seedBytes = encodeSeed(VALID_SEED_PAYLOAD);
    const input: PreSimulacaoInput = {
      playerDraft: {
        lineup: lineup('time-jogador', 100),
        strategy: STRATEGY_PLAYER,
      },
      modo: 'importar_seed',
      seedBytes,
    };
    const deps: PreSimulacaoDeps = {
      validateDraft: () => [],
      hasBlocking: () => false,
      importSeed,
    };

    const result = orquestrarPreSimulacao(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adversarioDraft).toBeDefined();
    expect(result.adversarioDraft?.teamSeedId).toBe('seed-adversario-xyz');
    expect(result.adversarioDraft?.strategy.preset).toBe('DEFENSIVO');

    // A store retém o time do adversário (R3.3) e habilita a confirmação.
    const store = createMatchStore();
    store.selecionarModo('importar_seed');
    store.setAdversarioSeed(result.adversarioDraft as TeamDraft);
    expect(store.getState().adversarioSeedDraft).toEqual(result.adversarioDraft);

  });

  it('seed inválida (JSON malformado) → IMPORT com motivo específico, simulação bloqueada (R3.2)', () => {
    const importSeed = makeFakeImportSeed();

    // Bytes de um .pflseed.json corrompido.
    const seedBytes = new TextEncoder().encode('{ isto não é json válido');
    const input: PreSimulacaoInput = {
      playerDraft: {
        lineup: lineup('time-jogador', 100),
        strategy: STRATEGY_PLAYER,
      },
      modo: 'importar_seed',
      seedBytes,
    };
    const deps: PreSimulacaoDeps = {
      validateDraft: () => [],
      hasBlocking: () => false,
      importSeed,
    };

    const result = orquestrarPreSimulacao(input, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('IMPORT');
    expect(result.error.message).toBe('JSON malformado no .pflseed.json');

    // Simulação bloqueada: a store nunca recebe adversário aprovado.
    const store = createMatchStore();
    store.selecionarModo('importar_seed');
    expect(store.getState().adversarioSeedDraft).toBeNull();
  });

  it('seed inválida (forma errada) → IMPORT com motivo de validação, simulação bloqueada (R3.2)', () => {
    const importSeed = makeFakeImportSeed();

    // JSON válido, porém sem lineup/strategy — recusado na validação.
    const seedBytes = encodeSeed({ foo: 'bar', nested: { a: 1 } });
    const input: PreSimulacaoInput = {
      playerDraft: {
        lineup: lineup('time-jogador', 100),
        strategy: STRATEGY_PLAYER,
      },
      modo: 'importar_seed',
      seedBytes,
    };
    const deps: PreSimulacaoDeps = {
      validateDraft: () => [],
      hasBlocking: () => false,
      importSeed,
    };

    const result = orquestrarPreSimulacao(input, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('IMPORT');
    expect(result.error.message).toBe('seed sem escalação e estratégia válidas');
  });

  // -------------------------------------------------------------------------
  // 5. Smoke de segurança: importação só parseia, nunca executa (R3.4)
  // -------------------------------------------------------------------------

  it('seed maliciosa é tratada como dados: nada é executado/eval-ado; sentinela nunca dispara (R3.4)', () => {
    // Sentinela global: seria incrementado SE qualquer conteúdo da seed fosse
    // executado como código. Permanece em 0 porque a importação só parseia.
    const sentinel = { executed: 0 };
    const g = globalThis as unknown as Record<string, unknown>;
    g.__PFL_SEED_SENTINEL__ = () => {
      sentinel.executed += 1;
    };
    // Espiona `eval` para provar que a importação jamais recorre a execução
    // dinâmica de código a partir do conteúdo da seed.
    const evalSpy = vi.spyOn(globalThis as { eval: (code: string) => unknown }, 'eval');

    const importSeed = makeFakeImportSeed();

    // Carga maliciosa como TEXTO JSON cru: inclui uma chave literal "__proto__"
    // (poluição de protótipo) e strings que parecem código. Construímos a string
    // à mão para garantir que o byte-stream contenha de fato a chave "__proto__"
    // (um `JSON.stringify` de objeto com `__proto__:` literal a omitiria). Tudo é
    // apenas texto dentro do JSON; nenhum campo é interpretado como código.
    const lineupJson = JSON.stringify(lineup('malicioso', 400));
    const maliciousJson =
      '{' +
      '"__proto__":{"polluted":true},' +
      '"teamSeedId":"malicioso",' +
      `"lineup":${lineupJson},` +
      '"strategy":{"preset":"EQUILIBRADO",' +
      '"note":"globalThis.__PFL_SEED_SENTINEL__(); eval(\\"1+1\\"); require(\\"fs\\")"},' +
      '"payloadCode":"process.exit(1); (function(){__PFL_SEED_SENTINEL__()})()"' +
      '}';
    expect(maliciousJson).toContain('__proto__'); // o byte-stream contém a chave
    const seedBytes = new TextEncoder().encode(maliciousJson);

    const input: PreSimulacaoInput = {
      playerDraft: {
        lineup: lineup('time-jogador', 100),
        strategy: STRATEGY_PLAYER,
      },
      modo: 'importar_seed',
      seedBytes,
    };
    const deps: PreSimulacaoDeps = {
      validateDraft: () => [],
      hasBlocking: () => false,
      importSeed,
    };

    const result = orquestrarPreSimulacao(input, deps);

    // A seed é parseada como DADOS: a forma mínima é válida, logo aprova — mas
    // nada do conteúdo "parecido com código" é executado.
    expect(result.ok).toBe(true);

    // Prova central (R3.4): nenhum código da seed rodou.
    expect(sentinel.executed).toBe(0);
    expect(evalSpy).not.toHaveBeenCalled();

    // E a poluição de protótipo via chave `__proto__` do literal NÃO vazou para
    // Object.prototype (o literal com `__proto__` apenas define o protótipo do
    // objeto local; e `JSON.parse` trata `"__proto__"` como própria chave de dados).
    expect(
      (Object.prototype as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();

    // Limpeza do sentinela global.
    delete g.__PFL_SEED_SENTINEL__;
    evalSpy.mockRestore();
  });
});
