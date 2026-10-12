'use client';

/**
 * Provider React da store do time em edição
 * (`components/team/TeamDraftProvider.tsx`) — spec `pfl-team-strategy-ui`,
 * Task 8.4.
 *
 * A camada React sobre as transições puras e imutáveis de `lib/team/store.ts`.
 * As duas telas da spec (`/time` e `/estrategia`) compartilham **uma única**
 * instância de `TeamDraft` em memória, montada acima das rotas num layout comum
 * (grupo `(team)`). Como o App Router **não remonta** um provider que vive num
 * layout compartilhado ao navegar entre páginas irmãs do mesmo subárvore, o
 * `TeamDraft` em edição **sobrevive** à navegação `/time` ↔ `/estrategia` sem
 * ser descartado (R3.1, R11.1, R12.1, R12.2 — a estratégia e o roster são o
 * mesmo documento, editado em telas diferentes).
 *
 * Princípios de design refletidos:
 * - **O núcleo puro é a fonte da verdade**: este provider não contém regra de
 *   jogo. Cada ação delega a uma transição pura (`addAthlete`, `assignRole`,
 *   `setOffenseStyle`, `reorderOffensePlays`, `loadFromPreset`, ...), que recebe
 *   o `TeamDraft` corrente e devolve um **novo** `TeamDraft` imutável.
 * - **Apresentação separada de lógica**: o estado reativo vive num
 *   `useState<TeamDraft>`; as ações são estáveis (`useCallback`) e apenas
 *   substituem o estado pelo resultado da transição pura correspondente.
 *
 * O provider espelha a interface da store (`lib/team/store.ts`) sob a forma de
 * ações React, para que os componentes das tarefas 9.x (Meu Time) e 10.x
 * (Estratégia) consumam um ponto único via {@link useTeamDraft}.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  loadEmpty,
  addAthlete as addAthleteTx,
  removeAthlete as removeAthleteTx,
  updateAthlete as updateAthleteTx,
  assignRole as assignRoleTx,
  clearRole as clearRoleTx,
  setOffenseStyle as setOffenseStyleTx,
  setDefenseStyle as setDefenseStyleTx,
  reorderOffensePlays as reorderOffensePlaysTx,
  reorderDefensePlays as reorderDefensePlaysTx,
} from '@/lib/team/store';
import { clonePresetToDraft } from '@/lib/presets';
import type {
  TeamDraft,
  AthleteDraft,
  LineupUnit,
  Role,
  PlayId,
  PresetId,
} from '@/lib/team/model';

/**
 * Conjunto de ações reativas que mutam o `TeamDraft` compartilhado. Cada ação
 * delega a uma transição pura de `lib/team/store.ts` e substitui o estado pelo
 * novo `TeamDraft` produzido — o anterior nunca é mutado.
 *
 * As assinaturas espelham a interface `TeamStore` do design, mas sem retorno:
 * o estado atualizado flui aos consumidores via re-render do Context.
 */
export interface TeamDraftActions {
  /** Começa do zero: substitui o draft por um time vazio (R1.2). */
  loadEmpty(name?: string): void;
  /** Clona um preset copiável para o draft em edição (R10.2). */
  loadFromPreset(presetId: PresetId): void;

  // Roster
  addAthlete(athlete: AthleteDraft): void;
  removeAthlete(instanceId: number): void;
  updateAthlete(instanceId: number, patch: Partial<AthleteDraft>): void;

  // Atribuição de posição
  assignRole(unit: LineupUnit, role: Role, instanceId: number): void;
  clearRole(unit: LineupUnit, role: Role): void;

  // Estratégia
  setOffenseStyle(style: string): void;
  setDefenseStyle(style: string): void;
  reorderOffensePlays(order: PlayId[]): void;
  reorderDefensePlays(order: PlayId[]): void;

  /** Substitui o draft inteiro (ex.: após carregar time salvo ou seed). */
  setDraft(next: TeamDraft): void;
}

/**
 * Valor do Context: o `TeamDraft` corrente reativo (para renderizar) e as ações
 * que o transicionam. Componentes obtêm ambos por {@link useTeamDraft}.
 */
export interface TeamDraftContextValue {
  /** Snapshot reativo do `TeamDraft`; re-renderiza a cada transição. */
  readonly draft: TeamDraft;
  /** Ações que aplicam as transições puras da store. */
  readonly actions: TeamDraftActions;
}

/**
 * `undefined` como sentinela de "fora do provider": permite {@link useTeamDraft}
 * lançar um erro claro quando usado sem o provider montado acima.
 */
const TeamDraftContext = createContext<TeamDraftContextValue | undefined>(
  undefined,
);

/**
 * Provider do `TeamDraft` compartilhado. Mantém o draft num `useState` (fonte da
 * verdade reativa) e expõe ações estáveis que delegam às transições puras.
 *
 * Montado no `app/(team)/layout.tsx`, acima de `/time` e `/estrategia`: como o
 * App Router preserva a instância de um layout entre navegações para páginas
 * irmãs, o `TeamDraft` em edição persiste à transição entre as duas telas sem
 * ser descartado (R3.1, R11.1, R12.1, R12.2).
 *
 * @param initial Draft inicial opcional (padrão: time vazio).
 * @param children As páginas `/time` e `/estrategia` sob o grupo `(team)`.
 */
export function TeamDraftProvider({
  children,
  initial,
}: {
  readonly children: ReactNode;
  readonly initial?: TeamDraft;
}): ReactNode {
  const [draft, setDraftState] = useState<TeamDraft>(
    () => initial ?? loadEmpty(),
  );

  const setDraft = useCallback((next: TeamDraft) => {
    setDraftState(next);
  }, []);

  const loadEmptyAction = useCallback((name?: string) => {
    setDraftState(loadEmpty(name));
  }, []);

  const loadFromPreset = useCallback((presetId: PresetId) => {
    setDraftState(clonePresetToDraft(presetId));
  }, []);

  const addAthlete = useCallback((athlete: AthleteDraft) => {
    setDraftState((prev) => addAthleteTx(prev, athlete));
  }, []);

  const removeAthlete = useCallback((instanceId: number) => {
    setDraftState((prev) => removeAthleteTx(prev, instanceId));
  }, []);

  const updateAthlete = useCallback(
    (instanceId: number, patch: Partial<AthleteDraft>) => {
      setDraftState((prev) => updateAthleteTx(prev, instanceId, patch));
    },
    [],
  );

  const assignRole = useCallback(
    (unit: LineupUnit, role: Role, instanceId: number) => {
      setDraftState((prev) => assignRoleTx(prev, unit, role, instanceId));
    },
    [],
  );

  const clearRole = useCallback((unit: LineupUnit, role: Role) => {
    setDraftState((prev) => clearRoleTx(prev, unit, role));
  }, []);

  const setOffenseStyle = useCallback((style: string) => {
    setDraftState((prev) => setOffenseStyleTx(prev, style));
  }, []);

  const setDefenseStyle = useCallback((style: string) => {
    setDraftState((prev) => setDefenseStyleTx(prev, style));
  }, []);

  const reorderOffensePlays = useCallback((order: PlayId[]) => {
    setDraftState((prev) => reorderOffensePlaysTx(prev, order));
  }, []);

  const reorderDefensePlays = useCallback((order: PlayId[]) => {
    setDraftState((prev) => reorderDefensePlaysTx(prev, order));
  }, []);

  const actions = useMemo<TeamDraftActions>(
    () => ({
      loadEmpty: loadEmptyAction,
      loadFromPreset,
      addAthlete,
      removeAthlete,
      updateAthlete,
      assignRole,
      clearRole,
      setOffenseStyle,
      setDefenseStyle,
      reorderOffensePlays,
      reorderDefensePlays,
      setDraft,
    }),
    [
      loadEmptyAction,
      loadFromPreset,
      addAthlete,
      removeAthlete,
      updateAthlete,
      assignRole,
      clearRole,
      setOffenseStyle,
      setDefenseStyle,
      reorderOffensePlays,
      reorderDefensePlays,
      setDraft,
    ],
  );

  const value = useMemo<TeamDraftContextValue>(
    () => ({ draft, actions }),
    [draft, actions],
  );

  return (
    <TeamDraftContext.Provider value={value}>
      {children}
    </TeamDraftContext.Provider>
  );
}

/**
 * Hook de acesso ao `TeamDraft` compartilhado. Retorna o draft corrente (para
 * renderizar) e as ações (para transicioná-lo). Lança um erro claro se usado
 * fora do {@link TeamDraftProvider}, para que o engano seja pego em
 * desenvolvimento em vez de produzir um `undefined` silencioso.
 */
export function useTeamDraft(): TeamDraftContextValue {
  const value = useContext(TeamDraftContext);
  if (value === undefined) {
    throw new Error(
      'useTeamDraft deve ser usado dentro de <TeamDraftProvider> (layout do grupo de rotas (team)).',
    );
  }
  return value;
}
