import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O escritor inicia com `import 'server-only'`, que lança fora de um contexto
 * de servidor Next/RSC. Sob Vitest neutralizamos essa guarda com um stub, sem
 * alterar o comportamento testado (as escritas recebem um cliente injetado).
 */
vi.mock('server-only', () => ({}));

import {
  DESIGN_BASELINE_CONFLICT_TARGET,
  DESIGN_BASELINE_TABLE,
  upsertDesignBaseline,
} from './writer';
import type { DesignBaselineRow } from './types';

/**
 * Testes de exemplo e de propriedade para a escrita do Baseline_Design (Task
 * 5.3).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4_
 *
 * O upsert registra, sob a `version` do arquivo, os 36 matchups
 * (`kind='matchups_36'`) e os parâmetros (`kind='simulation_parameters'`) com
 * `ON CONFLICT (version, kind)`. O `payload` é preservado fiel (R11.1, R11.2),
 * o `status` legível (R11.3) e a reexecução atualiza o par em vez de duplicá-lo
 * (R11.4).
 */

// ---------------------------------------------------------------------------
// Fake de Supabase em memória: suporta `from().upsert(rows,{onConflict})
// .select(target)`, gravando por chave composta `(version, kind)` — espelhando
// a PK composta da tabela `design_baseline`.
// ---------------------------------------------------------------------------

function makeFakeClient(): {
  client: SupabaseClient;
  store: Map<string, Record<string, unknown>>;
} {
  const store = new Map<string, Record<string, unknown>>();

  const client = {
    from(_table: string) {
      return {
        upsert(
          rows: Record<string, unknown>[],
          opts: { onConflict: string },
        ) {
          const keyCols = opts.onConflict.split(',');
          for (const row of rows) {
            const key = keyCols.map((c) => String(row[c])).join(':');
            store.set(key, row);
          }
          return {
            select() {
              return Promise.resolve({
                data: rows.map(() => ({})),
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, store };
}

const VERSION = 'D1-design-2026-10-09';

describe('upsertDesignBaseline — registro versionado dos artefatos (R11.1–R11.4)', () => {
  it('grava os dois kind sob a mesma version, preservando payload e status', async () => {
    const { client, store } = makeFakeClient();
    const matchupsPayload = {
      matchups: [{ offense: 'A', defense: 'B', offense_probability_delta: 0.1 }],
    };
    const paramsPayload = { tick_ms: 100, seed_mode: 'deterministic' };

    const rows: DesignBaselineRow[] = [
      {
        version: VERSION,
        kind: 'matchups_36',
        status: 'PROPOSED_BALANCE_VALUE',
        payload: matchupsPayload,
      },
      {
        version: VERSION,
        kind: 'simulation_parameters',
        status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
        payload: paramsPayload,
      },
    ];

    const result = await upsertDesignBaseline(rows, { client });

    expect(result.inserted).toBe(2);
    expect(result.rejected).toHaveLength(0);
    expect(store.size).toBe(2);

    const matchups = store.get(`${VERSION}:matchups_36`);
    expect(matchups?.status).toBe('PROPOSED_BALANCE_VALUE');
    expect(matchups?.payload).toEqual(matchupsPayload);

    const params = store.get(`${VERSION}:simulation_parameters`);
    expect(params?.status).toBe(
      'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
    );
    expect(params?.payload).toEqual(paramsPayload);
  });

  it('é idempotente: reaplicar a mesma version/kind atualiza em vez de duplicar', async () => {
    const { client, store } = makeFakeClient();
    const first: DesignBaselineRow = {
      version: VERSION,
      kind: 'matchups_36',
      status: 'PROPOSED_BALANCE_VALUE',
      payload: { v: 1 },
    };
    const updated: DesignBaselineRow = {
      ...first,
      status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
      payload: { v: 2 },
    };

    await upsertDesignBaseline([first], { client });
    await upsertDesignBaseline([updated], { client });

    expect(store.size).toBe(1);
    const row = store.get(`${VERSION}:matchups_36`);
    expect(row?.status).toBe(
      'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
    );
    expect(row?.payload).toEqual({ v: 2 });
  });

  it('usa a chave composta (version, kind) como alvo do ON CONFLICT', () => {
    expect(DESIGN_BASELINE_CONFLICT_TARGET).toBe('version,kind');
    expect(DESIGN_BASELINE_TABLE).toBe('design_baseline');
  });

  it('rejeita linhas sem version/kind legível sem interromper as demais', async () => {
    const { client, store } = makeFakeClient();
    const rows = [
      { version: '', kind: 'matchups_36', status: 's', payload: {} },
      {
        version: VERSION,
        kind: '',
        status: 's',
        payload: {},
      },
      {
        version: VERSION,
        kind: 'simulation_parameters',
        status: 'ok',
        payload: { ok: true },
      },
    ] as unknown as DesignBaselineRow[];

    const result = await upsertDesignBaseline(rows, { client });

    expect(result.inserted).toBe(1);
    expect(result.rejected).toHaveLength(2);
    expect(store.size).toBe(1);
    for (const r of result.rejected) {
      expect(r.reason).toContain('ausente ou inválida');
    }
  });
});

// ---------------------------------------------------------------------------
// Property test: idempotência do upsert por (version, kind) — aplicar uma vez
// e N vezes converge ao mesmo estado final sem duplicatas (Property 6).
// ---------------------------------------------------------------------------

describe('Feature: pfl-data-catalog, Idempotência do Baseline_Design (R11.4)', () => {
  it('aplicar o upsert 1x e Nx produz o mesmo estado, sem duplicar por (version, kind)', () => {
    const kindArb = fc.constantFrom(
      'matchups_36' as const,
      'simulation_parameters' as const,
    );
    const rowArb = fc.record({
      version: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ''),
      kind: kindArb,
      status: fc.string({ minLength: 1, maxLength: 20 }),
      payload: fc.object({ maxDepth: 2 }),
    });

    fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { maxLength: 20 }),
        fc.integer({ min: 2, max: 5 }),
        async (rows, repeats) => {
          const typedRows = rows as DesignBaselineRow[];

          // Estado-alvo: um registro por par (version, kind), o último vence.
          const expected = new Map<string, DesignBaselineRow>();
          for (const r of typedRows) {
            expected.set(`${r.version}:${r.kind}`, r);
          }

          const { client, store } = makeFakeClient();
          for (let i = 0; i < repeats; i += 1) {
            await upsertDesignBaseline(typedRows, { client });
          }

          // Sem duplicatas: tamanho igual ao de pares distintos.
          expect(store.size).toBe(expected.size);
          // Convergência campo a campo para o último valor de cada par.
          for (const [key, row] of expected) {
            const stored = store.get(key);
            expect(stored?.status).toBe(row.status);
            expect(stored?.payload).toEqual(row.payload);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
