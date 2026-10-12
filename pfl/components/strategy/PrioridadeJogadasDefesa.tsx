'use client';

/**
 * `PrioridadeJogadasDefesa` (`components/strategy/PrioridadeJogadasDefesa.tsx`) —
 * spec `pfl-team-strategy-ui`, Task 10.1.
 *
 * Componente de **apresentação** (burro) da Tela_Estrategia: exibe as **6**
 * jogadas de defesa (`D_*` de `DEFENSE_PLAYS`) na ordem de prioridade recebida
 * em `order` e permite reordená-las **por teclado** (botões mover acima/abaixo)
 * via `ListaPrioridade`. Cada mudança emite a nova ordem completa por
 * `onReorder`, sempre uma **permutação do conjunto fixo** (R12.2/R12.3/R12.4).
 *
 * Não há desenhador de jogadas e não há UI de special teams (R12.5/R12.6):
 * apenas a ordenação das 6 jogadas defensivas fixas. Espelha
 * `PrioridadeJogadasAtaque`.
 *
 * O mapa {@link LABELS_DEFESA} fornece rótulos legíveis de UI (R17.5).
 *
 * _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6_
 */

import type { ReactNode } from 'react';
import { DEFENSE_PLAYS, type PlayId } from '@/lib/team/model';
import { ListaPrioridade } from './ListaPrioridade';

/** Rótulos legíveis das 6 jogadas de defesa. Textos de UI (R17.5). */
export const LABELS_DEFESA: Readonly<Record<
  Extract<
    PlayId,
    | 'D_RUN_FIT'
    | 'D_EDGE_CONTAIN'
    | 'D_ZONE'
    | 'D_MAN'
    | 'D_RUSH'
    | 'D_CONTAIN_QB'
  >,
  string
>> = {
  D_RUN_FIT: 'Contenção de corrida',
  D_EDGE_CONTAIN: 'Contenção de perímetro',
  D_ZONE: 'Cobertura de zona',
  D_MAN: 'Marcação individual',
  D_RUSH: 'Pressão ao passador',
  D_CONTAIN_QB: 'Contenção do QB',
};

export interface PrioridadeJogadasDefesaProps {
  /** Ordem atual das 6 jogadas de defesa (permutação de `DEFENSE_PLAYS`). */
  readonly order: PlayId[];
  /** Emite a nova ordem completa após reordenar por teclado (R12.4). */
  readonly onReorder: (order: PlayId[]) => void;
}

export function PrioridadeJogadasDefesa({
  order,
  onReorder,
}: PrioridadeJogadasDefesaProps): ReactNode {
  // Resguardo: se `order` vier incompleta, cai para a ordem canônica das 6
  // jogadas de defesa, garantindo que as 6 opções estejam sempre presentes (R12.2).
  const effectiveOrder: readonly PlayId[] =
    order.length === DEFENSE_PLAYS.length ? order : [...DEFENSE_PLAYS];

  return (
    <section aria-labelledby="pfl-prioridade-defesa-titulo">
      <h3
        id="pfl-prioridade-defesa-titulo"
        style={{ fontSize: '1.0625rem', fontWeight: 600, margin: '0 0 0.5rem' }}
      >
        Prioridade das jogadas de defesa
      </h3>
      <ListaPrioridade
        scope="defesa"
        order={effectiveOrder}
        labels={LABELS_DEFESA as Readonly<Record<PlayId, string>>}
        groupLabel="Prioridade das jogadas de defesa"
        onReorder={onReorder}
      />
    </section>
  );
}
