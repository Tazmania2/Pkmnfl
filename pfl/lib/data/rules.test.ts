import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DesignBaselineRow } from '../catalog/types';
import type { NflMatchupRow } from '../nfl/types';
import { getDesignBaseline, getNflMatchups } from './rules';

/**
 * Testes de exemplo da camada de leitura dos dados de regras (Task 13.8).
 *
 * Cobrem o contrato de disponibilidade das consultas de regras (Req. 12.7):
 * `getNflMatchups` e `getDesignBaseline` retornam exatamente o que está
 * persistido no Supabase, lendo somente das tabelas `nfl_matchup_data` e
 * `design_baseline` — sem acionar a API_NFL nem ler arquivos do catálogo.
 *
 * O cliente Supabase é injetado como dublê em memória que modela fielmente a
 * cadeia de query-builder usada por `rules.ts`:
 * - `from(table).select(cols).order(col, opts)` (matchups), e
 * - `from(table).select(cols).order(...).order(...).limit(n)[.eq(col, val)]`
 *   (baseline).
 * O resultado da cadeia é "thenable" (`await query`), resolvendo com
 * `{ data, error }` controlados, sem qualquer I/O real.
 */

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

interface RecordedCall {
  readonly table: string;
  readonly columns: string;
  readonly orders: Array<{ column: string; ascending: boolean | undefined }>;
  readonly limit: number | null;
  readonly eq: Array<{ column: string; value: unknown }>;
}

/**
 * Constrói um dublê de SupabaseClient que registra a tabela, as colunas
 * projetadas, os `order`, o `limit` e os `eq` aplicados, e resolve a cadeia
 * (via `then`) com o resultado fornecido pelo resolvedor por tabela.
 *
 * Cada elo da cadeia (`.order`, `.limit`, `.eq`) é ele próprio "thenable",
 * replicando o fato de que `rules.ts` ora aguarda após `.order()` (matchups),
 * ora após `.limit()` ou `.eq()` (baseline).
 */
function makeFakeClient(
  resolver: (table: string) => QueryResult<Record<string, unknown>>,
): { client: SupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const call: RecordedCall = {
      table,
      columns: '',
      orders: [],
      limit: null,
      eq: [],
    };
    calls.push(call);

    // Objeto encadeável e aguardável que compartilha o mesmo `call`.
    const builder = {
      select(cols: string) {
        (call as { columns: string }).columns = cols;
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        call.orders.push({ column, ascending: opts?.ascending });
        return builder;
      },
      limit(n: number) {
        (call as { limit: number | null }).limit = n;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eq.push({ column, value });
        return builder;
      },
      // Torna a cadeia aguardável em qualquer ponto após `.order()`.
      then<TResult1 = QueryResult<Record<string, unknown>>>(
        onfulfilled?: (value: QueryResult<Record<string, unknown>>) => TResult1,
      ) {
        const result = resolver(table);
        return Promise.resolve(result).then(onfulfilled);
      },
    };

    return builder;
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, calls };
}

describe('getNflMatchups', () => {
  const persisted: NflMatchupRow[] = [
    {
      natural_key: 'air-raid|cover-2|2024',
      offense_scheme: 'air-raid',
      defense_scheme: 'cover-2',
      payload: { snaps: 120, success_rate: 0.47 },
      captured_at: '2024-06-01T00:00:00.000Z',
      source: 'https://nfl.balldontlie.io',
    },
    {
      natural_key: 'west-coast|cover-3|2024',
      offense_scheme: 'west-coast',
      defense_scheme: 'cover-3',
      payload: { snaps: 98, success_rate: 0.51 },
      captured_at: '2024-06-01T00:00:00.000Z',
      source: 'https://nfl.balldontlie.io',
    },
  ];

  it('retorna exatamente os Dados_Matchup_NFL persistidos (R12.7)', async () => {
    const { client } = makeFakeClient(() => ({
      data: persisted.map((r) => ({ ...r })),
      error: null,
    }));

    const rows = await getNflMatchups({ client });

    expect(rows).toEqual(persisted);
  });

  it('lê somente de nfl_matchup_data, ordenando por natural_key (R12.8/R10.4)', async () => {
    const { client, calls } = makeFakeClient(() => ({ data: [], error: null }));

    await getNflMatchups({ client });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.table).toBe('nfl_matchup_data');
    expect(call?.orders).toEqual([{ column: 'natural_key', ascending: true }]);
  });

  it('retorna lista vazia quando não há matchups persistidos', async () => {
    const { client } = makeFakeClient(() => ({ data: [], error: null }));

    const rows = await getNflMatchups({ client });

    expect(rows).toEqual([]);
  });

  it('trata data nulo como ausência de linhas (lista vazia)', async () => {
    const { client } = makeFakeClient(() => ({ data: null, error: null }));

    const rows = await getNflMatchups({ client });

    expect(rows).toEqual([]);
  });

  it('propaga erro da consulta como exceção', async () => {
    const { client } = makeFakeClient(() => ({
      data: null,
      error: { message: 'db unavailable' },
    }));

    await expect(getNflMatchups({ client })).rejects.toThrow(/nfl_matchup_data/);
  });
});

describe('getDesignBaseline', () => {
  const latest: DesignBaselineRow = {
    version: '1.7.0',
    kind: 'matchups_36',
    status: 'PROPOSED_BALANCE_VALUE',
    payload: { matchups: 36 },
  };

  it('retorna o Baseline_Design persistido mais recente quando não há versão (R12.7)', async () => {
    const { client } = makeFakeClient(() => ({
      data: [{ ...latest, created_at: '2024-06-01T00:00:00.000Z' }],
      error: null,
    }));

    const row = await getDesignBaseline(undefined, { client });

    expect(row).toEqual(latest);
  });

  it('lê somente de design_baseline, com ordenação e limite 1 (R12.8/R10.4)', async () => {
    const { client, calls } = makeFakeClient(() => ({
      data: [{ ...latest, created_at: '2024-06-01T00:00:00.000Z' }],
      error: null,
    }));

    await getDesignBaseline(undefined, { client });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.table).toBe('design_baseline');
    expect(call?.orders).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'version', ascending: false },
    ]);
    expect(call?.limit).toBe(1);
    // Sem versão informada, nenhum filtro `eq` é aplicado.
    expect(call?.eq).toEqual([]);
  });

  it('filtra por version quando informada e retorna o persistido (R12.7)', async () => {
    const target: DesignBaselineRow = {
      version: '1.6.0',
      kind: 'simulation_parameters',
      status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
      payload: { seed: 42 },
    };
    const { client, calls } = makeFakeClient(() => ({
      data: [{ ...target, created_at: '2024-05-01T00:00:00.000Z' }],
      error: null,
    }));

    const row = await getDesignBaseline('1.6.0', { client });

    expect(row).toEqual(target);
    expect(calls[0]?.eq).toEqual([{ column: 'version', value: '1.6.0' }]);
  });

  it('ignora version vazia/em branco e não aplica filtro eq', async () => {
    const { client, calls } = makeFakeClient(() => ({
      data: [{ ...latest, created_at: '2024-06-01T00:00:00.000Z' }],
      error: null,
    }));

    await getDesignBaseline('   ', { client });

    expect(calls[0]?.eq).toEqual([]);
  });

  it('retorna null quando nenhum Baseline_Design corresponde', async () => {
    const { client } = makeFakeClient(() => ({ data: [], error: null }));

    const row = await getDesignBaseline(undefined, { client });

    expect(row).toBeNull();
  });

  it('projeta apenas os campos do contrato (sem created_at)', async () => {
    const { client } = makeFakeClient(() => ({
      data: [{ ...latest, created_at: '2024-06-01T00:00:00.000Z' }],
      error: null,
    }));

    const row = await getDesignBaseline(undefined, { client });

    expect(row).not.toBeNull();
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['kind', 'payload', 'status', 'version'].sort(),
    );
  });

  it('propaga erro da consulta como exceção', async () => {
    const { client } = makeFakeClient(() => ({
      data: null,
      error: { message: 'rls denied' },
    }));

    await expect(getDesignBaseline(undefined, { client })).rejects.toThrow(/design_baseline/);
  });
});
