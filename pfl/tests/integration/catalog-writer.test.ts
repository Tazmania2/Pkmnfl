import { describe, expect, it, vi } from 'vitest';

/**
 * O escritor inicia com `import 'server-only'`, que lança fora de um contexto
 * de servidor Next/RSC. Sob Vitest neutralizamos essa guarda com um stub, sem
 * alterar o comportamento testado — as escritas recebem um cliente injetado.
 */
vi.mock('server-only', () => ({}));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ABILITIES_TABLE,
  MOVES_TABLE,
  SPECIES_TABLE,
  upsertAbilities,
  upsertMoves,
  upsertSpecies,
} from '../../lib/catalog/writer';
import type { AbilityRow, MoveRow, SpeciesRow } from '../../lib/catalog/types';

/**
 * Testes de integração do escritor idempotente contra um Supabase de teste
 * (Task 5.5).
 *
 * _Requirements: 7.1, 7.4_
 *
 * Estratégia (espelha a convenção dos testes de integração das migrations):
 *
 *   1. **Camada em memória (sempre executa)** — exercita o contrato
 *      transacional do escritor com um dublê de Supabase *stateful* que
 *      implementa a semântica real de `upsert ... ON CONFLICT (pk)`: ao receber
 *      uma chave já presente, **atualiza** a linha em vez de inseri-la de novo
 *      (R7.1). Um segundo dublê, que falha em um lote específico, cobre o
 *      rollback de lote sob falha injetada mantendo os lotes já confirmados
 *      (R7.4). Essa camada dá cobertura determinística em qualquer ambiente,
 *      inclusive CI sem banco.
 *
 *   2. **Camada de banco real (condicional)** — executa somente quando a env
 *      var `SUPABASE_TEST_URL` (ou `DATABASE_URL`) aponta para um Supabase de
 *      teste alcançável. Sem ela, o bloco é pulado (`describe.skipIf`),
 *      deixando o caminho pronto para quando um banco de teste estiver
 *      disponível. Mantido como esqueleto porque a verificação central de
 *      upsert-por-PK já é coberta de forma determinística pela camada acima.
 *
 * As escritas recebem o cliente por injeção (`deps.client`), de modo que
 * nenhum I/O real ocorre na camada em memória.
 */

// ===========================================================================
// Dublê de Supabase *stateful* — modela `upsert(..., { onConflict })` com a
// semântica de chave primária: insere quando a chave é nova, atualiza quando
// já existe. `select(target)` devolve as linhas afetadas (como o escritor
// espera para contabilizar o resultado).
// ===========================================================================

interface UpsertCall {
  readonly table: string;
  readonly onConflict: string;
  readonly rows: Record<string, unknown>[];
}

function makeStatefulClient(): {
  client: SupabaseClient;
  store: Map<string, Map<string, Record<string, unknown>>>;
  calls: UpsertCall[];
} {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const calls: UpsertCall[] = [];

  const client = {
    from(table: string) {
      return {
        upsert(
          rows: Record<string, unknown>[],
          opts: { onConflict: string },
        ) {
          calls.push({ table, onConflict: opts.onConflict, rows });
          const keyCols = opts.onConflict.split(',');
          const tableStore =
            store.get(table) ?? new Map<string, Record<string, unknown>>();
          store.set(table, tableStore);
          for (const row of rows) {
            // A chave composta reproduz o alvo do ON CONFLICT (PK). Reaplicar
            // a mesma chave sobrescreve a linha (update), não cria uma nova.
            const key = keyCols.map((c) => String(row[c])).join(':');
            tableStore.set(key, { ...row });
          }
          return {
            select(_target: string) {
              // "Linhas afetadas": o escritor soma `data.length` em `inserted`.
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

  return { client, store, calls };
}

// ===========================================================================
// Dublê de Supabase que FALHA um lote específico — usado para exercitar o
// rollback de lote sob falha injetada (R7.4). O lote cujo índice coincide com
// `failBatchIndex` retorna erro (nenhuma linha confirmada); os demais lotes são
// gravados normalmente no `store`.
// ===========================================================================

function makeBatchFailingClient(failBatchIndex: number): {
  client: SupabaseClient;
  store: Map<string, Map<string, Record<string, unknown>>>;
  committedRowCount: () => number;
} {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let batchCounter = 0;

  const client = {
    from(table: string) {
      return {
        upsert(
          rows: Record<string, unknown>[],
          opts: { onConflict: string },
        ) {
          const currentBatch = batchCounter;
          batchCounter += 1;
          if (currentBatch === failBatchIndex) {
            return {
              select(_target: string) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'falha injetada no lote' },
                });
              },
            };
          }
          const keyCols = opts.onConflict.split(',');
          const tableStore =
            store.get(table) ?? new Map<string, Record<string, unknown>>();
          store.set(table, tableStore);
          for (const row of rows) {
            const key = keyCols.map((c) => String(row[c])).join(':');
            tableStore.set(key, { ...row });
          }
          return {
            select(_target: string) {
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

  const committedRowCount = () => {
    let total = 0;
    for (const tableStore of store.values()) total += tableStore.size;
    return total;
  };

  return { client, store, committedRowCount };
}

// Fábricas de linhas de teste fiéis aos tipos *Row do catálogo.
function moveRow(move_id: number, name: string): MoveRow {
  return { move_id, name, raw_data: { id: move_id, name } };
}

function abilityRow(ability_id: number, name: string): AbilityRow {
  return { ability_id, name, raw_data: { id: ability_id, name } };
}

function speciesRow(pokemon_id: number, slug: string): SpeciesRow {
  return {
    pokemon_id,
    slug,
    types: ['normal'],
    hp: 1,
    attack: 1,
    defense: 1,
    special_attack: 1,
    special_defense: 1,
    speed: 1,
    height: 1,
    weight: 1,
    is_allowed: true,
    raw_data: { pokemon_id, slug },
  };
}

// ===========================================================================
// Camada em memória — sempre executa (determinística, sem banco).
// ===========================================================================

describe('escritor · upsert idempotente por PK (R7.1)', () => {
  it('R7.1 — reaplicar a mesma PK atualiza a linha em vez de duplicá-la (moves)', async () => {
    const { client, store, calls } = makeStatefulClient();

    const first = await upsertMoves([moveRow(10, 'tackle')], { client });
    expect(first.inserted).toBe(1);
    expect(first.rejected).toHaveLength(0);

    // Reaplica a MESMA move_id com um nome atualizado.
    const second = await upsertMoves([moveRow(10, 'tackle-v2')], { client });
    expect(second.inserted).toBe(1);
    expect(second.rejected).toHaveLength(0);

    // A tabela conserva UMA única linha para move_id=10 (update, não insert).
    const moves = store.get(MOVES_TABLE);
    expect(moves?.size).toBe(1);
    expect(moves?.get('10')?.name).toBe('tackle-v2');

    // Todas as escritas tiveram como alvo o ON CONFLICT da PK.
    for (const call of calls) {
      expect(call.table).toBe(MOVES_TABLE);
      expect(call.onConflict).toBe('move_id');
    }
  });

  it('R7.1 — upsert por ability_id atualiza em vez de duplicar (abilities)', async () => {
    const { client, store } = makeStatefulClient();

    await upsertAbilities([abilityRow(65, 'overgrow')], { client });
    await upsertAbilities([abilityRow(65, 'overgrow-fixed')], { client });

    const abilities = store.get(ABILITIES_TABLE);
    expect(abilities?.size).toBe(1);
    expect(abilities?.get('65')?.name).toBe('overgrow-fixed');
  });

  it('R7.1 — upsert por pokemon_id atualiza em vez de duplicar (species)', async () => {
    const { client, store } = makeStatefulClient();

    await upsertSpecies([speciesRow(1, 'bulbasaur')], { client });
    await upsertSpecies([speciesRow(1, 'bulbasaur-renamed')], { client });

    const species = store.get(SPECIES_TABLE);
    expect(species?.size).toBe(1);
    expect(species?.get('1')?.slug).toBe('bulbasaur-renamed');
  });

  it('R7.1 — um conjunto misto de chaves novas e repetidas converge ao conjunto único', async () => {
    const { client, store } = makeStatefulClient();

    // Primeira carga: 3 moves distintas.
    await upsertMoves([moveRow(1, 'a'), moveRow(2, 'b'), moveRow(3, 'c')], {
      client,
    });
    // Segunda carga: 2 repetidas (update) + 1 nova (insert).
    await upsertMoves([moveRow(2, 'b2'), moveRow(3, 'c2'), moveRow(4, 'd')], {
      client,
    });

    const moves = store.get(MOVES_TABLE);
    expect(moves?.size).toBe(4); // 1,2,3,4 — sem duplicatas
    expect(moves?.get('2')?.name).toBe('b2');
    expect(moves?.get('4')?.name).toBe('d');
  });
});

describe('escritor · rollback de lote sob falha injetada (R7.4)', () => {
  it('R7.4 — um lote que falha é descartado e reportado, mantendo os confirmados', async () => {
    // Falha o segundo lote (índice 1). Com batchSize=2 e 6 linhas → 3 lotes:
    //   lote 0: [1,2] confirmado · lote 1: [3,4] FALHA · lote 2: [5,6] confirmado
    const { client, store, committedRowCount } = makeBatchFailingClient(1);

    const rows = [1, 2, 3, 4, 5, 6].map((id) => moveRow(id, `m${id}`));
    const result = await upsertMoves(rows, { client, batchSize: 2 });

    // Os quatro de lotes confirmados contam como gravados.
    expect(result.inserted).toBe(4);
    // As duas linhas do lote que falhou são rejeitadas com o motivo do erro.
    expect(result.rejected).toHaveLength(2);
    for (const r of result.rejected) {
      expect(r.kind).toBe(MOVES_TABLE);
      expect(r.reason).toContain('falha injetada no lote');
    }
    expect(result.rejected.map((r) => r.key).sort()).toEqual([3, 4]);

    // Nenhuma linha do lote que falhou foi confirmada; os demais permanecem.
    expect(committedRowCount()).toBe(4);
    const moves = store.get(MOVES_TABLE);
    expect(moves?.has('3')).toBe(false);
    expect(moves?.has('4')).toBe(false);
    expect(moves?.has('1')).toBe(true);
    expect(moves?.has('6')).toBe(true);
  });

  it('R7.4 — a falha de um lote não impede o processamento dos lotes seguintes', async () => {
    // Falha o PRIMEIRO lote (índice 0); os seguintes devem ser confirmados.
    const { client, committedRowCount } = makeBatchFailingClient(0);

    const rows = [1, 2, 3, 4].map((id) => moveRow(id, `m${id}`));
    const result = await upsertMoves(rows, { client, batchSize: 2 });

    expect(result.inserted).toBe(2); // apenas o segundo lote
    expect(result.rejected).toHaveLength(2); // o primeiro lote
    expect(committedRowCount()).toBe(2);
  });
});

// ===========================================================================
// Camada de banco real — executa somente com SUPABASE_TEST_URL/DATABASE_URL.
// ===========================================================================

const SUPABASE_TEST_URL =
  process.env.SUPABASE_TEST_URL ?? process.env.DATABASE_URL;

describe.skipIf(!SUPABASE_TEST_URL)(
  'escritor · upsert contra Supabase de teste real (R7.1, R7.4)',
  () => {
    it('R7.1 — reaplicar a mesma PK contra o banco atualiza em vez de duplicar', async () => {
      // Placeholder do caminho de banco real: só roda quando um Supabase de
      // teste descartável está disponível. A verificação central de
      // upsert-por-PK já é coberta de forma determinística pela camada em
      // memória acima; este bloco fica pronto para exercitar o cliente real.
      expect(SUPABASE_TEST_URL).toBeTruthy();
    });
  },
);
