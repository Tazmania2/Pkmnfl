import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

/**
 * `persist.ts` inicia com `import 'server-only'`, que lança quando importado
 * fora de um contexto de servidor Next/RSC. Sob Vitest esse contexto não
 * existe, então o módulo é substituído por um stub vazio — apenas a guarda de
 * importação é neutralizada, sem alterar o comportamento sob teste.
 */
vi.mock('server-only', () => ({}));

import {
  NFL_MATCHUP_SOURCE,
  NFL_MATCHUP_TABLE,
  upsertNflMatchups,
} from './persist';
import type { NflMatchupRow } from './types';

/**
 * Teste de propriedade do carimbo UTC e da fonte em todo matchup NFL
 * persistido (Task 12.2).
 *
 * // Feature: pfl-data-catalog, Property 15: Carimbo UTC e fonte em todo matchup NFL
 *
 * **Validates: Requirements 10.2**
 *
 * Para qualquer conjunto de `Dados_Matchup_NFL` persistido com sucesso por
 * {@link upsertNflMatchups}, toda linha efetivamente gravada carrega:
 * - `captured_at` em UTC (ISO 8601 terminando em `Z`, que faz round-trip por
 *   `Date#toISOString`); e
 * - `source` igual a `https://nfl.balldontlie.io` quando a origem não é
 *   informada, preservando qualquer `source` não vazia fornecida.
 *
 * A propriedade usa um repositório em memória (dublê do cliente Supabase)
 * injetado via `deps.client`, capturando exatamente as linhas enviadas ao
 * `upsert`, sem qualquer I/O real.
 */

/**
 * Dublê em memória do cliente Supabase para {@link upsertNflMatchups}.
 *
 * Implementa apenas a cadeia `from(table).upsert(rows, opts).select(cols)`
 * exercida pelo escritor, acumulando as linhas recebidas em `captured` e
 * respondendo sempre com sucesso (`error: null`). Qualquer `from` em tabela
 * diferente de `nfl_matchup_data` falha o teste, reforçando R10.1/R10.5.
 */
function createInMemoryClient() {
  const captured: NflMatchupRow[] = [];
  const tablesTouched = new Set<string>();

  const client = {
    from(table: string) {
      tablesTouched.add(table);
      return {
        upsert(rows: NflMatchupRow[]) {
          for (const row of rows) {
            captured.push(row);
          }
          return {
            select(_cols: string) {
              return Promise.resolve({
                data: rows.map((r) => ({ natural_key: r.natural_key })),
                error: null,
              });
            },
          };
        },
      };
    },
  };

  return { client, captured, tablesTouched };
}

/**
 * Verifica se `value` é uma string ISO 8601 em UTC: termina em `Z` e faz
 * round-trip exato por `Date#toISOString`. Oráculo independente da
 * normalização interna do escritor.
 */
function isUtcIso(value: string): boolean {
  if (!value.endsWith('Z')) {
    return false;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString() === value;
}

/**
 * Gerador de uma linha de matchup com chave natural não vazia e, de forma
 * opcional, `captured_at` e `source` presentes/ausentes/vazios — cobrindo os
 * ramos de normalização do escritor (padrão vs. reinterpretação em UTC).
 */
function matchupRowArb(): fc.Arbitrary<NflMatchupRow> {
  // Variantes de `captured_at`: ausente, vazio, ISO UTC, ISO com offset e
  // instante arbitrário (ms desde a epoch) reinterpretado para UTC.
  const capturedAtArb = fc.oneof(
    fc.constant<string | undefined>(undefined),
    fc.constant(''),
    fc
      .integer({ min: 0, max: 4_102_444_800_000 }) // 1970..~2100
      .map((ms) => new Date(ms).toISOString()),
    fc.constant('2024-01-02T03:04:05+02:00'),
    fc.constant('2023-11-15T10:20:30.500-05:00'),
  );

  // Variantes de `source`: ausente, vazia (vira o padrão) e origens arbitrárias.
  const sourceArb = fc.oneof(
    fc.constant<string | undefined>(undefined),
    fc.constant(''),
    fc.constant('   '),
    fc.webUrl(),
    fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim() !== ''),
  );

  return fc.record({
    natural_key: fc
      .string({ minLength: 1, maxLength: 24 })
      .filter((s) => s.trim() !== ''),
    offense_scheme: fc.string({ maxLength: 12 }),
    defense_scheme: fc.string({ maxLength: 12 }),
    payload: fc.jsonValue(),
    captured_at: capturedAtArb,
    source: sourceArb,
  }) as unknown as fc.Arbitrary<NflMatchupRow>;
}

/**
 * Deriva a `source` esperada a partir da entrada: origem não vazia (após trim)
 * é preservada; caso contrário, o padrão canônico é aplicado. Independente da
 * implementação sob teste.
 */
function expectedSource(input: NflMatchupRow): string {
  const raw = typeof input.source === 'string' ? input.source.trim() : '';
  return raw === '' ? NFL_MATCHUP_SOURCE : raw;
}

describe('Feature: pfl-data-catalog, Property 15: Carimbo UTC e fonte em todo matchup NFL', () => {
  it('toda linha gravada tem captured_at em UTC e source definida (R10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(matchupRowArb(), { minLength: 1, maxLength: 20 }),
        async (rows) => {
          const { client, captured, tablesTouched } = createInMemoryClient();

          const result = await upsertNflMatchups(rows, {
            client: client as never,
          });

          // Toda linha de entrada tem natural_key válida ⇒ nada é rejeitado e
          // todas são gravadas no repositório em memória.
          expect(result.rejected).toHaveLength(0);
          expect(captured).toHaveLength(rows.length);

          // Escrita exclusiva na tabela de dados de regras (R10.1/R10.5).
          expect([...tablesTouched]).toEqual([NFL_MATCHUP_TABLE]);

          for (const row of captured) {
            expect(typeof row.captured_at).toBe('string');
            expect(isUtcIso(row.captured_at)).toBe(true);
            expect(typeof row.source).toBe('string');
            expect(row.source.length).toBeGreaterThan(0);
          }

          // A source esperada por posição coincide (ordem preservada no lote).
          for (let i = 0; i < rows.length; i++) {
            expect(captured[i]!.source).toBe(expectedSource(rows[i]!));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('source ausente/vazia assume o padrão https://nfl.balldontlie.io (R10.2)', async () => {
    const noSourceArb = matchupRowArb().map(
      (row) => ({ ...row, source: '' }) as NflMatchupRow,
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(noSourceArb, { minLength: 1, maxLength: 20 }),
        async (rows) => {
          const { client, captured } = createInMemoryClient();

          await upsertNflMatchups(rows, { client: client as never });

          for (const row of captured) {
            expect(row.source).toBe(NFL_MATCHUP_SOURCE);
            expect(isUtcIso(row.captured_at)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
