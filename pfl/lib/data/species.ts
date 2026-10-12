/**
 * Camada de leitura de espécies do catálogo (spec `pfl-data-catalog`).
 *
 * Expõe `getAllowedSpecies`, que retorna **exclusivamente** as espécies com
 * `is_allowed = true`, projetando apenas identidade (`pokemon_id`, `slug`),
 * `types` e as seis estatísticas base (Req. 12.1). A consulta lê **somente**
 * do Supabase, usando o cliente público (anon) de leitura — nunca toca os
 * arquivos do Catálogo Oficial nem a API_NFL em tempo de execução (Req. 12.8).
 *
 * O cliente é injetável (parâmetro `deps.client`) para permitir testes
 * unitários com um dublê em memória, sem I/O real. Em produção, o cliente é
 * criado via {@link createPublicClient}.
 *
 * _Requirements: 12.1, 12.8_
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SpeciesSummary } from '../catalog/types';
import { createPublicClient } from '../supabase/public-client';

/** Nome da tabela de espécies consultada pela Camada_Leitura. */
export const SPECIES_TABLE = 'species' as const;

/**
 * Colunas projetadas por {@link getAllowedSpecies}. Restringir a projeção às
 * colunas do contrato (identidade + `types` + seis stats base) evita vazar
 * `raw_data`, `is_allowed`, altura ou peso para o consumidor (Req. 12.1).
 */
export const SPECIES_SUMMARY_COLUMNS =
  'pokemon_id, slug, types, hp, attack, defense, special_attack, special_defense, speed' as const;

/**
 * Dependências injetáveis de {@link getAllowedSpecies}. Em produção, o cliente
 * é criado via {@link createPublicClient}; os testes fornecem um dublê para
 * evitar I/O real.
 */
export interface GetAllowedSpeciesDeps {
  /** Cliente Supabase de leitura (padrão: {@link createPublicClient}). */
  readonly client?: SupabaseClient;
}

/**
 * Retorna todas as espécies permitidas (`is_allowed = true`).
 *
 * Comportamento (Req. 12.1, 12.8):
 * - Filtra `is_allowed = true` no servidor; nenhuma espécie com
 *   `is_allowed = false` é retornada.
 * - Projeta apenas `pokemon_id`, `slug`, `types` e as seis estatísticas base.
 * - Lê exclusivamente do Supabase pelo cliente de leitura; não acessa arquivos
 *   do catálogo nem APIs externas.
 *
 * A ordenação por `pokemon_id` torna o resultado determinístico entre chamadas.
 *
 * @param deps Dependências injetáveis (cliente) para teste.
 * @returns Lista de {@link SpeciesSummary} das espécies permitidas.
 * @throws Se a consulta ao Supabase falhar (erro propagado ao chamador).
 */
export async function getAllowedSpecies(
  deps: GetAllowedSpeciesDeps = {},
): Promise<SpeciesSummary[]> {
  const client = deps.client ?? createPublicClient();

  const { data, error } = await client
    .from(SPECIES_TABLE)
    .select(SPECIES_SUMMARY_COLUMNS)
    .eq('is_allowed', true)
    .order('pokemon_id', { ascending: true });

  if (error !== null) {
    throw new Error(
      `Falha ao consultar espécies permitidas em "${SPECIES_TABLE}": ${error.message}`,
    );
  }

  const rows = (data ?? []) as unknown as SpeciesSummary[];

  return rows.map((row) => ({
    pokemon_id: row.pokemon_id,
    slug: row.slug,
    types: row.types,
    hp: row.hp,
    attack: row.attack,
    defense: row.defense,
    special_attack: row.special_attack,
    special_defense: row.special_defense,
    speed: row.speed,
  }));
}
