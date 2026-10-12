/**
 * Predicado puro do conjunto de Especies_Permitidas (R6.5, decisão D-4).
 *
 * O MVP admite as 146 espécies cujos `pokemon_id` vão de 1 a 151, excetuando
 * os cinco lendários/míticos: 144 (Articuno), 145 (Zapdos), 146 (Moltres),
 * 150 (Mewtwo) e 151 (Mew).
 *
 * Esta é a formalização, como lógica pura in-memory, do invariante de dados
 * `species.is_allowed`. A coluna no catálogo é populada por outra spec; aqui
 * garantimos a semântica e a propriedade de corretude P-1 valida a
 * equivalência.
 */

/** Limite inferior (inclusivo) da primeira geração. */
export const MIN_POKEMON_ID = 1;

/** Limite superior (inclusivo) da primeira geração. */
export const MAX_POKEMON_ID = 151;

/**
 * `pokemon_id` da primeira geração que ficam de fora do conjunto permitido:
 * os pássaros lendários (144, 145, 146) e os psíquicos (150 Mewtwo, 151 Mew).
 */
export const EXCLUDED_POKEMON_IDS: ReadonlySet<number> = new Set([
  144, 145, 146, 150, 151,
]);

/**
 * Retorna `true` se e somente se `pokemonId` pertence ao conjunto de
 * Especies_Permitidas, ou seja, quando é um inteiro no intervalo
 * `[1, 151]` e não está entre os identificadores excluídos
 * `{144, 145, 146, 150, 151}`.
 *
 * Valores não-inteiros (NaN, frações) resultam em `false`.
 */
export function isAllowedSpecies(pokemonId: number): boolean {
  if (!Number.isInteger(pokemonId)) {
    return false;
  }

  const withinRange =
    pokemonId >= MIN_POKEMON_ID && pokemonId <= MAX_POKEMON_ID;

  return withinRange && !EXCLUDED_POKEMON_IDS.has(pokemonId);
}
