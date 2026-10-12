/**
 * Modelo in-memory das restrições CHECK de valores não negativos da tabela
 * `species` (migration `20261009000001_init_catalog.sql`).
 *
 * _Requirements: 6.4_ — a tabela de Especie_Pokemon contém colunas obrigatórias
 * e NÃO NEGATIVAS para as seis estatísticas base (`hp`, `attack`, `defense`,
 * `special_attack`, `special_defense`, `speed`), para a altura (`height`) e para
 * o peso (`weight`).
 *
 * Este módulo é um SUT (System Under Test) equivalente, fiel aos CHECKs do SQL
 * (`CHECK (col >= 0)` em cada uma das 8 colunas numéricas), permitindo validar
 * a semântica das restrições sem depender de um PostgreSQL ativo no ambiente.
 * Toda alteração nos CHECKs da migration deve ser refletida aqui.
 */

/** As oito colunas numéricas de `species` sujeitas ao CHECK `>= 0` (R6.4). */
export const SPECIES_NON_NEGATIVE_COLUMNS = [
  'hp',
  'attack',
  'defense',
  'special_attack',
  'special_defense',
  'speed',
  'height',
  'weight',
] as const;

/** Nome de uma das colunas numéricas não negativas de `species`. */
export type SpeciesNonNegativeColumn =
  (typeof SPECIES_NON_NEGATIVE_COLUMNS)[number];

/**
 * Subconjunto de uma linha de `species` relevante para os CHECKs de não
 * negatividade — as seis stats base, a altura e o peso.
 */
export type SpeciesNumericStats = Record<SpeciesNonNegativeColumn, number>;

/** Resultado da avaliação das restrições CHECK de não negatividade. */
export interface SpeciesConstraintResult {
  /** `true` quando todas as 8 colunas satisfazem `col >= 0`. */
  readonly accepted: boolean;
  /** Colunas que violaram o CHECK (`col < 0`), na ordem canônica. */
  readonly violations: readonly SpeciesNonNegativeColumn[];
}

/**
 * Avalia os CHECKs `col >= 0` de `species` contra uma linha candidata.
 *
 * Espelha o comportamento do PostgreSQL: a inserção é aceita (`accepted: true`)
 * se e somente se nenhuma das 8 colunas numéricas for negativa. Valores
 * negativos (inclusive via NaN/Infinity, que não são `>= 0`) são rejeitados e
 * reportados em `violations`.
 */
export function checkSpeciesNonNegativeStats(
  stats: SpeciesNumericStats,
): SpeciesConstraintResult {
  const violations: SpeciesNonNegativeColumn[] = [];

  for (const column of SPECIES_NON_NEGATIVE_COLUMNS) {
    // `>= 0` é falso para negativos e para NaN — equivalente ao CHECK do SQL.
    if (!(stats[column] >= 0)) {
      violations.push(column);
    }
  }

  return { accepted: violations.length === 0, violations };
}
