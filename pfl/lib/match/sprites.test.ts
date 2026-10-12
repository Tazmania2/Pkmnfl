// Feature: pfl-gameday-result-ui, Property 21: Sprite vem da Camada_Leitura ou
// do substituto local, nunca de fonte externa
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SPRITE_SUBSTITUTO, resolveSprite } from './sprites';
import type { SpeciesRawEntry, SpeciesRawIndex } from './types';

/**
 * Teste de propriedade da camada fina de sprites (Task 5.2).
 *
 * **Feature: pfl-gameday-result-ui, Property 21: Sprite vem da Camada_Leitura
 * ou do substituto local, nunca de fonte externa**
 *
 * _Validates: Requirements 9.2, 9.6_
 *
 * Para todo `pokemonId` e índice de `raw_data`, `resolveSprite`:
 * - devolve um `src` extraído de `species.raw_data.sprites` quando houver
 *   alguma arte 8-bit utilizável (R9.2) — nunca uma URL externa inventada;
 * - caso contrário (sprite ausente/null ou espécie fora do índice), devolve o
 *   `SPRITE_SUBSTITUTO` local empacotado com `isFallback === true` (R9.6);
 * - é determinística (mesma entrada → mesmo resultado);
 * - produz um `alt` descritivo não vazio (R17.4).
 */

/** URL externa claramente ilegítima — nunca deve aparecer no `src` resolvido. */
const URL_EXTERNA = 'https://external.example.com/malicious-sprite.png';

/**
 * Coleta todas as strings de sprite presentes na árvore `raw_data.sprites` de
 * uma entrada — o conjunto de origens legítimas para o `src` quando não é
 * fallback. Espelha, de forma independente, a estrutura fiel da PokéAPI que o
 * resolvedor sonda (`versions['generation-i'][game].front_default` e
 * `sprites.front_default`).
 */
function spriteStringsOf(entry: SpeciesRawEntry): Set<string> {
  const found = new Set<string>();
  const raw = entry.raw_data;
  if (typeof raw !== 'object' || raw === null) return found;
  const sprites = (raw as Record<string, unknown>)['sprites'];
  if (typeof sprites !== 'object' || sprites === null) return found;
  const spritesRec = sprites as Record<string, unknown>;

  const front = spritesRec['front_default'];
  if (typeof front === 'string' && front.length > 0) found.add(front);

  const versions = spritesRec['versions'];
  if (typeof versions === 'object' && versions !== null) {
    const gen1 = (versions as Record<string, unknown>)['generation-i'];
    if (typeof gen1 === 'object' && gen1 !== null) {
      for (const game of Object.values(gen1 as Record<string, unknown>)) {
        if (typeof game === 'object' && game !== null) {
          const fd = (game as Record<string, unknown>)['front_default'];
          if (typeof fd === 'string' && fd.length > 0) found.add(fd);
        }
      }
    }
  }
  return found;
}

/** Gera uma string de sprite plausível (caminho/URL da Camada_Leitura). */
const spriteUrlArb = fc
  .integer({ min: 1, max: 10000 })
  .map((n) => `/raw/sprites/gen1/${n}.png`);

/**
 * Uma entrada de `front_default` da PokéAPI: às vezes uma string usável, às
 * vezes `null` (ausente), às vezes a chave simplesmente não existe.
 */
const frontDefaultArb = fc.oneof(
  spriteUrlArb,
  fc.constant(null),
  fc.constant(undefined),
);

/**
 * Gera um bloco `sprites` ao estilo PokéAPI, cobrindo os casos:
 * - com arte 8-bit da Geração I (red-blue / yellow),
 * - sem versões mas com `front_default`,
 * - sem nenhum sprite utilizável (tudo null/ausente),
 * - `sprites` ausente por completo.
 */
const spritesBlockArb = fc.oneof(
  // Com versões de Geração I.
  fc.record({
    front_default: frontDefaultArb,
    versions: fc.record({
      'generation-i': fc.record({
        'red-blue': fc.record({ front_default: frontDefaultArb }),
        yellow: fc.record({ front_default: frontDefaultArb }),
      }),
    }),
  }),
  // Só front_default no topo.
  fc.record({ front_default: frontDefaultArb }),
  // Bloco sem qualquer sprite utilizável.
  fc.record({ front_default: fc.constant(null) }),
);

/** `raw_data` cru: às vezes com bloco `sprites`, às vezes sem nada útil. */
const rawDataArb = fc.oneof(
  fc.record({ sprites: spritesBlockArb }),
  fc.record({}), // sem bloco sprites
  fc.constant(null), // raw_data totalmente ausente
);

/** Slug plausível, gerado de forma barata (sem regex). */
const slugArb = fc.option(
  fc.constantFrom('pikachu', 'charizard', 'bulbasaur', 'snorlax', 'eevee'),
  { nil: undefined },
);

/** Entrada arbitrária (sem fixar o id; o id vem do próprio record). */
const entryArb: fc.Arbitrary<SpeciesRawEntry> = fc.record({
  pokemon_id: fc.integer({ min: 1, max: 500 }),
  slug: slugArb,
  raw_data: rawDataArb,
});

/** Índice arbitrário `pokemonId → SpeciesRawEntry` (Map-like via `get`). */
const indexArb: fc.Arbitrary<{
  index: SpeciesRawIndex;
  presentIds: number[];
}> = fc.array(entryArb, { minLength: 1, maxLength: 8 }).map((entries) => {
  const map = new Map<number, SpeciesRawEntry>();
  for (const e of entries) map.set(e.pokemon_id, e);
  return { index: map, presentIds: [...map.keys()] };
});

describe('Feature: pfl-gameday-result-ui, Property 21: Sprite da Camada_Leitura ou substituto local', () => {
  it('src vem do raw_data (sem fallback) OU é o SPRITE_SUBSTITUTO (com fallback), nunca externo (R9.2, R9.6)', () => {
    fc.assert(
      fc.property(indexArb, ({ index, presentIds }) => {
        for (const id of presentIds) {
          const entry = index.get(id)!;
          const legitSprites = spriteStringsOf(entry);
          const res = resolveSprite(id, index);

          // Nunca uma fonte externa que não estava no raw_data.
          expect(res.src).not.toBe(URL_EXTERNA);

          if (res.isFallback) {
            // Ausência de sprite utilizável → substituto local empacotado.
            expect(res.src).toBe(SPRITE_SUBSTITUTO);
          } else {
            // Presença → src foi uma das strings de sprite do próprio raw_data.
            expect(legitSprites.has(res.src)).toBe(true);
            // E, sendo legítimo, nunca igual ao substituto por engano.
            expect(res.src).not.toBe(SPRITE_SUBSTITUTO);
          }

          // Coerência: isFallback === true  ⟺  não havia sprite utilizável.
          expect(res.isFallback).toBe(legitSprites.size === 0);

          // alt descritivo e não vazio (R17.4).
          expect(typeof res.alt).toBe('string');
          expect(res.alt.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('pokemonId ausente do índice resolve para o substituto local (isFallback, R9.6)', () => {
    fc.assert(
      fc.property(indexArb, fc.integer({ min: 1, max: 1000 }), ({ index, presentIds }, probe) => {
        // Escolhe um id garantidamente ausente do índice.
        const absentId = presentIds.includes(probe) ? probe + 10000 : probe;
        fc.pre(!presentIds.includes(absentId));

        const res = resolveSprite(absentId, index);
        expect(res.isFallback).toBe(true);
        expect(res.src).toBe(SPRITE_SUBSTITUTO);
        expect(res.src).not.toBe(URL_EXTERNA);
        expect(res.alt.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('é determinística: a mesma entrada resolve para resultado igual em duas chamadas', () => {
    fc.assert(
      fc.property(indexArb, ({ index, presentIds }) => {
        for (const id of presentIds) {
          const a = resolveSprite(id, index);
          const b = resolveSprite(id, index);
          expect(a).toEqual(b);
        }
      }),
      { numRuns: 100 },
    );
  });
});
