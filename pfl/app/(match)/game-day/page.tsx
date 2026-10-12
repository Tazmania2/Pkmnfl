'use client';

/**
 * Rota **Game Day** (`app/(match)/game-day/page.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 16.1.
 *
 * Client Component **orquestrador** da Tela_Game_Day. É a cola entre a store de
 * partida (`useMatchStore`, montada pelo layout do grupo `(match)`), os módulos
 * puros de `@/lib/match` (mapeamento de modo, geração de seed, orquestração de
 * pré-simulação, chamada ao motor, planejador de cenas) e os componentes de
 * **apresentação** de `@/components/gameday`. Nenhuma regra de jogo vive aqui: a
 * página apenas **sequencia** o fluxo e **repassa** dados — "o log é a única
 * verdade" e "apresentação separada de lógica" (design → "Fluxo das telas",
 * "Máquina de estados da tela Game Day").
 *
 * ## Fluxo conectado (FSM)
 *
 * 1. **Selecionando**: `SeletorModo` (ligado a `state.modo` + `selecionarModo`)
 *    e `SeedRngDisplay(state.seedRng)`. No `importar_seed`, mostra o
 *    `ImportadorSeedAdversario` com um handler de importação injetado.
 * 2. **Confirmar** (`BotaoConfirmar`, habilitado por `confirmarHabilitado`):
 *    roda `orquestrarPreSimulacao` (validação do jogador + import do adversário);
 *    em recusa → `registrarErro`; em aprovação → gera `Seed_RNG` com
 *    `gerarSeedRng()`, `iniciarSimulacao(seed)` (R5.2) e chama `runSimulation`
 *    **uma única vez** (R6.1).
 * 3. **Sucesso** → `concluirSimulacao(log, score)` (R6.3) → `buildAnimationScenes`
 *    → `PainelAndamento` (HUD no `eventIndex` corrente) + `AnimationPlayer` +
 *    `AlternativaTextual`. **Erro** (INPUT/NETWORK) → `registrarErro` + `AvisoErro`
 *    com retry (R6.5, R7.4).
 * 4. **Simulando** (sem log) → só `EstadoCarregamento`, sem placar/estatística
 *    (R7.1–R7.3).
 * 5. `AnimationPlayer` `onComplete`/pular → `irParaResultado()` +
 *    `router.push('/resultado')` (R9.5, R9.7, R11.2). Cenas vazias → `onComplete`
 *    dispara imediatamente → navega.
 * 6. Velocidade `1|2` é estado local do player; `onToggleSpeed` alterna. O índice
 *    corrente da animação (`onAdvance`) alimenta o `eventIndex` do HUD (mapeado de
 *    `scene.eventIndex`).
 *
 * ## ⚠️ Placeholders de integração com `pfl-team-strategy-ui` (spec 4) e catálogo
 *
 * No momento desta tarefa, a spec `pfl-team-strategy-ui` **ainda não existe** no
 * repositório. As dependências reais abaixo DEVEM ser trocadas pelos módulos
 * reais quando a spec 4 for integrada — todos marcados com `TODO(spec-4)` /
 * `TODO(catalogo)` no código:
 *
 * - **`playerDraft`** (Escalacao + Estrategia do jogador): hoje vem de spec 4
 *   (Meu Time → Estratégia). Usamos um `TeamDraft` placeholder documentado
 *   (`PLACEHOLDER_PLAYER_DRAFT`) para montar o `SimulateInput` e permitir que o
 *   fluxo compile e seja exercitável. Trocar pela fonte real da store de time.
 * - **`validateDraft` / `hasBlocking`**: hoje de `@/lib/validation` (spec 4).
 *   Usamos **stubs pass-through** (`validateDraft → []`, `hasBlocking → false`)
 *   — NÃO fabricam regras de validação; apenas não bloqueiam para que o gate
 *   `confirmarHabilitado` e `orquestrarPreSimulacao` fiquem ligados. Trocar pelas
 *   funções reais pré-ligadas ao retrato de elegibilidade/anatomia.
 * - **`importSeed`**: hoje de `@/lib/seed/import` (spec 4). O handler injetado no
 *   `ImportadorSeedAdversario` usa um stub (`PLACEHOLDER_IMPORT_SEED`) que recusa
 *   com motivo honesto ("importação de seed ainda não integrada") — não fabrica
 *   um `TeamDraft`. Trocar pela `importSeed` real (seed tratada como dados, R3.4).
 * - **`SpeciesRawIndex`** (sprites da Animacao_8bit): a Camada_Leitura (`lib/data`
 *   de `pfl-data-catalog`) materializa o índice `pokemonId → raw_data`. Montá-lo
 *   pode exigir dados assíncronos/servidor; usamos um índice **vazio**
 *   (`EMPTY_SPECIES_INDEX`) como placeholder — `resolveSprite` cai no substituto
 *   local (R9.6), sem bloquear. Trocar pelo índice real quando disponível.
 *
 * _Requirements: 4.1, 5.1, 5.2, 6.1, 6.3, 6.5, 7.1, 7.4, 9.5, 9.7, 11.2_
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useMatchStore } from '@/components/match';
import {
  SeletorModo,
  SeedRngDisplay,
  ImportadorSeedAdversario,
  BotaoConfirmar,
  EstadoCarregamento,
  AvisoErro,
  PainelAndamento,
  AnimationPlayer,
  AlternativaTextual,
  type ImportFileHandler,
} from '@/components/gameday';
import {
  confirmarHabilitado,
  gerarSeedRng,
  modoParaBot,
  runSimulation,
  buildAnimationScenes,
  orquestrarPreSimulacao,
} from '@/lib/match';
import type {
  Scene,
  SpeciesRawIndex,
  SimulateInput,
  SimulateOutcome,
  TeamDraft,
  ValidationWarning,
  ImportResult,
  PreSimulacaoDeps,
  LineupInput,
  StrategyInput,
  ModoAdversario,
} from '@/lib/match';

// ===========================================================================
// Placeholders de integração — spec 4 (pfl-team-strategy-ui) e catálogo
// ===========================================================================
//
// Tudo nesta seção é PROVISÓRIO e deve ser substituído na integração. Cada item
// é um stub honesto: ou não bloqueia (validação pass-through), ou recusa com um
// motivo claro (import), ou cai no substituto local (sprites). NENHUM fabrica
// valores de jogo.

/**
 * TODO(spec-4): escalação placeholder do jogador. A escalação real (três
 * unidades com atletas) virá da store de time da spec 4. Esta forma mínima só
 * existe para montar o `SimulateInput` e deixar o fluxo compilável/exercitável.
 */
const PLACEHOLDER_PLAYER_LINEUP: LineupInput = {
  units: {
    offense: [],
    defense: [],
    specialTeams: [],
  },
};

/**
 * TODO(spec-4): estratégia placeholder do jogador. A estratégia real (preset +
 * pesos/prioridades) virá da tela de Estratégia da spec 4.
 */
const PLACEHOLDER_PLAYER_STRATEGY: StrategyInput = {
  preset: 'BALANCED',
};

/**
 * TODO(spec-4): rascunho placeholder do time do jogador (Escalacao + Estrategia).
 * Substituir pela leitura do rascunho real produzido por Meu Time → Estratégia
 * (`pfl-team-strategy-ui`). É consumido por `orquestrarPreSimulacao` (validação)
 * e por `buildSimulateInput` (montagem do request ao motor).
 */
const PLACEHOLDER_PLAYER_DRAFT: TeamDraft = {
  lineup: PLACEHOLDER_PLAYER_LINEUP,
  strategy: PLACEHOLDER_PLAYER_STRATEGY,
};

/**
 * TODO(spec-4): escalação placeholder do adversário para os modos que NÃO
 * importam seed (`bot_aleatorio`, `desafiar_curti`). Com o motor dirigindo o bot
 * via `botModeAway`, a escalação do adversário será resolvida pela integração
 * real; aqui enviamos uma escalação vazia como marcador.
 */
const PLACEHOLDER_ADVERSARY_LINEUP: LineupInput = {
  units: {
    offense: [],
    defense: [],
    specialTeams: [],
  },
};

/** TODO(spec-4): estratégia placeholder do adversário (modos sem seed). */
const PLACEHOLDER_ADVERSARY_STRATEGY: StrategyInput = {
  preset: 'BALANCED',
};

/**
 * TODO(spec-4): stub pass-through de `validateDraft` (de `@/lib/validation`).
 * NÃO implementa regras de validação de time — apenas devolve "sem avisos" para
 * que o gate de confirmação e a orquestração fiquem ligados sem bloquear. A
 * função real recebe também o retrato de elegibilidade e as convenções de
 * anatomia (ver `pfl-team-strategy-ui`).
 */
const validateDraftStub = (_draft: TeamDraft): ReadonlyArray<ValidationWarning> => [];

/**
 * TODO(spec-4): stub pass-through de `hasBlocking` (de `@/lib/validation`).
 * NÃO reimplementa a noção de "bloqueante" — devolve `false` (nunca bloqueia).
 */
const hasBlockingStub = (_warnings: ReadonlyArray<ValidationWarning>): boolean => false;

/**
 * TODO(spec-4): stub de `importSeed` (de `@/lib/seed/import`). Trata a seed como
 * dados (não executa conteúdo), mas, como o pipeline real ainda não existe,
 * **recusa** com um motivo honesto em vez de fabricar um `TeamDraft`. Trocar
 * pela `importSeed` real quando a spec 4 for integrada.
 */
const PLACEHOLDER_IMPORT_SEED = (_bytes: Uint8Array): ImportResult => ({
  ok: false,
  reason: {
    step: 'integracao',
    message: 'importação de seed ainda não integrada (pfl-team-strategy-ui)',
  },
});

/**
 * TODO(catalogo): índice de espécies VAZIO como placeholder da Camada_Leitura
 * (`lib/data` de `pfl-data-catalog`). `resolveSprite` consulta este índice de
 * forma pura; sem entradas, cai no `SPRITE_SUBSTITUTO` local (R9.6) — nunca uma
 * fonte externa (R9.2). Trocar pelo índice real `pokemonId → raw_data` quando a
 * materialização (possivelmente assíncrona/servidor) estiver disponível.
 */
const EMPTY_SPECIES_INDEX: SpeciesRawIndex = {
  get: () => undefined,
};

// ===========================================================================
// Montagem do SimulateInput (R6.1) — a partir do draft do jogador + adversário
// ===========================================================================

/**
 * Monta o `SimulateInput` a partir do rascunho do jogador (placeholder spec-4),
 * do adversário (draft da seed quando `importar_seed`, senão placeholder), do
 * `Seed_RNG` gerado e do `botModeAway` mapeado por `modoParaBot(modo)` (R2.*).
 *
 * TODO(spec-4): substituir `PLACEHOLDER_PLAYER_*` pela escalação/estratégia reais
 * do jogador. O adversário, no `importar_seed`, usa o `TeamDraft` aprovado
 * (retido na store via `setAdversarioSeed`); nos demais modos, o motor dirige o
 * bot por `botModeAway` e os placeholders de adversário são enviados como
 * marcadores.
 */
function buildSimulateInput(
  seedRng: string,
  modo: ModoAdversario,
  adversarioSeedDraft: TeamDraft | null,
): SimulateInput {
  const adversaryLineup: LineupInput =
    adversarioSeedDraft?.lineup ?? PLACEHOLDER_ADVERSARY_LINEUP;
  const adversaryStrategy: StrategyInput =
    adversarioSeedDraft?.strategy ?? PLACEHOLDER_ADVERSARY_STRATEGY;

  return {
    // TODO(spec-4): escalação/estratégia reais do jogador.
    playerLineup: PLACEHOLDER_PLAYER_DRAFT.lineup,
    playerStrategy: PLACEHOLDER_PLAYER_DRAFT.strategy,
    adversaryLineup,
    adversaryStrategy,
    seedRng,
    botModeAway: modoParaBot(modo),
  };
}

// ===========================================================================
// Página
// ===========================================================================

/** `id` do controle de confirmação para associação ARIA do `AvisoErro` (R17.7). */
const CONFIRMAR_CONTROL_ID = 'pfl-game-day-confirmar';

export default function GameDayPage(): ReactNode {
  const router = useRouter();
  const { store, state } = useMatchStore();

  // Velocidade do player, estado local 1x↔2x (R11.3, R11.4). Único estado de
  // reprodução no pai; o índice/cadência da cena é interno ao AnimationPlayer.
  const [speed, setSpeed] = useState<1 | 2>(1);

  // Índice da cena corrente, alimentado por `onAdvance` do player, usado para
  // projetar o HUD (`PainelAndamento`) e destacar a cena na `AlternativaTextual`.
  const [sceneIndex, setSceneIndex] = useState<number>(0);

  // Bytes da seed importada do adversário (modo importar_seed). Repassados a
  // `orquestrarPreSimulacao` no momento da confirmação (seed tratada como dados).
  const seedBytesRef = useRef<Uint8Array | null>(null);

  // Dependências injetadas na orquestração pré-simulação (stubs spec-4).
  // TODO(spec-4): trocar `validateDraftStub`/`hasBlockingStub`/`PLACEHOLDER_IMPORT_SEED`
  // pelas funções reais de `@/lib/validation` e `@/lib/seed/import`.
  const preSimulacaoDeps = useMemo<PreSimulacaoDeps>(
    () => ({
      validateDraft: validateDraftStub,
      hasBlocking: hasBlockingStub,
      importSeed: PLACEHOLDER_IMPORT_SEED,
    }),
    [],
  );

  // Cenas da animação, derivadas puramente do log retido (recomputadas só quando
  // o log muda). Sem log ainda → sem cenas.
  const scenes: ReadonlyArray<Scene> = useMemo<ReadonlyArray<Scene>>(
    () => (state.log !== null ? buildAnimationScenes(state.log) : []),
    [state.log],
  );

  // Gate do botão confirmar (R4.5, R5.1): modo + validação sem bloqueio (stub) +
  // seed aprovada no importar_seed. Os avisos do jogador vêm do stub pass-through.
  // TODO(spec-4): passar os avisos reais de `validateDraft(playerDraft)`.
  const playerWarnings = useMemo<ReadonlyArray<ValidationWarning>>(
    () => validateDraftStub(PLACEHOLDER_PLAYER_DRAFT),
    [],
  );
  const habilitado = confirmarHabilitado(state, playerWarnings);
  const simulando = state.phase === 'Simulando';

  // -------------------------------------------------------------------------
  // Handlers de seleção/importação (fase Selecionando)
  // -------------------------------------------------------------------------

  const handleSelecionarModo = useCallback(
    (modo: ModoAdversario) => {
      // Troca de modo descarta bytes de seed pendentes (coerente com a store,
      // que descarta o `adversarioSeedDraft` ao sair do importar_seed).
      seedBytesRef.current = null;
      store.selecionarModo(modo);
    },
    [store],
  );

  /**
   * Handler de importação injetado no `ImportadorSeedAdversario`: recebe os bytes
   * do `.pflseed.json` (seed como dados, R3.4), guarda-os para a confirmação e
   * delega ao `importSeed` injetado. Em aprovação, retém o `TeamDraft` do
   * adversário na store (R3.3). O resultado é devolvido ao componente para que
   * ele exiba o motivo em recusa.
   *
   * TODO(spec-4): com a `importSeed` real, o retorno `ok:true` trará um
   * `TeamDraft` válido; hoje o stub recusa (`ok:false`), então nenhum draft é
   * retido e o gate de confirmação permanece bloqueado no importar_seed.
   */
  const handleImportFile = useCallback<ImportFileHandler>(
    (bytes) => {
      seedBytesRef.current = bytes;
      const result = PLACEHOLDER_IMPORT_SEED(bytes);
      if (result.ok) {
        store.setAdversarioSeed(result.draft);
      }
      return result;
    },
    [store],
  );

  // -------------------------------------------------------------------------
  // Confirmar → pré-simulação → runSimulation (fase Validando/Simulando)
  // -------------------------------------------------------------------------

  const executarSimulacao = useCallback(async () => {
    const modo = state.modo;
    if (modo === null) {
      return;
    }

    // (1) Orquestração pré-simulação (R4.1, R3.*): valida o time do jogador e,
    // no importar_seed, importa a seed do adversário. Puro; não toca a store.
    // TODO(spec-4): `PLACEHOLDER_PLAYER_DRAFT` → rascunho real do jogador.
    const pre = orquestrarPreSimulacao(
      {
        playerDraft: PLACEHOLDER_PLAYER_DRAFT,
        modo,
        seedBytes: seedBytesRef.current ?? undefined,
      },
      preSimulacaoDeps,
    );

    if (!pre.ok) {
      // Recusa (validação/importação): não simula; registra erro e preserva o
      // estado para nova tentativa (R4.1, R4.3, R3.2, R4.4).
      store.registrarErro(pre.error);
      return;
    }

    // Aprovação: retém o adversário da seed, se houver (R3.3).
    if (pre.adversarioDraft !== undefined) {
      store.setAdversarioSeed(pre.adversarioDraft);
    }

    // (2) Gera o Seed_RNG (entropia só aqui) e inicia a simulação de um clique
    // só (R5.2). `iniciarSimulacao` é idempotente: 2º clique em Simulando é no-op.
    const seedRng = gerarSeedRng();
    store.iniciarSimulacao(seedRng);

    // (3) Chama o motor UMA única vez (R6.1). Monta o request do draft do jogador
    // + adversário (seed ou placeholder) + modoParaBot(modo) + Seed_RNG.
    const input = buildSimulateInput(seedRng, modo, pre.adversarioDraft ?? state.adversarioSeedDraft);
    const outcome: SimulateOutcome = await runSimulation(input);

    if (outcome.ok) {
      // Sucesso: retém log+score verbatim e avança para Animando (R6.3).
      setSceneIndex(0);
      store.concluirSimulacao(outcome.log, outcome.score);
      return;
    }

    // Erro de entrada (INPUT, R6.5) ou de comunicação (NETWORK, R7.4): registra;
    // NÃO anima nem navega. O estado (modo/seed) é preservado para retry.
    store.registrarErro(
      outcome.kind === 'INPUT'
        ? { kind: 'INPUT', message: outcome.message, field: outcome.field }
        : { kind: 'NETWORK', message: outcome.message },
    );
  }, [state.modo, state.adversarioSeedDraft, preSimulacaoDeps, store]);

  const handleConfirmar = useCallback(() => {
    void executarSimulacao();
  }, [executarSimulacao]);

  /**
   * Retry a partir da fase `Erro` (R7.4): a FSM só reinicia a simulação a partir
   * de `Selecionando`, então voltamos a essa fase preservando modo/seed e então
   * reexecutamos. `iniciarSimulacao` só transita de `Selecionando`, logo o retry
   * precisa que o estado volte a essa fase. Fazemos isso reusando `selecionarModo`
   * com o modo corrente (no-op de dados, mas garante a fase de origem) antes de
   * reexecutar.
   *
   * NOTA: a store não expõe uma transição `Erro → Selecionando` dedicada; o
   * design prevê "nova tentativa (estado preservado)". Reemitimos o modo atual
   * (que a store só aceita em `Selecionando`) é insuficiente aqui porque estamos
   * em `Erro`. Portanto o retry efetivo é um `reset` do estado de erro seguido de
   * re-seleção do mesmo modo; preservamos a seleção do jogador reinformando-a.
   */
  const handleRetry = useCallback(() => {
    const modoAtual = state.modo;
    const adversario = state.adversarioSeedDraft;
    // Volta ao início da FSM (sai de `Erro`) sem perder a intenção do jogador.
    store.reset();
    if (modoAtual !== null) {
      store.selecionarModo(modoAtual);
      if (modoAtual === 'importar_seed' && adversario !== null) {
        store.setAdversarioSeed(adversario);
      }
    }
    // Reexecuta o fluxo de confirmação com a mesma seleção.
    void executarSimulacao();
  }, [state.modo, state.adversarioSeedDraft, store, executarSimulacao]);

  // -------------------------------------------------------------------------
  // Animação → Resultado (fase Animando → Resultado)
  // -------------------------------------------------------------------------

  /**
   * Avanço de cena do player: sincroniza o índice usado pelo HUD/Alternativa.
   */
  const handleAdvance = useCallback((index: number) => {
    setSceneIndex(index);
  }, []);

  /** Alterna a velocidade do player 1x↔2x (R11.3, R11.4). */
  const handleToggleSpeed = useCallback(() => {
    setSpeed((s) => (s === 1 ? 2 : 1));
  }, []);

  /**
   * Conclusão da animação (todos os Snaps, pulo, ou log vazio): avança a FSM
   * `Animando → Resultado` e navega para `/resultado` (R9.5, R9.7, R11.2). Com
   * cenas vazias, o `AnimationPlayer` dispara `onComplete` imediatamente — a
   * navegação acontece sem reprodução.
   */
  const handleComplete = useCallback(() => {
    store.irParaResultado();
    router.push('/resultado');
  }, [store, router]);

  // -------------------------------------------------------------------------
  // Projeção para o HUD: mapeia a cena corrente → eventIndex do log
  // -------------------------------------------------------------------------

  // Índice da cena corrente clampado à faixa válida; o HUD projeta o `eventIndex`
  // do log correspondente via `progressAt` dentro do `PainelAndamento`.
  const cenaCorrente: Scene | undefined =
    scenes.length > 0
      ? scenes[Math.min(Math.max(sceneIndex, 0), scenes.length - 1)]
      : undefined;

  // -------------------------------------------------------------------------
  // Render por fase da FSM
  // -------------------------------------------------------------------------

  const emSelecao = state.phase === 'Selecionando' || state.phase === 'Validando';
  const emErro = state.phase === 'Erro';
  const emAnimacao = state.phase === 'Animando';

  return (
    <main aria-label="Game Day">
      <h1>Game Day</h1>

      {/* --- Fase de seleção/validação: escolher modo, seed, importar, confirmar --- */}
      {emSelecao || emErro ? (
        <section aria-label="Preparação da partida">
          <SeletorModo selected={state.modo} onSelect={handleSelecionarModo} />

          <SeedRngDisplay seedRng={state.seedRng} />

          {/* Importador só no Modo_Importar_Seed. O handler injetado liga a
              `importSeed` (hoje stub spec-4). */}
          {state.modo === 'importar_seed' ? (
            <ImportadorSeedAdversario
              onImportFile={handleImportFile}
              rejection={
                state.erro?.kind === 'IMPORT' ? state.erro.message : null
              }
            />
          ) : null}

          {/* Único controle de confirmação, habilitado por `confirmarHabilitado`
              e idempotente em `Simulando` (R5.1–R5.3). Associado ao AvisoErro
              por ARIA (R17.7). */}
          <div id={CONFIRMAR_CONTROL_ID}>
            <BotaoConfirmar
              habilitado={habilitado}
              simulando={simulando}
              onConfirmar={handleConfirmar}
            />
          </div>

          {/* Erro de entrada/comunicação com retry (R6.5, R7.4). */}
          {emErro ? (
            <AvisoErro
              error={state.erro}
              controlId={CONFIRMAR_CONTROL_ID}
              onRetry={handleRetry}
            />
          ) : null}
        </section>
      ) : null}

      {/* --- Fase Simulando: carregamento honesto, SEM placar/estatística (R7.*) --- */}
      {simulando ? <EstadoCarregamento /> : null}

      {/* --- Fase Animando: HUD + player + alternativa textual (R8/R9/R11) --- */}
      {emAnimacao && state.log !== null ? (
        <section aria-label="Partida em andamento">
          {/* HUD do Snap corrente, projetado do log via progressAt. */}
          {cenaCorrente !== undefined ? (
            <PainelAndamento log={state.log} eventIndex={cenaCorrente.eventIndex} />
          ) : null}

          {/* Player burro: reproduz as cenas; pular/concluir → navega ao resultado.
              Cenas vazias → onComplete imediato → navega (R9.7). Sprites via
              SpeciesRawIndex (placeholder vazio → substituto local, R9.6). */}
          <AnimationPlayer
            scenes={scenes}
            speed={speed}
            species={EMPTY_SPECIES_INDEX}
            onAdvance={handleAdvance}
            onComplete={handleComplete}
            onToggleSpeed={handleToggleSpeed}
          />

          {/* Equivalente textual acessível, invariante ao modo de reprodução (R11.5). */}
          <AlternativaTextual scenes={scenes} currentIndex={sceneIndex} />
        </section>
      ) : null}
    </main>
  );
}
