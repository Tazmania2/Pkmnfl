/**
 * Conciliador de relações do Catálogo Oficial (spec `pfl-data-catalog`).
 *
 * As relações de golpe aprendível e habilidade disponível são derivadas das
 * fichas (fonte autoritativa). Os índices reversos (`moves_to_pokemon_ids`,
 * `abilities_to_pokemon_ids`) servem para **conferir** igualdade de conjuntos,
 * nunca como fonte de verdade — evitando dupla fonte de verdade.
 *
 * Para cada `id` (um `move_id` ou `ability_id`), compara-se o conjunto de
 * `pokemon_id` derivado das fichas com o conjunto declarado no índice reverso.
 * Quando todos os conjuntos coincidem, a conciliação não reporta divergência
 * (retorna `[]`). Em divergência, reporta — por id — exatamente os `pokemon_id`
 * presentes apenas na gravação (`only_in_db`) e exatamente os presentes apenas
 * no índice (`only_in_index`).
 *
 * Função pura (sem I/O, sem rede). Núcleo testável por PBT.
 *
 * _Requirements: 4.3, 4.4, 5.3_
 */

import type { IndiceReverso } from './types';

/**
 * Diferença de conciliação para um único id (`move_id` ou `ability_id`).
 * Reportada apenas quando os conjuntos de `pokemon_id` divergem.
 */
export interface ReconDiff {
  /** `move_id` ou `ability_id` cujo conjunto de `pokemon_id` divergiu. */
  readonly id: number;
  /** `pokemon_id` gravados (derivados das fichas) mas ausentes do índice. */
  readonly only_in_db: number[];
  /** `pokemon_id` no índice reverso mas ausentes da gravação. */
  readonly only_in_index: number[];
}

/**
 * Concilia, por id, o conjunto de `pokemon_id` derivado das fichas com o índice
 * reverso correspondente.
 *
 * Considera a união dos ids presentes em `derived` e em `reverseIndex`: um id
 * presente num lado e ausente do outro é tratado como conjunto vazio no lado
 * ausente, de modo que a divergência é reportada integralmente. As diferenças
 * (`only_in_db`, `only_in_index`) são retornadas em ordem crescente de
 * `pokemon_id`, e as entradas de `ReconDiff` em ordem crescente de `id`, para
 * determinismo.
 *
 * @param derived Mapa `id → conjunto de pokemon_id` derivado das fichas.
 * @param reverseIndex Índice reverso `id (string) → pokemon_ids`.
 * @returns `[]` quando todos os conjuntos coincidem; caso contrário, um
 * `ReconDiff` por id divergente com as diferenças exatas.
 */
export function reconcile(
  derived: Map<number, Set<number>>,
  reverseIndex: IndiceReverso,
): ReconDiff[] {
  // Reúne todos os ids a conferir: os derivados das fichas e os do índice.
  const ids = new Set<number>(derived.keys());
  for (const key of Object.keys(reverseIndex)) {
    ids.add(Number(key));
  }

  const diffs: ReconDiff[] = [];

  for (const id of ids) {
    const dbSet = derived.get(id) ?? new Set<number>();
    const indexSet = new Set<number>(reverseIndex[String(id)] ?? []);

    const onlyInDb: number[] = [];
    for (const pokemonId of dbSet) {
      if (!indexSet.has(pokemonId)) {
        onlyInDb.push(pokemonId);
      }
    }

    const onlyInIndex: number[] = [];
    for (const pokemonId of indexSet) {
      if (!dbSet.has(pokemonId)) {
        onlyInIndex.push(pokemonId);
      }
    }

    if (onlyInDb.length > 0 || onlyInIndex.length > 0) {
      diffs.push({
        id,
        only_in_db: onlyInDb.sort((a, b) => a - b),
        only_in_index: onlyInIndex.sort((a, b) => a - b),
      });
    }
  }

  return diffs.sort((a, b) => a.id - b.id);
}
