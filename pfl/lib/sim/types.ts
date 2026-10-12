/**
 * Tipos compartilhados do núcleo de simulação (`lib/sim/types.ts`).
 *
 * Este módulo reúne os contratos imutáveis que atravessam o `Motor_Simulacao`:
 * a entrada resolvida do núcleo puro (`ResolvedInput`), o estado de jogo
 * (`GameState`), os parâmetros do modelo (`SimulationParameters`), o baseline de
 * design (`Baseline`), os matchups, as decisões de efeito inerte, os eventos de
 * log (`LogEvent`, `GameLog`), as estatísticas agregadas (`GameStats`) e o
 * resultado da simulação (`SimulationResult`).
 *
 * Fronteira de pureza (invariante de arquitetura): nenhum tipo aqui depende de
 * rede, banco, relógio de sistema ou ambiente. Toda a variação da partida entra
 * pela assinatura `simulate(input: ResolvedInput): SimulationResult` e sai no
 * resultado. Por isso **toda entrada do núcleo é imutável** (`readonly`,
 * `ReadonlyArray`, `ReadonlyMap`): o determinismo byte a byte é verificável
 * porque a mesma `ResolvedInput` sempre produz o mesmo `SimulationResult`.
 *
 * As definições abaixo seguem a seção "Data Models" e "Components and
 * Interfaces" do design.
 *
 * _Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 13.1, 13.3_
 */

import type { NflMatchupRow } from '../nfl/types';

// Reexporta a linha de matchup NFL para que o gancho de calibração do núcleo
// (`calibrateDeltas`) e a entrada resolvida possam referenciá-la sem acoplar o
// resto do núcleo ao módulo `lib/nfl`.
export type { NflMatchupRow };

// ---------------------------------------------------------------------------
// Identificadores de jogadas e papéis (Catalogo_Jogadas de 18 jogadas)
// ---------------------------------------------------------------------------

/** As seis `Jogada_Ofensiva` do catálogo. */
export type OffensivePlayId =
  | 'O_RUN_INSIDE'
  | 'O_RUN_OUTSIDE'
  | 'O_PASS_SHORT'
  | 'O_PASS_INTERMEDIATE'
  | 'O_PASS_DEEP'
  | 'O_PLAY_ACTION';

/** As seis `Jogada_Defensiva` do catálogo. */
export type DefensivePlayId =
  | 'D_RUN_FIT'
  | 'D_EDGE_CONTAIN'
  | 'D_ZONE'
  | 'D_MAN'
  | 'D_RUSH'
  | 'D_CONTAIN_QB';

/** As seis `Jogada_Special_Teams` do catálogo (três chutando, três recebendo). */
export type SpecialTeamsPlayId =
  | 'ST_O_KICKOFF'
  | 'ST_O_PUNT'
  | 'ST_O_FIELD_GOAL'
  | 'ST_D_KICK_RETURN'
  | 'ST_D_PUNT_RETURN'
  | 'ST_D_KICK_BLOCK';

/** Qualquer identificador do `Catalogo_Jogadas` (18 jogadas no total). */
export type PlayId = OffensivePlayId | DefensivePlayId | SpecialTeamsPlayId;

/** Unidade de escalação à qual um atleta é atribuído. */
export type LineupUnit = 'offense' | 'defense' | 'specialTeams';

/** Posição funcional usada pelo `Validador_Funcoes`. */
export type Position =
  | 'QB'
  | 'C'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'CB'
  | 'S'
  | 'K'
  | 'P'
  | 'OL'
  | 'DL'
  | 'LB';

/** Lado do campo que detém a posse. */
export type Team = 'home' | 'away';

// ---------------------------------------------------------------------------
// Valores primitivos de domínio
// ---------------------------------------------------------------------------

/** Posição espacial usada pela `Esfera_Supressao`. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Condição meteorológica sorteada na inicialização da partida. */
export type Weather = 'CLEAR' | 'RAIN' | 'WIND' | 'HEAT' | 'COLD';

/**
 * `Placar` final da partida. `final` indica fim do tempo regulamentar; `tie`
 * sinaliza empate (que vira `Decisao_Produto_Pendente` de prolongamento).
 */
export interface Score {
  readonly home: number;
  readonly away: number;
  readonly final: boolean;
  readonly tie: boolean;
}

// ---------------------------------------------------------------------------
// Entrada resolvida do núcleo puro (ResolvedInput)
// ---------------------------------------------------------------------------

/** As seis estatísticas base de um atleta resolvido. */
export interface AthleteStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly specialAttack: number;
  readonly specialDefense: number;
  readonly speed: number;
}

/**
 * Atleta já resolvido do catálogo (stats, tipo, golpes, habilidade e efeitos
 * adicionais lidos antes da simulação). A fadiga é indexada por `instanceId`,
 * que é único por time e compartilhado entre todas as unidades do indivíduo.
 */
export interface ResolvedAthlete {
  /** `instance_id` (único por time) — chave da fadiga compartilhada. */
  readonly instanceId: number;
  readonly pokemonId: number;
  readonly types: ReadonlyArray<string>;
  readonly stats: AthleteStats;
  readonly abilityId: number;
  /** Exatamente quatro golpes por atleta (contrato da foundation). */
  readonly moveIds: readonly [number, number, number, number];
  /** Efeitos adicionais → resolvidos pela política de inércia (todos inertes no MVP). */
  readonly additionalEffectIds: ReadonlyArray<string>;
  readonly positionDesignation: Position;
}

/**
 * Escalação resolvida de um time: atletas por unidade de jogo. `teamSeedId`
 * identifica o time importado no modo bot-seed; nunca deriva o `Seed_RNG`.
 */
export interface ResolvedLineup {
  readonly teamSeedId?: string;
  readonly units: Readonly<Record<LineupUnit, ReadonlyArray<ResolvedAthlete>>>;
}

/** Perfil tático de referência de um time. */
export type Preset = 'BALANCED' | 'GROUND' | 'AERIAL' | 'CURTI';

/**
 * `Estrategia` de um time: preset de estilo e as prioridades táticas que
 * governam a seleção de jogadas.
 */
export interface Strategy {
  readonly preset: Preset;
  /** Pesos situacionais por jogada (opcional; o preset provê o default). */
  readonly playWeights?: Readonly<Record<string, number>>;
  /** Prioridades táticas arbitrárias declaradas pela estratégia. */
  readonly priorities?: Readonly<Record<string, number>>;
}

/** Os três modos de bot suportados. */
export type BotMode = 'random' | 'curti' | 'seeded';

/**
 * Entrada imutável e autossuficiente do núcleo puro. Contém tudo que a
 * simulação precisa — não há leitura externa durante a execução.
 */
export interface ResolvedInput {
  readonly home: ResolvedLineup;
  readonly away: ResolvedLineup;
  readonly strategyHome: Strategy;
  readonly strategyAway: Strategy;
  readonly botModeHome?: BotMode;
  readonly botModeAway?: BotMode;
  /** `simulation_parameters` + `matchups_36` + versão/status do baseline. */
  readonly baseline: Baseline;
  /** Tabela de disposição de efeitos (`effects_52_mvp_disposition`). */
  readonly effectDisposition: ReadonlyMap<string, EffectStatus>;
  /** Gancho de calibração NFL (não aplicado no MVP). */
  readonly nflMatchups?: ReadonlyArray<NflMatchupRow>;
  /** `Seed_RNG`, inteiro em `[0, 2^64 - 1]`. */
  readonly seed: bigint;
}

// ---------------------------------------------------------------------------
// Parâmetros do modelo e baseline de design
// ---------------------------------------------------------------------------

/** Modificadores de clima parametrizados no baseline. */
export interface WeatherModifiers {
  readonly RAIN: { readonly reception: number; readonly fumble: number };
  readonly WIND: { readonly deep_pass: number; readonly long_kick: number };
  readonly HEAT: { readonly fatigue_per_snap: number };
  readonly COLD: { readonly reception: number };
}

/** Parâmetros de fadiga (de `simulation_parameters.fatigue`). */
export interface FatigueParameters {
  readonly active: number;
  readonly extreme_action: number;
  readonly inactive_snap_recovery: number;
  readonly max_penalty: number;
}

/** Parâmetros do ganho/perda de corrida (de `simulation_parameters.run`). */
export interface RunParameters {
  readonly base: number;
  readonly coef: number;
  readonly loss_min: number;
  readonly loss_max: number;
}

/** Intervalos de jardas-alvo de passe (de `simulation_parameters.pass`). */
export interface PassParameters {
  readonly short: readonly [number, number];
  readonly deep: readonly [number, number];
}

/**
 * Parâmetros do `Modelo_Probabilistico` e do loop/relógio, lidos de
 * `design_baseline/simulation_parameters`. Baseline de design **não calibrado
 * empiricamente**; o motor os trata como referência versionada.
 */
export interface SimulationParameters {
  readonly base: number; // 0.5
  readonly difference_coefficient: number; // 0.45
  readonly min: number; // 0.05
  readonly max: number; // 0.95
  readonly skill_mod_max_abs: number; // 0.15
  readonly tick_s: number; // 0.1
  readonly quarter_seconds: number; // 900
  readonly play_timeout_s: number; // 30
  readonly suppression_radius_yards: number; // 2
  /** Probabilidades de clima: CLEAR .40, RAIN .20, WIND .15, HEAT .15, COLD .10. */
  readonly weather: Readonly<Record<Weather, number>>;
  readonly weather_modifiers: WeatherModifiers;
  readonly fatigue: FatigueParameters;
  readonly run: RunParameters;
  readonly pass: PassParameters;
}

/**
 * Confronto `offense × defense` dos `matchups_36`, com o delta de probabilidade
 * ofensivo (aplicado simetricamente antes da disputa).
 */
export interface Matchup {
  readonly offense: PlayId;
  readonly defense: PlayId;
  readonly offense_probability_delta: number;
}

/**
 * `Baseline_Design` versionado: parâmetros do modelo + mapa de deltas de
 * matchup. `status` sinaliza explicitamente que não é empiricamente calibrado.
 */
export interface Baseline {
  /** Ex.: "D1-design-2026-10-09". */
  readonly version: string;
  /** Ex.: FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED. */
  readonly status: string;
  readonly simulationParameters: SimulationParameters;
  /** Chave `${offense}|${defense}` → `offense_probability_delta`. */
  readonly matchups: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Política de efeitos inertes
// ---------------------------------------------------------------------------

/**
 * Status de disposição de um efeito. `INERT_WITH_WARNING` é o valor canônico do
 * MVP; a união com `string` admite outros status versionados no baseline.
 */
export type EffectStatus = 'INERT_WITH_WARNING' | (string & {});

/**
 * Decisão de disposição de um efeito adicional. No MVP, `inert` é sempre `true`;
 * `reason` carrega o motivo (`INERT_WITH_WARNING` ou ausência de disposição).
 */
export interface InertDecision {
  readonly inert: boolean;
  readonly reason: string;
  readonly effectId: string;
  readonly athleteInstanceId: number;
}

// ---------------------------------------------------------------------------
// Estado de jogo imutável (GameState) e FSM
// ---------------------------------------------------------------------------

/** Estado da máquina de estados do fluxo de jogo. */
export type GamePhase =
  | 'Kickoff'
  | 'Drive'
  | 'FourthDownDecision'
  | 'Punt'
  | 'FieldGoalAtt'
  | 'Touchdown'
  | 'ExtraPointPhase'
  | 'Safety'
  | 'Turnover'
  | 'ChangePossession'
  | 'EndOfQuarter'
  | 'EndOfGame';

/**
 * Estado imutável da partida. Toda transição é
 * `(GameState, PlayResolution) → GameState`, retornando um novo objeto sem
 * mutação, o que torna o histórico reconstruível e o determinismo trivial de
 * verificar. O relógio é inteiro (décimos de segundo) para estabilidade.
 */
export interface GameState {
  readonly quarter: number; // 1..4
  readonly gameClockDeci: number; // relógio do quarto em décimos de segundo (inteiro): 9000 = 900s
  readonly down: number; // 1..4
  readonly distance: number; // jardas para o 1º down
  readonly ballOn: number; // posição da bola (jardas relativas à goal line)
  readonly possession: Team;
  readonly score: { readonly home: number; readonly away: number };
  readonly weather: Weather;
  readonly phase: GamePhase;
  /** `instance_id` → penalidade de fadiga em `[0, 0.12]`. */
  readonly fatigue: ReadonlyMap<number, number>;
  readonly ballPos: Vec3; // posição espacial p/ Esfera_Supressao
  readonly snapCount: number;
}

// ---------------------------------------------------------------------------
// Log determinístico e serialização estável
// ---------------------------------------------------------------------------

/**
 * Valor JSON canônico. Usado pelo serializador estável (`stableStringify`): o
 * log é serializado com chaves ordenadas lexicograficamente para comparação
 * byte a byte entre execuções.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Tipos de evento do `Log_Partida`. */
export type LogEventType =
  | 'MATCH_INIT'
  | 'WEATHER_ROLL'
  | 'KICKOFF'
  | 'SNAP'
  | 'TICK'
  | 'PLAY_SELECTED'
  | 'MATCHUP_APPLIED'
  | 'ATTR_CONTEST'
  | 'PLAY_RESULT'
  | 'SCORE'
  | 'POSSESSION_CHANGE'
  | 'POWER_SUPPRESSED'
  | 'POWER_INERT'
  | 'TELEKINESIS_NOTE'
  | 'ANATOMY_WARNING'
  | 'FOUL'
  | 'PENDING_DECISION'
  | 'TIMEOUT'
  | 'QUARTER_END'
  | 'GAME_END';

/** Estado-resumo vigente registrado em cada evento de log. */
export interface StateSnapshot {
  readonly quarter: number;
  readonly gameClock: number; // décimos de segundo (inteiro) p/ estabilidade
  readonly down: number;
  readonly distance: number;
  readonly ballOn: number; // jardas relativas à goal line
  readonly possession: Team;
  readonly score: { readonly home: number; readonly away: number };
  readonly weather: Weather;
}

/**
 * Evento ordenado do `Log_Partida`. `seq` é o índice sequencial determinístico
 * que garante ordenação estável; `powerReason` carrega o motivo de (não)
 * ativação de poder (supressão, inércia, telecinese).
 */
export interface LogEvent {
  readonly seq: number;
  readonly type: LogEventType;
  readonly snap?: number;
  readonly tick?: number;
  readonly state: StateSnapshot;
  readonly narrative: string;
  readonly detail: Readonly<Record<string, JsonValue>>;
  readonly powerReason?: string;
}

/**
 * `Log_Partida` completo: cabeçalho de auditoria (seed, origem/status do
 * baseline), a lista ordenada de eventos e as estatísticas agregadas.
 */
export interface GameLog {
  /** `Seed_RNG` em decimal (uint64) — R1.7. */
  readonly seedUsed: string;
  /** Origem versionada do baseline — R5.5, R6.10. */
  readonly baselineVersion: string;
  /** Status não-calibrado do baseline (FROZEN_MVP_...). */
  readonly baselineStatus: string;
  readonly events: ReadonlyArray<LogEvent>;
  readonly stats: GameStats;
}

// ---------------------------------------------------------------------------
// Estatísticas agregadas
// ---------------------------------------------------------------------------

/** Tipo de evento de pontuação no resumo de scoring. */
export type ScoringType = 'TD' | 'FG' | 'SAFETY' | 'PAT' | 'TWO_PT';

/** Uma entrada do resumo de scoring. */
export interface ScoringEntry {
  readonly type: ScoringType;
  readonly team: Team;
  readonly quarter: number;
}

/** Estatísticas agregadas da partida, derivadas determinísticamente dos eventos. */
export interface GameStats {
  readonly rushes: { readonly attempts: number; readonly yards: number };
  readonly passes: {
    readonly attempts: number;
    readonly completions: number;
    readonly yards: number;
    readonly interceptions: number;
  };
  readonly turnovers: number;
  readonly fouls: number;
  readonly scoringSummary: ReadonlyArray<ScoringEntry>;
}

// ---------------------------------------------------------------------------
// Resultado da simulação (saída do núcleo puro)
// ---------------------------------------------------------------------------

/**
 * Saída do núcleo puro `simulate(input: ResolvedInput)`. `seedUsed` ecoa o
 * `Seed_RNG` efetivamente usado, permitindo auditoria e reprodução.
 */
export interface SimulationResult {
  readonly log: GameLog;
  readonly score: Score;
  readonly seedUsed: bigint;
}
