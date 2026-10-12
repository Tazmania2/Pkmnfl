/**
 * Camada de leitura dos dados de regras: `Dados_Matchup_NFL` e `Baseline_Design`
 * (spec `pfl-data-catalog`).
 *
 * Este módulo expõe consultas que servem os dados de regras **exclusivamente a
 * partir do Supabase** (R12.7, R12.8, R10.4). A leitura nunca aciona a API_NFL
 * nem toca os arquivos do Catálogo Oficial em tempo de execução de consulta:
 * as únicas fontes são as tabelas `nfl_matchup_data` e `design_baseline`, já
 * populadas pelo seed/ingestão. Por isso usamos o cliente público (anon) de
 * leitura, sujeito a RLS, sem qualquer I/O externo.
 *
 * O cliente é injetável para permitir testes unitários sem conexão real.
 *
 * _Requirements: 12.7, 12.8, 10.4_
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { DesignBaselineRow } from '../catalog/types';
import type { NflMatchupRow } from '../nfl/types';
import { createPublicClient } from '../supabase/public-client';

/** Tabela de origem dos `Dados_Matchup_NFL` (somente leitura nesta camada). */
export const NFL_MATCHUP_TABLE = 'nfl_matchup_data' as const;

/** Tabela de origem do `Baseline_Design` (somente leitura nesta camada). */
export const DESIGN_BASELINE_TABLE = 'design_baseline' as const;

/**
 * Dependências injetáveis das consultas de regras. Em produção o cliente é
 * criado via {@link createPublicClient}; os testes podem fornecer um dublê para
 * evitar I/O real e verificar que a leitura só toca o Supabase.
 */
export interface RulesReadDeps {
  /** Cliente Supabase de leitura (padrão: {@link createPublicClient}). */
  readonly client?: SupabaseClient;
}

/** Colunas projetadas de `nfl_matchup_data`, alinhadas a {@link NflMatchupRow}. */
const NFL_MATCHUP_COLUMNS =
  'natural_key, offense_scheme, defense_scheme, payload, captured_at, source' as const;

/** Colunas projetadas de `design_baseline`, alinhadas a {@link DesignBaselineRow}. */
const DESIGN_BASELINE_COLUMNS = 'version, kind, status, payload, created_at' as const;

/**
 * Retorna todos os `Dados_Matchup_NFL` persistidos, lendo exclusivamente de
 * `nfl_matchup_data` no Supabase (R12.7, R12.8, R10.4).
 *
 * A leitura é read-only e não realiza qualquer requisição à API_NFL nem acessa
 * arquivos do Catálogo Oficial. Quando não há linhas, retorna uma lista vazia.
 *
 * @param deps Dependências injetáveis (cliente) para teste.
 * @returns Lista de {@link NflMatchupRow} persistidos.
 * @throws {Error} Se a consulta ao Supabase falhar.
 */
export async function getNflMatchups(deps: RulesReadDeps = {}): Promise<NflMatchupRow[]> {
  const client = deps.client ?? createPublicClient();

  const { data, error } = await client
    .from(NFL_MATCHUP_TABLE)
    .select(NFL_MATCHUP_COLUMNS)
    .order('natural_key', { ascending: true });

  if (error !== null) {
    throw new Error(`Falha ao ler ${NFL_MATCHUP_TABLE}: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as NflMatchupRow[];
  return rows;
}

/**
 * Retorna um registro de `Baseline_Design` persistido, lendo exclusivamente de
 * `design_baseline` no Supabase (R12.7, R12.8, R10.4).
 *
 * - Com `version` informada, filtra por essa versão e retorna o registro mais
 *   recente dentre os `kind` daquela versão (desempate por `created_at`).
 * - Sem `version`, retorna o registro mais recente de todos (maior
 *   `created_at`, com `version` como desempate estável).
 * - Quando nenhum registro corresponde, retorna `null` (sem lançar exceção).
 *
 * A leitura é read-only e não aciona a API_NFL nem lê arquivos do catálogo.
 *
 * @param version Versão de design a filtrar (opcional).
 * @param deps Dependências injetáveis (cliente) para teste.
 * @returns A {@link DesignBaselineRow} correspondente ou `null`.
 * @throws {Error} Se a consulta ao Supabase falhar.
 */
export async function getDesignBaseline(
  version?: string,
  deps: RulesReadDeps = {},
): Promise<DesignBaselineRow | null> {
  const client = deps.client ?? createPublicClient();

  let query = client
    .from(DESIGN_BASELINE_TABLE)
    .select(DESIGN_BASELINE_COLUMNS)
    .order('created_at', { ascending: false })
    .order('version', { ascending: false })
    .limit(1);

  if (typeof version === 'string' && version.trim() !== '') {
    query = query.eq('version', version);
  }

  const { data, error } = await query;

  if (error !== null) {
    throw new Error(`Falha ao ler ${DESIGN_BASELINE_TABLE}: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as DesignBaselineRow[];
  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    version: row.version,
    kind: row.kind,
    status: row.status,
    payload: row.payload,
  };
}
