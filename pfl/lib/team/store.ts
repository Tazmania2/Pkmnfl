/**
 * Store do time em edição (`lib/team/store.ts`).
 *
 * Mantém o {@link TeamDraft} em memória e expõe operações de transição de
 * estado. Toda operação é **pura e imutável**: recebe um `TeamDraft` e devolve
 * um **novo** `TeamDraft`, sem mutar o anterior (nem seus arrays/objetos
 * internos). Isso facilita teste por propriedade, desfazer/refazer e a dupla
 * validação cliente/servidor descrita no design ("Store do time em edição").
 *
 * O módulo tem duas camadas:
 * - **Transições puras** (`addAthlete`, `assignRole`, ...): funções livres que
 *   não guardam estado; são o coração testável por PBT.
 * - **{@link createTeamStore}**: um invólucro fino que mantém uma referência ao
 *   `TeamDraft` corrente e aplica as transições puras, expondo a interface
 *   {@link TeamStore} do design (`getDraft`, operações encadeáveis).
 *
 * Convenções deste módulo:
 * - O roster nunca excede {@link ROSTER_CAP} (53). A 54ª adição é **recusada**,
 *   preservando o roster existente (R2.3/R2.4).
 * - `assignRole` recusa colocar a **mesma identidade** (`instanceId`) em dois
 *   papéis da mesma unidade no mesmo snap (R13.3/R13.5); a reatribuição de um
 *   papel já ocupado substitui o ocupante.
 * - As prioridades de jogada são sempre **permutações** dos conjuntos fixos
 *   {@link OFFENSE_PLAYS} / {@link DEFENSE_PLAYS}; uma ordem inválida é
 *   recusada e o estado anterior é preservado (R12.3/R12.4).
 *
 * `loadFromPreset` delega para {@link clonePresetToDraft} (`lib/presets/`),
 * clonando o preset num `TeamDraft` editável e comitando-o. `loadFromSeed`
 * chega em tarefa posterior (7.2).
 *
 * _Requirements: 1.2, 2.3, 2.4, 4.3, 11.2, 11.3, 12.3, 12.4, 13.3, 13.5_
 */

import {
  OFFENSE_PLAYS,
  DEFENSE_PLAYS,
  type TeamDraft,
  type AthleteDraft,
  type LineupUnit,
  type Role,
  type PlayId,
  type PresetId,
} from './model';
import { clonePresetToDraft } from '../presets';

/** Teto do roster: nunca excede 53 atletas (R2.3/R2.4). */
export const ROSTER_CAP = 53;

/**
 * Monta um {@link TeamDraft} vazio: roster e escalações vazios, estratégia com
 * estilos em branco e prioridades nas ordens canônicas de {@link OFFENSE_PLAYS}
 * e {@link DEFENSE_PLAYS}. É o ponto de partida de "Começar do zero" (R1.2).
 *
 * @param name Nome inicial do time (padrão: string vazia).
 */
export function loadEmpty(name = ''): TeamDraft {
  return {
    name,
    roster: [],
    lineups: [],
    strategy: {
      offenseStyle: '',
      defenseStyle: '',
      offensePlayPriority: [...OFFENSE_PLAYS],
      defensePlayPriority: [...DEFENSE_PLAYS],
    },
  };
}

/**
 * Adiciona um atleta ao roster.
 *
 * Recusa a adição quando o roster já atingiu {@link ROSTER_CAP}, preservando o
 * roster existente e devolvendo um novo `TeamDraft` idêntico (R2.4). Nos demais
 * casos devolve um novo `TeamDraft` com o atleta anexado ao fim.
 *
 * O chamador é responsável por validar espécie permitida e demais regras de
 * ficha; esta transição apenas respeita o teto do roster.
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function addAthlete(draft: TeamDraft, athlete: AthleteDraft): TeamDraft {
  if (draft.roster.length >= ROSTER_CAP) {
    // Recusa a 54ª adição: estado preservado, nova referência imutável.
    return cloneDraft(draft);
  }
  return {
    ...draft,
    roster: [...draft.roster, cloneAthlete(athlete)],
  };
}

/**
 * Remove do roster o atleta cuja identidade (`instanceId`) coincide, e limpa
 * todas as atribuições de escalação que o referenciavam (uma instância removida
 * não pode permanecer escalada). Se nenhum atleta corresponde, devolve um novo
 * `TeamDraft` equivalente ao original.
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function removeAthlete(draft: TeamDraft, instanceId: number): TeamDraft {
  return {
    ...draft,
    roster: draft.roster.filter((a) => a.instanceId !== instanceId),
    lineups: draft.lineups.filter((l) => l.instanceId !== instanceId),
  };
}

/**
 * Aplica um `patch` parcial ao atleta de identidade `instanceId`, devolvendo um
 * novo `TeamDraft` com o atleta atualizado. A identidade (`instanceId`) nunca é
 * alterada, mesmo que presente no `patch`. Arrays como `moveIds` são copiados
 * para preservar a imutabilidade do estado anterior.
 *
 * Se nenhum atleta corresponde, devolve um novo `TeamDraft` equivalente.
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function updateAthlete(
  draft: TeamDraft,
  instanceId: number,
  patch: Partial<AthleteDraft>,
): TeamDraft {
  return {
    ...draft,
    roster: draft.roster.map((a) =>
      a.instanceId === instanceId
        ? cloneAthlete({ ...a, ...patch, instanceId: a.instanceId })
        : a,
    ),
  };
}

/**
 * Atribui a instância `instanceId` ao papel `role` da unidade `unit`.
 *
 * Regras (R4.3/R13.3/R13.5):
 * - Recusa (preservando o estado) quando a **mesma identidade** já ocupa
 *   **outro** papel da **mesma unidade** — uma instância não pode ocupar dois
 *   papéis no mesmo snap. Reatribuir a identidade ao papel que ela já ocupa é
 *   idempotente (nova referência, mesmo conteúdo).
 * - Substitui qualquer ocupante anterior do papel alvo na unidade.
 * - Também registra a `position_designation` do atleta como `role`, refletindo
 *   a atribuição na ficha (R4.3).
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function assignRole(
  draft: TeamDraft,
  unit: LineupUnit,
  role: Role,
  instanceId: number,
): TeamDraft {
  // Identidade duplicada no mesmo snap/unidade (em papel diferente): recusa.
  const duplicateInUnit = draft.lineups.some(
    (l) => l.unit === unit && l.instanceId === instanceId && l.role !== role,
  );
  if (duplicateInUnit) {
    return cloneDraft(draft);
  }

  // Substitui o ocupante anterior do papel alvo (se houver).
  const withoutTarget = draft.lineups.filter(
    (l) => !(l.unit === unit && l.role === role),
  );
  const lineups = [...withoutTarget, { unit, role, instanceId }];

  return {
    ...draft,
    lineups,
    roster: draft.roster.map((a) =>
      a.instanceId === instanceId
        ? { ...a, positionDesignation: role }
        : a,
    ),
  };
}

/**
 * Libera o papel `role` da unidade `unit`, removendo a atribuição
 * correspondente (se existir). Devolve sempre um novo `TeamDraft`.
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function clearRole(
  draft: TeamDraft,
  unit: LineupUnit,
  role: Role,
): TeamDraft {
  return {
    ...draft,
    lineups: draft.lineups.filter(
      (l) => !(l.unit === unit && l.role === role),
    ),
  };
}

/**
 * Registra o estilo de ataque na estratégia (R11.2), devolvendo um novo
 * `TeamDraft` com a `strategy` atualizada.
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function setOffenseStyle(draft: TeamDraft, style: string): TeamDraft {
  return {
    ...draft,
    strategy: { ...draft.strategy, offenseStyle: style },
  };
}

/**
 * Registra o estilo de defesa na estratégia (R11.3), devolvendo um novo
 * `TeamDraft` com a `strategy` atualizada.
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function setDefenseStyle(draft: TeamDraft, style: string): TeamDraft {
  return {
    ...draft,
    strategy: { ...draft.strategy, defenseStyle: style },
  };
}

/**
 * Define a prioridade das jogadas de ataque. A `order` deve ser uma
 * **permutação** exata de {@link OFFENSE_PLAYS} (mesmos ids, sem repetição nem
 * omissão). Caso contrário a reordenação é recusada e o estado anterior é
 * preservado (R12.3).
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function reorderOffensePlays(
  draft: TeamDraft,
  order: PlayId[],
): TeamDraft {
  if (!isPermutationOf(order, OFFENSE_PLAYS)) {
    return cloneDraft(draft);
  }
  return {
    ...draft,
    strategy: { ...draft.strategy, offensePlayPriority: [...order] },
  };
}

/**
 * Define a prioridade das jogadas de defesa. A `order` deve ser uma
 * **permutação** exata de {@link DEFENSE_PLAYS} (mesmos ids, sem repetição nem
 * omissão). Caso contrário a reordenação é recusada e o estado anterior é
 * preservado (R12.4).
 *
 * @returns Novo `TeamDraft` (nunca o original).
 */
export function reorderDefensePlays(
  draft: TeamDraft,
  order: PlayId[],
): TeamDraft {
  if (!isPermutationOf(order, DEFENSE_PLAYS)) {
    return cloneDraft(draft);
  }
  return {
    ...draft,
    strategy: { ...draft.strategy, defensePlayPriority: [...order] },
  };
}

/**
 * Interface da store do time em edição (design · "Store do time em edição").
 *
 * Mantém o `TeamDraft` corrente e expõe as transições puras como operações
 * encadeáveis que também devolvem o novo `TeamDraft`. `loadFromPreset` e
 * `loadFromSeed` chegam em tarefas posteriores (5.1 e 7.2).
 */
export interface TeamStore {
  /** Retorna o `TeamDraft` corrente (referência imutável). */
  getDraft(): TeamDraft;

  // Roster
  addAthlete(athlete: AthleteDraft): TeamDraft;
  removeAthlete(instanceId: number): TeamDraft;
  updateAthlete(instanceId: number, patch: Partial<AthleteDraft>): TeamDraft;

  // Atribuição de posição
  assignRole(unit: LineupUnit, role: Role, instanceId: number): TeamDraft;
  clearRole(unit: LineupUnit, role: Role): TeamDraft;

  // Estratégia
  setOffenseStyle(style: string): TeamDraft;
  setDefenseStyle(style: string): TeamDraft;
  reorderOffensePlays(order: PlayId[]): TeamDraft;
  reorderDefensePlays(order: PlayId[]): TeamDraft;

  // Carga
  loadEmpty(name?: string): TeamDraft;
  loadFromPreset(presetId: PresetId): TeamDraft;
}

/**
 * Cria uma {@link TeamStore} com estado inicial opcional (padrão: time vazio).
 *
 * O estado é mantido numa referência interna substituída a cada operação pelo
 * novo `TeamDraft` produzido pela transição pura correspondente; o `TeamDraft`
 * anterior nunca é mutado.
 */
export function createTeamStore(initial: TeamDraft = loadEmpty()): TeamStore {
  let draft: TeamDraft = initial;
  const commit = (next: TeamDraft): TeamDraft => {
    draft = next;
    return draft;
  };

  return {
    getDraft: () => draft,

    addAthlete: (athlete) => commit(addAthlete(draft, athlete)),
    removeAthlete: (instanceId) => commit(removeAthlete(draft, instanceId)),
    updateAthlete: (instanceId, patch) =>
      commit(updateAthlete(draft, instanceId, patch)),

    assignRole: (unit, role, instanceId) =>
      commit(assignRole(draft, unit, role, instanceId)),
    clearRole: (unit, role) => commit(clearRole(draft, unit, role)),

    setOffenseStyle: (style) => commit(setOffenseStyle(draft, style)),
    setDefenseStyle: (style) => commit(setDefenseStyle(draft, style)),
    reorderOffensePlays: (order) => commit(reorderOffensePlays(draft, order)),
    reorderDefensePlays: (order) => commit(reorderDefensePlays(draft, order)),

    loadEmpty: (name) => commit(loadEmpty(name)),
    loadFromPreset: (presetId) => commit(clonePresetToDraft(presetId)),
  };
}

/**
 * Verifica se `order` é uma permutação exata de `expected`: mesmo tamanho e
 * mesmos elementos (como conjunto), sem repetições nem omissões.
 */
function isPermutationOf(order: PlayId[], expected: readonly PlayId[]): boolean {
  if (order.length !== expected.length) {
    return false;
  }
  const remaining = new Set<PlayId>(expected);
  for (const id of order) {
    if (!remaining.delete(id)) {
      // Elemento ausente de `expected` ou repetido: não é permutação.
      return false;
    }
  }
  return remaining.size === 0;
}

/** Copia um atleta, duplicando o array `moveIds` para não compartilhar refs. */
function cloneAthlete(athlete: AthleteDraft): AthleteDraft {
  return { ...athlete, moveIds: [...athlete.moveIds] };
}

/**
 * Produz uma cópia rasa-por-nível do `TeamDraft`, com novos arrays de topo.
 * Usada por transições que "recusam" uma operação para manter o contrato de
 * devolver sempre uma nova referência imutável sem alterar o estado anterior.
 */
function cloneDraft(draft: TeamDraft): TeamDraft {
  return {
    ...draft,
    roster: draft.roster.map(cloneAthlete),
    lineups: draft.lineups.map((l) => ({ ...l })),
    strategy: {
      ...draft.strategy,
      offensePlayPriority: [...draft.strategy.offensePlayPriority],
      defensePlayPriority: [...draft.strategy.defensePlayPriority],
    },
    ...(draft.provenance ? { provenance: { ...draft.provenance } } : {}),
  };
}
