/**
 * Tipos locais da spec `pfl-gameday-result-ui` (`lib/match/types.ts`).
 *
 * Define **apenas** as estruturas em memória próprias desta spec — a seleção de
 * modo, a FSM/estado da partida no cliente, as projeções puras do `Log_Partida`
 * (andamento, cenas da animação, highlights, desfecho) e a borda de chamada ao
 * motor. Os contratos consumidos de specs anteriores (`GameLog`, `Score`,
 * `BotMode`, `LineupInput`, etc.) **não** são redefinidos aqui: vêm de
 * `./contracts` (que os reexporta da fonte autoritativa).
 *
 * Princípios refletidos nos tipos (design "Princípios de design"):
 * - **O log é a única verdade** (R6.4, R8.5, R17.5): `ProgressFrame`, `Scene`,
 *   `Highlight` e `Outcome` carregam somente valores lidos/derivados do
 *   `Log_Partida`/`Placar`; cada estrutura derivada referencia o `eventIndex` de
 *   origem para rastreabilidade.
 * - **Apresentação separada de lógica**: estes tipos são puros (sem DOM, sem
 *   rede); os componentes React os recebem como dados.
 * - **Seed de RNG separado do seed de time** (R6.2, R16.3): `seedRng` é um campo
 *   próprio da `MatchState`, nunca derivado de seed de time.
 *
 * _Requirements: 2.4, 6.1, 6.4, 17.5_
 */

import type {
  BotMode,
  GameLog,
  Score,
  TeamDraft,
  Weather,
  Team,
  LineupInput,
  StrategyInput,
} from './contracts';

// ---------------------------------------------------------------------------
// Modo de adversário e fase da FSM
// ---------------------------------------------------------------------------

/**
 * Os três `Modo_Adversario` suportados — e **apenas** esses três (R1.1, R2.4).
 * O tipo é fechado: nenhum outro modo é construível, o que torna
 * `modoParaBot` total sobre o domínio (Property 1).
 *
 * - `bot_aleatorio`  → Bot aleatório do motor (R2.1)
 * - `desafiar_curti` → Bot Curti, preset CURTI (R2.2)
 * - `importar_seed`  → Bot de seed de terceiros, carregado de `.pflseed.json` (R2.3)
 */
export type ModoAdversario = 'bot_aleatorio' | 'desafiar_curti' | 'importar_seed';

/**
 * Fases da máquina de estados da Tela_Game_Day (design "Máquina de estados").
 * A transição é estritamente orientada: a exibição de andamento/placar só é
 * possível a partir de `Animando` (quando `log`/`score` existem, R7.3).
 */
export type MatchPhase =
  | 'Selecionando'
  | 'Validando'
  | 'Simulando'
  | 'Animando'
  | 'Resultado'
  | 'Erro';

/**
 * Categoria de erro retido na store, cada uma com um tratamento distinto no
 * design ("Error Handling"):
 * - `VALIDATION` — validação de elenco do jogador com aviso bloqueante (R4.1/R4.3)
 * - `IMPORT`     — recusa de importação da seed do adversário (R3.2/R4.4)
 * - `INPUT`      — 400 do motor: entrada inválida/incompleta (R6.5)
 * - `NETWORK`    — falha de comunicação com o motor (R7.4)
 */
export type MatchErrorKind = 'VALIDATION' | 'IMPORT' | 'INPUT' | 'NETWORK';

/**
 * Erro legível retido na store, associado por ARIA ao controle de origem
 * (R7.4, R17.7). `field` identifica, quando aplicável, o controle/campo alvo.
 */
export interface MatchError {
  readonly kind: MatchErrorKind;
  readonly message: string;
  readonly field?: string;
}

/**
 * Estado em memória da partida, compartilhado pelas duas telas (design "Data
 * Models: Estado da partida"). A store **nunca** calcula placar/estatística —
 * apenas retém o que o motor devolveu (`log`/`score`, R6.4).
 */
export interface MatchState {
  readonly phase: MatchPhase;
  /** Seleção corrente de modo (R1.2); `null` antes de escolher. */
  readonly modo: ModoAdversario | null;
  /** Seed_RNG exibível (R16.3), decimal uint64; distinto do seed de time (R6.2). */
  readonly seedRng: string | null;
  /** Time do adversário quando `Modo_Importar_Seed`, após `importSeed` aprovado (R3.3). */
  readonly adversarioSeedDraft: TeamDraft | null;
  /** `Log_Partida` retido após sucesso (R6.3); fonte de todo andamento (R6.4). */
  readonly log: GameLog | null;
  /** `Placar` retido do motor; nunca recalculado. */
  readonly score: Score | null;
  /** Erro legível corrente (R7.4, R17.7); `null` quando não há erro. */
  readonly erro: MatchError | null;
}

// ---------------------------------------------------------------------------
// Projeção de andamento (HUD) — leitores puros do log (R8.*)
// ---------------------------------------------------------------------------

/**
 * Projeção legível do estado de um `LogEvent` para o HUD de andamento. Nenhum
 * campo é inventado: todos vêm de `event.state`/`event.narrative` e dos avisos
 * de `powerReason`/`detail` do Snap (R8.1–R8.5, R12.1). O relógio permanece em
 * décimos de segundo (`gameClockDeci`), formatado para exibição por `formatClock`.
 */
export interface ProgressFrame {
  /** Placar corrente do Snap (de `state.score`) — R8.1. */
  readonly score: { readonly home: number; readonly away: number };
  readonly quarter: number; // R8.2
  readonly gameClockDeci: number; // R8.2 (décimos de segundo)
  readonly down: number; // R8.2
  readonly distance: number; // R8.2
  readonly possession: Team; // R8.2
  readonly weather: Weather; // R8.4 (apenas exibe; nunca sorteia)
  readonly narrative: string; // R8.3
  /** Avisos de Efeito_Inerte/supressão do Snap, exibidos junto à narrativa (R12.1). */
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Cenas da animação 8-bit — função pura do log (R9, R10)
// ---------------------------------------------------------------------------

/**
 * Referência a um sprite por `pokemonId`. A imagem concreta é resolvida pelo
 * player via `resolveSprite` (camada fina sobre a Camada_Leitura), nunca aqui —
 * `Scene` permanece pura e sem I/O (R9.2).
 */
export interface SpriteRef {
  readonly pokemonId: number;
}

/**
 * Uma cena da `Animacao_8bit`, derivada deterministicamente de um Snap do
 * `Log_Partida` (design "Planejador de cenas"). A sequência de cenas é uma
 * **bijeção ordenada** dos Snaps (Property 13); cada cena referencia o
 * `eventIndex` de origem para rastreabilidade (R9.1, R9.3).
 */
export interface Scene {
  /** Posição na sequência, 0..N-1, em ordem crescente de `seq` do log. */
  readonly index: number;
  /** Número do Snap representado. */
  readonly snap: number;
  /** Índice do `LogEvent` de origem (rastreabilidade ao log). */
  readonly eventIndex: number;
  /** Lado com a posse neste Snap. */
  readonly offense: Team;
  /** Pokémon da unidade ofensiva (do log/escalação resolvida). */
  readonly offenseSprites: ReadonlyArray<SpriteRef>;
  /** Pokémon da unidade defensiva. */
  readonly defenseSprites: ReadonlyArray<SpriteRef>;
  /** Tipo de resultado da jogada (ganho, passe, TD, turnover...) extraído do `detail`. */
  readonly resultKind: string;
  /** Narrativa_Snap (= Alternativa_Textual). */
  readonly narrative: string;
  /** Avisos de efeito inerte/supressão do Snap (R12.1). */
  readonly warnings: ReadonlyArray<string>;
  /** Duração-base da cena em ms, DERIVADA do log (não do relógio real) — R10.2. */
  readonly durationHint: number;
}

// ---------------------------------------------------------------------------
// Resolução de sprites (camada fina sobre a Camada_Leitura) — R9.2, R9.6
// ---------------------------------------------------------------------------

/**
 * Resultado da resolução de um `Sprite_Pokemon`. `src` vem de
 * `species.raw_data.sprites` quando disponível; caso contrário, `isFallback` é
 * `true` e `src` aponta o `SPRITE_SUBSTITUTO` local empacotado — nunca uma fonte
 * externa (R9.2, R9.6). `alt` descreve o Pokémon para leitores de tela (R17.4).
 */
export interface SpriteResolution {
  readonly src: string;
  readonly isFallback: boolean;
  readonly alt: string;
}

/**
 * Entrada de espécie usada por `resolveSprite` — a projeção **mínima** da
 * Camada_Leitura necessária para resolver um `Sprite_Pokemon`: a identidade do
 * Pokémon (`pokemon_id`, `slug`) e o `raw_data` fiel da PokéAPI (que contém o
 * objeto `sprites`). O campo `raw_data` é `unknown` por contrato do catálogo
 * (`SpeciesRow.raw_data`): o resolvedor o sonda de forma defensiva, sem assumir
 * a presença de qualquer entrada de sprite.
 */
export interface SpeciesRawEntry {
  readonly pokemon_id: number;
  readonly slug?: string;
  readonly raw_data: unknown;
}

/**
 * Índice em memória `pokemonId → SpeciesRawEntry`, materializado a partir da
 * Camada_Leitura (`lib/data/`) **antes** da reprodução. `resolveSprite` consulta
 * este índice de forma pura (sem I/O), o que mantém a resolução de sprites
 * determinística e livre de acesso externo em tempo de execução (R9.2).
 *
 * Qualquer forma indexável por `pokemonId` serve (`Map` ou objeto). A ausência
 * de uma entrada é tratada como "sprite indisponível" → substituto local (R9.6).
 */
export interface SpeciesRawIndex {
  /** Resolve a entrada de uma espécie pelo `pokemonId`, ou `undefined` se ausente. */
  get(pokemonId: number): SpeciesRawEntry | undefined;
}

// ---------------------------------------------------------------------------
// Resultado — desfecho e highlights (R13, R14)
// ---------------------------------------------------------------------------

/**
 * Desfecho da partida derivado **exclusivamente** do `Placar` (R13.4):
 * `winner` quando as pontuações diferem (R13.2), `tie` quando iguais (R13.3).
 */
export type Outcome =
  | { readonly kind: 'winner'; readonly team: Team }
  | { readonly kind: 'tie' };

/**
 * Um item do resumo de eventos (`Highlights`) derivado do `Log_Partida` por
 * regra pura e determinística (R14.2). Cada highlight referencia (`eventIndex`)
 * um evento existente do log — nenhum é fabricado sem origem (R14.3).
 */
export interface Highlight {
  /** Índice do `LogEvent` de origem (rastreabilidade, R14.3). */
  readonly eventIndex: number;
  readonly quarter: number;
  /** Relógio formatado (mm:ss) do evento. */
  readonly clock: string;
  /** Tipo do highlight (TD, FG, SAFETY, TURNOVER, FALTA relevante...). */
  readonly kind: string;
  /** Texto derivado da narrativa/`detail` do evento. */
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Borda de chamada ao motor (adaptador) — R6, R2, R7
// ---------------------------------------------------------------------------

/**
 * Entrada do adaptador `runSimulation` (Task 9): as **duas escalações**, as
 * **duas estratégias**, o **`Seed_RNG`** (decimal uint64, distinto do seed de
 * time — R6.2) e o `botModeAway` já mapeado por `modoParaBot(modo)` (R2.*).
 */
export interface SimulateInput {
  readonly playerLineup: LineupInput;
  readonly playerStrategy: StrategyInput;
  readonly adversaryLineup: LineupInput;
  readonly adversaryStrategy: StrategyInput;
  /** Seed_RNG decimal uint64; nunca derivado do seed de time (R6.2). */
  readonly seedRng: string;
  /** Modo de bot do adversário = `modoParaBot(modo)` (R2.*). */
  readonly botModeAway: BotMode;
}

/**
 * Resultado normalizado da chamada ao motor (design "Adaptador de chamada"):
 * - sucesso → `{ ok:true, log, score }` retido na store, sem recálculo (R6.3);
 * - 400 do motor → `{ ok:false, kind:'INPUT' }` (não anima nem navega, R6.5);
 * - falha de rede/timeout → `{ ok:false, kind:'NETWORK' }` (encerra loading,
 *   permite retry, R7.4).
 */
export type SimulateOutcome =
  | { readonly ok: true; readonly log: GameLog; readonly score: Score }
  | { readonly ok: false; readonly kind: 'INPUT'; readonly message: string; readonly field?: string }
  | { readonly ok: false; readonly kind: 'NETWORK'; readonly message: string };
