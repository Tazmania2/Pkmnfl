/**
 * Modelo puro, in-memory, da integridade referencial de chaves estrangeiras do
 * Schema_PFL (Correctness Property P-2, decisão de Testing Strategy).
 *
 * O design impõe FKs no PostgreSQL. Como não há garantia de um Postgres vivo
 * nos testes, este módulo modela o enforcement de FK como um SUT equivalente:
 * cada catálogo é um conjunto de identificadores existentes
 * (`species.pokemon_id`, `moves.move_id`, `abilities.ability_id`) e
 * `insertWithFk` aceita uma linha referenciadora se e somente se **cada** valor
 * de FK resolve para um id existente no catálogo referenciado; caso contrário,
 * rejeita a inserção e **preserva o estado** (nenhuma linha é adicionada).
 *
 * Cobre as tabelas referenciadoras do schema:
 * - `pokemon_learnable_moves` — FK `pokemon_id`→species, `move_id`→moves  (R9.2, R9.3)
 * - `pokemon_abilities`        — FK `pokemon_id`→species, `ability_id`→abilities (R10.2, R10.3)
 * - `athletes`                 — FK `pokemon_id`→species, `ability_id`→abilities (R12.4, R12.5)
 * - `athlete_moves`            — FK `move_id`→moves (R12.6)
 */

/** Catálogos: conjuntos dos ids existentes em cada tabela referenciada. */
export interface Catalogs {
  /** `species.pokemon_id` existentes. */
  readonly species: ReadonlySet<number>;
  /** `moves.move_id` existentes. */
  readonly moves: ReadonlySet<number>;
  /** `abilities.ability_id` existentes. */
  readonly abilities: ReadonlySet<number>;
}

/** Tabela referenciada por uma chave estrangeira. */
export type ReferencedCatalog = keyof Catalogs;

/** Tabelas referenciadoras do schema cobertas por este modelo. */
export type ReferencingTable =
  | 'pokemon_learnable_moves'
  | 'pokemon_abilities'
  | 'athletes'
  | 'athlete_moves';

/** Uma única chave estrangeira: a coluna e o catálogo que ela referencia. */
export interface ForeignKey {
  /** Nome da coluna de FK na linha referenciadora (ex.: `pokemon_id`). */
  readonly column: string;
  /** Catálogo referenciado por esta FK. */
  readonly references: ReferencedCatalog;
  /** Valor fornecido para a FK. */
  readonly value: number;
}

/** Resultado de uma tentativa de inserção com validação de FKs. */
export interface InsertResult {
  /** `true` se todas as FKs resolveram e a linha foi aceita. */
  readonly accepted: boolean;
  /**
   * Colunas de FK cujo valor não resolveu para uma linha existente no
   * catálogo referenciado, na ordem em que aparecem na linha. Vazio quando
   * `accepted` é `true`.
   */
  readonly violations: readonly string[];
}

/**
 * Definição das FKs de cada tabela referenciadora, conforme o DDL do design.
 * Usada para construir as linhas a validar e como oráculo das colunas de FK.
 */
export const FOREIGN_KEYS: Readonly<
  Record<ReferencingTable, readonly { column: string; references: ReferencedCatalog }[]>
> = {
  // R9.2 / R9.3
  pokemon_learnable_moves: [
    { column: 'pokemon_id', references: 'species' },
    { column: 'move_id', references: 'moves' },
  ],
  // R10.2 / R10.3
  pokemon_abilities: [
    { column: 'pokemon_id', references: 'species' },
    { column: 'ability_id', references: 'abilities' },
  ],
  // R12.4 / R12.5
  athletes: [
    { column: 'pokemon_id', references: 'species' },
    { column: 'ability_id', references: 'abilities' },
  ],
  // R12.6
  athlete_moves: [{ column: 'move_id', references: 'moves' }],
};

/**
 * Representa uma inserção de linha em `insertWithFk`: as FKs a validar.
 *
 * A FK resolve quando `catalogs[fk.references]` contém `fk.value`.
 */
export interface ReferencingRow {
  /** Tabela em que a linha é inserida (apenas para rastreabilidade). */
  readonly table: ReferencingTable;
  /** Chaves estrangeiras da linha. */
  readonly foreignKeys: readonly ForeignKey[];
}

/**
 * Tenta inserir `row` sob o enforcement de FK dos `catalogs`.
 *
 * Aceita (sem efeitos colaterais sobre o estado modelado) se e somente se cada
 * FK resolve para um id existente no catálogo referenciado. Se qualquer FK
 * referencia um id inexistente, rejeita e lista todas as colunas violadas,
 * preservando o estado — espelha a `foreign key violation` do PostgreSQL.
 */
export function insertWithFk(
  catalogs: Catalogs,
  row: ReferencingRow,
): InsertResult {
  const violations: string[] = [];

  for (const fk of row.foreignKeys) {
    const catalog = catalogs[fk.references];
    if (!catalog.has(fk.value)) {
      violations.push(fk.column);
    }
  }

  return { accepted: violations.length === 0, violations };
}
