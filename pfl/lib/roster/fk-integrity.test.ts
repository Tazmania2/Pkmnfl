import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  Catalogs,
  FOREIGN_KEYS,
  ForeignKey,
  insertWithFk,
  ReferencingRow,
  ReferencingTable,
} from './fk-integrity';

/**
 * Teste de propriedade da integridade referencial de FKs (Task 10.4).
 *
 * **Feature: pfl-foundation, Property 2: Integridade referencial — toda FK resolve**
 *
 * Validates: Requirements 9.2, 9.3, 10.2, 10.3, 12.4, 12.5, 12.6
 *
 * Para todo catálogo (`species`, `moves`, `abilities`) e toda referência
 * inserida em `pokemon_learnable_moves`, `pokemon_abilities`, `athletes` e
 * `athlete_moves`, uma inserção é aceita somente se cada FK resolve para uma
 * linha existente na tabela referenciada; qualquer referência a um id
 * inexistente é rejeitada e preserva o estado.
 */

const REFERENCING_TABLES: readonly ReferencingTable[] = [
  'pokemon_learnable_moves',
  'pokemon_abilities',
  'athletes',
  'athlete_moves',
];

/**
 * Gera catálogos não vazios de ids existentes. Mantém faixas pequenas e
 * sobrepostas de propósito, para que os ids referenciados tenham chance real
 * de cair dentro ou fora de cada catálogo.
 */
const catalogsArb: fc.Arbitrary<Catalogs> = fc
  .record({
    species: fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 1 }),
    moves: fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 1 }),
    abilities: fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 1 }),
  })
  .map(({ species, moves, abilities }) => ({
    species: new Set(species),
    moves: new Set(moves),
    abilities: new Set(abilities),
  }));

/** Valor de FK: na mesma faixa dos catálogos, podendo existir ou não. */
const fkValueArb = fc.integer({ min: 1, max: 60 });

/**
 * Oráculo independente: toda FK da linha resolve para um id presente no
 * catálogo referenciado.
 */
function allForeignKeysResolve(catalogs: Catalogs, row: ReferencingRow): boolean {
  return row.foreignKeys.every((fk) => catalogs[fk.references].has(fk.value));
}

/**
 * Constrói uma linha referenciadora para uma tabela, emparelhando cada
 * definição de FK com o valor na mesma posição. Exige `values.length` igual à
 * aridade de FKs da tabela.
 */
function buildRow(table: ReferencingTable, values: readonly number[]): ReferencingRow {
  const definitions = FOREIGN_KEYS[table];
  if (values.length !== definitions.length) {
    throw new Error(
      `esperados ${definitions.length} valores de FK para ${table}, recebidos ${values.length}`,
    );
  }
  const foreignKeys: ForeignKey[] = definitions.map((fk, index) => ({
    column: fk.column,
    references: fk.references,
    value: values[index] as number,
  }));
  return { table, foreignKeys };
}

/**
 * Gera, em um único arbitrário, um catálogo, uma tabela referenciadora e uma
 * linha com valores de FK para essa tabela. Cobre todas as tabelas numa única
 * propriedade, mantendo as iterações planas (sem `fc.assert` aninhado).
 */
const scenarioArb: fc.Arbitrary<{ catalogs: Catalogs; row: ReferencingRow }> =
  fc
    .tuple(catalogsArb, fc.constantFrom(...REFERENCING_TABLES))
    .chain(([catalogs, table]) => {
      const arity = FOREIGN_KEYS[table].length;
      return fc
        .array(fkValueArb, { minLength: arity, maxLength: arity })
        .map((values) => ({ catalogs, row: buildRow(table, values) }));
    });

describe('Feature: pfl-foundation, Property 2: Integridade referencial — toda FK resolve', () => {
  it('aceita a inserção se e somente se todas as FKs resolvem (todas as tabelas referenciadoras)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ catalogs, row }) => {
        const result = insertWithFk(catalogs, row);
        const shouldAccept = allForeignKeysResolve(catalogs, row);

        expect(result.accepted).toBe(shouldAccept);

        if (shouldAccept) {
          // Toda FK resolve → aceita, sem violações.
          expect(result.violations).toEqual([]);
        } else {
          // Alguma FK não resolve → rejeita; as colunas violadas são
          // exatamente as cujo valor está ausente do catálogo.
          const expectedViolations = row.foreignKeys
            .filter((fk) => !catalogs[fk.references].has(fk.value))
            .map((fk) => fk.column);
          expect(result.violations).toEqual(expectedViolations);
          expect(result.violations.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('aceita quando toda FK referencia um id existente (referências garantidamente válidas)', () => {
    fc.assert(
      fc.property(
        catalogsArb,
        fc.constantFrom(...REFERENCING_TABLES),
        (catalogs, table) => {
          const values = FOREIGN_KEYS[table].map((fk) => {
            // Catálogos são sempre não vazios (minLength: 1), então existe
            // pelo menos um id para referenciar.
            const [first] = [...catalogs[fk.references]];
            return first as number;
          });
          const row = buildRow(table, values);

          const result = insertWithFk(catalogs, row);
          expect(result.accepted).toBe(true);
          expect(result.violations).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejeita quando ao menos uma FK referencia um id inexistente, preservando o estado', () => {
    fc.assert(
      fc.property(
        catalogsArb,
        fc.constantFrom(...REFERENCING_TABLES),
        (catalogs, table) => {
          const fks = FOREIGN_KEYS[table];
          const brokenFk = fks[0] as (typeof fks)[number];

          // A primeira FK aponta deliberadamente para um id ausente do
          // catálogo referenciado (valor fora da faixa [1,60]); as demais
          // referenciam ids existentes.
          const absent = 10_000;
          const values = fks.map((fk, index) => {
            if (index === 0) {
              // Garante ausência (a faixa de catálogo é [1,60]).
              expect(catalogs[fk.references].has(absent)).toBe(false);
              return absent;
            }
            const [first] = [...catalogs[fk.references]];
            return first as number;
          });
          const row = buildRow(table, values);

          const result = insertWithFk(catalogs, row);
          expect(result.accepted).toBe(false);
          expect(result.violations).toContain(brokenFk.column);
        },
      ),
      { numRuns: 100 },
    );
  });
});
