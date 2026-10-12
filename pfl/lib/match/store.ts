/**
 * Store de partida e FSM da Tela_Game_Day (`lib/match/store.ts`) — spec
 * `pfl-gameday-result-ui`.
 *
 * Documento em memória compartilhado pelas duas telas (Game Day → Resultado),
 * modelado como uma **máquina de estados explícita** cujas transições são
 * **funções puras** do estado corrente (design → "Máquina de estados da tela
 * Game Day" e "Store de partida"). Modelar a orquestração como FSM torna "um
 * clique só" (R5.2), a idempotência da confirmação (R5.3), o "loading honesto"
 * (R7) e o "não reenviar ao navegar" invariantes verificáveis.
 *
 * Princípios de design refletidos:
 * - **O log é a única verdade** (R6.4): a store **nunca** calcula placar/
 *   estatística — apenas **retém** o `GameLog`/`Score` que o motor devolveu
 *   (`concluirSimulacao`). Nenhuma transição deriva valores de jogo.
 * - **Apresentação separada de lógica**: este módulo é framework-agnóstico (sem
 *   React, sem DOM, sem rede). O Context provider que o monta acima das rotas é
 *   a Task 12.1; o adaptador de chamada ao motor é a Task 9.
 * - **FSM estritamente orientada**: a exibição de andamento/placar só é possível
 *   a partir de `Animando` (quando `log`/`score` existem, R7.3). As transições
 *   são as únicas arestas do diagrama de estados; chamadas fora da fase de
 *   origem são ignoradas (não lançam), mantendo a store resiliente a cliques
 *   repetidos e navegação.
 *
 * NOTA (Task 8.2): `snapshot()`/`restore()` são a **(de)serialização pura** do
 * estado em memória. `snapshot()` produz um JSON **estável** (chaves ordenadas
 * lexicograficamente em todos os níveis, formato compacto) reusando o
 * `stableStringify` do núcleo (`@/lib/sim/log`) — o mesmo serializador canônico
 * do `Log_Partida`. Serialização estável garante que o mesmo `MatchState`
 * sempre gere exatamente a mesma string, o que torna a sobrevivência a
 * refresh/deep-link em `/resultado` determinística (R16.2) e mantém o
 * `Seed_RNG` exibido rastreável byte a byte (R16.3). `restore()` reaplica o
 * estado **verbatim** — sem recalcular placar/estatística/log (R6.4) —
 * guardando-se contra entrada malformada. A persistência em `sessionStorage`
 * propriamente dita é orquestrada pelo Context provider (Task 12.1): a store
 * permanece framework-agnóstica (sem DOM, sem `window`).
 *
 * _Requirements: 1.2, 3.3, 5.2, 5.3, 6.3, 6.4, 7.3, 4.5, 5.1, 16.2, 16.3_
 */

import type {
  MatchState,
  MatchPhase,
  MatchError,
  ModoAdversario,
} from './types';
import type { GameLog, Score, TeamDraft, ValidationWarning } from './contracts';
import { stableStringify } from '@/lib/sim/log';

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

/**
 * Estado inicial canônico da partida: fase `Selecionando`, sem modo escolhido,
 * sem seed, sem time de adversário, sem log/placar e sem erro. É o estado para o
 * qual `reset()` retorna e o ponto de entrada da FSM (`[*] → Selecionando`).
 */
export const ESTADO_INICIAL: MatchState = Object.freeze({
  phase: 'Selecionando',
  modo: null,
  seedRng: null,
  adversarioSeedDraft: null,
  log: null,
  score: null,
  erro: null,
});

// ---------------------------------------------------------------------------
// Gate de confirmação — função pura (Property 3, R4.5/R5.1)
// ---------------------------------------------------------------------------

/**
 * Gate do controle único de confirmação (`BotaoConfirmar`): o jogador só pode
 * disparar a simulação quando **todas** as pré-condições valem (R5.1, "um clique
 * só"). Função **pura** dos insumos — não lê fase da FSM nem efeitos colaterais;
 * depende apenas de:
 *
 * 1. **modo selecionado** (R1.2): `state.modo !== null`;
 * 2. **validação do time do jogador sem bloqueio** (R4.5): nenhum
 *    `ValidationWarning` com `blocking === true`. Os avisos chegam por parâmetro
 *    porque é a Task 10.1 quem liga `validateDraft`/`hasBlocking` ao fluxo; a
 *    store não reimplementa regras de time (princípio "validação reusada");
 * 3. **(só no `importar_seed`) seed do adversário aprovada** (R3.3): quando o
 *    modo é `importar_seed`, `state.adversarioSeedDraft` deve estar presente
 *    (produzido por `importSeed` aprovado). Nos demais modos esta condição não
 *    se aplica.
 *
 * Habilitado **sse** as três condições valem simultaneamente (Property 3). Por
 * padrão `playerWarnings` é vazio (sem bloqueio).
 */
export function confirmarHabilitado(
  state: MatchState,
  playerWarnings: ReadonlyArray<ValidationWarning> = [],
): boolean {
  // (1) modo precisa estar selecionado.
  if (state.modo === null) {
    return false;
  }

  // (2) validação do time do jogador não pode ter aviso bloqueante.
  if (playerWarnings.some((w) => w.blocking)) {
    return false;
  }

  // (3) no modo importar_seed, o time do adversário precisa estar aprovado.
  if (state.modo === 'importar_seed' && state.adversarioSeedDraft === null) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Transições puras da FSM
// ---------------------------------------------------------------------------
//
// Cada transição recebe o estado corrente e devolve o **próximo** estado, sem
// mutar o recebido (todos os campos de `MatchState` são `readonly`). Chamadas
// fora da fase de origem retornam o estado inalterado — a FSM nunca lança por
// transição inválida, apenas ignora, o que casa com a semântica de "clique
// repetido ignorado" (R5.3) e protege contra ordens de evento inesperadas.

/**
 * `selecionarModo` (R1.2): registra **exatamente** o modo escolhido. Só é aceito
 * na fase `Selecionando` — depois que a simulação começou, o modo não muda. Ao
 * trocar de modo, o `adversarioSeedDraft` previamente importado é descartado,
 * pois ele pertence especificamente ao `importar_seed` (evita reaproveitar o
 * time de um adversário para outro modo).
 */
function reduceSelecionarModo(state: MatchState, modo: ModoAdversario): MatchState {
  if (state.phase !== 'Selecionando') {
    return state;
  }
  return {
    ...state,
    modo,
    adversarioSeedDraft: modo === 'importar_seed' ? state.adversarioSeedDraft : null,
  };
}

/**
 * `setAdversarioSeed` (R3.3): retém o `TeamDraft` do adversário produzido por um
 * `importSeed` aprovado. Só faz sentido no modo `importar_seed` e durante a
 * seleção; em qualquer outra combinação a chamada é ignorada. A store trata a
 * seed **como dados** — não executa nem interpreta conteúdo (R3.4 é garantido na
 * borda de importação, Task 10.1).
 */
function reduceSetAdversarioSeed(state: MatchState, draft: TeamDraft): MatchState {
  if (state.phase !== 'Selecionando' || state.modo !== 'importar_seed') {
    return state;
  }
  return { ...state, adversarioSeedDraft: draft };
}

/**
 * `iniciarSimulacao` (R5.2, R5.3): confirmação de um clique só. Transita
 * `Selecionando → Validando → Simulando` numa única chamada, retendo o
 * `Seed_RNG` exibível (R16.3) — distinto do seed de time (R6.2) — e limpando
 * qualquer erro anterior.
 *
 * **Idempotência (R5.3)**: só transita a partir de `Selecionando`. Uma chamada
 * na fase `Simulando` (ex.: segundo clique enquanto o motor responde) é
 * ignorada: a store permanece em `Simulando` sem reenviar a simulação. Chamadas
 * em qualquer outra fase também são no-ops.
 */
function reduceIniciarSimulacao(state: MatchState, seedRng: string): MatchState {
  if (state.phase !== 'Selecionando') {
    // Em `Simulando` (ou qualquer fase que não `Selecionando`): no-op idempotente.
    return state;
  }
  return {
    ...state,
    phase: 'Simulando',
    seedRng,
    erro: null,
  };
}

/**
 * `concluirSimulacao` (R6.3, R6.4): recebeu `log`+`score` do motor. Transita
 * `Simulando → Animando` **retendo** exatamente o que o motor devolveu — a store
 * nunca recalcula placar/estatística. Só é aceito na fase `Simulando`; em outra
 * fase é ignorado (evita sobrescrever um resultado já consumido).
 */
function reduceConcluirSimulacao(state: MatchState, log: GameLog, score: Score): MatchState {
  if (state.phase !== 'Simulando') {
    return state;
  }
  return {
    ...state,
    phase: 'Animando',
    log,
    score,
    erro: null,
  };
}

/**
 * `registrarErro` (R6.5, R7.4): erro de entrada (400 do motor) ou de comunicação
 * (rede/timeout). Transita `Simulando → Erro` retendo a mensagem legível (alvo
 * ARIA em `field`). **Preserva** `modo`, `seedRng` e `adversarioSeedDraft` para
 * permitir nova tentativa sem recomeçar a seleção (R7.4). Só transita a partir
 * de `Simulando`.
 */
function reduceRegistrarErro(state: MatchState, erro: MatchError): MatchState {
  if (state.phase !== 'Simulando') {
    return state;
  }
  return {
    ...state,
    phase: 'Erro',
    erro,
  };
}

/**
 * `irParaResultado`: transita `Animando → Resultado` quando a reprodução termina
 * (todos os Snaps, pulo, ou log vazio). O `log`/`score` já retidos são a fonte
 * do desfecho e dos highlights na Tela_Resultado — nada é recalculado. Só é
 * aceito na fase `Animando`.
 */
function reduceIrParaResultado(state: MatchState): MatchState {
  if (state.phase !== 'Animando') {
    return state;
  }
  return { ...state, phase: 'Resultado' };
}

/**
 * `reset`: retorna ao estado inicial (`Selecionando`), descartando modo, seed,
 * time do adversário, log/placar e erro. Usado para iniciar uma nova partida.
 */
function reduceReset(): MatchState {
  return { ...ESTADO_INICIAL };
}

// ---------------------------------------------------------------------------
// (De)serialização do snapshot — restauração verbatim e defensiva (R6.4, R16.2)
// ---------------------------------------------------------------------------

/** Conjunto fechado das fases válidas da FSM, para validação de restauração. */
const FASES_VALIDAS: ReadonlySet<MatchPhase> = new Set<MatchPhase>([
  'Selecionando',
  'Validando',
  'Simulando',
  'Animando',
  'Resultado',
  'Erro',
]);

/**
 * Converte uma string de snapshot de volta num `MatchState`, **sem recalcular**
 * valores (log/placar retornam exatamente como foram serializados, R6.4). A
 * entrada é tratada como dados não confiáveis (pode vir de `sessionStorage`
 * adulterado ou de uma versão anterior): parsing e a forma do objeto são
 * validados defensivamente. Qualquer anomalia (JSON inválido, não-objeto, fase
 * desconhecida) resulta em `null` — o chamador então **mantém** o estado atual,
 * em vez de corromper a FSM.
 *
 * A validação é estrutural e mínima: confirma que `phase` é uma fase conhecida
 * e que os campos nulos-ou-presentes têm o tipo esperado. Não reconstrói nem
 * normaliza `log`/`score` — eles são retidos verbatim, coerentes com o princípio
 * "o log é a única verdade".
 */
function parseSnapshot(snapshotStr: string): MatchState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotStr);
  } catch {
    // JSON malformado: nada a restaurar.
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Fase precisa pertencer ao conjunto fechado da FSM.
  if (typeof obj.phase !== 'string' || !FASES_VALIDAS.has(obj.phase as MatchPhase)) {
    return null;
  }

  // `modo` é um dos três modos ou `null`.
  const modo = obj.modo;
  if (
    modo !== null &&
    modo !== 'bot_aleatorio' &&
    modo !== 'desafiar_curti' &&
    modo !== 'importar_seed'
  ) {
    return null;
  }

  // `seedRng` é string decimal ou `null`.
  if (obj.seedRng !== null && typeof obj.seedRng !== 'string') {
    return null;
  }

  // Reconstrói o estado verbatim (sem recálculo). Campos ausentes no snapshot
  // (ex.: `undefined` omitido por `stableStringify`) voltam como `null`,
  // mantendo a forma total de `MatchState`.
  return {
    phase: obj.phase as MatchPhase,
    modo: (modo ?? null) as ModoAdversario | null,
    seedRng: (obj.seedRng ?? null) as string | null,
    adversarioSeedDraft: (obj.adversarioSeedDraft ?? null) as TeamDraft | null,
    log: (obj.log ?? null) as GameLog | null,
    score: (obj.score ?? null) as Score | null,
    erro: (obj.erro ?? null) as MatchError | null,
  };
}

// ---------------------------------------------------------------------------
// Interface e fábrica da store
// ---------------------------------------------------------------------------

/**
 * Store de partida: documento em memória com as transições da FSM e um snapshot
 * serializável. As transições delegam aos redutores puros acima; a store apenas
 * guarda o estado corrente e expõe `getState()` para leitura.
 *
 * `snapshot()`/`restore()` são a (de)serialização estável do estado para
 * sobreviver a refresh/deep-link em `/resultado` (R16.2); a persistência em
 * `sessionStorage` é orquestrada pelo provider (Task 12.1).
 */
export interface MatchStore {
  /** Lê o estado corrente (imutável). */
  getState(): MatchState;
  /** Registra o modo selecionado (R1.2); só na fase `Selecionando`. */
  selecionarModo(modo: ModoAdversario): void;
  /** Retém o time do adversário após `importSeed` aprovado (R3.3). */
  setAdversarioSeed(draft: TeamDraft): void;
  /** Confirmação de um clique: `Selecionando→Simulando`; idempotente (R5.2, R5.3). */
  iniciarSimulacao(seedRng: string): void;
  /** Retém `log`+`score` do motor e avança `Simulando→Animando` (R6.3, R6.4). */
  concluirSimulacao(log: GameLog, score: Score): void;
  /** Registra erro e avança `Simulando→Erro`, preservando o estado (R6.5, R7.4). */
  registrarErro(e: MatchError): void;
  /** Avança `Animando→Resultado` ao fim da reprodução. */
  irParaResultado(): void;
  /** Retorna ao estado inicial (nova partida). */
  reset(): void;
  /** Serializa `MatchState` de forma estável (JSON canônico), R16.2/R16.3. */
  snapshot(): string;
  /** Restaura `MatchState` de um snapshot, sem recalcular valores (R6.4, R16.2). */
  restore(snapshot: string): void;
}

/**
 * Fábrica da store de partida. Cria uma instância independente com o estado
 * inicial; cada chamada produz uma store isolada (útil para testes e para o
 * provider montar uma por sessão). As transições substituem a referência de
 * estado interna pelo resultado do redutor puro correspondente — sem mutação
 * do estado anterior.
 */
export function createMatchStore(): MatchStore {
  let state: MatchState = { ...ESTADO_INICIAL };

  return {
    getState() {
      return state;
    },
    selecionarModo(modo) {
      state = reduceSelecionarModo(state, modo);
    },
    setAdversarioSeed(draft) {
      state = reduceSetAdversarioSeed(state, draft);
    },
    iniciarSimulacao(seedRng) {
      state = reduceIniciarSimulacao(state, seedRng);
    },
    concluirSimulacao(log, score) {
      state = reduceConcluirSimulacao(state, log, score);
    },
    registrarErro(e) {
      state = reduceRegistrarErro(state, e);
    },
    irParaResultado() {
      state = reduceIrParaResultado(state);
    },
    reset() {
      state = reduceReset();
    },
    // --- Persistência (Task 8.2): (de)serialização estável ----------------
    // `snapshot` serializa o estado corrente como JSON canônico (chaves
    // ordenadas, compacto) via `stableStringify` do núcleo — mesmo serializador
    // do `Log_Partida`. `restore` reaplica o estado verbatim, sem recalcular
    // nenhum valor (R6.4), guardando-se contra entrada malformada.
    snapshot() {
      return stableStringify(state);
    },
    restore(snapshotStr: string) {
      const parsed = parseSnapshot(snapshotStr);
      if (parsed !== null) {
        state = parsed;
      }
    },
  };
}

// Reexporta os tipos de fase/estado que acompanham a FSM, para consumidores que
// importam a store sem precisar tocar em `./types` diretamente.
export type { MatchState, MatchPhase, MatchError, ModoAdversario };
