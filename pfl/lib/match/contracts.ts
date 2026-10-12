/**
 * Contratos **consumidos** de specs anteriores (`lib/match/contracts.ts`).
 *
 * Esta spec (`pfl-gameday-result-ui`) é a quinta e última do PFL e **não redefine**
 * os tipos das specs 1–4: ela os **importa e reexporta** a partir de um único
 * ponto, para que os módulos de `lib/match/` e os componentes de `components/`
 * consumam uma superfície estável sem acoplar-se aos caminhos internos de cada
 * spec de origem (design → "Components and Interfaces: Contratos consumidos").
 *
 * Princípio de design nº 4 ("Validação reusada, nunca reimplementada") e nº 1
 * ("O log é a única verdade"): nenhum contrato aqui é uma cópia — todos apontam
 * para a fonte autoritativa da spec que os entregou.
 *
 * ## Mapa de origem
 *
 * | Contrato(s)                                                            | Spec de origem            | Módulo                         |
 * |------------------------------------------------------------------------|---------------------------|--------------------------------|
 * | `GameLog`, `LogEvent`, `StateSnapshot`, `GameStats`, `Score`, `Weather`, `BotMode`, `ScoringEntry`, `ScoringType`, `Team`, `JsonValue` | `pfl-simulation-engine` | `@/lib/sim/types`              |
 * | `SpeciesSummary`, `SpeciesRow`                                         | `pfl-data-catalog`        | `@/lib/catalog/types`          |
 * | `SimulateRequest`, `SimulateResponse`, `SimulateError`, `LineupInput`, `StrategyInput`, `AthleteInput` | `pfl-simulation-engine` (`POST /api/simulate`) | contrato HTTP (abaixo) |
 * | `TeamDraft`, `ImportResult`, `ImportRejection`, `ValidationWarning`    | `pfl-team-strategy-ui`    | placeholder (ver nota)         |
 *
 * ## Nota sobre `pfl-team-strategy-ui`
 *
 * No momento desta tarefa, os módulos `lib/validation` e `lib/seed/import` da
 * spec `pfl-team-strategy-ui` ainda **não estão presentes** no repositório. Para
 * não bloquear o scaffolding desta spec (e sem reimplementar regras de time), os
 * contratos `TeamDraft`/`ImportResult`/`ValidationWarning` são declarados aqui
 * como **tipos estruturais mínimos** (forward declarations), marcados para
 * substituição por reexportação direta assim que a spec 4 for integrada. Nenhuma
 * lógica de validação/importação é definida aqui — apenas a forma consumida.
 */

// ---------------------------------------------------------------------------
// pfl-simulation-engine — tipos do núcleo e do Log_Partida (fonte autoritativa)
// ---------------------------------------------------------------------------

export type {
  // Log determinístico e seus componentes (R6.3, R8.*, R14.*)
  GameLog,
  LogEvent,
  LogEventType,
  StateSnapshot,
  GameStats,
  ScoringEntry,
  ScoringType,
  // Placar e desfecho (R13.*)
  Score,
  // Condições/identidades de domínio
  Weather,
  Team,
  // Modo de bot do motor — alvo de `modoParaBot` (R2.*)
  BotMode,
  // Valor JSON canônico usado em `detail`
  JsonValue,
} from '@/lib/sim/types';

// ---------------------------------------------------------------------------
// pfl-data-catalog — Camada_Leitura (sprites via raw_data) (R9.2, R9.6)
// ---------------------------------------------------------------------------

export type {
  // Projeção de leitura de espécie permitida (identidade + stats)
  SpeciesSummary,
  // Linha completa de `species` — `raw_data` contém o objeto `sprites` da PokéAPI
  SpeciesRow,
} from '@/lib/catalog/types';

// ---------------------------------------------------------------------------
// pfl-simulation-engine — contrato HTTP de `POST /api/simulate`
// ---------------------------------------------------------------------------
//
// O Route Handler `app/api/simulate/route.ts` define estas formas de corpo e de
// resposta localmente (não as exporta). Reproduzimos aqui a **forma consumida**
// pelo adaptador de chamada (`lib/match/simulate-client.ts`, Task 9) para fixar
// o contrato de borda com o motor, exatamente como o design o fixa em
// "Contratos consumidos". A fonte de verdade do comportamento continua sendo o
// Route Handler da spec 3.

/** As três unidades de escalação exigidas em toda `LineupInput`. */
export type LineupUnitKey = 'offense' | 'defense' | 'specialTeams';

/**
 * Atleta de entrada enviado no corpo de `POST /api/simulate` (forma crua aceita
 * pelo motor). Exatamente quatro golpes (`moveIds`) e as seis estatísticas base.
 */
export interface AthleteInput {
  readonly instanceId: number;
  readonly pokemonId: number;
  readonly types: ReadonlyArray<string>;
  readonly stats: {
    readonly hp: number;
    readonly attack: number;
    readonly defense: number;
    readonly specialAttack: number;
    readonly specialDefense: number;
    readonly speed: number;
  };
  readonly abilityId: number;
  readonly moveIds: ReadonlyArray<number>;
  readonly additionalEffectIds?: ReadonlyArray<string>;
  readonly positionDesignation: string;
}

/** Escalação de entrada: atletas por unidade de jogo (`Escalacao`). */
export interface LineupInput {
  readonly teamSeedId?: string;
  readonly units: Readonly<Record<LineupUnitKey, ReadonlyArray<AthleteInput>>>;
}

/** Estratégia de entrada: preset de estilo + prioridades opcionais (`Estrategia`). */
export interface StrategyInput {
  readonly preset: string;
  readonly playWeights?: Readonly<Record<string, number>>;
  readonly priorities?: Readonly<Record<string, number>>;
}

/**
 * Corpo da requisição `POST /api/simulate` (`SimulateRequest`): as **duas
 * escalações**, as **duas estratégias** e o **`Seed_RNG`** (R6.1). O `seed` é
 * uma string decimal (uint64 preservado); `botModeAway` recebe
 * `modoParaBot(modo)` (R2.*).
 */
export interface SimulateRequest {
  readonly home: LineupInput;
  readonly away: LineupInput;
  readonly strategyHome: StrategyInput;
  readonly strategyAway: StrategyInput;
  /** Seed_RNG em decimal, "0".."18446744073709551615" (R6.2). */
  readonly seed: string;
  readonly botModeHome?: import('@/lib/sim/types').BotMode;
  readonly botModeAway?: import('@/lib/sim/types').BotMode;
}

/** Resposta de sucesso (200) de `POST /api/simulate`. */
export interface SimulateResponse {
  readonly log: import('@/lib/sim/types').GameLog;
  readonly score: import('@/lib/sim/types').Score;
}

/** Resposta de erro (400) de `POST /api/simulate`: `field` aponta o campo inválido. */
export interface SimulateError {
  readonly error: string;
  readonly field?: string;
}

// ---------------------------------------------------------------------------
// pfl-team-strategy-ui — validação e importação de seed (forward declarations)
// ---------------------------------------------------------------------------
//
// IMPORTANTE: estes tipos são declarações estruturais mínimas enquanto a spec
// `pfl-team-strategy-ui` (`lib/validation`, `lib/seed/import`) não está integrada
// ao repositório. Assim que ela existir, SUBSTITUIR por reexportação direta:
//   export type { TeamDraft } from '@/lib/team/model';
//   export type { ValidationWarning } from '@/lib/validation';
//   export type { ImportResult, ImportRejection } from '@/lib/seed/import';
// Nenhuma regra de validação/importação é definida aqui.

/**
 * Rascunho de time do jogador (`Escalacao` + `Estrategia`), consumido como
 * entrada da validação (`validateDraft`) e produzido pela importação de seed
 * aprovada (`importSeed`). Forma mínima consumida por esta spec: a escalação e a
 * estratégia que serão enviadas ao motor, mais o identificador de seed de time
 * (nunca derivado do `Seed_RNG`, R6.2).
 *
 * @see pfl-team-strategy-ui — substituir por reexport quando a spec 4 for integrada.
 */
export interface TeamDraft {
  readonly lineup: LineupInput;
  readonly strategy: StrategyInput;
  /** Identificador do time importado (modo bot-seed); distinto do `Seed_RNG`. */
  readonly teamSeedId?: string;
}

/**
 * Aviso de validação de elenco produzido por `validateDraft`. `blocking`
 * distingue avisos que impedem a simulação (gate de confirmação, R4.5/R5.1) dos
 * meramente informativos; `message` é a mensagem legível exibida ao jogador.
 *
 * @see pfl-team-strategy-ui — substituir por reexport quando a spec 4 for integrada.
 */
export interface ValidationWarning {
  readonly code: string;
  readonly message: string;
  readonly blocking: boolean;
  /** Alvo opcional do aviso (ex.: unidade/atleta), para associação por ARIA. */
  readonly field?: string;
}

/**
 * Resultado da importação de uma seed de adversário (`importSeed`). Em recusa,
 * `reason` descreve o motivo específico (passo + razão), exibido ao jogador
 * (R3.2, R4.4). A seed é tratada **como dados** — nenhum conteúdo é executado
 * (R3.4).
 *
 * @see pfl-team-strategy-ui — substituir por reexport quando a spec 4 for integrada.
 */
export type ImportResult =
  | { readonly ok: true; readonly draft: TeamDraft }
  | { readonly ok: false; readonly reason: ImportRejection };

/**
 * Motivo de recusa de uma importação de seed. `step` nomeia o passo do pipeline
 * que recusou e `message` é a razão legível.
 *
 * @see pfl-team-strategy-ui — substituir por reexport quando a spec 4 for integrada.
 */
export interface ImportRejection {
  readonly step: string;
  readonly message: string;
}
