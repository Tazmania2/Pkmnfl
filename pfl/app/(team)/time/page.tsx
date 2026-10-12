/**
 * Shell da Tela_Meu_Time (`app/(team)/time/page.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 8.4.
 *
 * **Server Component** que (a) hidrata a elegibilidade de espécie a partir da
 * `Camada_Leitura` via o adaptador de elegibilidade (`lib/team/`) e (b) monta o
 * island cliente ({@link MeuTimeIsland}), que consome o `TeamDraft` compartilhado
 * pelo provider do layout `(team)`. A store compartilhada garante que navegar
 * para `/estrategia` e voltar não descarta o rascunho (R3.1).
 *
 * A hidratação de elegibilidade é **tolerante a falha e não bloqueante**: se a
 * `Camada_Leitura` estiver indisponível (ex.: Supabase ainda não provisionado em
 * dev), o shell renderiza com `allowedSpecies = null` em vez de derrubar a tela.
 * O ponto desta tarefa é o shell + a fiação da store compartilhada; a UI
 * completa de montagem chega nas tarefas 9.x.
 *
 * _Requirements: 3.1, 11.1, 12.1, 12.2_
 */

import type { ReactNode } from 'react';
import {
  createEligibilitySource,
  resolveEligibilitySnapshot,
} from '@/lib/team/eligibility-adapter';
import { MeuTimeIsland } from '@/components/team/MeuTimeIsland';

// Toca a `Camada_Leitura` (Supabase) no servidor; nunca pré-renderizada.
export const dynamic = 'force-dynamic';

/**
 * Resolve o conjunto de espécies permitidas no servidor, de forma não
 * bloqueante: devolve `null` se a leitura falhar, para que o shell renderize
 * mesmo sem o catálogo disponível.
 */
async function hydrateAllowedSpecies(): Promise<number[] | null> {
  try {
    const source = createEligibilitySource();
    const snapshot = await resolveEligibilitySnapshot(source, { pokemonIds: [] });
    return [...snapshot.allowedSpecies].sort((a, b) => a - b);
  } catch {
    // Elegibilidade indisponível: a tela ainda monta; 9.x pode recarregar.
    return null;
  }
}

/**
 * Página `/time`. Hidrata a elegibilidade e renderiza o island cliente de Meu
 * Time sob o provider compartilhado do grupo `(team)`.
 */
export default async function MeuTimePage(): Promise<ReactNode> {
  const allowedSpecies = await hydrateAllowedSpecies();
  return <MeuTimeIsland allowedSpecies={allowedSpecies} />;
}
