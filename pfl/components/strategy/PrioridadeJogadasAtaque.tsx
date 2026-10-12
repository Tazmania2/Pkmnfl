'use client';

/**
 * `PrioridadeJogadasAtaque` (`components/strategy/PrioridadeJogadasAtaque.tsx`) —
 * spec `pfl-team-strategy-ui`, Task 10.1.
 *
 * Componente de **apresentação** (burro) da Tela_Estrategia: exibe as **6**
 * jogadas de ataque (`O_*` de `OFFENSE_PLAYS`) na ordem de prioridade recebida
 * em `order` e permite reordená-las **por teclado** (botões mover acima/abaixo)
 * via `ListaPrioridade`. Cada mudança emite a nova ordem completa por
 * `onReorder`, sempre uma **permutação do conjunto fixo** (R12.1/R12.3/R12.4).
 *
 * Não há desenhador de jogadas e não há UI de special teams (R12.5/R12.6): este
 * componente apenas ordena as 6 jogadas ofensivas fixas.
 *
 * O mapa {@link LABELS_ATAQUE} fornece rótulos legíveis para cada `PlayId`. São
 * **rótulos de UI**, não números de catálogo — não há questão de honestidade de
 * valores (R17.5).
 *
 * _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6_
 */

import type { ReactNode } from 'react';
import { OFFENSE_PLAYS, type PlayId } from '@/lib/team/model';
import { ListaPrioridade } from './ListaPrioridade';

/** Rótulos legíveis das 6 jogadas de ataque. Textos de UI (R17.5). */
export const LABELS_ATAQUE: Readonly<Record<
  Extract<
    PlayId,
    | 'O_RUN_INSIDE'
    | 'O_RUN_OUTSIDE'
    | 'O_PASS_SHORT'
    | 'O_PASS_INTERMEDIATE'
    | 'O_PASS_DEEP'
    | 'O_PLAY_ACTION'
  >,
  string
>> = {
  O_RUN_INSIDE: 'Corrida interna',
  O_RUN_OUTSIDE: 'Corrida externa',
  O_PASS_SHORT: 'Passe curto',
  O_PASS_INTERMEDIATE: 'Passe intermediário',
  O_PASS_DEEP: 'Passe profundo',
  O_PLAY_ACTION: 'Play action',
};

export interface PrioridadeJogadasAtaqueProps {
  /** Ordem atual das 6 jogadas de ataque (permutação de `OFFENSE_PLAYS`). */
  readonly order: PlayId[];
  /** Emite a nova ordem completa após reordenar por teclado (R12.4). */
  readonly onReorder: (order: PlayId[]) => void;
}

export function PrioridadeJogadasAtaque({
  order,
  onReorder,
}: PrioridadeJogadasAtaqueProps): ReactNode {
  // Resguardo: se `order` vier incompleta, cai para a ordem canônica das 6
  // jogadas de ataque, garantindo que as 6 opções estejam sempre presentes (R12.1).
  const effectiveOrder: readonly PlayId[] =
    order.length === OFFENSE_PLAYS.length ? order : [...OFFENSE_PLAYS];

  return (
    <section aria-labelledby="pfl-prioridade-ataque-titulo">
      <h3
        id="pfl-prioridade-ataque-titulo"
        style={{ fontSize: '1.0625rem', fontWeight: 600, margin: '0 0 0.5rem' }}
      >
        Prioridade das jogadas de ataque
      </h3>
      <ListaPrioridade
        scope="ataque"
        order={effectiveOrder}
        labels={LABELS_ATAQUE as Readonly<Record<PlayId, string>>}
        groupLabel="Prioridade das jogadas de ataque"
        onReorder={onReorder}
      />
    </section>
  );
}
