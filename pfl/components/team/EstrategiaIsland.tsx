'use client';

/**
 * Island cliente da Tela_Estrategia (`components/team/EstrategiaIsland.tsx`) —
 * spec `pfl-team-strategy-ui`, Tasks 8.4 e 11.1.
 *
 * Monta a tela Estratégia sobre o **mesmo** `TeamDraft` compartilhado via
 * {@link useTeamDraft} que a Tela_Meu_Time: estilos e prioridades de jogada são
 * sub-objeto do mesmo documento (R11.1, R12.1, R12.2), de modo que navegar entre
 * `/time` e `/estrategia` nunca descarta edições.
 *
 * Fiação (Task 11.1) dos componentes de apresentação de `components/strategy/`
 * ao `StrategyDraft` compartilhado:
 * - `SeletorEstiloAtaque`/`SeletorEstiloDefesa` → `actions.setOffenseStyle`/
 *   `setDefenseStyle` (R11.2/R11.3).
 * - `PrioridadeJogadasAtaque`/`PrioridadeJogadasDefesa` →
 *   `actions.reorderOffensePlays`/`reorderDefensePlays` (R12.3/R12.4).
 *
 * Cada ação delega a uma transição pura e imutável da store, substituindo o
 * `TeamDraft` sem mutar o anterior; os seletores e listas apenas emitem o novo
 * valor/ordem.
 *
 * _Requirements: 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4_
 */

import type { ReactNode } from 'react';
import { useTeamDraft } from './TeamDraftProvider';
import {
  SeletorEstiloAtaque,
  SeletorEstiloDefesa,
  PrioridadeJogadasAtaque,
  PrioridadeJogadasDefesa,
} from '@/components/strategy';

/**
 * Renderiza a tela Estratégia com os seletores de estilo e as listas de
 * priorização de jogadas, fiados ao `StrategyDraft` compartilhado.
 */
export function EstrategiaIsland(): ReactNode {
  const { draft, actions } = useTeamDraft();
  const { strategy } = draft;

  return (
    <section aria-labelledby="estrategia-titulo">
      <h1 id="estrategia-titulo">Estratégia</h1>

      {/* Estilos de ataque/defesa registrados na StrategyDraft (R11.2/R11.3). */}
      <SeletorEstiloAtaque
        value={strategy.offenseStyle}
        onChange={actions.setOffenseStyle}
      />
      <SeletorEstiloDefesa
        value={strategy.defenseStyle}
        onChange={actions.setDefenseStyle}
      />

      {/* Prioridades: permutações dos conjuntos fixos de 6 jogadas (R12.3/R12.4). */}
      <PrioridadeJogadasAtaque
        order={strategy.offensePlayPriority}
        onReorder={actions.reorderOffensePlays}
      />
      <PrioridadeJogadasDefesa
        order={strategy.defensePlayPriority}
        onReorder={actions.reorderDefensePlays}
      />
    </section>
  );
}
