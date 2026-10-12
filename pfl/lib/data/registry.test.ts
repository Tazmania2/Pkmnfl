import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getAbility, getMove } from './registry';

/**
 * Testes de exemplo da camada de leitura do registro (Task 13.5).
 *
 * Cobrem o contrato de `getMove`/`getAbility`:
 * - retornam o registro com `raw_data` fiel (Req. 12.5);
 * - identificador inexistente → `Result.found = false`, sem lançar (Req. 12.6);
 * - a consulta é somente leitura e o registro permanece disponível para novas
 *   consultas (Req. 12.8).
 *
 * O cliente Supabase é injetado como stub: a cadeia
 * `.from().select().eq().maybeSingle()` é modelada por um construtor de query
 * que resolve com `{ data, error }` controlados, sem qualquer I/O real.
 */

type MaybeSingleResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
};

/**
 * Constrói um stub de SupabaseClient que registra as tabelas e filtros usados
 * e resolve `maybeSingle()` conforme um resolvedor fornecido por tabela.
 */
function makeStubClient(
  resolver: (table: string, column: string, value: unknown) => MaybeSingleResult,
): { client: SupabaseClient; calls: Array<{ table: string; column: string; value: unknown }> } {
  const calls: Array<{ table: string; column: string; value: unknown }> = [];

  const from = vi.fn((table: string) => {
    let selected = '';
    const builder = {
      select(cols: string) {
        selected = cols;
        return builder;
      },
      eq(column: string, value: unknown) {
        void selected;
        return {
          async maybeSingle() {
            calls.push({ table, column, value });
            return resolver(table, column, value);
          },
        };
      },
    };
    return builder;
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, calls };
}

describe('getMove', () => {
  it('retorna o golpe com raw_data fiel quando existe (R12.5)', async () => {
    const rawData = {
      id: 85,
      name: 'thunderbolt',
      power: 90,
      accuracy: 100,
      meta: { ailment: { name: 'paralysis' }, ailment_chance: 10 },
      nested: { a: [1, 2, { b: null }] },
    };
    const { client } = makeStubClient(() => ({
      data: { move_id: 85, name: 'thunderbolt', raw_data: rawData },
      error: null,
    }));

    const result = await getMove(85, client);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.value.move_id).toBe(85);
    expect(result.value.name).toBe('thunderbolt');
    // raw_data reconstruído campo a campo, sem conversão.
    expect(result.value.raw_data).toEqual(rawData);
  });

  it('retorna found:false para move_id inexistente, sem lançar (R12.6)', async () => {
    const { client } = makeStubClient(() => ({ data: null, error: null }));

    const result = await getMove(999999, client);

    expect(result.found).toBe(false);
  });

  it('trata o código PostgREST de "nenhuma linha" como ausência (R12.6)', async () => {
    const { client } = makeStubClient(() => ({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    }));

    const result = await getMove(123, client);

    expect(result.found).toBe(false);
  });

  it('permanece disponível para novas consultas após uma ausência (R12.8)', async () => {
    const { client, calls } = makeStubClient((_table, _column, value) => {
      if (value === 1) return { data: null, error: null };
      return {
        data: { move_id: 2, name: 'tackle', raw_data: { id: 2, name: 'tackle', power: 40 } },
        error: null,
      };
    });

    const miss = await getMove(1, client);
    expect(miss.found).toBe(false);

    // Nova consulta logo em seguida ainda funciona (leitura não invalida nada).
    const hit = await getMove(2, client);
    expect(hit.found).toBe(true);
    if (hit.found) {
      expect(hit.value.name).toBe('tackle');
    }
    expect(calls).toHaveLength(2);
  });

  it('consulta a tabela moves filtrando por move_id (somente leitura, R12.8)', async () => {
    const { client, calls } = makeStubClient(() => ({
      data: { move_id: 10, name: 'scratch', raw_data: {} },
      error: null,
    }));

    await getMove(10, client);

    expect(calls).toEqual([{ table: 'moves', column: 'move_id', value: 10 }]);
  });

  it('propaga erro real da consulta (não é um simples "não encontrado")', async () => {
    const { client } = makeStubClient(() => ({
      data: null,
      error: { code: 'XXYYZ', message: 'db unavailable' },
    }));

    await expect(getMove(1, client)).rejects.toMatchObject({ code: 'XXYYZ' });
  });
});

describe('getAbility', () => {
  it('retorna a habilidade com raw_data fiel quando existe (R12.5)', async () => {
    const rawData = {
      id: 26,
      name: 'levitate',
      effect_entries: [{ effect: 'Immune to Ground moves.', language: { name: 'en' } }],
      history: [{ generation: 'iii' }],
    };
    const { client } = makeStubClient(() => ({
      data: { ability_id: 26, name: 'levitate', raw_data: rawData },
      error: null,
    }));

    const result = await getAbility(26, client);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.value.ability_id).toBe(26);
    expect(result.value.name).toBe('levitate');
    expect(result.value.raw_data).toEqual(rawData);
  });

  it('retorna found:false para ability_id inexistente, sem lançar (R12.6)', async () => {
    const { client } = makeStubClient(() => ({ data: null, error: null }));

    const result = await getAbility(424242, client);

    expect(result.found).toBe(false);
  });

  it('consulta a tabela abilities filtrando por ability_id (R12.8)', async () => {
    const { client, calls } = makeStubClient(() => ({
      data: { ability_id: 65, name: 'overgrow', raw_data: {} },
      error: null,
    }));

    await getAbility(65, client);

    expect(calls).toEqual([{ table: 'abilities', column: 'ability_id', value: 65 }]);
  });
});
