/**
 * Pipeline de resolução de jogada — fases a–h (`lib/sim/play/pipeline.ts`).
 *
 * Orquestra, de forma **pura e determinística**, a resolução de um único snap,
 * encadeando as fases do design ("Pipeline de resolução de jogada"):
 *
 *   (a) seleção automática de jogada ofensiva e defensiva por situação+estilo;
 *   (b) validação anatômica (`Validador_Funcoes`);
 *   (c) delta de matchup (`matchups_36`), aplicado ANTES da disputa, simétrico;
 *   (d) disputa de atributos (`Modelo_Probabilistico`): p = clamp(...);
 *   (e) clima e fadiga (modificadores de recepção/passe/chute/fumble + penalidade);
 *   (f) resolução do resultado (jardas de corrida; passe completo/incompleto/INT;
 *       fumble);
 *   (g) atualização de fadiga compartilhada por `instance_id`;
 *   (h) emissão das entradas de `Log_Partida` (payloads por fase).
 *
 * ## Ordem fixa de consumo do RNG (R1.2)
 *
 * O RNG é consumido **exatamente nesta ordem**, pulando passos inaplicáveis à
 * jogada (ver design, "Ordem fixa de consumo do RNG", passo 2):
 *
 *   1. **Decisão do bot ofensivo** — `offensePolicy.choosePlay` (consome 1
 *      `nextFloat()` só quando há >1 opção de peso positivo; ver `select.ts`).
 *   2. **Decisão do bot defensivo** — `defensePolicy.choosePlay` (mesma regra).
 *   3. **Teste de sucesso** — `probability.decideSuccess` (1 `nextFloat()`),
 *      pulado quando a jogada aborta na validação anatômica (fase (b)).
 *   4. **Amostragens de resultado**, dependentes do tipo de jogada e todas após
 *      o teste de sucesso, nesta sub-ordem fixa:
 *        4a. **Jardas-alvo do passe** (`probability.pass`) — só em jogadas de
 *            passe quando a disputa teve sucesso (passe completo).
 *        4b. **Jardas de corrida perdidas** (`probability.run` no ramo de
 *            perda) — só em corrida quando a disputa falhou (perda amostrada);
 *            o ganho de corrida é determinístico e não consome RNG.
 *        4c. **Teste de fumble** (1 `nextFloat()`) — só quando o portador tem
 *            posse física passível de fumble (jogada viva com avanço).
 *
 * Jogadas que não envolvem passe nunca consomem o RNG de "jardas-alvo de passe";
 * a ordem relativa dos passos **aplicáveis** é sempre a mesma, o que preserva a
 * reprodutibilidade byte a byte (Property 5).
 *
 * ## Abort por pré-condição de formação legal (R4.4)
 *
 * Se a jogada selecionada não satisfaz a pré-condição de formação legal (a
 * validação anatômica da ação-chave retorna `blocked`), o pipeline **aborta** a
 * execução daquela jogada com um erro determinado (`PlayAbort`) e emite o log
 * correspondente, **sem substituição oculta de jogada** e **sem consumir** o RNG
 * de disputa/resultado. Uma limitação (`allowed_with_limitation`) permite a
 * jogada e apenas registra o aviso.
 *
 * ## Pureza
 *
 * Nenhuma leitura de ambiente, rede, banco ou relógio de sistema. Toda a
 * aleatoriedade entra pelo `Rng` injetado; a mesma `(estado, entrada, políticas,
 * estado do RNG)` sempre produz o mesmo `{ resolution, logEvents, aborted }`.
 * O pipeline **não** aplica a `PlayResolution` ao estado (isso é da FSM, Task
 * 12) nem atribui `seq` aos eventos (isso é do `log.ts`, Task 13.1): produz
 * apenas os dados por fase que essas camadas consomem.
 *
 * _Requirements: 4.4, 1.2_
 */

import type { Rng } from '../rng';
import type { PlayResolution } from '../state';
import type {
  DefensivePlayId,
  GameState,
  JsonValue,
  LogEventType,
  OffensivePlayId,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  StateSnapshot,
  Team,
} from '../types';

import { validateAnatomy, type AnatomyOutcome, type PlayAction } from './anatomy';
import { matchupDelta, baselineProvenance } from '../matchups';
import { compute, decideSuccess, run, pass, type PassDepth } from './probability';
import { modifiers as weatherModifiers, type WeatherEffect } from './weather';
import { applyFatigue, type FatigueSnapInput } from './fatigue';
import { resolveEffectDisposition } from './inert';
import {
  type PlayCatalog,
  type PlayPolicy,
  type PlaySelectionContext,
} from './select';

// ---------------------------------------------------------------------------
// Payload de log por fase (shape intermediário consumido por log.ts, Task 13.1)
// ---------------------------------------------------------------------------

/**
 * Evento de log emitido pelo pipeline **sem** `seq`: o `log.ts` (Task 13.1)
 * atribui o índice sequencial determinístico ao agregar os eventos de toda a
 * partida. É um subconjunto estrutural de `LogEvent` (mesmos `type`, `state`,
 * `narrative`, `detail`, `powerReason`, `snap`, `tick`), para que a camada de
 * log apenas acrescente `seq` e o encadeie.
 */
export interface PipelineLogEvent {
  readonly type: LogEventType;
  readonly snap?: number;
  readonly tick?: number;
  readonly state: StateSnapshot;
  readonly narrative: string;
  readonly detail: Readonly<Record<string, JsonValue>>;
  readonly powerReason?: string;
}

// ---------------------------------------------------------------------------
// Entrada e saída do pipeline
// ---------------------------------------------------------------------------

/**
 * Políticas de escolha de jogada dos dois times. A ordem fixa O→D de consumo do
 * RNG é imposta por este pipeline: a política do time em posse é sempre
 * consultada antes da política do time sem posse.
 */
export interface PlayPolicies {
  readonly home: PlayPolicy;
  readonly away: PlayPolicy;
}

/** Opções de resolução de um snap. */
export interface ResolvePlayOptions {
  /**
   * Catálogo das 18 jogadas (restringe a saída da seleção, R4.3). Default: o
   * `PLAY_CATALOG` canônico quando omitido.
   */
  readonly catalog?: PlayCatalog;
}

/** Motivo determinado de aborto de uma jogada (R4.4). */
export type PlayAbortReason =
  /** A ação-chave da jogada é anatomicamente impossível na formação legal. */
  | 'ILLEGAL_FORMATION_PRECONDITION';

/**
 * Aborto determinado da jogada (R4.4): o pipeline interrompe a resolução sem
 * substituição oculta de jogada e sem consumir o RNG de disputa/resultado. O
 * aviso vem do `Validador_Funcoes`.
 */
export interface PlayAbort {
  readonly reason: PlayAbortReason;
  readonly warning: string;
}

/**
 * Resultado da resolução de um snap. `resolution` alimenta as transições puras
 * do estado (Task 12 — FSM); `logEvents` alimenta o `log.ts` (Task 13.1);
 * `aborted` é presente quando a jogada foi interrompida por pré-condição
 * ilegal (R4.4) — nesse caso `resolution` descreve apenas o consumo de relógio
 * mínimo (bola morta) e nenhum avanço/pontuação ocorre.
 */
export interface PlayOutcome {
  /** Jogada ofensiva selecionada (sempre do catálogo). */
  readonly offensePlay: OffensivePlayId;
  /** Jogada defensiva selecionada (sempre do catálogo). */
  readonly defensePlay: DefensivePlayId;
  /** Resolução a aplicar ao estado (jardas/relógio/posse/fadiga). */
  readonly resolution: PlayResolution;
  /** Eventos de log por fase (sem `seq`), em ordem de emissão. */
  readonly logEvents: ReadonlyArray<PipelineLogEvent>;
  /** Presente quando a jogada foi abortada por pré-condição ilegal (R4.4). */
  readonly aborted?: PlayAbort;
}

// ---------------------------------------------------------------------------
// Classificação de jogadas ofensivas (corrida/passe/profundidade/ação-chave)
// ---------------------------------------------------------------------------

/** Jogadas ofensivas de corrida. */
const RUN_PLAYS: ReadonlySet<OffensivePlayId> = new Set<OffensivePlayId>([
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
]);

/** Jogadas ofensivas de passe (inclui play action, que termina em passe). */
const PASS_PLAYS: ReadonlySet<OffensivePlayId> = new Set<OffensivePlayId>([
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
]);

/** `true` quando a jogada ofensiva é uma corrida. */
function isRunPlay(play: OffensivePlayId): boolean {
  return RUN_PLAYS.has(play);
}

/** `true` quando a jogada ofensiva é um passe. */
function isPassPlay(play: OffensivePlayId): boolean {
  return PASS_PLAYS.has(play);
}

/**
 * Profundidade do passe por jogada: `O_PASS_DEEP` é profundo; os demais passes
 * (curto, intermediário e play action) usam o intervalo curto do baseline. A
 * profundidade seleciona o intervalo de jardas-alvo amostrado (R6.9).
 */
function passDepthOf(play: OffensivePlayId): PassDepth {
  return play === 'O_PASS_DEEP' ? 'deep' : 'short';
}

/**
 * Ação anatômica-chave que a jogada ofensiva exige da posição que a executa,
 * usada na validação de pré-condição de formação legal (fase (b)):
 * - corrida → `carry` (posse física e condução da bola);
 * - passe   → `throw` (lançamento físico pelo QB).
 */
function keyOffensiveAction(play: OffensivePlayId): PlayAction {
  return isRunPlay(play) ? 'carry' : 'throw';
}

/** Posição que executa a ação-chave de uma jogada ofensiva. */
function keyOffensiveRole(play: OffensivePlayId): ResolvedAthlete['positionDesignation'] {
  // Corrida é conduzida pelo RB; passe é lançado pelo QB.
  return isRunPlay(play) ? 'RB' : 'QB';
}

// ---------------------------------------------------------------------------
// Seleção de atletas e cálculo de Δattr (disputa)
// ---------------------------------------------------------------------------

/** Soma de atributos "ofensivos" relevantes de um atleta (ataque + velocidade). */
function offensiveRating(a: ResolvedAthlete): number {
  return a.stats.attack + a.stats.specialAttack + a.stats.speed;
}

/** Soma de atributos "defensivos" relevantes de um atleta (defesa + velocidade). */
function defensiveRating(a: ResolvedAthlete): number {
  return a.stats.defense + a.stats.specialDefense + a.stats.speed;
}

/** Média de uma métrica sobre uma unidade (0 quando vazia). */
function averageRating(
  athletes: ReadonlyArray<ResolvedAthlete>,
  metric: (a: ResolvedAthlete) => number,
): number {
  if (athletes.length === 0) return 0;
  let sum = 0;
  for (const a of athletes) sum += metric(a);
  return sum / athletes.length;
}

/** Escala de normalização de Δattr: diferença de rating / ESTE valor → [-1, 1]. */
const ATTR_NORMALIZER = 300;

/**
 * Δattr normalizado em `[-1, 1]` para a disputa (R6.1): diferença entre o rating
 * ofensivo médio da unidade de ataque e o rating defensivo médio da unidade de
 * defesa, dividido por uma escala fixa. `probability.compute` reaplica o clamp
 * `[-1, 1]`, de modo que valores extremos saturam sem distorcer a fórmula.
 */
function computeAttrDelta(
  offenseUnit: ReadonlyArray<ResolvedAthlete>,
  defenseUnit: ReadonlyArray<ResolvedAthlete>,
): number {
  const off = averageRating(offenseUnit, offensiveRating);
  const def = averageRating(defenseUnit, defensiveRating);
  return (off - def) / ATTR_NORMALIZER;
}

// ---------------------------------------------------------------------------
// Clima aplicado à disputa (modificador agregado) e à fadiga
// ---------------------------------------------------------------------------

/**
 * Modificador de clima agregado para a disputa, dependente do tipo de jogada
 * (R7.2–R7.5): passe profundo sofre `deepPass` (WIND); passe (recepção) sofre
 * `reception` (RAIN/COLD); corrida não tem modificador de probabilidade de
 * clima (a chuva afeta fumble, tratado na resolução do resultado). Fadiga de
 * HEAT não entra aqui — é aplicada à fadiga, não à probabilidade.
 */
function climaModForContest(
  play: OffensivePlayId,
  effect: WeatherEffect,
): number {
  if (isRunPlay(play)) {
    return 0;
  }
  // Passe: recepção penalizada por RAIN/COLD; passe profundo também por WIND.
  const deep = passDepthOf(play) === 'deep' ? effect.deepPass : 0;
  return effect.reception + deep;
}

// ---------------------------------------------------------------------------
// Construção do StateSnapshot para os eventos de log
// ---------------------------------------------------------------------------

/** Projeta o `GameState` corrente no `StateSnapshot` registrado em cada evento. */
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
// Helpers de contexto de seleção e de unidades
// ---------------------------------------------------------------------------

/** Lineup do time informado. */
function lineupOf(input: ResolvedInput, team: Team): ResolvedLineup {
  return team === 'home' ? input.home : input.away;
}

/** Política do time informado. */
function policyOf(policies: PlayPolicies, team: Team): PlayPolicy {
  return team === 'home' ? policies.home : policies.away;
}

/**
 * Monta o `PlaySelectionContext` para um lado da bola a partir do estado. O
 * campo `hasPossession` distingue a escolha ofensiva (`true`) da defensiva
 * (`false`); o restante é compartilhado (down/distância/posição/relógio/clima/
 * fadiga).
 */
function selectionContext(
  state: GameState,
  hasPossession: boolean,
): PlaySelectionContext {
  return {
    down: state.down,
    distance: state.distance,
    fieldPosition: state.ballOn,
    gameClock: state.gameClockDeci,
    weather: state.weather,
    fatigueByInstance: state.fatigue,
    hasPossession,
  };
}

/** `instance_id` de todos os atletas de uma unidade. */
function instanceIdsOf(athletes: ReadonlyArray<ResolvedAthlete>): number[] {
  return athletes.map((a) => a.instanceId);
}

/** Encontra o primeiro atleta de uma unidade designado para a posição dada. */
function findByPosition(
  athletes: ReadonlyArray<ResolvedAthlete>,
  position: ResolvedAthlete['positionDesignation'],
): ResolvedAthlete | undefined {
  return athletes.find((a) => a.positionDesignation === position);
}

// ---------------------------------------------------------------------------
// Resolução de um snap — fases (a)–(h) em ordem fixa
// ---------------------------------------------------------------------------

/**
 * Resolve um único snap, encadeando as fases (a)–(h) na ordem fixa documentada e
 * consumindo o RNG na ordem fixa (bot O → bot D → teste de sucesso → amostragens
 * de resultado), pulando passos inaplicáveis.
 *
 * Puro: toda aleatoriedade vem de `rng`; não aplica a resolução ao estado nem
 * atribui `seq` aos eventos. Em caso de pré-condição de formação ilegal, aborta
 * com erro determinado + log, sem substituir a jogada (R4.4).
 *
 * @param state    Estado corrente da partida (não mutado).
 * @param input    Entrada resolvida imutável do núcleo.
 * @param policies Políticas de escolha de jogada dos dois times.
 * @param rng      Gerador_RNG determinístico (única fonte de entropia).
 * @param options  Opções (catálogo). O catálogo deve ser fornecido ou importado
 *                 pelo chamador; a seleção nunca sai dele (R4.3).
 * @returns `PlayOutcome` com jogadas escolhidas, resolução e eventos de log.
 */
export function resolvePlay(
  state: GameState,
  input: ResolvedInput,
  policies: PlayPolicies,
  rng: Rng,
  options: ResolvePlayOptions & { readonly catalog: PlayCatalog },
): PlayOutcome {
  const catalog = options.catalog;
  const params = input.baseline.simulationParameters;
  const provenance = baselineProvenance(input.baseline);

  const offenseTeam: Team = state.possession;
  const defenseTeam: Team = offenseTeam === 'home' ? 'away' : 'home';

  const offenseLineup = lineupOf(input, offenseTeam);
  const defenseLineup = lineupOf(input, defenseTeam);
  const offenseUnit = offenseLineup.units.offense;
  const defenseUnit = defenseLineup.units.defense;

  const snapshot = snapshotOf(state);
  const events: PipelineLogEvent[] = [];

  // ---- Fase (a): seleção automática de jogada — RNG O→D (passos 1 e 2) -----
  // RNG consume #1: decisão do bot ofensivo (ordem fixa: ataque primeiro).
  const offensePlay = policyOf(policies, offenseTeam).choosePlay(
    selectionContext(state, true),
    catalog,
    rng,
  ) as OffensivePlayId;

  // RNG consume #2: decisão do bot defensivo (ordem fixa: defesa depois).
  const defensePlay = policyOf(policies, defenseTeam).choosePlay(
    selectionContext(state, false),
    catalog,
    rng,
  ) as DefensivePlayId;

  events.push({
    type: 'PLAY_SELECTED',
    snap: state.snapCount,
    state: snapshot,
    narrative: `Ataque escolhe ${offensePlay}; defesa responde ${defensePlay}.`,
    detail: {
      offense: offensePlay,
      defense: defensePlay,
      down: state.down,
      distance: state.distance,
      fieldPosition: state.ballOn,
      weather: state.weather,
      baselineVersion: provenance.version,
      baselineStatus: provenance.status,
    },
  });

  // ---- Fase (b): validação anatômica (Validador_Funcoes) -------------------
  const keyRole = keyOffensiveRole(offensePlay);
  const keyAction = keyOffensiveAction(offensePlay);
  const keyAthlete =
    findByPosition(offenseUnit, keyRole) ?? offenseUnit[0];

  if (keyAthlete !== undefined) {
    const anatomy: AnatomyOutcome = validateAnatomy(
      keyAthlete,
      keyRole,
      keyAction,
    );

    if (anatomy.kind === 'blocked') {
      // (R4.4) Pré-condição de formação legal ausente: aborta com erro
      // determinado + log, SEM substituição oculta de jogada e SEM consumir o
      // RNG de disputa/resultado. Consome apenas o relógio mínimo (bola morta).
      events.push({
        type: 'ANATOMY_WARNING',
        snap: state.snapCount,
        state: snapshot,
        narrative: anatomy.warning,
        detail: {
          offense: offensePlay,
          role: keyRole,
          action: keyAction,
          instanceId: keyAthlete.instanceId,
          outcome: 'blocked',
        },
        powerReason: 'ANATOMY_BLOCKED',
      });
      events.push({
        type: 'PENDING_DECISION',
        snap: state.snapCount,
        state: snapshot,
        narrative:
          `Jogada ${offensePlay} abortada: pré-condição de formação legal ` +
          'não satisfeita. Nenhuma substituição de jogada é feita.',
        detail: {
          offense: offensePlay,
          defense: defensePlay,
          abortReason: 'ILLEGAL_FORMATION_PRECONDITION',
        },
      });

      const minimalClock = Math.min(
        10, // bola morta cedo: ~1,0 s (ver clock.BASE_DEAD_BALL_TICKS)
        state.gameClockDeci,
      );
      return {
        offensePlay,
        defensePlay,
        resolution: { yardsGained: 0, clockDeci: minimalClock },
        logEvents: events,
        aborted: {
          reason: 'ILLEGAL_FORMATION_PRECONDITION',
          warning: anatomy.warning,
        },
      };
    }

    if (anatomy.kind === 'allowed_with_limitation') {
      // Limitação: permite a jogada e registra o aviso (R10.10) — segue a
      // resolução normalmente.
      events.push({
        type: 'ANATOMY_WARNING',
        snap: state.snapCount,
        state: snapshot,
        narrative: anatomy.warning,
        detail: {
          offense: offensePlay,
          role: keyRole,
          action: keyAction,
          instanceId: keyAthlete.instanceId,
          outcome: 'allowed_with_limitation',
        },
        powerReason: 'ANATOMY_LIMITATION',
      });
    }
  }

  // ---- Política de efeitos inertes: zero bônus, sempre logado (R9) ----------
  // Todo efeito adicional dos atletas da unidade ofensiva é resolvido como
  // inerte-com-motivo; não altera atributo nem resultado — apenas registra.
  for (const athlete of offenseUnit) {
    for (const effectId of athlete.additionalEffectIds) {
      const decision = resolveEffectDisposition(
        effectId,
        input.effectDisposition,
        athlete.instanceId,
      );
      events.push({
        type: 'POWER_INERT',
        snap: state.snapCount,
        state: snapshot,
        narrative:
          `Efeito ${effectId} do atleta ${athlete.instanceId} é inerte ` +
          `(${decision.reason}); zero bônus aplicado.`,
        detail: {
          effectId: decision.effectId,
          instanceId: decision.athleteInstanceId,
          inert: decision.inert,
        },
        powerReason: decision.reason,
      });
    }
  }

  // ---- Fase (c): delta de matchup (antes da disputa, simétrico) -------------
  const delta = matchupDelta(input.baseline, offensePlay, defensePlay);
  events.push({
    type: 'MATCHUP_APPLIED',
    snap: state.snapCount,
    state: snapshot,
    narrative: `Delta de matchup ${offensePlay}×${defensePlay} = ${delta}.`,
    detail: {
      offense: offensePlay,
      defense: defensePlay,
      offenseProbabilityDelta: delta,
      baselineVersion: provenance.version,
      baselineStatus: provenance.status,
    },
  });

  // ---- Fase (e, parte 1): clima — modificador agregado para a disputa -------
  const weatherEffect = weatherModifiers(state.weather, params);
  const climaMod = climaModForContest(offensePlay, weatherEffect);

  // ---- Fase (d): disputa de atributos (Modelo_Probabilistico) ---------------
  const attrDelta = computeAttrDelta(offenseUnit, defenseUnit);
  const pFinal = compute(
    { attrDelta, matchupDelta: delta, climaMod },
    params,
  );

  // RNG consume #3: teste de sucesso contra a probabilidade final.
  const success = decideSuccess(pFinal, rng);

  events.push({
    type: 'ATTR_CONTEST',
    snap: state.snapCount,
    state: snapshot,
    narrative: `Disputa: p=${pFinal.toFixed(4)} → ${success ? 'sucesso' : 'falha'}.`,
    detail: {
      probability: pFinal,
      attrDelta,
      matchupDelta: delta,
      climaMod,
      success,
    },
  });

  // ---- Fase (f): resolução do resultado (RNG passo 4) -----------------------
  let yardsGained = 0;
  let turnover = false;
  let completed: boolean | undefined;
  // No MVP, a secundária sem recepção física resolve a disputa como
  // incompleto/deflexão, nunca INT por magnetismo/telecinese (R10.5); portanto
  // não há interceptação no pipeline do MVP. Mantido explícito para o log.
  const intercepted = false;
  let fumble = false;
  let targetYards: number | undefined;

  if (isPassPlay(offensePlay)) {
    if (success) {
      // Passe completo: RNG consume #4a — jardas-alvo amostradas no intervalo.
      targetYards = pass(passDepthOf(offensePlay), params, rng);
      yardsGained = targetYards;
      completed = true;
    } else {
      // Passe incompleto: sem avanço. A disputa fracassada pode ser INT quando
      // a secundária realiza recepção física; no MVP, sem recepção física a
      // disputa resolve-se como incompleto/deflexão (R10.5), então o resultado
      // padrão é incompleto (não consome RNG adicional). Nenhuma INT por
      // telecinese/magnetismo.
      completed = false;
      yardsGained = 0;
    }
  } else if (isRunPlay(offensePlay)) {
    // Corrida: ganho determinístico quando vence o gap; perda amostrada quando
    // perde (RNG consume #4b, só no ramo de perda).
    const runAdvantage = Math.max(0, attrDelta); // vantagem relativa normalizada
    const result = run(runAdvantage, success, params, rng);
    yardsGained = result.yards;
  }

  // ---- Fase (f, parte 2): teste de fumble (só com avanço vivo) --------------
  // Fumble é testado quando houve portador em posse física com a bola viva —
  // ou seja, corrida (sempre) e passe completo. RAIN acrescenta +fumble (R7.2).
  const liveCarry =
    isRunPlay(offensePlay) || (isPassPlay(offensePlay) && completed === true);
  if (liveCarry) {
    const baseFumble = 0.02; // probabilidade base de fumble do baseline MVP
    const fumbleP = baseFumble + weatherEffect.fumble;
    // RNG consume #4c: teste de fumble.
    fumble = rng.nextFloat() < fumbleP;
    if (fumble) {
      turnover = true;
    }
  }

  // Fumble transfere posse (turnover). INT não ocorre no MVP (ver acima).
  if (fumble) {
    turnover = true;
  }

  const stopsClock = isPassPlay(offensePlay) && completed === false;

  events.push({
    type: 'PLAY_RESULT',
    snap: state.snapCount,
    state: snapshot,
    narrative:
      `Resultado de ${offensePlay}: ${yardsGained} jd` +
      (completed === false ? ' (incompleto)' : '') +
      (fumble ? ' + fumble (turnover)' : '') +
      (intercepted ? ' + interceptação' : '') +
      '.',
    detail: {
      offense: offensePlay,
      defense: defensePlay,
      yardsGained,
      completed: completed ?? null,
      intercepted,
      fumble,
      turnover,
      targetYards: targetYards ?? null,
      stopsClock,
    },
  });

  // ---- Fase (g): atualização de fadiga compartilhada por instance_id --------
  // Participantes do snap (ativos): as unidades de ataque e defesa em campo.
  // Extremos: a posição que executa a ação-chave (lançamento/condução). O
  // restante dos instance_id da partida recupera (inativo) — tratado pela FSM
  // ao agregar; aqui aplicamos a atualização dos participantes do snap.
  const activeInstances = new Set<number>([
    ...instanceIdsOf(offenseUnit),
    ...instanceIdsOf(defenseUnit),
  ]);
  const extremeInstances = new Set<number>();
  if (keyAthlete !== undefined) {
    extremeInstances.add(keyAthlete.instanceId);
    activeInstances.delete(keyAthlete.instanceId);
  }
  const fatigueInput: FatigueSnapInput = {
    activeInstances,
    extremeInstances,
    inactiveInstances: new Set<number>(),
    weather: state.weather,
    params: params.fatigue,
    heatFatiguePerSnap: params.weather_modifiers.HEAT.fatigue_per_snap,
  };
  const nextFatigue = applyFatigue(state.fatigue, fatigueInput);
  // Delta de fadiga: diferença entre o novo mapa e o corrente, por instance_id,
  // para alimentar `applyPlayResolution` (que combina imutavelmente).
  const fatigueDelta = new Map<number, number>();
  for (const [instanceId, penalty] of nextFatigue) {
    const prev = state.fatigue.get(instanceId) ?? 0;
    const d = penalty - prev;
    if (d !== 0) {
      fatigueDelta.set(instanceId, d);
    }
  }

  // ---- Fase (e, parte 2) + relógio: duração derivada do resultado -----------
  // O relógio consumido é derivado do resultado (determinístico, nunca
  // wall-clock). A FSM aplica `resolvePlayClock`; aqui informamos os campos que
  // governam a duração via a própria resolução (`yardsGained`/stopsClock) e
  // deixamos o `clockDeci` para a FSM. Para manter a resolução autossuficiente,
  // reportamos também os sinais de duração em `detail` do PLAY_RESULT (acima).

  const resolution: PlayResolution = {
    yardsGained,
    possessionChanges: turnover,
    fatigueDelta,
    // `clockDeci`, `pointsScored`, `nextPhase` e `ballPos` são decididos pela
    // FSM a partir deste resultado e do estado — o pipeline não os impõe.
  };

  // ---- Fase (h): o conjunto de eventos emitidos acima É a emissão de log ----
  return {
    offensePlay,
    defensePlay,
    resolution,
    logEvents: events,
  };
}
