/**
 * Máquina de estados do fluxo de jogo (`lib/sim/fsm.ts`).
 *
 * FSM **pura e imutável** do fluxo de posse da partida. Cada transição recebe o
 * `GameState` corrente e o resultado de uma jogada (`PlayResolution`) e devolve
 * um **novo** `GameState`, nunca mutando a entrada. Isto espelha o
 * `stateDiagram` do design ("Máquina de estados do fluxo de jogo"):
 *
 *   Kickoff → Drive → {FirstDown → Drive | FourthDownDecision | Touchdown |
 *   Turnover | Safety} ; Punt/FieldGoalAtt/Turnover → ChangePossession → Drive ;
 *   Drive → EndOfQuarter → {Kickoff | EndOfGame}.
 *
 * ## Escopo desta task (12.1)
 *
 * Esta task implementa o **núcleo de down/distância/posse** e as transições de
 * **fim de quarto / fim de jogo**:
 *
 * - Conceder 4 downs para 10 jardas (R3.1); ao alcançar a distância, reiniciar
 *   para 1º & 10 (`FirstDown`); não converter após o 4º down transfere a posse
 *   ao adversário na posição corrente da bola, espelhando a perspectiva de
 *   `ballOn` (R3.2).
 * - Modelar turnover (fumble/INT) e troca de posse (`ChangePossession`).
 * - Modelar `EndOfQuarter`/`EndOfGame`: ao fim do 4º quarto, encerrar sem
 *   overtime (R2.6); empate ao fim do tempo regulamentar vira
 *   `Decisao_Produto_Pendente` com `score.tie = true` (R2.5).
 *
 * Pontuação (12.2), gatilhos de special teams (12.3) e faltas/pendências
 * genéricas (12.4) são tasks separadas que **estendem** este módulo. Por isso as
 * transições de fase são expostas como helpers compostos e pequenos
 * (`enterChangePossession`, `enterFirstDown`, `advanceDriveDown`,
 * `transferOnDowns`, `enterPhase`), para que as tasks seguintes as reusem sem
 * reescrever o fluxo.
 *
 * ## Fase de "primeiro down"
 *
 * O `stateDiagram` do design mostra um nó transiente `FirstDown` que retorna
 * imediatamente a `Drive` ("FirstDown --> Drive: novo conjunto de downs"). O
 * tipo `GamePhase` do núcleo não reifica esse nó transiente: conceder um novo
 * conjunto de downs reinicia down/distância e permanece em `Drive`. A função
 * `enterFirstDown` encapsula essa concessão (1º & 10 em `Drive`) para que a
 * intenção fique explícita no código e nos logs.
 *
 * ## Representação do empate → pendência (R2.5)
 *
 * O `GameState` não carrega um campo de pendência; a pendência é um **fato
 * derivado do fim de jogo**. `finalizeGame` devolve um `GameEndResult` com:
 * - o `GameState` final em fase `EndOfGame`;
 * - o `Score` imutável (`final: true`, `tie` quando o placar está igualado);
 * - um `pendingDecision` opcional — presente **exatamente quando** há empate —
 *   com o motivo `OVERTIME_NOT_IN_MVP`, para o `log.ts` (Task 13) emitir o
 *   evento `PENDING_DECISION` correspondente. A simulação (Task 14) consome esse
 *   descritor sem inventar mecânica de prolongamento.
 *
 * Puro: sem I/O, rede, relógio de sistema ou entropia externa. Reutiliza os
 * blocos imutáveis de `state.ts` e os helpers de relógio/quarto de `clock.ts`.
 *
 * _Requirements: 2.5, 2.6, 3.1, 3.2_
 */

import type {
  GamePhase,
  GameState,
  Score,
  ScoringEntry,
  ScoringType,
  SpecialTeamsPlayId,
  Team,
} from './types';
import {
  DEFAULT_DISTANCE_YARDS,
  DOWNS_PER_SET,
  FIELD_LENGTH_YARDS,
  advanceDown,
  opponentOf,
  resetDowns,
  withState,
  type PlayResolution,
} from './state';
import { endQuarter, isQuarterOver, isRegulationOver } from './clock';

// ---------------------------------------------------------------------------
// Resultado de down/distância de uma jogada (classificação pura)
// ---------------------------------------------------------------------------

/**
 * Classificação do desfecho de down/distância de uma jogada, derivada apenas do
 * estado corrente e das jardas ganhas (sem RNG). É o insumo da FSM para decidir
 * entre conceder novo conjunto de downs, avançar o down ou transferir a posse.
 */
export type DownOutcome =
  /** Ganho ≥ distância: concede novo conjunto (1º & 10) — estado `FirstDown`. */
  | 'FIRST_DOWN'
  /** Ganho < distância em down < 4: avança o down, mantém a posse. */
  | 'NEXT_DOWN'
  /** Ganho < distância no 4º down: transfere a posse (turnover on downs). */
  | 'TURNOVER_ON_DOWNS';

/**
 * Classifica o desfecho de down/distância de uma jogada sem alterar o estado.
 *
 * - Alcançar a distância (`yardsGained >= distance`) concede um novo conjunto de
 *   downs (`FIRST_DOWN`), independentemente do down corrente (R3.1).
 * - Caso contrário, enquanto houver downs restantes (`down < DOWNS_PER_SET`),
 *   avança-se o down (`NEXT_DOWN`).
 * - No último down sem alcançar a distância, a posse é transferida
 *   (`TURNOVER_ON_DOWNS`, R3.2).
 *
 * @param state Estado corrente (usa `down` e `distance`).
 * @param yardsGained Jardas líquidas ganhas na jogada.
 * @returns A classificação do desfecho de down/distância.
 */
export function classifyDownOutcome(
  state: GameState,
  yardsGained: number,
): DownOutcome {
  if (yardsGained >= state.distance) {
    return 'FIRST_DOWN';
  }
  if (state.down < DOWNS_PER_SET) {
    return 'NEXT_DOWN';
  }
  return 'TURNOVER_ON_DOWNS';
}

// ---------------------------------------------------------------------------
// Transições de fase (helpers compostos, reutilizados por 12.2–12.4)
// ---------------------------------------------------------------------------

/**
 * Define a fase da FSM sem alterar nenhum outro campo. Atalho tipado para as
 * tasks seguintes comporem transições de fase pontuais.
 *
 * @param state Estado corrente (não mutado).
 * @param phase Nova fase.
 * @returns Novo estado com a fase sobrescrita.
 */
export function enterPhase(state: GameState, phase: GamePhase): GameState {
  if (state.phase === phase) return state;
  return withState(state, { phase });
}

/**
 * Concede um novo conjunto de downs (1º & 10) ao time em posse (R3.1),
 * correspondente ao nó transiente `FirstDown` do design que retorna de imediato
 * a `Drive`. Não altera posse nem posição da bola — apenas reinicia
 * down/distância e mantém/define a fase `Drive`.
 *
 * @param state Estado corrente.
 * @returns Novo estado em `Drive` com `down = 1`, `distance = 10`.
 */
export function enterFirstDown(state: GameState): GameState {
  return withState(resetDowns(state), { phase: 'Drive' });
}

/**
 * Avança o conjunto de downs após uma jogada que não alcançou a distância em um
 * down anterior ao 4º: incrementa o down, reduz a distância restante pelo ganho
 * e mantém a fase em `Drive`. Não altera a posse.
 *
 * @param state Estado corrente.
 * @param yardsGained Jardas líquidas ganhas na jogada.
 * @returns Novo estado em `Drive` com down/distância atualizados.
 */
export function advanceDriveDown(
  state: GameState,
  yardsGained: number,
): GameState {
  return withState(advanceDown(state, yardsGained), { phase: 'Drive' });
}

/**
 * Transfere a posse ao adversário **na posição corrente da bola**, espelhando a
 * perspectiva de `ballOn` para o novo time em posse (`100 - ballOn`), pois a
 * posição é relativa às goal lines do time que detém a bola. Reinicia o conjunto
 * de downs (1º & 10) para o novo ataque e coloca a fase em `ChangePossession`.
 *
 * Serve tanto ao turnover on downs (R3.2) quanto ao turnover por fumble/INT: a
 * mecânica de troca de posse é a mesma; o que difere é o estado de origem.
 *
 * @param state Estado corrente.
 * @returns Novo estado com posse trocada, bola espelhada e 1º & 10.
 */
export function enterChangePossession(state: GameState): GameState {
  const mirroredBallOn = FIELD_LENGTH_YARDS - state.ballOn;
  return {
    ...state,
    possession: opponentOf(state.possession),
    ballOn: mirroredBallOn,
    down: 1,
    distance: DEFAULT_DISTANCE_YARDS,
    phase: 'ChangePossession',
  };
}

/**
 * Transferência de posse por 4º down não convertido (turnover on downs, R3.2).
 * Alias semântico de `enterChangePossession` que primeiro marca a fase
 * `FourthDownDecision` percorrida, deixando o rastro de fluxo coerente com o
 * `stateDiagram` do design (Drive → FourthDownDecision → ... → ChangePossession).
 *
 * @param state Estado corrente.
 * @returns Novo estado com a posse transferida ao adversário.
 */
export function transferOnDowns(state: GameState): GameState {
  return enterChangePossession(withState(state, { phase: 'FourthDownDecision' }));
}

// ---------------------------------------------------------------------------
// Transição principal de down/distância/posse por jogada
// ---------------------------------------------------------------------------

/**
 * Aplica a lógica de down/distância/posse de uma jogada **de ataque regular**
 * (não special teams, não pontuação) ao estado, devolvendo um novo `GameState`.
 *
 * Precedência das regras:
 * 1. Se a jogada troca a posse (`possessionChanges`, p.ex. fumble/INT), a posse
 *    é transferida ao adversário na posição corrente, espelhando `ballOn`, com
 *    1º & 10 para o novo ataque (`ChangePossession`).
 * 2. Caso contrário, classifica-se o desfecho de down/distância:
 *    - `FIRST_DOWN` → novo conjunto (1º & 10), permanece em `Drive` (R3.1).
 *    - `NEXT_DOWN` → avança o down, mantém a posse, fase `Drive`.
 *    - `TURNOVER_ON_DOWNS` → transfere a posse na posição corrente (R3.2).
 *
 * O avanço posicional da bola (`ballOn`), o relógio e a fadiga já foram
 * aplicados por `applyPlayResolution` (`state.ts`); esta função decide somente o
 * fluxo de down/distância/posse. Ela espera receber um `state` **já avançado**
 * pela resolução quando `possessionChanges = false` (ou seja, `ballOn` reflete o
 * ganho), e usa `resolution.yardsGained` apenas para classificar o desfecho de
 * distância.
 *
 * @param state Estado corrente, já com a posição/relógio/fadiga aplicados.
 * @param resolution Resolução da jogada (usa `yardsGained` e `possessionChanges`).
 * @returns Novo `GameState` com down/distância/posse e fase atualizados.
 */
export function advancePossession(
  state: GameState,
  resolution: PlayResolution,
): GameState {
  if (resolution.possessionChanges === true) {
    // Turnover por fumble/INT: a posse passa ao adversário na posição corrente.
    return enterChangePossession(state);
  }

  const yardsGained = resolution.yardsGained ?? 0;
  const outcome = classifyDownOutcome(state, yardsGained);

  switch (outcome) {
    case 'FIRST_DOWN':
      return enterFirstDown(state);
    case 'NEXT_DOWN':
      return advanceDriveDown(state, yardsGained);
    case 'TURNOVER_ON_DOWNS':
      return transferOnDowns(state);
  }
}

// ---------------------------------------------------------------------------
// Fim de quarto e fim de jogo (R2.5, R2.6)
// ---------------------------------------------------------------------------

/**
 * Motivo de uma `Decisao_Produto_Pendente` originada da FSM.
 *
 * `OVERTIME_NOT_IN_MVP` é o caso canônico de 12.1 (empate ao fim do tempo
 * regulamentar). `RULE_GAP_NOT_IN_CONTRACT` é a extensão genérica de 12.4 para
 * **qualquer** situação de regra que o contrato autoritativo não decide — a
 * pendência é registrada em vez de inventar mecânica (R14.4). Novos motivos
 * são aditivos: adicionar um membro à união não invalida os produtores/leitores
 * existentes do motivo de overtime.
 */
export type PendingDecisionReason =
  /** Empate ao fim do tempo regulamentar; prolongamento fora do MVP (R2.5). */
  | 'OVERTIME_NOT_IN_MVP'
  /** Lacuna de regra não decidida pelo contrato autoritativo (R14.4). */
  | 'RULE_GAP_NOT_IN_CONTRACT';

/**
 * Descritor de uma `Decisao_Produto_Pendente` (R2.5). O `GameState` não carrega
 * pendências; este descritor é produzido por `finalizeGame` e consumido pelo
 * `log.ts` (Task 13) para emitir o evento `PENDING_DECISION`, sem que o núcleo
 * invente mecânica de prolongamento.
 */
export interface PendingDecision {
  readonly reason: PendingDecisionReason;
  /** Narrativa estável para o log. */
  readonly note: string;
}

/**
 * Resultado do encerramento da partida. Compõe o estado final (`EndOfGame`), o
 * `Score` imutável com `final`/`tie` e, **apenas em caso de empate**, o descritor
 * de pendência de prolongamento.
 */
export interface GameEndResult {
  readonly state: GameState;
  readonly score: Score;
  /** Presente exatamente quando o jogo termina empatado (R2.5). */
  readonly pendingDecision?: PendingDecision;
}

/**
 * Projeta o `GameState` no `Score` final imutável. `final` indica fim do tempo
 * regulamentar; `tie` sinaliza empate no placar.
 *
 * @param state Estado da partida.
 * @param final Se o tempo regulamentar terminou (default: `true`).
 * @returns `Score` com `home`/`away`/`final`/`tie`.
 */
export function toScore(state: GameState, final = true): Score {
  return {
    home: state.score.home,
    away: state.score.away,
    final,
    tie: state.score.home === state.score.away,
  };
}

/**
 * Avança o relógio ao fim de um quarto (R2.3→R2.2): quando o relógio do quarto
 * corrente chegou a zero, delega a `endQuarter` (de `clock.ts`), que avança para
 * o próximo quarto recarregando o relógio e colocando a fase em `Kickoff`, ou —
 * no 4º quarto — marca a fase `EndOfGame`. Se o relógio ainda não zerou, o
 * estado é devolvido inalterado.
 *
 * Não encerra a partida nem decide o empate: isso é de `finalizeGame`, chamado
 * quando a fase chega a `EndOfGame`.
 *
 * @param state Estado corrente.
 * @returns Novo estado no próximo quarto, em `EndOfGame`, ou inalterado.
 */
export function advanceAfterQuarter(state: GameState): GameState {
  if (!isQuarterOver(state)) {
    return state;
  }
  return endQuarter(state);
}

/**
 * Encerra a partida ao fim do tempo regulamentar (R2.6: sem overtime no MVP).
 * Produz o estado final em `EndOfGame`, o `Score` com `final = true` e, quando
 * o placar está empatado, o descritor de `Decisao_Produto_Pendente` de
 * prolongamento (R2.5). A pontuação em si (atualização do placar) é das jogadas
 * anteriores; aqui apenas se consolida o desfecho.
 *
 * @param state Estado corrente (tipicamente após o relógio do 4º quarto zerar).
 * @returns `GameEndResult` com estado final, `Score` e pendência opcional.
 */
export function finalizeGame(state: GameState): GameEndResult {
  const finalState = enterPhase(state, 'EndOfGame');
  const score = toScore(finalState, true);

  if (score.tie) {
    return {
      state: finalState,
      score,
      pendingDecision: {
        reason: 'OVERTIME_NOT_IN_MVP',
        note:
          'Empate ao fim do tempo regulamentar: prolongamento não simulado no ' +
          'MVP (Decisao_Produto_Pendente).',
      },
    };
  }

  return { state: finalState, score };
}

/**
 * Resolve a virada de quarto / fim de jogo a partir do estado corrente. Se o
 * relógio do quarto não zerou, devolve o estado inalterado e sem desfecho. Se
 * zerou:
 * - no tempo regulamentar restante (quartos 1–3), avança para o próximo quarto
 *   (`advanceAfterQuarter`) e devolve o novo estado, sem `end`;
 * - no 4º quarto (`isRegulationOver`), encerra a partida (`finalizeGame`) e
 *   devolve o `GameEndResult` em `end` — incluindo a pendência de empate (R2.5).
 *
 * É o ponto único que o loop de simulação (Task 14) consulta após cada jogada
 * para saber se continua, troca de quarto ou encerra.
 *
 * @param state Estado corrente.
 * @returns `{ state, end? }`: estado resultante e, no fim de jogo, o desfecho.
 */
export function resolveClockBoundary(state: GameState): {
  readonly state: GameState;
  readonly end?: GameEndResult;
} {
  if (!isQuarterOver(state)) {
    return { state };
  }

  if (isRegulationOver(state)) {
    const end = finalizeGame(state);
    return { state: end.state, end };
  }

  return { state: advanceAfterQuarter(state) };
}

// ===========================================================================
// Task 12.2 — Regras de pontuação e posição da bola (R3.3–R3.8)
// ===========================================================================
//
// Esta seção **estende** a FSM de down/distância/posse (12.1) com as regras de
// pontuação da NFL 2026 e a leitura da **posição da bola relativa às goal
// lines** para determinar touchdown, safety e tentativas (R3.7). Tudo é puro e
// imutável: nenhuma função abaixo muta o `GameState` ou o `Score` de entrada;
// cada uma devolve um novo valor componível com as transições de 12.1.
//
// Convenção de `ballOn` (herdada de `state.ts`, R3.7): posição em jardas
// **relativas às goal lines do time em posse** — a própria goal line (defendida)
// é 0 e a goal line adversária (de ataque) é `FIELD_LENGTH_YARDS` (100). Logo:
// - **Touchdown**: a bola, em posse física, alcança a end zone adversária, i.e.
//   `ballOn >= 100` (R3.3).
// - **Safety**: a bola fica morta na própria end zone do time em posse, i.e.
//   `ballOn <= 0` (R3.5), valendo 2 pontos **ao adversário**.
// Como a perspectiva é sempre a do time em posse, a mesma leitura serve aos dois
// lados sem ramificação por `home`/`away`.
//
// Rastreabilidade NFL 2026 (R3.8): os valores de pontos são os da edição 2026 —
// TD 6, FG 3, Safety 2 (ao adversário), PAT 1, conversão de 2 pontos 2 — e estão
// centralizados em `SCORING_POINTS` para que o log e as estatísticas (Task 13)
// os citem a partir de uma única fonte de verdade.

// ---------------------------------------------------------------------------
// Valores de pontos (fonte única — NFL 2026, R3.3–R3.6, R3.8)
// ---------------------------------------------------------------------------

/**
 * Pontos por tipo de evento de pontuação, conforme a edição NFL 2026 (R3.8):
 * `TD` 6 (R3.3), `FG` 3 (R3.4), `SAFETY` 2 ao adversário (R3.5), `PAT` 1 e
 * `TWO_PT` 2 (R3.6). Fonte única consumida pela FSM, pelo log e pelas estatísticas.
 */
export const SCORING_POINTS: Readonly<Record<ScoringType, number>> = {
  TD: 6,
  FG: 3,
  SAFETY: 2,
  PAT: 1,
  TWO_PT: 2,
};

// ---------------------------------------------------------------------------
// Leitura da posição da bola relativa às goal lines (R3.7)
// ---------------------------------------------------------------------------

/**
 * Indica se a bola, em posse física do time atacante, alcançou a end zone
 * adversária — a condição posicional de um touchdown (R3.3, R3.7).
 *
 * Como `ballOn` é relativo às goal lines do time em posse, "alcançar a end zone
 * adversária" é simplesmente `ballOn >= FIELD_LENGTH_YARDS` (100). A **posse
 * física legal** do portador (contato + controle; nunca manipulação remota,
 * R8.8/R10.5) é pré-condição validada a montante pelo pipeline/anatomia; esta
 * função decide apenas a geometria do campo.
 *
 * @param state Estado corrente (usa `ballOn`).
 * @returns `true` quando a bola alcançou a end zone adversária.
 */
export function hasReachedOpponentEndZone(state: GameState): boolean {
  return state.ballOn >= FIELD_LENGTH_YARDS;
}

/**
 * Indica se a bola ficou morta na própria end zone do time em posse — a condição
 * posicional de um safety (R3.5, R3.7). Em `ballOn` relativo às goal lines, a
 * própria end zone corresponde a `ballOn <= 0`.
 *
 * @param state Estado corrente (usa `ballOn`).
 * @returns `true` quando a bola está morta na própria end zone.
 */
export function isInOwnEndZone(state: GameState): boolean {
  return state.ballOn <= 0;
}

// ---------------------------------------------------------------------------
// Resultado de pontuação (imutável, componível com as transições de 12.1)
// ---------------------------------------------------------------------------

/**
 * Resultado puro de um evento de pontuação. Compõe:
 * - o novo `GameState` (placar atualizado + fase da FSM correspondente);
 * - a `ScoringEntry` canônica (tipo, time que pontuou, quarto) para o
 *   `scoringSummary` das estatísticas e para o evento `SCORE` do log (Task 13);
 * - os `points` concedidos (eco de `SCORING_POINTS`), por conveniência do log.
 *
 * O `ScoringEntry` registra sempre o **time beneficiado** pelos pontos — no
 * safety, o adversário do time em posse (R3.5).
 */
export interface ScoringResult {
  readonly state: GameState;
  readonly entry: ScoringEntry;
  readonly points: number;
}

/**
 * Credita pontos imutavelmente a um time, devolvendo um novo `Score` interno do
 * `GameState` (campo `{ home, away }`), sem mutar o objeto de entrada. Reutiliza
 * a mesma semântica aditiva de `applyPlayResolution` (`state.ts`), mantendo um
 * único entendimento de "somar ao placar".
 *
 * @param score Placar corrente `{ home, away }`.
 * @param team Time a creditar.
 * @param points Pontos a somar (≥ 0).
 * @returns Novo placar imutável.
 */
function creditScore(
  score: GameState['score'],
  team: Team,
  points: number,
): GameState['score'] {
  return {
    home: score.home + (team === 'home' ? points : 0),
    away: score.away + (team === 'away' ? points : 0),
  };
}

/**
 * Núcleo compartilhado de todos os eventos de pontuação: credita `points` ao
 * `team`, define a `phase` resultante e emite a `ScoringEntry` (tipo, time,
 * quarto corrente). Puro e imutável.
 *
 * @param state Estado corrente.
 * @param type Tipo de pontuação (determina os pontos via `SCORING_POINTS`).
 * @param team Time beneficiado pelos pontos.
 * @param phase Fase da FSM após o evento.
 * @returns `ScoringResult` com estado, entrada de scoring e pontos.
 */
function applyScore(
  state: GameState,
  type: ScoringType,
  team: Team,
  phase: GamePhase,
): ScoringResult {
  const points = SCORING_POINTS[type];
  const nextState: GameState = {
    ...state,
    score: creditScore(state.score, team, points),
    phase,
  };
  const entry: ScoringEntry = { type, team, quarter: state.quarter };
  return { state: nextState, entry, points };
}

// ---------------------------------------------------------------------------
// Touchdown (6) e habilitação de PAT/2pt (R3.3)
// ---------------------------------------------------------------------------

/**
 * Registra um **touchdown** (6 pontos) para o time em posse e transita para a
 * fase `Touchdown` (R3.3). O design encadeia `Touchdown → ExtraPointPhase`
 * ("6 pts + habilita PAT/2pt"); a habilitação do ponto extra/conversão é
 * exposta por `enterExtraPointPhase`, que o chamador aplica em seguida, mantendo
 * cada transição pequena e rastreável.
 *
 * Pré-condição (validada a montante): o portador é **legal e em posse física**
 * ao alcançar a end zone — manipulação remota nunca é touchdown (R8.8/R10.7).
 *
 * @param state Estado corrente (o time beneficiado é o `possession` atual).
 * @returns `ScoringResult` com +6 ao time em posse e fase `Touchdown`.
 */
export function scoreTouchdown(state: GameState): ScoringResult {
  return applyScore(state, 'TD', state.possession, 'Touchdown');
}

/**
 * Entra na fase `ExtraPointPhase`, habilitando a tentativa de ponto extra (PAT)
 * ou a conversão de 2 pontos após um touchdown (R3.3). Transição de fase pura;
 * não altera placar nem posse. O time que pontuou (ainda `possession`) é quem
 * executa a tentativa.
 *
 * @param state Estado corrente (tipicamente logo após `scoreTouchdown`).
 * @returns Novo estado na fase `ExtraPointPhase`.
 */
export function enterExtraPointPhase(state: GameState): GameState {
  return enterPhase(state, 'ExtraPointPhase');
}

// ---------------------------------------------------------------------------
// Field goal (3) — R3.4
// ---------------------------------------------------------------------------

/**
 * Registra um **field goal** convertido (3 pontos) para o time que chutou
 * (`possession`) (R3.4). O design encadeia `FieldGoalAtt → ExtraPointPhase`
 * no fluxo pós-FG; porém, por não haver tentativa de conversão após um FG, a
 * fase resultante aqui é `Kickoff` — o fluxo real pós-pontuação é um novo chute
 * inicial (vide `stateDiagram`: `ExtraPointPhase → Kickoff`, `Safety → Kickoff`).
 * Mantemos a transição direta a `Kickoff` para o field goal, deixando
 * `ExtraPointPhase` exclusivamente para a sequência de touchdown.
 *
 * @param state Estado corrente (o chutador é o time em posse).
 * @returns `ScoringResult` com +3 ao time em posse e fase `Kickoff`.
 */
export function scoreFieldGoal(state: GameState): ScoringResult {
  return applyScore(state, 'FG', state.possession, 'Kickoff');
}

// ---------------------------------------------------------------------------
// Safety (2 ao adversário) — R3.5
// ---------------------------------------------------------------------------

/**
 * Registra um **safety**: 2 pontos **ao adversário** do time em posse, quando o
 * portador é derrubado ou a bola fica morta na própria end zone (R3.5). Credita
 * ao oponente de `possession` e transita para `Safety`; o fluxo subsequente é um
 * chute inicial (`Safety → Kickoff` no design).
 *
 * @param state Estado corrente (o time em posse sofre o safety).
 * @returns `ScoringResult` com +2 ao adversário e fase `Safety`.
 */
export function scoreSafety(state: GameState): ScoringResult {
  const beneficiary = opponentOf(state.possession);
  return applyScore(state, 'SAFETY', beneficiary, 'Safety');
}

// ---------------------------------------------------------------------------
// Ponto extra (1) e conversão de 2 pontos (2) — R3.6
// ---------------------------------------------------------------------------

/**
 * Registra um **ponto extra (PAT)** convertido: 1 ponto ao time que marcou o
 * touchdown (`possession`) (R3.6). Após a conversão, o fluxo é um novo chute
 * inicial (`ExtraPointPhase → Kickoff` no design), portanto a fase resultante é
 * `Kickoff`.
 *
 * @param state Estado corrente (na fase `ExtraPointPhase`).
 * @returns `ScoringResult` com +1 ao time em posse e fase `Kickoff`.
 */
export function scoreExtraPoint(state: GameState): ScoringResult {
  return applyScore(state, 'PAT', state.possession, 'Kickoff');
}

/**
 * Registra uma **conversão de 2 pontos** convertida: 2 pontos ao time que marcou
 * o touchdown (`possession`) (R3.6). Como no PAT, o fluxo subsequente é um novo
 * chute inicial, logo a fase resultante é `Kickoff`.
 *
 * @param state Estado corrente (na fase `ExtraPointPhase`).
 * @returns `ScoringResult` com +2 ao time em posse e fase `Kickoff`.
 */
export function scoreTwoPointConversion(state: GameState): ScoringResult {
  return applyScore(state, 'TWO_PT', state.possession, 'Kickoff');
}

// ---------------------------------------------------------------------------
// Detecção de pontuação a partir da posição da bola (R3.3, R3.5, R3.7)
// ---------------------------------------------------------------------------

/**
 * Classificação do desfecho de pontuação **posicional** de uma jogada de ataque
 * regular, derivada apenas da posição da bola relativa às goal lines (R3.7).
 */
export type ScoringOutcome =
  /** `ballOn >= 100`: portador legal alcançou a end zone adversária (R3.3). */
  | 'TOUCHDOWN'
  /** `ballOn <= 0`: bola morta na própria end zone (R3.5). */
  | 'SAFETY'
  /** Bola dentro de campo: sem evento de pontuação posicional. */
  | 'NONE';

/**
 * Classifica o desfecho de pontuação posicional de uma jogada **sem** alterar o
 * estado nem o placar, usando somente a posição da bola relativa às goal lines
 * (R3.7). A **posse física legal** é pré-condição verificada pelo pipeline a
 * montante; manipulação remota nunca chega aqui como touchdown/safety
 * (R8.8/R10.7).
 *
 * Precedência: a end zone adversária (`TOUCHDOWN`) tem prioridade sobre a
 * própria (`SAFETY`); as duas condições são mutuamente exclusivas na prática,
 * pois `ballOn` é limitado a `[0, 100]` por `applyPlayResolution`.
 *
 * @param state Estado corrente, já com a posição da bola aplicada pela resolução.
 * @returns `TOUCHDOWN`, `SAFETY` ou `NONE`.
 */
export function classifyScoringOutcome(state: GameState): ScoringOutcome {
  if (hasReachedOpponentEndZone(state)) {
    return 'TOUCHDOWN';
  }
  if (isInOwnEndZone(state)) {
    return 'SAFETY';
  }
  return 'NONE';
}

/**
 * Resolve o evento de pontuação posicional de uma jogada de ataque regular a
 * partir da posição da bola (R3.3, R3.5, R3.7). Devolve o `ScoringResult`
 * correspondente quando há touchdown ou safety, ou `null` quando a jogada não
 * produz pontuação posicional (o fluxo de down/distância segue por
 * `advancePossession`).
 *
 * Esta função é o ponto de integração com a transição de 12.1: o loop de
 * simulação (Task 14) chama `resolvePositionalScoring` **antes** de
 * `advancePossession`; havendo pontuação, aplica o `ScoringResult` (que já
 * define a fase `Touchdown`/`Safety`) em vez de avançar downs.
 *
 * @param state Estado corrente, já com a posição da bola aplicada.
 * @returns `ScoringResult` do touchdown/safety, ou `null` se não houver.
 */
export function resolvePositionalScoring(
  state: GameState,
): ScoringResult | null {
  switch (classifyScoringOutcome(state)) {
    case 'TOUCHDOWN':
      return scoreTouchdown(state);
    case 'SAFETY':
      return scoreSafety(state);
    case 'NONE':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Reexport conveniente dos blocos de down/distância usados pela FSM
// ---------------------------------------------------------------------------

export { DOWNS_PER_SET, DEFAULT_DISTANCE_YARDS, FIELD_LENGTH_YARDS } from './state';
export type { Team, ScoringEntry, ScoringType };

// ===========================================================================
// Task 12.3 — Gatilhos de special teams por estado (R11.1–R11.5)
// ===========================================================================
//
// Esta seção **estende** a FSM (12.1 down/distância/posse + 12.2 pontuação) com
// os gatilhos de **special teams acionados por estado**, nunca por acaso
// (R11.4). O design ("Gatilhos de special teams") fixa três pares situacionais
// de jogadas do `Catalogo_Jogadas`:
//
//   | Estado                                             | Ofensiva (ST)     | Defensiva (ST)     |
//   | Chute inicial (pós-pontuação / início de período)  | ST_O_KICKOFF      | ST_D_KICK_RETURN   |
//   | Decisão de punt (4º down)                          | ST_O_PUNT         | ST_D_PUNT_RETURN   |
//   | Tentativa de FG / ponto extra                      | ST_O_FIELD_GOAL   | ST_D_KICK_BLOCK    |
//
// A seleção é uma **função pura e determinística do estado** (R11.4): dado o
// `GameState` (via sua `phase`, estendida por um descritor opcional de decisão
// de 4º down), devolve-se o par de special teams a executar, **sem consumir o
// `Gerador_RNG` de escolha**. Isto contrasta com `select.ts` (jogadas regulares
// de ataque/defesa), que pode consumir 1 `nextFloat()` no sorteio ponderado —
// aqui nenhum float é consumido, pois o gatilho é inteiramente situacional.
//
// Reuso de indivíduos e fadiga compartilhada (R11.5): special teams podem
// reutilizar os mesmos indivíduos da equipe fora de snaps simultâneos, mantendo
// a **fadiga compartilhada por `instance_id`**. Essa compartilha já é
// garantida por `state.ts` (`fatigue: ReadonlyMap<number, number>` indexado por
// `instance_id`) e por `play/fatigue.ts` (`applyFatigue`). Este módulo apenas
// **seleciona o par de jogadas** e NÃO duplica nem mantém fadiga por unidade:
// não há mapa de fadiga por "unidade de special teams", de modo que a leitura e
// a acumulação continuam ocorrendo na única entrada por `instance_id`. Assim, a
// seleção de special teams por estado não quebra o invariante de fadiga
// compartilhada (R6.7/R11.5).

// ---------------------------------------------------------------------------
// Situações de special teams (classificação pura do estado) — R11.1–R11.3
// ---------------------------------------------------------------------------

/**
 * A situação de special teams determinada pelo estado do jogo. Cada situação
 * mapeia 1:1 para um par (ofensiva ST, defensiva ST) do `Catalogo_Jogadas`
 * (R11.1–R11.3). `NONE` indica que o estado corrente não é um gatilho de special
 * teams (jogada de scrimmage regular segue por `select.ts`/`advancePossession`).
 */
export type SpecialTeamsSituation =
  /** Chute inicial pós-pontuação ou início de período (R11.1). */
  | 'KICKOFF'
  /** Decisão de punt no 4º down (R11.2). */
  | 'PUNT'
  /** Tentativa de field goal ou ponto extra (R11.3). */
  | 'FIELD_GOAL'
  /** Nenhum gatilho de special teams aplicável. */
  | 'NONE';

/**
 * Par de `Jogada_Special_Teams` a executar simultaneamente: a jogada do time que
 * executa o chute/tentativa (`offense`) e a resposta do time adversário
 * (`defense`). Ambas pertencem às seis `SpecialTeamsPlayId` do catálogo.
 */
export interface SpecialTeamsPlays {
  readonly offense: SpecialTeamsPlayId;
  readonly defense: SpecialTeamsPlayId;
}

/**
 * Mapa canônico e congelado situação → par de special teams (R11.1–R11.3). É a
 * **única fonte de verdade** dos gatilhos, espelhando a tabela do design; o log
 * (Task 13) e o pipeline (Task 14) citam o par a partir daqui.
 */
export const SPECIAL_TEAMS_TRIGGERS: Readonly<
  Record<Exclude<SpecialTeamsSituation, 'NONE'>, SpecialTeamsPlays>
> = Object.freeze({
  // R11.1 — chute inicial.
  KICKOFF: Object.freeze({
    offense: 'ST_O_KICKOFF',
    defense: 'ST_D_KICK_RETURN',
  }),
  // R11.2 — punt no 4º down.
  PUNT: Object.freeze({
    offense: 'ST_O_PUNT',
    defense: 'ST_D_PUNT_RETURN',
  }),
  // R11.3 — tentativa de FG / ponto extra.
  FIELD_GOAL: Object.freeze({
    offense: 'ST_O_FIELD_GOAL',
    defense: 'ST_D_KICK_BLOCK',
  }),
});

/**
 * Descritor opcional da decisão tomada no 4º down (`FourthDownDecision`). O
 * `stateDiagram` do design ramifica `FourthDownDecision` em `Punt`, `FieldGoalAtt`
 * ou `Drive` (go-for-it). Como a `phase` sozinha não distingue punt de FG antes
 * de a FSM entrar em `Punt`/`FieldGoalAtt`, este descritor permite ao chamador
 * (bot/pipeline) informar a intenção de forma explícita e **determinística**,
 * sem recorrer a RNG. Quando ausente, a classificação usa apenas a `phase`.
 */
export type FourthDownChoice = 'PUNT' | 'FIELD_GOAL' | 'GO_FOR_IT';

/**
 * Classifica a **situação de special teams** a partir do estado do jogo, de
 * forma puramente determinística (R11.4) — sem consumir RNG.
 *
 * Regras (derivadas da `phase` e, para o 4º down, de uma escolha explícita):
 * - `Kickoff` → `KICKOFF` (chute inicial pós-pontuação / início de período,
 *   R11.1). As fases que o design encadeia a um novo kickoff
 *   (`ExtraPointPhase`, `Safety`) chegam aqui já como `Kickoff` via as
 *   transições de 12.2; manter o gatilho em `Kickoff` concentra a regra em um
 *   único ponto.
 * - `Punt` → `PUNT` (R11.2); `FieldGoalAtt` → `FIELD_GOAL` (R11.3);
 *   `ExtraPointPhase` → `FIELD_GOAL`, pois a tentativa de ponto extra usa o par
 *   de FG (R11.3).
 * - `FourthDownDecision` → depende de `choice`: `PUNT` → `PUNT`;
 *   `FIELD_GOAL` → `FIELD_GOAL`; `GO_FOR_IT`/ausente → `NONE` (segue scrimmage).
 * - Qualquer outra fase (`Drive`, `ChangePossession`, `Touchdown`, `Turnover`,
 *   `EndOfQuarter`, `EndOfGame`) → `NONE`.
 *
 * @param state Estado corrente (usa `phase`).
 * @param choice Decisão explícita de 4º down, quando a fase é `FourthDownDecision`.
 * @returns A `SpecialTeamsSituation` aplicável ao estado.
 */
export function classifySpecialTeamsSituation(
  state: GameState,
  choice?: FourthDownChoice,
): SpecialTeamsSituation {
  switch (state.phase) {
    case 'Kickoff':
      return 'KICKOFF';
    case 'Punt':
      return 'PUNT';
    case 'FieldGoalAtt':
      return 'FIELD_GOAL';
    case 'ExtraPointPhase':
      // A tentativa de ponto extra é executada pelo par de FG (R11.3).
      return 'FIELD_GOAL';
    case 'FourthDownDecision':
      if (choice === 'PUNT') return 'PUNT';
      if (choice === 'FIELD_GOAL') return 'FIELD_GOAL';
      return 'NONE';
    default:
      return 'NONE';
  }
}

/**
 * Seleciona o par de `Jogada_Special_Teams` acionado **pelo estado do jogo**
 * (R11.1–R11.4), de forma pura e determinística, **sem consumir o `Gerador_RNG`
 * de escolha**. Devolve `null` quando o estado não corresponde a um gatilho de
 * special teams (a jogada regular de scrimmage segue por `select.ts`).
 *
 * Esta é a função que a orquestração (Task 14) consulta a cada snap, antes da
 * seleção de jogada regular: havendo par de special teams, executa esse par; do
 * contrário, segue para a seleção ponderada de ataque/defesa.
 *
 * A fadiga continua compartilhada por `instance_id` mesmo quando os indivíduos
 * de special teams coincidem com os de ataque/defesa fora de snaps simultâneos
 * (R11.5): esta seleção não cria nem duplica fadiga por unidade; apenas nomeia o
 * par de jogadas, deixando a acumulação/leitura de fadiga em `state.ts`/
 * `fatigue.ts` intacta.
 *
 * @param state Estado corrente (usa `phase`).
 * @param choice Decisão explícita de 4º down, quando a fase é `FourthDownDecision`.
 * @returns O par `{ offense, defense }` de special teams, ou `null` se inaplicável.
 */
export function selectSpecialTeams(
  state: GameState,
  choice?: FourthDownChoice,
): SpecialTeamsPlays | null {
  const situation = classifySpecialTeamsSituation(state, choice);
  if (situation === 'NONE') {
    return null;
  }
  return SPECIAL_TEAMS_TRIGGERS[situation];
}

/**
 * Indica se o estado corrente aciona special teams (R11.1–R11.3), ou seja, se
 * `selectSpecialTeams` produziria um par de jogadas. Conveniência para o loop de
 * simulação ramificar entre special teams e scrimmage sem recriar o par.
 *
 * @param state Estado corrente.
 * @param choice Decisão explícita de 4º down, quando aplicável.
 * @returns `true` quando há um gatilho de special teams.
 */
export function isSpecialTeamsState(
  state: GameState,
  choice?: FourthDownChoice,
): boolean {
  return classifySpecialTeamsSituation(state, choice) !== 'NONE';
}

// ---------------------------------------------------------------------------
// Transições de fase para a decisão de 4º down (reutilizam 12.1/12.2)
// ---------------------------------------------------------------------------

/**
 * Coloca a FSM na fase `Punt` (R11.2), a partir da decisão de punt no 4º down
 * (`FourthDownDecision → Punt` no `stateDiagram`). Transição de fase pura; a
 * mudança de posse subsequente (`Punt → ChangePossession`) é de 12.1
 * (`enterChangePossession`). Não altera posse, placar nem posição aqui.
 *
 * @param state Estado corrente.
 * @returns Novo estado na fase `Punt`.
 */
export function enterPunt(state: GameState): GameState {
  return enterPhase(state, 'Punt');
}

/**
 * Coloca a FSM na fase `FieldGoalAtt` (R11.3), a partir da decisão de FG no 4º
 * down (`FourthDownDecision → FieldGoalAtt` no `stateDiagram`). Transição de
 * fase pura; o desfecho (FG convertido → `scoreFieldGoal` de 12.2; perdido/
 * bloqueado → `enterChangePossession` de 12.1) é aplicado pelo chamador.
 *
 * @param state Estado corrente.
 * @returns Novo estado na fase `FieldGoalAtt`.
 */
export function enterFieldGoalAttempt(state: GameState): GameState {
  return enterPhase(state, 'FieldGoalAtt');
}

export type { SpecialTeamsPlayId };

// ===========================================================================
// Task 12.4 — Faltas (NFL 2026) e Decisao_Produto_Pendente genérica (R14.1–R14.4)
// ===========================================================================
//
// Esta seção **estende** a FSM (12.1 down/distância/posse + 12.2 pontuação +
// 12.3 special teams) com:
//
// 1. **Detecção e aplicação de faltas** de formação, elegibilidade e
//    interferência conforme a edição NFL 2026 (R14.1), devolvendo a resolução
//    (jardas de penalidade / repetir o down) de forma **estruturada e
//    rastreável** (R14.3), para o `log.ts` (Task 13) emitir o evento `FOUL`.
// 2. O **invariante** de que a detecção de falta é uma **função pura do contexto
//    de jogo**, NUNCA condicionada por qualquer flag/estratégia Pokémon: não há
//    parâmetro de estratégia nestas funções, logo nenhuma `Strategy` consegue
//    desativar a detecção (R14.2).
// 3. Um descritor **genérico** de `Decisao_Produto_Pendente` para lacunas de
//    regra que o contrato autoritativo não decide (R14.4), reusando a forma de
//    `PendingDecision` de 12.1 — **sem inventar mecânica** (nenhum efeito sobre
//    placar, posse, down/distância ou relógio é produzido aqui).
//
// Tudo é puro e imutável: nenhuma função abaixo muta o `GameState` de entrada;
// cada uma devolve um novo valor (ou um descritor) componível com as transições
// anteriores. A **aplicação** de uma penalidade ao estado continua sendo
// decisão do pipeline (Task 14) a partir do `FoulResult` traceável produzido
// aqui; esta task modela a detecção, a resolução e o registro.

// ---------------------------------------------------------------------------
// Tipos de falta e resolução (NFL 2026) — R14.1, R14.3
// ---------------------------------------------------------------------------

/**
 * Categorias de falta modeladas no MVP, conforme a edição NFL 2026 (R14.1):
 * - `FORMATION`: formação ilegal no snap (p.ex. jogadores insuficientes na
 *   linha de scrimmage).
 * - `ELIGIBILITY`: recebedor/elegibilidade irregular (p.ex. recebedor inelegível
 *   adiante da linha num passe).
 * - `INTERFERENCE`: interferência de passe (ofensiva ou defensiva).
 */
export type FoulType = 'FORMATION' | 'ELIGIBILITY' | 'INTERFERENCE';

/** Qual lado cometeu a falta — determina contra quem a penalidade incide. */
export type FoulParty = 'offense' | 'defense';

/**
 * Como a falta é resolvida, de forma estruturada e rastreável (R14.3):
 * - `penaltyYards`: jardas de penalidade aplicadas (sempre ≥ 0).
 * - `replayDown`: se o down é repetido após a penalidade (p.ex. falta de
 *   formação) em vez de contar como um down jogado.
 * - `automaticFirstDown`: se a penalidade concede 1º down automático ao ataque
 *   (caso da interferência defensiva de passe na NFL 2026).
 */
export interface FoulResolution {
  readonly penaltyYards: number;
  readonly replayDown: boolean;
  readonly automaticFirstDown: boolean;
}

/**
 * Resultado estruturado e rastreável de uma falta detectada (R14.1, R14.3):
 * o tipo, o lado faltoso e a resolução a aplicar, mais uma `description`
 * narrativa estável para o evento `FOUL` do log (Task 13). É um **fato
 * derivado do contexto da jogada**, não uma mutação de estado.
 */
export interface FoulResult {
  readonly type: FoulType;
  readonly party: FoulParty;
  readonly resolution: FoulResolution;
  /** Narrativa estável para o log (Task 13). */
  readonly description: string;
}

/**
 * Resoluções canônicas por tipo de falta, conforme a edição NFL 2026 (R14.1).
 * **Única fonte de verdade** das jardas/repetição de down, espelhando os valores
 * da edição 2026 para que o log cite a resolução a partir de um só lugar (R14.3):
 * - `FORMATION`: 5 jardas, repete o down.
 * - `ELIGIBILITY`: 5 jardas, repete o down.
 * - `INTERFERENCE`: 10 jardas; quando defensiva, concede 1º down automático
 *   (ajustado por `detectFouls`); por padrão repete o down.
 */
export const FOUL_RESOLUTIONS: Readonly<Record<FoulType, FoulResolution>> =
  Object.freeze({
    FORMATION: Object.freeze({
      penaltyYards: 5,
      replayDown: true,
      automaticFirstDown: false,
    }),
    ELIGIBILITY: Object.freeze({
      penaltyYards: 5,
      replayDown: true,
      automaticFirstDown: false,
    }),
    INTERFERENCE: Object.freeze({
      penaltyYards: 10,
      replayDown: true,
      automaticFirstDown: false,
    }),
  });

// ---------------------------------------------------------------------------
// Contexto pré-snap/jogada para a detecção de faltas — R14.1, R14.2
// ---------------------------------------------------------------------------

/**
 * Contexto **objetivo** da jogada do qual a detecção de faltas é uma função
 * pura (R14.2). Deliberadamente NÃO contém nenhum campo de `Strategy`, preset
 * ou flag de time: a detecção não pode ser desativada por nenhuma estratégia
 * Pokémon, pois a estratégia simplesmente não participa desta assinatura.
 *
 * Os campos descrevem o que o pipeline (Task 14) observou na formação/execução:
 * - `playersOnLine`: nº de jogadores na linha de scrimmage no snap.
 * - `ineligibleReceiverDownfield`: recebedor inelegível adiante da linha num
 *   passe.
 * - `offensivePassInterference` / `defensivePassInterference`: interferência de
 *   passe pelo ataque/defesa.
 */
export interface FoulContext {
  readonly playersOnLine: number;
  readonly ineligibleReceiverDownfield: boolean;
  readonly offensivePassInterference: boolean;
  readonly defensivePassInterference: boolean;
}

/** Nº mínimo de jogadores na linha de scrimmage para formação legal (NFL 2026). */
export const MIN_PLAYERS_ON_LINE = 7;

// ---------------------------------------------------------------------------
// Detecção pura de faltas (não há flag de estratégia) — R14.1, R14.2, R14.3
// ---------------------------------------------------------------------------

/**
 * Detecta as faltas aplicáveis a partir **somente** do `FoulContext` objetivo da
 * jogada, de forma pura e determinística (R14.1). Devolve um `FoulResult` por
 * falta encontrada, com a resolução canônica (R14.3), em ordem estável
 * (formação → elegibilidade → interferência) para serialização byte a byte.
 *
 * **Invariante de aplicabilidade (R14.2):** esta função é uma função pura do
 * contexto de jogo e NÃO recebe nenhuma `Strategy`/flag de time; portanto
 * nenhuma estratégia Pokémon consegue desativar a detecção. A estratégia
 * influencia apenas a seleção de jogadas (`select.ts`), nunca a vigência das
 * faltas.
 *
 * Casos (NFL 2026):
 * - `playersOnLine < MIN_PLAYERS_ON_LINE` → falta de **formação** (ofensiva).
 * - `ineligibleReceiverDownfield` → falta de **elegibilidade** (ofensiva).
 * - `offensivePassInterference` → **interferência** ofensiva (repete o down).
 * - `defensivePassInterference` → **interferência** defensiva, com 1º down
 *   automático ao ataque.
 *
 * @param context Contexto objetivo da jogada.
 * @returns Lista imutável de faltas detectadas (vazia se nenhuma).
 */
export function detectFouls(
  context: FoulContext,
): ReadonlyArray<FoulResult> {
  const fouls: FoulResult[] = [];

  if (context.playersOnLine < MIN_PLAYERS_ON_LINE) {
    fouls.push({
      type: 'FORMATION',
      party: 'offense',
      resolution: FOUL_RESOLUTIONS.FORMATION,
      description:
        `Formação ilegal: ${context.playersOnLine} jogadores na linha ` +
        `(mínimo ${MIN_PLAYERS_ON_LINE}); penalidade de ` +
        `${FOUL_RESOLUTIONS.FORMATION.penaltyYards} jardas, repete o down.`,
    });
  }

  if (context.ineligibleReceiverDownfield) {
    fouls.push({
      type: 'ELIGIBILITY',
      party: 'offense',
      resolution: FOUL_RESOLUTIONS.ELIGIBILITY,
      description:
        'Recebedor inelegível adiante da linha; penalidade de ' +
        `${FOUL_RESOLUTIONS.ELIGIBILITY.penaltyYards} jardas, repete o down.`,
    });
  }

  if (context.offensivePassInterference) {
    fouls.push({
      type: 'INTERFERENCE',
      party: 'offense',
      resolution: FOUL_RESOLUTIONS.INTERFERENCE,
      description:
        'Interferência de passe ofensiva; penalidade de ' +
        `${FOUL_RESOLUTIONS.INTERFERENCE.penaltyYards} jardas, repete o down.`,
    });
  }

  if (context.defensivePassInterference) {
    fouls.push({
      type: 'INTERFERENCE',
      party: 'defense',
      resolution: {
        ...FOUL_RESOLUTIONS.INTERFERENCE,
        // NFL 2026: interferência defensiva de passe concede 1º down automático.
        automaticFirstDown: true,
      },
      description:
        'Interferência de passe defensiva; penalidade de ' +
        `${FOUL_RESOLUTIONS.INTERFERENCE.penaltyYards} jardas e 1º down automático.`,
    });
  }

  return fouls;
}

/**
 * Aplica a **resolução de uma falta** ao estado, devolvendo um novo `GameState`
 * (puro e imutável), traduzindo o `FoulResult` traceável em efeito de
 * down/distância (R14.1, R14.3). A penalidade move a bola e ajusta a distância
 * conforme o lado faltoso; a aplicação em si fica concentrada aqui para que o
 * pipeline (Task 14) a reuse sem reimplementar a aritmética.
 *
 * Convenção de `ballOn` (relativo ao time em posse, herdada de `state.ts`):
 * - Falta **defensiva** → avança a bola do ataque: `ballOn += penaltyYards`
 *   (limitado a `[0, 100]`); interferência defensiva concede 1º & 10.
 * - Falta **ofensiva** → recua a bola do ataque: `ballOn -= penaltyYards`
 *   (limitado a `[0, 100]`) e **aumenta** a distância pela penalidade quando o
 *   down é repetido.
 *
 * Não altera placar, posse, relógio nem fase: a penalidade é um ajuste de
 * posição/distância. Repetir o down (`replayDown`) significa que o down corrente
 * é mantido (nenhum incremento), o que ocorre naturalmente por não chamar
 * `advanceDown` aqui.
 *
 * @param state Estado corrente.
 * @param foul Resultado de falta traceável (de `detectFouls`).
 * @returns Novo `GameState` com a penalidade aplicada.
 */
export function applyFoul(state: GameState, foul: FoulResult): GameState {
  const { party, resolution } = foul;
  const yards = resolution.penaltyYards;

  if (party === 'defense') {
    const nextBallOn = Math.min(
      FIELD_LENGTH_YARDS,
      Math.max(0, state.ballOn + yards),
    );
    if (resolution.automaticFirstDown) {
      // 1º & 10 na nova posição (interferência defensiva).
      return {
        ...state,
        ballOn: nextBallOn,
        down: 1,
        distance: DEFAULT_DISTANCE_YARDS,
      };
    }
    return {
      ...state,
      ballOn: nextBallOn,
      distance: Math.max(1, state.distance - yards),
    };
  }

  // Falta ofensiva: recua a bola e aumenta a distância quando o down repete.
  const nextBallOn = Math.min(
    FIELD_LENGTH_YARDS,
    Math.max(0, state.ballOn - yards),
  );
  return {
    ...state,
    ballOn: nextBallOn,
    distance: resolution.replayDown ? state.distance + yards : state.distance,
  };
}

// ---------------------------------------------------------------------------
// Decisao_Produto_Pendente genérica para lacunas de regra — R14.4
// ---------------------------------------------------------------------------

/**
 * Produz um descritor de `Decisao_Produto_Pendente` para uma **situação de regra
 * que o contrato autoritativo não decide** (R14.4), reusando a forma de
 * `PendingDecision` de 12.1. O motor registra a pendência (o `log.ts` emite
 * `PENDING_DECISION`) e **não inventa mecânica**: esta função apenas descreve a
 * lacuna; não altera placar, posse, down/distância, relógio nem fase.
 *
 * Overtime (`finalizeGame`/`OVERTIME_NOT_IN_MVP`) é o caso canônico já coberto
 * por 12.1; esta função cobre quaisquer outras lacunas sob o motivo genérico
 * `RULE_GAP_NOT_IN_CONTRACT`.
 *
 * @param situation Descrição estável da situação não decidida pelo contrato.
 * @returns `PendingDecision` com motivo `RULE_GAP_NOT_IN_CONTRACT`.
 */
export function pendingDecisionForRuleGap(situation: string): PendingDecision {
  return {
    reason: 'RULE_GAP_NOT_IN_CONTRACT',
    note:
      `Situação não decidida pelo contrato autoritativo: ${situation}. ` +
      'Registrada como Decisao_Produto_Pendente; nenhuma mecânica inventada (R14.4).',
  };
}
