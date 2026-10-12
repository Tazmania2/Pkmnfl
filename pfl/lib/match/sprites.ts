/**
 * Camada fina de sprites (`lib/match/sprites.ts`) — spec `pfl-gameday-result-ui`.
 *
 * Resolve o `Sprite_Pokemon` de um Pokémon a partir **exclusivamente** da
 * Camada_Leitura (`species.raw_data.sprites`, estrutura fiel da PokéAPI
 * preservada por `pfl-data-catalog`). A seleção da melhor arte **8-bit**
 * disponível é determinística; se nenhuma entrada de sprite estiver presente —
 * ou a própria espécie estiver ausente do índice — o resolvedor devolve o
 * `SPRITE_SUBSTITUTO`, um asset **local empacotado** no app, nunca uma URL
 * externa (R9.2, R9.6). O campo `alt` descreve o Pokémon para leitores de tela
 * (R17.4).
 *
 * Princípios refletidos (design → "Camada fina de sprites", Property 21):
 * - **Sem acesso externo em runtime** (R9.2): a função é pura; lê apenas do
 *   `SpeciesRawIndex` recebido (materializado da Camada_Leitura) e nunca faz
 *   rede/I/O. O `src` ou vem de `raw_data.sprites`, ou é o substituto local.
 * - **Substituto padrão** (R9.6): ausência de sprite → `isFallback: true` com
 *   `src = SPRITE_SUBSTITUTO`; a reprodução dos demais Snaps não é interrompida.
 * - **Determinismo**: a ordem de preferência das entradas 8-bit é fixa, logo o
 *   mesmo `raw_data` sempre resolve para o mesmo `src`.
 *
 * _Requirements: 9.2, 9.6, 17.4_
 */

import type { SpeciesRawEntry, SpeciesRawIndex, SpriteResolution } from './types';

/**
 * Caminho do sprite substituto padrão, empacotado em `public/sprites/`. É um
 * asset **local** servido pelo próprio app (`/sprites/substituto.png`), nunca
 * uma fonte externa — garantia central de R9.2/R9.6.
 */
export const SPRITE_SUBSTITUTO = '/sprites/substituto.png' as const;

/**
 * Ordem de preferência determinística das entradas de sprite **8-bit** dentro
 * de `raw_data.sprites.versions['generation-i'][<jogo>].front_default`, na
 * estrutura fiel da PokéAPI. Gerações 8-bit = Geração I (Red/Blue, Yellow).
 * A primeira entrada presente e não vazia vence; a ordem fixa torna a seleção
 * reprodutível entre chamadas.
 */
const GEN1_GAME_PREFERENCE: readonly string[] = ['red-blue', 'yellow'] as const;

/**
 * Verifica se um valor é um objeto indexável por string (não-nulo, não-array),
 * permitindo sondar com segurança a árvore `sprites` cujo tipo é `unknown`.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Retorna a string se for uma URL/caminho de sprite utilizável (não vazia),
 * caso contrário `null`. A PokéAPI usa `null` para entradas ausentes.
 */
function asSpriteString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Extrai, de forma determinística, a melhor entrada de sprite **8-bit** de um
 * `raw_data` cru da PokéAPI, ou `null` se nenhuma estiver disponível.
 *
 * Preferência (do mais 8-bit/específico ao mais genérico):
 *   1. `sprites.versions['generation-i']['red-blue'].front_default`
 *   2. `sprites.versions['generation-i']['yellow'].front_default`
 *   3. `sprites.front_default` (fallback dentro da própria Camada_Leitura)
 *
 * Toda a sondagem é defensiva: `raw_data` é `unknown` por contrato do catálogo e
 * pode não conter objeto `sprites` algum (ex.: fichas sem o bloco de sprites),
 * caso em que a função devolve `null` e o chamador usa o substituto local.
 */
function extractEightBitSprite(rawData: unknown): string | null {
  if (!isRecord(rawData)) {
    return null;
  }

  const sprites = rawData['sprites'];
  if (!isRecord(sprites)) {
    return null;
  }

  // 1 e 2 — arte 8-bit da Geração I, na ordem de preferência fixa.
  const versions = sprites['versions'];
  if (isRecord(versions)) {
    const gen1 = versions['generation-i'];
    if (isRecord(gen1)) {
      for (const game of GEN1_GAME_PREFERENCE) {
        const entry = gen1[game];
        if (isRecord(entry)) {
          const src = asSpriteString(entry['front_default']);
          if (src !== null) {
            return src;
          }
        }
      }
    }
  }

  // 3 — fallback para o sprite frontal padrão da própria Camada_Leitura.
  return asSpriteString(sprites['front_default']);
}

/**
 * Monta o texto alternativo acessível (`alt`) de um Pokémon para leitores de
 * tela (R17.4). Prefere o `slug` da espécie quando disponível; na ausência,
 * usa o identificador numérico. Quando o sprite é o substituto, o `alt` deixa
 * isso explícito, para que a ausência de arte seja perceptível sem a imagem.
 */
function buildAlt(pokemonId: number, slug: string | undefined, isFallback: boolean): string {
  const nome = slug && slug.length > 0 ? slug : `Pokémon #${pokemonId}`;
  return isFallback ? `Sprite substituto de ${nome}` : `Sprite 8-bit de ${nome}`;
}

/**
 * Resolve o `Sprite_Pokemon` de `pokemonId` a partir do índice de leitura
 * `species`. Determinística e pura (sem I/O): nunca acessa fontes externas em
 * tempo de execução (R9.2).
 *
 * - Entrada presente **com** sprite 8-bit → `{ src, isFallback: false, alt }`,
 *   onde `src` vem de `species.raw_data.sprites` (Camada_Leitura).
 * - Entrada ausente **ou** sem qualquer sprite utilizável → `{ src:
 *   SPRITE_SUBSTITUTO, isFallback: true, alt }`, usando o asset local
 *   empacotado — a reprodução dos demais Snaps não é interrompida (R9.6).
 *
 * @param pokemonId Identificador do Pokémon a representar.
 * @param species   Índice em memória `pokemonId → SpeciesRawEntry`, derivado da
 *   Camada_Leitura antes da reprodução.
 * @returns A resolução do sprite (`src`, `isFallback`, `alt`).
 */
export function resolveSprite(
  pokemonId: number,
  species: SpeciesRawIndex,
): SpriteResolution {
  const entry: SpeciesRawEntry | undefined = species.get(pokemonId);
  const src = entry ? extractEightBitSprite(entry.raw_data) : null;

  if (src !== null) {
    return {
      src,
      isFallback: false,
      alt: buildAlt(pokemonId, entry?.slug, false),
    };
  }

  return {
    src: SPRITE_SUBSTITUTO,
    isFallback: true,
    alt: buildAlt(pokemonId, entry?.slug, true),
  };
}
