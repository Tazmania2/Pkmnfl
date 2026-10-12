import { describe, expect, it, vi } from 'vitest';

/**
 * `pipeline.ts` importa `NFL_MATCHUP_SOURCE` de `persist.ts`, que inicia com
 * `import 'server-only'`. Sob Vitest não há contexto de servidor, então o
 * módulo é neutralizado por um stub vazio.
 */
vi.mock('server-only', () => ({}));

import { DEFAULT_NFL_PIPELINE, mapMatchups } from './pipeline';
import { NFL_MATCHUP_SOURCE } from './persist';

/**
 * Testes de exemplo do mapeador de matchups do pipeline NFL (Task 12.3).
 *
 * _Requirements: 10.1, 10.2, 10.3_
 */

describe('mapMatchups', () => {
  it('mapeia itens de uma resposta paginada { data: [...] } em NflMatchupRow[]', () => {
    const data = {
      data: [
        { offense_scheme: 'spread', defense_scheme: 'cover2', season: '2024' },
        { offense: 'power', defense: 'man', season: '2023' },
      ],
    };

    const rows = mapMatchups(data);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      natural_key: 'spread|cover2|2024',
      offense_scheme: 'spread',
      defense_scheme: 'cover2',
      source: NFL_MATCHUP_SOURCE,
      captured_at: '',
    });
    expect(rows[1]!.natural_key).toBe('power|man|2023');
  });

  it('aceita array direto no topo e omite temporada quando ausente', () => {
    const rows = mapMatchups([{ offense_scheme: 'spread', defense_scheme: 'cover2' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.natural_key).toBe('spread|cover2');
  });

  it('ignora itens sem esquemas identificáveis sem lançar', () => {
    const rows = mapMatchups({ data: [{ foo: 'bar' }, { offense_scheme: 'spread' }] });
    expect(rows).toHaveLength(0);
  });

  it('retorna lista vazia para formatos inesperados', () => {
    expect(mapMatchups(null)).toEqual([]);
    expect(mapMatchups(42)).toEqual([]);
    expect(mapMatchups({ nope: true })).toEqual([]);
  });

  it('preserva o item bruto no payload', () => {
    const item = { offense_scheme: 'spread', defense_scheme: 'cover2', extra: { a: 1 } };
    const rows = mapMatchups([item]);
    expect(rows[0]!.payload).toEqual(item);
  });
});

describe('DEFAULT_NFL_PIPELINE', () => {
  it('expõe ao menos o endpoint de matchups com mapeador', () => {
    expect(DEFAULT_NFL_PIPELINE.length).toBeGreaterThan(0);
    const matchups = DEFAULT_NFL_PIPELINE.find((e) => e.name === 'matchups');
    expect(matchups).toBeDefined();
    expect(matchups!.map).toBe(mapMatchups);
  });
});
