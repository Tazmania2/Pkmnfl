/**
 * Modelo do time em edição (`lib/team/model.ts`).
 *
 * Define os tipos e constantes do `TeamDraft` — o documento em memória que
 * representa o time sendo montado nas telas **Meu Time** e **Estratégia**.
 * Este módulo é **puro**: só declara tipos e dados somente-leitura, sem DOM,
 * sem rede e sem I/O. É a base consumida pela store (`lib/team/store.ts`), pelo
 * motor de validação (`lib/validation/`), pelos presets (`lib/presets/`) e pela
 * serialização de seed (`lib/seed/`).
 *
 * Convenções (design · "Modelo do time em edição"):
 * - Instâncias de atleta são distintas por `instanceId`, inclusive quando
 *   compartilham o mesmo `pokemonId` (duplicatas de espécie não são
 *   deduplicadas) — R2.1/R2.2.
 * - O roster nunca excede 53 atletas — R2.3/R2.4.
 * - As prioridades de jogada são permutações dos conjuntos fixos
 *   {@link OFFENSE_PLAYS} / {@link DEFENSE_PLAYS} — R12.3/R12.4.
 *
 * _Requirements: 2.1, 2.2, 3.1, 11.1, 12.1, 12.2, 13.1_
 */

/**
 * Identificadores autoritativos de jogada. Prefixo `O_` para ataque e `D_` para
 * defesa. São o conjunto fechado usado nas prioridades de estratégia e mapeado
 * para os ids do `play_catalog_18.json` na camada de persistência (R12.3/12.4).
 */
export type PlayId =
  | 'O_RUN_INSIDE'
  | 'O_RUN_OUTSIDE'
  | 'O_PASS_SHORT'
  | 'O_PASS_INTERMEDIATE'
  | 'O_PASS_DEEP'
  | 'O_PLAY_ACTION'
  | 'D_RUN_FIT'
  | 'D_EDGE_CONTAIN'
  | 'D_ZONE'
  | 'D_MAN'
  | 'D_RUSH'
  | 'D_CONTAIN_QB';

/**
 * Conjunto fixo das 6 jogadas de ataque, na ordem canônica. A priorização do
 * jogador é sempre uma permutação deste conjunto (R12.1/R12.3).
 */
export const OFFENSE_PLAYS: readonly PlayId[] = [
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
] as const;

/**
 * Conjunto fixo das 6 jogadas de defesa, na ordem canônica. A priorização do
 * jogador é sempre uma permutação deste conjunto (R12.2/R12.3).
 */
export const DEFENSE_PLAYS: readonly PlayId[] = [
  'D_RUN_FIT',
  'D_EDGE_CONTAIN',
  'D_ZONE',
  'D_MAN',
  'D_RUSH',
  'D_CONTAIN_QB',
] as const;

/**
 * Unidade de escalação: ataque, defesa e as 6 unidades de special teams.
 * Cada unidade preenchida tem 11 papéis e 11 identidades distintas por snap
 * (R13.1). As unidades de special teams são automáticas (sem UI de edição de
 * jogadas, R12.6), mas fazem parte do modelo para a serialização de seed.
 */
export type LineupUnit =
  | 'offense'
  | 'defense'
  | 'kickoff'
  | 'kick_return'
  | 'punt'
  | 'punt_return'
  | 'field_goal'
  | 'field_goal_block';

/** Papel dentro de uma unidade (11 por unidade). */
export type Role = string;

/** Identificador de um dos quatro presets copiáveis. */
export type PresetId = 'balanced' | 'ground' | 'aerial' | 'curti';

/**
 * Atleta no roster em edição. Distinto por {@link AthleteDraft.instanceId},
 * inclusive quando repete `pokemonId` (duplicata de espécie, R2.2).
 */
export interface AthleteDraft {
  /** Identidade da instância; única no roster do time. */
  instanceId: number;
  /** Espécie escolhida; deve pertencer a `getAllowedSpecies` (R2.5). */
  pokemonId: number;
  /** Habilidade escolhida; deve pertencer a `getAvailableAbilities(pokemonId)` (R6.2). */
  abilityId: number;
  /** Exatamente 4 golpes distintos de `getLearnableMoveIds(pokemonId)` (R6.3/R6.4). */
  moveIds: number[];
  /** Posição designada ao atleta (livre, orientada por dica, R4.3/R4.4). */
  positionDesignation: string;
}

/**
 * Sub-objeto de estratégia do time. Estilos de ataque/defesa e as prioridades
 * de jogada (cada uma uma permutação do conjunto fixo correspondente).
 */
export interface StrategyDraft {
  /** Estilo de ataque registrado (R11.2). */
  offenseStyle: string;
  /** Estilo de defesa registrado (R11.3). */
  defenseStyle: string;
  /** Permutação de {@link OFFENSE_PLAYS} definindo a prioridade (R12.3). */
  offensePlayPriority: PlayId[];
  /** Permutação de {@link DEFENSE_PLAYS} definindo a prioridade (R12.4). */
  defensePlayPriority: PlayId[];
}

/**
 * Atribuição de uma instância a um papel de uma unidade. Uma mesma instância
 * pode servir unidades diferentes, mas nunca dois papéis no mesmo snap/unidade
 * (R13.3/R13.5).
 */
export interface LineupAssignment {
  /** Unidade da escalação. */
  unit: LineupUnit;
  /** Papel ocupado dentro da unidade. */
  role: Role;
  /** Referência a um {@link AthleteDraft.instanceId}. */
  instanceId: number;
}

/**
 * Proveniência de um time clonado de preset. Para o preset `curti`, marca os
 * campos que são atribuição PFL versus os 22 titulares da fonte histórica
 * (R10.3/R10.4).
 */
export interface PresetProvenance {
  /** Preset de origem. */
  presetId: PresetId;
  /** Campos cuja definição é atribuição PFL (não da fonte histórica) — R10.4. */
  pflAssignedFields?: ('abilities' | 'moves' | 'special_teams' | 'strategy')[];
  /** `true` quando os 22 titulares vêm da fonte histórica (R10.3). */
  sourceStarters22?: boolean;
}

/**
 * Documento do time em edição, mantido em memória pela store. É carregado a
 * partir de um preset copiado, de um time salvo ou de um seed importado, e
 * editado livremente (incl. estados transitoriamente inválidos para feedback
 * inline) antes de um salvamento discreto.
 */
export interface TeamDraft {
  /** Definido após o primeiro salvamento no Supabase. */
  teamId?: string;
  /** Nome do time. */
  name: string;
  /** Roster de atletas; nunca excede 53 (R2.3/R2.4). */
  roster: AthleteDraft[];
  /** Atribuições de papéis por unidade. */
  lineups: LineupAssignment[];
  /** Sub-objeto de estratégia. */
  strategy: StrategyDraft;
  /** Marcação de proveniência quando clonado de preset (R10.4). */
  provenance?: PresetProvenance;
}
