/**
 * Camada de leitura — elegibilidade por espécie (`lib/data/eligibility.ts`).
 *
 * Expõe consultas de elegibilidade sobre o acervo persistido no Supabase, sem
 * tocar fontes externas (arquivos do catálogo ou API NFL) em tempo de leitura.
 * Lê exclusivamente do Supabase via cliente de leitura (anon), respeitando as
 * políticas de RLS.
 *
 * Semântica de presença/ausência (R12.6):
 * - Para um `pokemon_id` existente **e** com `is_allowed = true`, as consultas
 *   retornam `{ found: true, value }`; se a espécie permitida ainda não tiver
 *   relações, `value` é o conjunto vazio (sem erro) — R12.4.
 * - Para `pokemon_id` inexistente **ou** sem `is_allowed`, retornam
 *   `{ found: false }` — R12.6.
 *
 * _Requirements: 12.2, 12.3, 12.4, 12.6_
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createPublicClient } from '../supabase/public-client';
import type { Result } from '../catalog/types';

/** Nome da tabela de espécies no Supabase. */
const SPECIES_TABLE = 'species';
/** Nome da relação golpe-aprendível por espécie. */
const LEARNABLE_MOVES_TABLE = 'pokemon_learnable_moves';
/** Nome da relação habilidade-disponível por espécie. */
const POKEMON_ABILITIES_TABLE = 'pokemon_abilities';

/**
 * Habilidade disponível de uma espécie, conforme projeção da `Camada_Leitura`:
 * o identificador da habilidade e se ela é oculta (`is_hidden`).
 */
export interface AvailableAbility {
  readonly ability_id: number;
  readonly is_hidden: boolean;
}

/**
 * Dependências injetáveis das consultas de elegibilidade. Em produção o cliente
 * é criado via {@link createPublicClient}; os testes podem fornecer um dublê
 * para evitar I/O real.
 */
export interface EligibilityDeps {
  /** Cliente Supabase de leitura (padrão: {@link createPublicClient}). */
  readonly client?: SupabaseClient;
}

/**
 * Verifica se um `pokemon_id` existe e está marcado como permitido
 * (`is_allowed = true`).
 *
 * @returns `true` se a espécie existe e é permitida; `false` caso contrário
 *   (inexistente ou `is_allowed = false`).
 */
async function isAllowedSpecies(
  client: SupabaseClient,
  pokemonId: number,
): Promise<boolean> {
  const { data, error } = await client
    .from(SPECIES_TABLE)
    .select('pokemon_id, is_allowed')
    .eq('pokemon_id', pokemonId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (data === null) {
    return false;
  }
  return data.is_allowed === true;
}

/**
 * Retorna o conjunto de `move_id` que a espécie pode aprender.
 *
 * Comportamento (R12.2, R12.4, R12.6):
 * - Espécie permitida (`is_allowed = true`): `{ found: true, value: moveIds }`,
 *   onde `moveIds` é o conjunto (sem duplicatas) de `move_id` da relação
 *   `pokemon_learnable_moves`. Espécie permitida sem relações retorna
 *   `{ found: true, value: [] }` sem erro.
 * - Espécie inexistente ou sem `is_allowed`: `{ found: false }`.
 *
 * Só lê do Supabase; não realiza I/O externo (arquivos/rede).
 */
export async function getLearnableMoveIds(
  pokemonId: number,
  deps: EligibilityDeps = {},
): Promise<Result<number[]>> {
  const client = deps.client ?? createPublicClient();

  if (!(await isAllowedSpecies(client, pokemonId))) {
    return { found: false };
  }

  const { data, error } = await client
    .from(LEARNABLE_MOVES_TABLE)
    .select('move_id')
    .eq('pokemon_id', pokemonId);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as { move_id: number }[];
  // Conjunto: deduplica preservando a ordem de aparição.
  const seen = new Set<number>();
  const moveIds: number[] = [];
  for (const row of rows) {
    if (!seen.has(row.move_id)) {
      seen.add(row.move_id);
      moveIds.push(row.move_id);
    }
  }

  return { found: true, value: moveIds };
}

/**
 * Retorna o conjunto de habilidades disponíveis da espécie, cada uma com
 * `ability_id` e `is_hidden`.
 *
 * Comportamento (R12.3, R12.4, R12.6):
 * - Espécie permitida (`is_allowed = true`): `{ found: true, value: abilities }`,
 *   onde `abilities` é o conjunto (deduplicado por `ability_id`) de habilidades
 *   da relação `pokemon_abilities`. Espécie permitida sem relações retorna
 *   `{ found: true, value: [] }` sem erro.
 * - Espécie inexistente ou sem `is_allowed`: `{ found: false }`.
 *
 * Só lê do Supabase; não realiza I/O externo (arquivos/rede).
 */
export async function getAvailableAbilities(
  pokemonId: number,
  deps: EligibilityDeps = {},
): Promise<Result<AvailableAbility[]>> {
  const client = deps.client ?? createPublicClient();

  if (!(await isAllowedSpecies(client, pokemonId))) {
    return { found: false };
  }

  const { data, error } = await client
    .from(POKEMON_ABILITIES_TABLE)
    .select('ability_id, is_hidden')
    .eq('pokemon_id', pokemonId);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as AvailableAbility[];
  // Conjunto: deduplica por ability_id preservando a ordem de aparição.
  const seen = new Set<number>();
  const abilities: AvailableAbility[] = [];
  for (const row of rows) {
    if (!seen.has(row.ability_id)) {
      seen.add(row.ability_id);
      abilities.push({ ability_id: row.ability_id, is_hidden: row.is_hidden === true });
    }
  }

  return { found: true, value: abilities };
}
