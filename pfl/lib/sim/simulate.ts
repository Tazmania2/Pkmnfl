/**
 * Orquestração pura `simulate` (`lib/sim/simulate.ts`).
 *
 * **Capstone** do núcleo de simulação (Task 14.1): a função pura
 * `simulate(input: ResolvedInput): SimulationResult` que liga todas as peças —
 * RNG determinístico, inicialização (sorteio de clima), loop de ticks/quartos,
 * máquina de estados do fluxo de jogo (FSM), pipeline de resolução de jogada,
 * construção do log e estatísticas agregadas.
 *
 * ## Fronteira de pureza (R1.1, R1.5)
 *
 * A função é **totalmente pura**: toda a variação entra por `input`
 * (`ResolvedInput` + `Seed_RNG`) e sai no `SimulationResult`. Nenhuma leitura de
 * `Date`, `Math.random`, `crypto`, `performance`, ambiente, rede ou banco. A
 * única fonte de entropia é um **único** `Rng`, criado uma vez a partir de
 * `input.seed` (R1.2). A mesma `ResolvedInput` sempre produz o mesmo resultado
 * byte a byte.
 *
 * ## Ordem fixa de consumo do RNG (R1.2, design "Ordem fixa de consumo do RNG")
 *
 * 1. **Inicialização**: sorteio do `Clima` — exatamente **um** `nextFloat()`
 *    consumido antes de qualquer jogada (via `weather.roll`).
 * 2. **Por jogada (snap)**, na ordem imposta pelo pipeline: decisão do bot
 *    ofensivo → decisão do bot defensivo → teste de sucesso → amostragens de
 *    resultado (jardas de passe / perda de corrida / fumble), pulando os passos
 *    inaplicáveis à jogada.
 *
 * Special teams são acionados **por estado** (FSM, R11.4) e **não** consomem o
 * RNG de escolha de jogada, preservando a ordem fixa.
 *
 * ## Terminação do loop (sem laços infinitos)
 *
 * Cada jogada consome `clockDeci` do relógio do quarto, derivado
 * **determinísticamente** do resultado por `resolvePlayClock`. Como
 * `derivePlayTicks` garante **≥ 1 tick** por jogada e `DECI_PER_TICK = 1`, toda
 * jogada com relógio restante consome **≥ 1 décimo** — o relógio do quarto
 * **decresce estritamente** a cada jogada. Ao zerar, `resolveClockBoundary`
 * avança o quarto (recarregando o relógio) ou encerra a partida no 4º quarto.
 * Logo o número de jogadas por quarto é limitado por `QUARTER_DECI` e o total de
 * quartos por `TOTAL_QUARTERS`, garantindo terminação. Um limite defensivo de
 * iterações (`MAX_SNAPS`) protege contra um bug de regressão (relógio que não
 * decresce): atingi-lo lança erro, pois indicaria violação do invariante acima.
 *
 * _Requirements: 1.1, 1.5, 1.7, 2.6_
 */

import { createRng, type Rng } from './rng';
import {
  createInitialState,
  applyPlayResolution,
  type PlayResolution,
} from './state';
import { resolvePlayClock, isRegulationOver } from './clock';
import {
  advancePossession,
  resolvePositionalScoring,
  selectSpecialTeams,
  finalizeGame,
  resolveClockBoundary,
  toScore,
  type ScoringResult,
  type PendingDecision,
} from './fsm';
import {
  resolvePlay,
  type PlayPolicies,
  type PipelineLogEvent,
} from './play/pipeline';
import { PLAY_CATALOG, createSituationalPolicy } from './play/select';
import { roll as rollWeather, modifiers as weatherModifiers } from './play/weather';
import { buildGameLog } from './log';
import { computeStats } from './stats';
import type {
  GameState,
  JsonValue,
  ResolvedInput,
  SimulationResult,
  StateSnapshot,
  Weather,
} from './types';

// ---------------------------------------------------------------------------
// Limite defensivo de iterações do loop (indica bug se atingido)
// ---------------------------------------------------------------------------

/**
 * Teto defensivo de jogadas por partida. Com o relógio decrescendo ≥ 1 décimo
 * por jogada, cada quarto (9000 décimos) comporta no máximo 9000 jogadas; quatro
 * quartos ⇒ 36000. Dobramos a folga para `72000` como salvaguarda: ultrapassar
 * esse limite só é possível se o invariante "o relógio decresce a cada jogada"
 * for violado por um bug — nesse caso falhamos cedo com erro determinado em vez
 * de laçar indefinidamente.
 */
const MAX_SNAPS = 72_000;

// ---------------------------------------------------------------------------
// Helpers puros de projeção de estado para eventos de log
// ---------------------------------------------------------------------------

/** Projeta o `GameState` corrente no `StateSnapshot` registrado em um evento. */
function snapshotOf(state: GameState): StateSnapshot {
  return {
    quarter: state.quarter,
    gameClock: state.gameClockDeci,
    down: state.down,
    distance: state.distance,
    ballOn: state.ballOn,
    possession: state.possession,
    score: { home: state.score.home, away: state.score.away },
    weather: state.weather,
  };
}

// ---------------------------------------------------------------------------
// Eventos de inicialização (MATCH_INIT + WEATHER_ROLL) — RNG consume #1
// ---------------------------------------------------------------------------

/**
 * Constrói os eventos de inicialização da partida a partir do clima sorteado,
 * registrando o clima e seus modificadores vigentes (R7.6). Puro: não consome
 * RNG (o sorteio já ocorreu em `rollWeather`), apenas projeta o efeito.
 */
function buildInitEvents(
  state: GameState,
  weather: Weather,
  input: ResolvedInput,
): PipelineLogEvent[] {
  const snapshot = snapshotOf(state);
  const params = input.baseline.simulationParameters;
  const effect = weatherModifiers(weather, params);

  const modifiersDetail: Readonly<Record<string, JsonValue>> = {
    reception: effect.reception,
    fumble: effect.fumble,
    deepPass: effect.deepPass,
    longKick: effect.longKick,
    fatiguePerSnap: effect.fatiguePerSnap,
  };

  return [
    {
      type: 'MATCH_INIT',
      snap: state.snapCount,
      state: snapshot,
      narrative:
        `Partida inicializada: ${state.possession} recebe o chute inicial; ` +
        `clima ${weather}; baseline ${input.baseline.version}.`,
      detail: {
        weather,
        possession: state.possession,
        baselineVersion: input.baseline.version,
        baselineStatus: input.baseline.status,
      },
    },
    {
      type: 'WEATHER_ROLL',
      snap: state.snapCount,
      state: snapshot,
      narrative: `Clima sorteado: ${weather}.`,
      detail: {
        weather,
        modifiers: modifiersDetail,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Aplicação de um snap ao estado + emissão dos eventos derivados da FSM
// ---------------------------------------------------------------------------

/**
 * Emite um evento `SCORE` a partir de um `ScoringResult` da FSM (touchdown /
 * safety / field goal), carregando tipo, time beneficiado, quarto e pontos no
 * `detail` para o `stats.ts` derivar o `scoringSummary` (R13.5). Puro.
 */
function scoreEvent(
  stateBefore: GameState,
  scoring: ScoringResult,
): PipelineLogEvent {
  return {
    type: 'SCORE',
    snap: stateBefore.snapCount,
    state: snapshotOf(scoring.state),
    narrative:
      `${scoring.entry.team} marca ${scoring.points} ` +
      `(${scoring.entry.type}) no ${scoring.entry.quarter}º quarto.`,
    detail: {
      type: scoring.entry.type,
      team: scoring.entry.team,
      quarter: scoring.entry.quarter,
      points: scoring.points,
    },
  };
}

/**
 * Emite um evento `POSSESSION_CHANGE` quando a jogada troca a posse
 * (turnover/punt). O `detail.turnover` permite ao `stats.ts` contabilizar a
 * perda de posse de-duplicando por snap contra o `PLAY_RESULT`.
 */
function possessionChangeEvent(
  stateBefore: GameState,
  stateAfter: GameState,
): PipelineLogEvent {
  return {
    type: 'POSSESSION_CHANGE',
    snap: stateBefore.snapCount,
    state: snapshotOf(stateAfter),
    narrative: `Posse passa para ${stateAfter.possession}.`,
    detail: { turnover: true, to: stateAfter.possession },
  };
}

/**
 * Resultado da aplicação de um snap: o novo estado e os eventos derivados da FSM
 * (scoring / troca de posse) emitidos **após** os eventos do pipeline.
 */
interface SnapApplication {
  readonly state: GameState;
  readonly events: ReadonlyArray<PipelineLogEvent>;
}

/**
 * Aplica a resolução de uma jogada ao estado via as transições puras do núcleo e
 * da FSM, decidindo entre pontuação posicional (touchdown/safety) e avanço de
 * down/distância/posse, e emite os eventos de log derivados.
 *
 * Precedência (espelha o `stateDiagram` do design):
 * 1. Aplica a resolução genérica (`applyPlayResolution`): posição, relógio,
 *    fadiga e troca de posse por turnover.
 * 2. Se a bola alcançou uma end zone, resolve o evento posicional
 *    (`resolvePositionalScoring` → touchdown/safety) e emite `SCORE`.
 * 3. Caso contrário, resolve o fluxo de down/distância/posse
 *    (`advancePossession`); se a posse mudou, emite `POSSESSION_CHANGE`.
 *
 * Puro e imutável: nenhuma mutação do estado de entrada; não consome RNG.
 */
function applySnap(
  state: GameState,
  resolution: PlayResolution,
): SnapApplication {
  const events: PipelineLogEvent[] = [];

  // (1) Transição genérica: posição/relógio/fadiga/posse por turnover.
  const applied = applyPlayResolution(state, resolution);

  // (2) Pontuação posicional (touchdown/safety) tem precedência sobre o avanço
  // de down/distância. `resolvePositionalScoring` lê a posição já aplicada.
  if (!resolution.possessionChanges) {
    const scoring = resolvePositionalScoring(applied);
    if (scoring !== null) {
      events.push(scoreEvent(state, scoring));
      return { state: scoring.state, events };
    }
  }

  // (3) Fluxo de down/distância/posse (sem pontuação posicional).
  const next = advancePossession(applied, resolution);
  if (next.possession !== state.possession) {
    events.push(possessionChangeEvent(state, next));
  }
  return { state: next, events };
}

// ---------------------------------------------------------------------------
// Núcleo puro: simulate(input): SimulationResult
// ---------------------------------------------------------------------------

/**
 * Executa a simulação completa de uma partida de forma **pura e determinística**
 * (R1.1). Liga RNG → inicialização (clima) → loop de ticks/quartos → FSM →
 * pipeline de jogada → log → estatísticas, e devolve `{ log, score, seedUsed }`.
 *
 * - O `Rng` é criado **uma única vez** de `input.seed` (R1.2); o clima é o
 *   primeiro consumo (R7.1), antes de qualquer jogada.
 * - O loop encerra ao fim do 4º quarto (sem overtime, R2.6); em caso de empate,
 *   `finalizeGame` produz uma `Decisao_Produto_Pendente`, registrada como evento
 *   `PENDING_DECISION`, e `score.tie = true` (R2.5).
 * - `seedUsed` é devolvido como `bigint` e registrado no log em **decimal**
 *   (R1.7).
 *
 * @param input Entrada resolvida e imutável do núcleo (inclui `Seed_RNG`).
 * @returns `SimulationResult` com log, placar final e seed usado.
 */
export function simulate(input: ResolvedInput): SimulationResult {
  // --- RNG único a partir do Seed_RNG (R1.2) --------------------------------
  const rng: Rng = createRng(input.seed);
  const params = input.baseline.simulationParameters;

  // --- Políticas situacionais por estratégia (ataque/defesa) ----------------
  // Os modos de bot (random/curti/seeded) são da Task 15; aqui a política
  // situacional por estratégia é o comportamento padrão correto.
  const policies: PlayPolicies = {
    home: createSituationalPolicy(input.strategyHome),
    away: createSituationalPolicy(input.strategyAway),
  };

  // --- Inicialização: sorteio de clima (RNG consume #1, antes das jogadas) ---
  const weather: Weather = rollWeather(rng, params);
  let state: GameState = createInitialState({ weather });

  // Acumulador ordenado de eventos do Log_Partida (sem `seq`; o log.ts carimba).
  const events: PipelineLogEvent[] = [];
  events.push(...buildInitEvents(state, weather, input));

  let pendingDecision: PendingDecision | undefined;

  // --- Loop de simulação: jogadas até o fim do 4º quarto (R2.2, R2.6) --------
  let snaps = 0;
  while (!isRegulationOver(state)) {
    if (++snaps > MAX_SNAPS) {
      // Salvaguarda defensiva: o relógio DEVE decrescer ≥ 1 décimo por jogada.
      // Atingir este limite indica um bug (relógio estagnado), não um estado
      // de jogo legítimo. Falhamos cedo em vez de laçar indefinidamente.
      throw new Error(
        `simulate: limite de ${MAX_SNAPS} jogadas excedido — invariante de ` +
          'relógio decrescente violado (bug de terminação do loop).',
      );
    }

    // (a) Special teams são acionados por estado (R11.4) — sem consumir o RNG
    // de escolha. Quando aplicável, o par é apenas registrado; a resolução
    // física detalhada de ST não faz parte do pipeline de scrimmage do MVP.
    const specialTeams = selectSpecialTeams(state);
    if (specialTeams !== null) {
      events.push({
        type: 'KICKOFF',
        snap: state.snapCount,
        state: snapshotOf(state),
        narrative:
          `Special teams (${state.phase}): ${specialTeams.offense} × ` +
          `${specialTeams.defense}.`,
        detail: {
          phase: state.phase,
          offense: specialTeams.offense,
          defense: specialTeams.defense,
        },
      });
      // Avança a FSM para `Drive` consumindo tempo mínimo (bola morta do chute),
      // de modo que o relógio decresça e o loop progrida de forma determinística.
      state = { ...state, phase: 'Drive' };
    }

    // (b) Resolução de um snap de scrimmage (pipeline puro; RNG O→D→sucesso→
    // amostragens, pulando passos inaplicáveis).
    const outcome = resolvePlay(state, input, policies, rng, {
      catalog: PLAY_CATALOG,
    });
    events.push(...outcome.logEvents);

    // (c) Relógio consumido pela jogada, derivado do resultado (determinístico,
    // nunca wall-clock). Garante ≥ 1 décimo quando há relógio restante (R2.1).
    const clock = resolvePlayClock(
      {
        yardsGained: outcome.resolution.yardsGained,
        stopsClock:
          (outcome.resolution.yardsGained ?? 0) === 0 &&
          outcome.resolution.possessionChanges !== true,
        isPass: false,
      },
      state,
      params,
    );
    if (clock.timedOut) {
      events.push({
        type: 'TIMEOUT',
        snap: state.snapCount,
        state: snapshotOf(state),
        narrative:
          `Jogada encerrada por tempo limite (${clock.ticks} ticks).`,
        detail: { ticks: clock.ticks },
      });
    }

    // (d) Aplica a resolução (com o clockDeci derivado) via FSM/estado e emite
    // os eventos derivados (SCORE / POSSESSION_CHANGE).
    const resolutionWithClock: PlayResolution = {
      ...outcome.resolution,
      clockDeci: clock.clockDeci,
    };
    const applied = applySnap(state, resolutionWithClock);
    state = applied.state;
    events.push(...applied.events);

    // (e) Virada de quarto / fim de jogo. `resolveClockBoundary` recarrega o
    // relógio no próximo quarto ou encerra a partida no 4º (R2.3→R2.2, R2.6).
    const boundary = resolveClockBoundary(state);
    state = boundary.state;
    if (boundary.end !== undefined) {
      pendingDecision = boundary.end.pendingDecision;
      break;
    }
  }

  // --- Encerramento: garante o desfecho final mesmo se o loop saiu por guarda -
  const end = finalizeGame(state);
  const score = end.score;
  if (pendingDecision === undefined) {
    pendingDecision = end.pendingDecision;
  }

  events.push({
    type: 'GAME_END',
    snap: state.snapCount,
    state: snapshotOf(end.state),
    narrative:
      `Fim de jogo: ${score.home}–${score.away}` +
      (score.tie ? ' (empate).' : '.'),
    detail: {
      home: score.home,
      away: score.away,
      final: score.final,
      tie: score.tie,
    },
  });

  // Empate ao fim do tempo regulamentar → Decisao_Produto_Pendente (R2.5/R2.6).
  if (pendingDecision !== undefined) {
    events.push({
      type: 'PENDING_DECISION',
      snap: state.snapCount,
      state: snapshotOf(end.state),
      narrative: pendingDecision.note,
      detail: {
        reason: pendingDecision.reason,
        home: score.home,
        away: score.away,
      },
    });
  }

  // --- Estatísticas + Log_Partida (seed em decimal — R1.7) -------------------
  const stats = computeStats(events);
  const log = buildGameLog({
    events,
    seed: input.seed,
    baseline: input.baseline,
    stats,
  });

  return {
    log,
    score: toScore(end.state, true),
    seedUsed: input.seed,
  };
}
