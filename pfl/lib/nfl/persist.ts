/**
 * Persistência idempotente dos `Dados_Matchup_NFL` (spec `pfl-data-catalog`).
 *
 * Este módulo grava os dados históricos de matchups da NFL **exclusivamente**
 * na tabela própria de dados de referência de regras `nfl_matchup_data`
 * (R10.1), nunca como atleta, espécie ou registro de roster do jogador
 * (R10.5). A idempotência vem da chave natural: o upsert tem como alvo o
 * `ON CONFLICT (natural_key)`, de modo que uma reexecução atualize os
 * registros existentes sem duplicá-los (R10.3).
 *
 * Toda linha gravada carrega `captured_at` em UTC (ISO 8601) e a `source`
 * (padrão `https://nfl.balldontlie.io`), normalizados pelo escritor antes da
 * escrita (R10.2). A escrita reutiliza o cliente service-role da
 * `pfl-foundation` ({@link createServerClient}).
 *
 * _Requirements: 10.1, 10.2, 10.3, 10.5_
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { UpsertResult } from '../catalog/types';
import { createServerClient } from '../supabase/server-client';
import type { NflMatchupRow } from './types';

/**
 * Nome da única tabela em que os `Dados_Matchup_NFL` podem ser gravados.
 * Isolar o nome em uma constante torna explícito que a persistência nunca
 * alcança `species`/`athletes`/roster (R10.1, R10.5).
 */
export const NFL_MATCHUP_TABLE = 'nfl_matchup_data' as const;

/** Coluna de chave natural, alvo do `ON CONFLICT` do upsert idempotente (R10.3). */
export const NFL_MATCHUP_CONFLICT_TARGET = 'natural_key' as const;

/**
 * Fonte canônica dos `Dados_Matchup_NFL`. Usada como padrão quando a linha
 * não informa `source`, garantindo a identificação da origem em todo registro
 * (R10.2).
 */
export const NFL_MATCHUP_SOURCE = 'https://nfl.balldontlie.io' as const;

/** Tamanho padrão de lote para o upsert em bloco. */
const DEFAULT_BATCH_SIZE = 500;

/**
 * Dependências injetáveis de {@link upsertNflMatchups}. Em produção, o cliente
 * é criado via {@link createServerClient}; os testes podem fornecer um dublê
 * para evitar I/O real.
 */
export interface UpsertNflMatchupsDeps {
  /** Cliente Supabase service-role (padrão: {@link createServerClient}). */
  readonly client?: SupabaseClient;
  /** Tamanho de lote para o upsert (padrão: {@link DEFAULT_BATCH_SIZE}). */
  readonly batchSize?: number;
  /** Relógio injetável; retorna o instante de captura (padrão: `Date.now`). */
  readonly now?: () => Date;
}

/**
 * Normaliza uma linha de matchup para persistência, carimbando `captured_at`
 * em UTC (ISO 8601) e assegurando a `source` (R10.2).
 *
 * - `captured_at`: quando ausente/vazio, usa o instante atual; qualquer valor
 *   informado é reinterpretado para o formato ISO 8601 em UTC
 *   (`Date#toISOString`), de modo que o fuso jamais fique implícito.
 * - `source`: quando ausente/vazio, assume {@link NFL_MATCHUP_SOURCE}.
 *
 * A `payload` e os esquemas de ofensa/defesa são preservados fielmente.
 */
function normalizeRow(row: NflMatchupRow, capturedAtDefault: Date): NflMatchupRow {
  const capturedRaw = typeof row.captured_at === 'string' ? row.captured_at.trim() : '';
  let capturedAt: string;
  if (capturedRaw === '') {
    capturedAt = capturedAtDefault.toISOString();
  } else {
    const parsed = new Date(capturedRaw);
    // Reinterpreta em UTC; se o valor não for uma data válida, cai no instante atual.
    capturedAt = Number.isNaN(parsed.getTime())
      ? capturedAtDefault.toISOString()
      : parsed.toISOString();
  }

  const sourceRaw = typeof row.source === 'string' ? row.source.trim() : '';
  const source = sourceRaw === '' ? NFL_MATCHUP_SOURCE : sourceRaw;

  return {
    natural_key: row.natural_key,
    offense_scheme: row.offense_scheme,
    defense_scheme: row.defense_scheme,
    payload: row.payload,
    captured_at: capturedAt,
    source,
  };
}

/**
 * Faz o upsert idempotente dos `Dados_Matchup_NFL` em `nfl_matchup_data`.
 *
 * Comportamento (R10.1, R10.2, R10.3, R10.5):
 * - Grava **somente** na tabela {@link NFL_MATCHUP_TABLE}; nenhuma linha é
 *   escrita como atleta/espécie/roster (R10.1, R10.5).
 * - Usa `ON CONFLICT (natural_key)` (via `upsert(..., { onConflict })`) para
 *   que a reexecução atualize em vez de duplicar (R10.3).
 * - Carimba `captured_at` em UTC (ISO 8601) e assegura a `source` em cada
 *   linha antes de escrever (R10.2).
 * - Entradas inválidas (sem `natural_key`) são rejeitadas e reportadas em
 *   `rejected`, sem interromper as demais.
 *
 * O upsert em bloco não distingue, por padrão, inserções de atualizações; por
 * isso o resultado contabiliza as linhas efetivamente gravadas em `inserted`
 * (semântica de "linhas afetadas") e mantém `updated` em zero. A idempotência
 * é garantida pela chave natural, não pela contagem.
 *
 * @param rows Linhas de matchup a persistir.
 * @param deps Dependências injetáveis (cliente, lote, relógio) para teste.
 * @returns {@link UpsertResult} com totais e eventuais rejeições.
 */
export async function upsertNflMatchups(
  rows: NflMatchupRow[],
  deps: UpsertNflMatchupsDeps = {},
): Promise<UpsertResult> {
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize && deps.batchSize > 0 ? Math.floor(deps.batchSize) : DEFAULT_BATCH_SIZE;

  const rejected: UpsertResult['rejected'] = [];
  const valid: NflMatchupRow[] = [];

  for (const row of rows) {
    const key = typeof row.natural_key === 'string' ? row.natural_key.trim() : '';
    if (key === '') {
      rejected.push({
        kind: NFL_MATCHUP_TABLE,
        key: row.natural_key,
        reason: 'natural_key ausente ou vazia',
      });
      continue;
    }
    valid.push(normalizeRow(row, now()));
  }

  if (valid.length === 0) {
    return { inserted: 0, updated: 0, rejected };
  }

  const client = deps.client ?? createServerClient();

  let inserted = 0;
  for (let start = 0; start < valid.length; start += batchSize) {
    const batch = valid.slice(start, start + batchSize);
    const { data, error } = await client
      .from(NFL_MATCHUP_TABLE)
      .upsert(batch, { onConflict: NFL_MATCHUP_CONFLICT_TARGET })
      .select('natural_key');

    if (error !== null) {
      // Falha de lote: registra o motivo por linha do lote e mantém os lotes
      // já confirmados, sem interromper o relatório final (R7.4-análogo).
      for (const row of batch) {
        rejected.push({
          kind: NFL_MATCHUP_TABLE,
          key: row.natural_key,
          reason: error.message,
        });
      }
      continue;
    }

    inserted += Array.isArray(data) ? data.length : batch.length;
  }

  return { inserted, updated: 0, rejected };
}
