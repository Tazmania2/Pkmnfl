import { describe, expect, it } from 'vitest';

import {
  parseAbilities,
  parseFichas,
  parseManifest,
  parseMoves,
  parseReverseIndex,
  type ParseResult,
} from './loaders';
import type { FichaEspecie } from './types';

/**
 * Testes de exemplo para os leitores do Catálogo Oficial (Task 2.3).
 *
 * Exercitam as funções **puras** `parse*` com fixtures inline representativas,
 * mantendo os testes rápidos e determinísticos (sem I/O de disco). Cobrem:
 *
 * - leitura de um subconjunto representativo (5–10 fichas) e dos índices
 *   reversos com a estrutura esperada;
 * - rejeição de ficha inválida (sem `pokemon_id`/`slug`), devolvida para
 *   registro e prosseguimento posterior do seed (R1.5).
 *
 * _Requirements: 1.5_
 */

// ---------------------------------------------------------------------------
// Fixtures: subconjunto representativo de fichas de espécie
// ---------------------------------------------------------------------------

/** Monta uma ficha mínima porém estruturalmente íntegra para os testes. */
function makeFicha(
  pokemonId: number,
  slug: string,
  overrides: {
    types?: string[];
    stats?: Record<string, number>;
    abilityOptions?: Array<{
      name: string;
      id: number;
      is_hidden: boolean;
      slot: number;
    }>;
    learnableMoves?: Array<{ id: number; name: string; version_details: unknown[] }>;
  } = {},
): Record<string, unknown> {
  return {
    pokemon_id: pokemonId,
    slug,
    name_display: slug.charAt(0).toUpperCase() + slug.slice(1),
    eligible: true,
    source_uri: `https://pokeapi.co/api/v2/pokemon/${pokemonId}`,
    species_source_uri: `https://pokeapi.co/api/v2/pokemon-species/${pokemonId}`,
    official: {
      types: overrides.types ?? ['grass', 'poison'],
      stats: overrides.stats ?? {
        hp: 45,
        attack: 49,
        defense: 49,
        'special-attack': 65,
        'special-defense': 65,
        speed: 45,
      },
      height_dm: 7,
      weight_hg: 69,
      ability_options:
        overrides.abilityOptions ?? [
          { name: 'overgrow', id: 65, is_hidden: false, slot: 1 },
          { name: 'chlorophyll', id: 34, is_hidden: true, slot: 3 },
        ],
      learnable_moves:
        overrides.learnableMoves ?? [
          { id: 33, name: 'tackle', version_details: [] },
          { id: 45, name: 'growl', version_details: [] },
        ],
    },
  };
}

/** Oito fichas válidas (subconjunto representativo de 5–10 fichas). */
const REPRESENTATIVE_FICHAS: Record<string, unknown>[] = [
  makeFicha(1, 'bulbasaur'),
  makeFicha(4, 'charmander', { types: ['fire'] }),
  makeFicha(7, 'squirtle', { types: ['water'] }),
  makeFicha(25, 'pikachu', {
    types: ['electric'],
    stats: {
      hp: 35,
      attack: 55,
      defense: 40,
      'special-attack': 50,
      'special-defense': 50,
      speed: 90,
    },
  }),
  makeFicha(39, 'jigglypuff', { types: ['normal', 'fairy'] }),
  makeFicha(94, 'gengar', { types: ['ghost', 'poison'] }),
  makeFicha(130, 'gyarados', { types: ['water', 'flying'] }),
  makeFicha(143, 'snorlax', { types: ['normal'] }),
];

describe('parseFichas — subconjunto representativo (R1.5)', () => {
  it('lê 8 fichas válidas preservando pokemon_id, slug, tipos e stats', () => {
    const result: ParseResult<FichaEspecie> = parseFichas(REPRESENTATIVE_FICHAS);

    expect(result.valid).toHaveLength(8);
    expect(result.rejected).toEqual([]);

    const bulbasaur = result.valid[0]!;
    expect(bulbasaur.pokemon_id).toBe(1);
    expect(bulbasaur.slug).toBe('bulbasaur');
    expect(bulbasaur.official.types).toEqual(['grass', 'poison']);
    expect(bulbasaur.official.stats).toEqual({
      hp: 45,
      attack: 49,
      defense: 49,
      'special-attack': 65,
      'special-defense': 65,
      speed: 45,
    });

    const pikachu = result.valid[3]!;
    expect(pikachu.pokemon_id).toBe(25);
    expect(pikachu.slug).toBe('pikachu');
    expect(pikachu.official.stats.speed).toBe(90);
  });

  it('preserva os blocos official (ability_options e learnable_moves)', () => {
    const result = parseFichas(REPRESENTATIVE_FICHAS);
    const bulbasaur = result.valid[0]!;

    expect(bulbasaur.official.ability_options).toEqual([
      { name: 'overgrow', id: 65, is_hidden: false, slot: 1 },
      { name: 'chlorophyll', id: 34, is_hidden: true, slot: 3 },
    ]);
    expect(bulbasaur.official.learnable_moves).toEqual([
      { id: 33, name: 'tackle', version_details: [] },
      { id: 45, name: 'growl', version_details: [] },
    ]);
  });

  it('os pokemon_id lidos correspondem ao subconjunto de entrada', () => {
    const result = parseFichas(REPRESENTATIVE_FICHAS);
    const ids = result.valid.map((f) => f.pokemon_id);
    expect(ids).toEqual([1, 4, 7, 25, 39, 94, 130, 143]);
  });
});

// ---------------------------------------------------------------------------
// Rejeição de ficha inválida (R1.5)
// ---------------------------------------------------------------------------

describe('parseFichas — rejeição de ficha inválida (R1.5)', () => {
  it('rejeita ficha sem pokemon_id e mantém as válidas', () => {
    const semId = makeFicha(1, 'bulbasaur');
    delete (semId as Record<string, unknown>).pokemon_id;

    const result = parseFichas([semId, makeFicha(4, 'charmander')]);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.pokemon_id).toBe(4);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.index).toBe(0);
    expect(result.rejected[0]!.reason).toMatch(/pokemon_id/);
    expect(result.rejected[0]!.value).toBe(semId);
  });

  it('rejeita ficha sem slug e mantém as válidas', () => {
    const semSlug = makeFicha(7, 'squirtle');
    delete (semSlug as Record<string, unknown>).slug;

    const result = parseFichas([makeFicha(1, 'bulbasaur'), semSlug]);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.pokemon_id).toBe(1);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.index).toBe(1);
    expect(result.rejected[0]!.reason).toMatch(/slug/);
  });

  it('rejeita slug vazio (string em branco não conta como slug)', () => {
    const slugVazio = makeFicha(7, 'squirtle');
    (slugVazio as Record<string, unknown>).slug = '   ';

    const result = parseFichas([slugVazio]);

    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/slug/);
  });

  it('processa um lote misto: válidas separadas das rejeitadas na ordem da fonte', () => {
    const semId = makeFicha(1, 'bulbasaur');
    delete (semId as Record<string, unknown>).pokemon_id;
    const semSlug = makeFicha(130, 'gyarados');
    delete (semSlug as Record<string, unknown>).slug;

    const batch = [
      makeFicha(4, 'charmander'),
      semId,
      makeFicha(7, 'squirtle'),
      semSlug,
      makeFicha(25, 'pikachu'),
    ];

    const result = parseFichas(batch);

    expect(result.valid.map((f) => f.pokemon_id)).toEqual([4, 7, 25]);
    expect(result.rejected.map((r) => r.index)).toEqual([1, 3]);
  });

  it('rejeita ficha com bloco official malformado', () => {
    const semOfficial = makeFicha(1, 'bulbasaur');
    delete (semOfficial as Record<string, unknown>).official;

    const result = parseFichas([semOfficial]);

    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/official/);
  });

  it('devolve rejeição única quando a entrada não é um array', () => {
    const result = parseFichas({ pokemon_id: 1, slug: 'bulbasaur' });

    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.index).toBe(-1);
    expect(result.rejected[0]!.reason).toMatch(/não é um array/);
  });
});

// ---------------------------------------------------------------------------
// Golpes e habilidades enriquecidos ({ id, name, ... })
// ---------------------------------------------------------------------------

describe('parseMoves / parseAbilities — entidades por id/name', () => {
  it('lê golpes válidos preservando propriedades extras fiéis', () => {
    const moves = [
      { id: 33, name: 'tackle', power: 40, type: 'normal', pp: 35 },
      { id: 85, name: 'thunderbolt', power: 90, type: 'electric', pp: 15 },
    ];

    const result = parseMoves(moves);

    expect(result.rejected).toEqual([]);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[1]).toMatchObject({
      id: 85,
      name: 'thunderbolt',
      power: 90,
      type: 'electric',
    });
  });

  it('rejeita golpe sem id e mantém os válidos', () => {
    const result = parseMoves([
      { name: 'mystery', power: 10 },
      { id: 33, name: 'tackle' },
    ]);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.id).toBe(33);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.index).toBe(0);
    expect(result.rejected[0]!.reason).toMatch(/id/);
  });

  it('lê habilidades válidas e rejeita a sem name', () => {
    const result = parseAbilities([
      { id: 65, name: 'overgrow', effect: 'boosts grass moves' },
      { id: 34, name: '' },
    ]);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.id).toBe(65);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/name/);
  });
});

// ---------------------------------------------------------------------------
// Índices reversos (moves_to_pokemon_ids.json / abilities_to_pokemon_ids.json)
// ---------------------------------------------------------------------------

describe('parseReverseIndex — estrutura esperada', () => {
  it('lê um índice reverso de golpes com a estrutura id → pokemon_ids', () => {
    const raw = {
      '33': [1, 4, 7, 25],
      '85': [25],
      '45': [1, 39],
    };

    const index = parseReverseIndex(raw);

    // Chaves numéricas em string são iteradas em ordem numérica ascendente pelo
    // runtime; comparamos o conjunto de chaves, não a ordem de inserção.
    expect(Object.keys(index).sort()).toEqual(['33', '45', '85']);
    expect(index['33']).toEqual([1, 4, 7, 25]);
    expect(index['85']).toEqual([25]);
    expect(index['45']).toEqual([1, 39]);
  });

  it('descarta entradas malformadas (valor não é array de inteiros)', () => {
    const raw = {
      '33': [1, 4, 7],
      '99': 'not-an-array',
      '50': [1, 2.5, 3],
      '65': [65, 94],
    };

    const index = parseReverseIndex(raw);

    expect(Object.keys(index)).toEqual(['33', '65']);
    expect(index['33']).toEqual([1, 4, 7]);
    expect(index['65']).toEqual([65, 94]);
  });

  it('devolve um índice vazio quando a entrada não é um objeto', () => {
    expect(parseReverseIndex(null)).toEqual({});
    expect(parseReverseIndex([1, 2, 3])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Manifest (manifest.json — caminho + sha256)
// ---------------------------------------------------------------------------

describe('parseManifest — entradas path/sha256', () => {
  it('aceita a chave file como caminho (forma do acervo)', () => {
    const raw = {
      endpoints: [
        { file: 'pokemon/1.json', sha256: 'abc123', status: 200, bytes: 10 },
        { file: 'pokemon/4.json', sha256: 'def456', status: 200, bytes: 12 },
      ],
    };

    const entries = parseManifest(raw);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ path: 'pokemon/1.json', sha256: 'abc123' });
    expect(entries[1]).toEqual({ path: 'pokemon/4.json', sha256: 'def456' });
  });

  it('aceita um array no topo e descarta entradas sem sha256', () => {
    const raw = [
      { path: 'a.json', sha256: 'aaa' },
      { path: 'b.json' },
      { sha256: 'ccc' },
    ];

    const entries = parseManifest(raw);

    expect(entries).toEqual([{ path: 'a.json', sha256: 'aaa' }]);
  });
});
