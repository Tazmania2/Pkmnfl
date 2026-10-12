import { describe, expect, it } from 'vitest';

import {
  checkSpeciesNonNegativeStats,
  SPECIES_NON_NEGATIVE_COLUMNS,
  type SpeciesNumericStats,
} from './species-constraints';

/**
 * Testes de exemplo/edge para os CHECKs de stats base não negativos da tabela
 * `species` (Task 8.3).
 *
 * _Requirements: 6.4_ — valores negativos de qualquer uma das seis stats base,
 * da altura ou do peso são rejeitados pelos CHECKs `col >= 0`; valores >= 0 são
 * aceitos.
 */

/** Linha válida de referência (todas as 8 colunas numéricas >= 0). */
const VALID_STATS: SpeciesNumericStats = {
  hp: 45,
  attack: 49,
  defense: 49,
  special_attack: 65,
  special_defense: 65,
  speed: 45,
  height: 7,
  weight: 69,
};

describe('checkSpeciesNonNegativeStats — CHECK (col >= 0) de species (R6.4)', () => {
  it('aceita uma linha com todos os valores não negativos', () => {
    const result = checkSpeciesNonNegativeStats(VALID_STATS);
    expect(result.accepted).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('aceita zero em todas as colunas (limite inferior inclusivo)', () => {
    const zeros = Object.fromEntries(
      SPECIES_NON_NEGATIVE_COLUMNS.map((column) => [column, 0]),
    ) as SpeciesNumericStats;

    const result = checkSpeciesNonNegativeStats(zeros);
    expect(result.accepted).toBe(true);
    expect(result.violations).toEqual([]);
  });

  // Um caso de exemplo por coluna: valor negativo é rejeitado pelo CHECK.
  describe('rejeita valor negativo em cada coluna individualmente', () => {
    for (const column of SPECIES_NON_NEGATIVE_COLUMNS) {
      it(`rejeita ${column} negativo`, () => {
        const stats: SpeciesNumericStats = { ...VALID_STATS, [column]: -1 };

        const result = checkSpeciesNonNegativeStats(stats);
        expect(result.accepted).toBe(false);
        expect(result.violations).toEqual([column]);
      });
    }
  });

  it('rejeita e reporta todas as colunas quando todas são negativas', () => {
    const allNegative = Object.fromEntries(
      SPECIES_NON_NEGATIVE_COLUMNS.map((column) => [column, -5]),
    ) as SpeciesNumericStats;

    const result = checkSpeciesNonNegativeStats(allNegative);
    expect(result.accepted).toBe(false);
    expect(result.violations).toEqual([...SPECIES_NON_NEGATIVE_COLUMNS]);
  });

  it('reporta múltiplas violações na ordem canônica das colunas', () => {
    const stats: SpeciesNumericStats = {
      ...VALID_STATS,
      attack: -1,
      speed: -10,
      weight: -2,
    };

    const result = checkSpeciesNonNegativeStats(stats);
    expect(result.accepted).toBe(false);
    expect(result.violations).toEqual(['attack', 'speed', 'weight']);
  });
});
