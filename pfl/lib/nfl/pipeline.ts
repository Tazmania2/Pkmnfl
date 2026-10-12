/**
 * Definição do pipeline de endpoints da ingestão NFL (`Ingestao_NFL`,
 * spec `pfl-data-catalog`).
 *
 * Centraliza quais endpoints da API `nfl.balldontlie.io` são consumidos e como
 * cada resposta é mapeada para `NflMatchupRow[]`. Mantido separado do
 * orquestrador ({@link runNflIngestion}) para que a lista de endpoints evolua
 * sem tocar na lógica de resiliência/persistência.
 *
 * O mapeamento é defensivo: respostas em formato inesperado produzem uma lista
 * vazia (ou um erro capturado pelo orquestrador), nunca linhas malformadas. A
 * chave natural combina o esquema ofensivo, o defensivo e a temporada para
 * garantir idempotência por `natural_key` (R10.3).
 *
 * _Requirements: 9.5, 10.1, 10.2, 10.3_
 */

import { NFL_MATCHUP_SOURCE } from './persist';
import type { NflEndpoint } from './ingest';
import type { NflMatchupRow } from './types';

/** Record genérico cujo acesso a chaves é seguro para `unknown`. */
type UnknownRecord = Record<string, unknown>;

/** Verifica se `value` é um objeto não nulo (não array). */
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lê um campo string de um registro, retornando `''` quando ausente. */
function readString(record: UnknownRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Extrai o array de itens de uma resposta paginada típica da API_NFL
 * (`{ data: [...] }`) ou aceita um array direto no topo.
 */
function extractItems(data: unknown): UnknownRecord[] {
  const source = isRecord(data) && Array.isArray(data['data']) ? data['data'] : data;
  if (!Array.isArray(source)) {
    return [];
  }
  return source.filter(isRecord);
}

/**
 * Mapeia uma resposta de matchups ofensiva×defensiva em `NflMatchupRow[]`.
 *
 * Cada item deve expor `offense_scheme`/`defense_scheme` (ou `offense`/
 * `defense`) e, opcionalmente, `season`. A `natural_key` é
 * `offense|defense|season`; o `payload` preserva o item bruto fielmente; a
 * `source` padrão é {@link NFL_MATCHUP_SOURCE}. `captured_at` fica vazio para
 * que a persistência carimbe o instante atual em UTC (R10.2).
 */
export function mapMatchups(data: unknown): NflMatchupRow[] {
  const items = extractItems(data);
  const rows: NflMatchupRow[] = [];

  for (const item of items) {
    const offense = readString(item, 'offense_scheme') || readString(item, 'offense');
    const defense = readString(item, 'defense_scheme') || readString(item, 'defense');
    if (offense === '' || defense === '') {
      // Item sem esquemas identificáveis: ignorado (não gera linha inválida).
      continue;
    }
    const season = readString(item, 'season');
    const naturalKey = season === '' ? `${offense}|${defense}` : `${offense}|${defense}|${season}`;

    rows.push({
      natural_key: naturalKey,
      offense_scheme: offense,
      defense_scheme: defense,
      payload: item,
      captured_at: '',
      source: NFL_MATCHUP_SOURCE,
    });
  }

  return rows;
}

/**
 * Pipeline padrão de endpoints da ingestão NFL.
 *
 * A lista pode ser estendida conforme novos recursos da API forem necessários;
 * o orquestrador trata cada endpoint de forma independente e resiliente.
 */
export const DEFAULT_NFL_PIPELINE: readonly NflEndpoint[] = [
  { name: 'matchups', path: '/matchups', map: mapMatchups },
];
