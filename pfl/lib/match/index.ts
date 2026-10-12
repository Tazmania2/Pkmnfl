/**
 * Barril público de `lib/match/` — spec `pfl-gameday-result-ui`.
 *
 * Ponto único de importação para os módulos e componentes desta spec. Reexporta
 * (a) os **tipos locais** da partida (`./types`), (b) os **contratos consumidos**
 * de specs anteriores (`./contracts`) e (c) os **módulos puros** já entregues
 * (`./modo`, `./seed-rng`, `./progress`). Os demais módulos puros (`animation`,
 * `sprites`, `result`, `store`, `simulate-client`) são adicionados a este barril
 * conforme as tarefas seguintes os entregam.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.4, 16.1, 16.3, 17.5_
 */

// Tipos locais da spec (estado/FSM, projeções puras, borda de chamada ao motor).
export type {
  ModoAdversario,
  MatchPhase,
  MatchError,
  MatchErrorKind,
  MatchState,
  ProgressFrame,
  SpriteRef,
  Scene,
  SpriteResolution,
  SpeciesRawEntry,
  SpeciesRawIndex,
  Outcome,
  Highlight,
  SimulateInput,
  SimulateOutcome,
} from './types';

// Camada fina de sprites (resolução pura sobre a Camada_Leitura) — R9.2, R9.6.
export { resolveSprite, SPRITE_SUBSTITUTO } from './sprites';

// Mapeamento modo → bot (R2.*).
export { modoParaBot, MODOS_SUPORTADOS } from './modo';

// Contratos consumidos (reexportados da fonte autoritativa de cada spec).
export type {
  // pfl-simulation-engine (núcleo + Log_Partida)
  GameLog,
  LogEvent,
  LogEventType,
  StateSnapshot,
  GameStats,
  ScoringEntry,
  ScoringType,
  Score,
  Weather,
  Team,
  BotMode,
  JsonValue,
  // pfl-data-catalog (Camada_Leitura)
  SpeciesSummary,
  SpeciesRow,
  // pfl-simulation-engine (contrato HTTP de /api/simulate)
  SimulateRequest,
  SimulateResponse,
  SimulateError,
  LineupInput,
  StrategyInput,
  AthleteInput,
  LineupUnitKey,
  // pfl-team-strategy-ui (forward declarations — ver contracts.ts)
  TeamDraft,
  ValidationWarning,
  ImportResult,
  ImportRejection,
} from './contracts';

// Geração/validação do Seed_RNG (R6.2, R16.1, R16.3): entropia só em `gerarSeedRng`.
export { gerarSeedRng, parseSeedRng } from './seed-rng';

// Leitores de andamento puros (HUD, R8.*, R12.1): projeção do log + relógio mm:ss.
export { progressAt, formatClock } from './progress';

// Resultado: funções puras (R13.2–R13.4, R14.2, R14.3): desfecho + highlights.
export { determineOutcome, selectHighlights } from './result';

// Planejador de cenas da animação (função pura do log, R9.1/R9.3/R9.7/R10.*).
export { buildAnimationScenes, MIN_MS, MAX_MS } from './animation';

// Store de partida e FSM (R1.2, R3.3, R5.2, R5.3, R6.3, R6.4, R7.3, R4.5, R5.1):
// transições puras + gate de confirmação + fábrica da store compartilhada.
export { createMatchStore, confirmarHabilitado, ESTADO_INICIAL } from './store';
export type { MatchStore } from './store';

// Adaptador de chamada ao motor (borda de rede, R6.1/R6.2/R6.3/R6.5/R7.4/R2.3):
// monta o SimulateRequest, faz POST /api/simulate uma única vez e normaliza.
export { runSimulation } from './simulate-client';

// Orquestração de validação pré-simulação (R3.*, R4.*): sequencia
// validateDraft/hasBlocking (jogador) e importSeed (adversário) via dependências
// injetadas de pfl-team-strategy-ui; seed tratada como dados (R3.4).
export { orquestrarPreSimulacao } from './pre-simulacao';
export type {
  PreSimulacaoDeps,
  PreSimulacaoInput,
  PreSimulacaoResult,
  ValidateDraftFn,
  HasBlockingFn,
  ImportSeedFn,
} from './pre-simulacao';
