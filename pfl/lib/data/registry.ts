/**
 * Camada de leitura do registro de golpes e habilidades (spec `pfl-data-catalog`,
 * Task 13.5). Expõe `getMove` e `getAbility` sobre o acervo já persistido no
 * Supabase.
 *
 * Garantias de contrato:
 * - **Preservação fiel**: o `raw_data` retornado é exatamente a estrutura de
 *   origem gravada, sem conversão (Req. 12.5).
 * - **Ausência sem exceção**: identificador inexistente resolve para
 *   `{ found: false }` em vez de lançar; o registro permanece disponível para
 *   novas consultas, pois a leitura não altera estado nem invalida o cliente
 *   (Reqs. 12.6, 12.8).
 * - **Somente leitura**: usa o cliente de leitura (anon) e apenas consulta o
 *   Supabase; não escreve, não toca a API_NFL nem arquivos do catálogo.
 *
 * _Requirements: 12.5, 12.6, 12.8_
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AbilityRecord, MoveRecord, Result } from '../catalog/types';
import { createPublicClient } from '../supabase/public-client';

/**
 * Cria o cliente de leitura padrão (anon) sob demanda. É mantido lazy para que
 * a importação do módulo não exija variáveis de ambiente — testes podem injetar
 * um cliente stub e nunca tocar a configuração real.
 */
function defaultClient(): SupabaseClient {
  return createPublicClient();
}

/**
 * Mapeia o erro de uma consulta `maybeSingle()` para a semântica de ausência.
 *
 * `maybeSingle()` resolve `data: null` sem erro quando não há linha, o que já é
 * tratado como `{ found: false }`. Caso o adaptador retorne o código do
 * PostgREST para "nenhuma linha" (`PGRST116`), também o tratamos como ausência
 * em vez de propagar como falha, preservando o contrato de "não lançar".
 */
function isNotFoundError(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST116';
}

/**
 * Consulta um golpe pelo seu `move_id`.
 *
 * @param moveId Identificador do golpe (PK `moves.move_id`).
 * @param client Cliente Supabase opcional (injetável em testes); por padrão, o
 *   cliente público de leitura.
 * @returns `{ found: true, value }` com `move_id`, `name` e `raw_data` fiel
 *   quando o golpe existe; `{ found: false }` para id inexistente.
 */
export async function getMove(
  moveId: number,
  client: SupabaseClient = defaultClient(),
): Promise<Result<MoveRecord>> {
  const { data, error } = await client
    .from('moves')
    .select('move_id, name, raw_data')
    .eq('move_id', moveId)
    .maybeSingle();

  if (error && !isNotFoundError(error)) {
    throw error;
  }

  if (!data) {
    return { found: false };
  }

  const row = data as MoveRecord;
  return {
    found: true,
    value: {
      move_id: row.move_id,
      name: row.name,
      raw_data: row.raw_data,
    },
  };
}

/**
 * Consulta uma habilidade pelo seu `ability_id`.
 *
 * @param abilityId Identificador da habilidade (PK `abilities.ability_id`).
 * @param client Cliente Supabase opcional (injetável em testes); por padrão, o
 *   cliente público de leitura.
 * @returns `{ found: true, value }` com `ability_id`, `name` e `raw_data` fiel
 *   quando a habilidade existe; `{ found: false }` para id inexistente.
 */
export async function getAbility(
  abilityId: number,
  client: SupabaseClient = defaultClient(),
): Promise<Result<AbilityRecord>> {
  const { data, error } = await client
    .from('abilities')
    .select('ability_id, name, raw_data')
    .eq('ability_id', abilityId)
    .maybeSingle();

  if (error && !isNotFoundError(error)) {
    throw error;
  }

  if (!data) {
    return { found: false };
  }

  const row = data as AbilityRecord;
  return {
    found: true,
    value: {
      ability_id: row.ability_id,
      name: row.name,
      raw_data: row.raw_data,
    },
  };
}
