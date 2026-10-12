/**
 * Transformadores puros do Catálogo Oficial v1.7 (spec `pfl-data-catalog`).
 *
 * Este módulo converte registros do catálogo em linhas de banco. É o núcleo
 * puro (sem I/O, sem rede) testável por PBT. Nesta primeira fatia, expõe
 * apenas a elegibilidade de espécies (`ALLOWED_IDS` e `isAllowed`); os
 * mapeamentos `toSpeciesRow`/`toMoveRow`/`toAbilityRow` e os derivadores de
 * relações chegam em tarefas posteriores.
 *
 * O conjunto permitido é a única fonte de verdade da semântica de
 * `species.is_allowed`: 1..151 excetuando {144, 145, 146, 150, 151}.
 * A lógica reaproveita o predicado puro de `allowed-species.ts` para evitar
 * dupla fonte de verdade.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4_
 */

import {
  MIN_POKEMON_ID,
  MAX_POKEMON_ID,
  EXCLUDED_POKEMON_IDS,
  isAllowedSpecies,
} from './allowed-species';
import type {
  FichaEspecie,
  GolpeEnriquecido,
  HabilidadeEnriquecida,
  SpeciesRow,
  MoveRow,
  AbilityRow,
  LearnableMoveRow,
  PokemonAbilityRow,
} from './types';

/**
 * Conjunto imutável de Especies_Permitidas: os `pokemon_id` de 1 a 151
 * excetuando os cinco lendários/míticos {144, 145, 146, 150, 151}.
 *
 * Cardinalidade: 151 - 5 = 146.
 */
export const ALLOWED_IDS: ReadonlySet<number> = (() => {
  const ids = new Set<number>();
  for (let id = MIN_POKEMON_ID; id <= MAX_POKEMON_ID; id++) {
    if (!EXCLUDED_POKEMON_IDS.has(id)) {
      ids.add(id);
    }
  }
  return ids;
})();

/**
 * Retorna `true` se e somente se `pokemonId` pertence a `ALLOWED_IDS`.
 *
 * Qualquer `pokemon_id` fora do intervalo [1, 151] — bem como valores não
 * inteiros — resulta em `false` (Req. 6.4). As espécies 144, 145, 146, 150 e
 * 151 também resultam em `false` (Req. 6.2).
 */
export function isAllowed(pokemonId: number): boolean {
  return isAllowedSpecies(pokemonId);
}

// ---------------------------------------------------------------------------
// Mapeamento de registros do catálogo em linhas de banco
// ---------------------------------------------------------------------------

/**
 * Converte uma `FichaEspecie` do Catálogo Oficial em uma linha da tabela
 * `species`.
 *
 * Mapeamento de identidade/atributos a partir do bloco `official` (Req. 1.2):
 * - `pokemon_id`, `slug` e `types` da raiz/`official` da ficha;
 * - as seis stats base, com a renomeação de chaves com hífen da PokéAPI para
 *   as colunas com underscore do schema (`special-attack` → `special_attack`,
 *   `special-defense` → `special_defense`);
 * - `height` ← `official.height_dm` e `weight` ← `official.weight_hg`.
 *
 * A ficha original é preservada fielmente em `raw_data`, sem conversão
 * (Req. 1.3). A elegibilidade (`is_allowed`) é derivada exclusivamente de
 * `isAllowed(pokemon_id)` (Req. 6.1). As Anotações PFL permanecem fora de
 * `raw_data`, em colunas dedicadas (Req. 1.4).
 */
export function toSpeciesRow(f: FichaEspecie): SpeciesRow {
  const { stats } = f.official;

  return {
    pokemon_id: f.pokemon_id,
    slug: f.slug,
    types: f.official.types,
    hp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    special_attack: stats['special-attack'],
    special_defense: stats['special-defense'],
    speed: stats.speed,
    height: f.official.height_dm,
    weight: f.official.weight_hg,
    is_allowed: isAllowed(f.pokemon_id),
    raw_data: f,
  };
}

/**
 * Converte um `GolpeEnriquecido` em uma linha da tabela `moves`.
 *
 * O `move_id` espelha o campo `id` de origem e `name` o nome textual
 * (Req. 2.2). O golpe original é preservado fielmente em `raw_data`, incluindo
 * `power`, `accuracy`, `meta` e descrições, sem qualquer conversão (Req. 2.3).
 * As Anotações PFL ficam fora de `raw_data` (Req. 2.4).
 */
export function toMoveRow(m: GolpeEnriquecido): MoveRow {
  return {
    move_id: m.id,
    name: m.name,
    raw_data: m,
  };
}

/**
 * Converte uma `HabilidadeEnriquecida` em uma linha da tabela `abilities`.
 *
 * O `ability_id` espelha o campo `id` de origem e `name` o nome textual
 * (Req. 3.2). A habilidade original é preservada fielmente em `raw_data`,
 * incluindo efeitos, histórico e descrições, sem perda de campos (Req. 3.3).
 * As Anotações PFL ficam fora de `raw_data` (Req. 3.4).
 */
export function toAbilityRow(a: HabilidadeEnriquecida): AbilityRow {
  return {
    ability_id: a.id,
    name: a.name,
    raw_data: a,
  };
}

// ---------------------------------------------------------------------------
// Derivadores de relações Pokémon ↔ golpes/habilidades
// ---------------------------------------------------------------------------

/**
 * Deriva as relações Pokémon ↔ golpe aprendível a partir de
 * `official.learnable_moves[]` de todas as Fichas_Especie.
 *
 * Produz um par (`pokemon_id`, `move_id`) distinto por golpe aprendível,
 * deduplicando por essa chave composta: quando o mesmo par aparece mais de uma
 * vez — na mesma ficha ou em fichas distintas — mantém-se uma única linha, a da
 * primeira ocorrência (Req. 4.1, 4.6). Os metadados de versão de aprendizado
 * (`version_details`) são preservados fielmente, sem conversão, por par
 * (Req. 4.2). Função pura, sem I/O.
 *
 * _Requirements: 4.1, 4.2, 4.6_
 */
export function toLearnableMoveRows(
  fichas: FichaEspecie[],
): LearnableMoveRow[] {
  const seen = new Set<string>();
  const rows: LearnableMoveRow[] = [];

  for (const ficha of fichas) {
    const pokemonId = ficha.pokemon_id;
    for (const move of ficha.official.learnable_moves) {
      const key = `${pokemonId}:${move.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        pokemon_id: pokemonId,
        move_id: move.id,
        version_details: move.version_details,
      });
    }
  }

  return rows;
}

/**
 * Deriva as relações Pokémon ↔ habilidade disponível a partir de
 * `official.ability_options[]` de todas as Fichas_Especie.
 *
 * Produz um par (`pokemon_id`, `ability_id`) distinto por opção de habilidade,
 * deduplicando por essa chave composta: a primeira ocorrência de cada par
 * vence; ocorrências subsequentes do mesmo par são ignoradas (Req. 5.1, 5.5).
 * Preserva, por par, o indicador de habilidade oculta (`is_hidden`) e o `slot`
 * de origem (Req. 5.2). Função pura, sem I/O.
 *
 * _Requirements: 5.1, 5.2, 5.5_
 */
export function toPokemonAbilityRows(
  fichas: FichaEspecie[],
): PokemonAbilityRow[] {
  const seen = new Set<string>();
  const rows: PokemonAbilityRow[] = [];

  for (const ficha of fichas) {
    const pokemonId = ficha.pokemon_id;
    for (const ability of ficha.official.ability_options) {
      const key = `${pokemonId}:${ability.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        pokemon_id: pokemonId,
        ability_id: ability.id,
        is_hidden: ability.is_hidden,
        slot: ability.slot,
      });
    }
  }

  return rows;
}
