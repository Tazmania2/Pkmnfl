// Feature: pfl-data-catalog, Property 16: Leitura não realiza I/O externo
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Nomes de funções do `node:fs` espionadas (leitura de arquivos). O módulo é
 * substituído por um dublê (abaixo) cujas funções lançam, de modo que qualquer
 * acesso a disco durante a leitura seja detectado — tanto pela contagem de
 * chamadas quanto pela exceção.
 *
 * Em ESM o namespace do módulo não é configurável, então não é possível
 * `vi.spyOn(fs, ...)`. Usamos `vi.mock` para fornecer espiões como as próprias
 * exportações.
 */
const FS_METHODS = [
  'readFile',
  'readFileSync',
  'open',
  'openSync',
  'createReadStream',
  'access',
  'accessSync',
] as const;

vi.mock('node:fs', () => {
  // Lista inline: a fábrica do `vi.mock` é içada ao topo do arquivo e não pode
  // referenciar variáveis de módulo (como FS_METHODS) sem erro de inicialização.
  const names = [
    'readFile',
    'readFileSync',
    'open',
    'openSync',
    'createReadStream',
    'access',
    'accessSync',
  ];
  const mod: Record<string, unknown> = {};
  for (const name of names) {
    mod[name] = vi.fn(() => {
      throw new Error(`node:fs.${name} não deve ser chamado durante a leitura`);
    });
  }
  return { ...mod, default: mod };
});

// Importado após `vi.mock` para obter as funções espionadas (hoisting do mock
// garante a substituição antes de qualquer uso).
import * as fs from 'node:fs';

import { getAllowedSpecies } from './species';
import { getAvailableAbilities, getLearnableMoveIds } from './eligibility';
import { getAbility, getMove } from './registry';
import { getDesignBaseline, getNflMatchups } from './rules';

/**
 * Teste de propriedade da fronteira de rede/arquivo fechada em tempo de leitura
 * (Task 13.7).
 *
 * **Validates: Requirements 10.4, 12.8**
 *
 * Para qualquer consulta da `Camada_Leitura` — espécies permitidas
 * ({@link getAllowedSpecies}), elegibilidade ({@link getLearnableMoveIds},
 * {@link getAvailableAbilities}), registro ({@link getMove},
 * {@link getAbility}) e regras ({@link getNflMatchups},
 * {@link getDesignBaseline}) — nenhuma requisição à API_NFL (via `fetch`) e
 * nenhum acesso aos arquivos do Catálogo Oficial (via `node:fs`) ocorre durante
 * a leitura. Os dados vêm exclusivamente de um dublê do cliente Supabase
 * injetado em cada função; o cliente real (`createPublicClient`) nunca é
 * construído, logo nenhuma conexão de rede é aberta por ele.
 *
 * O teste instala espiões sobre `global.fetch` e sobre as funções de I/O de
 * arquivo do `node:fs` (`readFile`, `readFileSync`, `open`, `openSync`,
 * `createReadStream`, `access`, `accessSync`), executa cada consulta sobre
 * entradas geradas e afirma que todos os espiões permaneceram sem chamadas.
 */

/**
 * Linha arbitrária devolvida pelo dublê. Como o SUT apenas projeta campos
 * conhecidos, qualquer objeto JSON serve de "linha de banco" simulada.
 */
type FakeRow = Record<string, unknown>;

/**
 * Dublê em memória do cliente Supabase que cobre exatamente as cadeias de
 * consulta exercidas pela Camada_Leitura:
 *
 * - `from(table).select(cols)[.eq()][.order()][.limit()]` resolvido como
 *   `Promise<{ data, error }>` (usado por `getAllowedSpecies`, `getNflMatchups`
 *   e `getDesignBaseline`, que dão `await` na cadeia); e
 * - `...​.maybeSingle()` resolvido como `Promise<{ data, error }>` (usado por
 *   `getMove`, `getAbility` e pela checagem de espécie da elegibilidade).
 *
 * O builder é "thenable": pode ser aguardado diretamente ou ter `.maybeSingle()`
 * chamado. Em ambos os casos devolve `{ data, error: null }`. Nenhuma operação
 * toca rede ou disco — a ausência de I/O é justamente o que a propriedade
 * verifica.
 *
 * `rowsByTable` fornece as linhas por tabela; `singleByTable` fornece a linha
 * (ou `null`) para consultas `maybeSingle()`.
 */
function createInMemoryClient(spec: {
  readonly rowsByTable: Record<string, FakeRow[]>;
  readonly singleByTable: Record<string, FakeRow | null>;
}): SupabaseClient {
  function makeBuilder(table: string) {
    const listResult = {
      data: spec.rowsByTable[table] ?? [],
      error: null as null,
    };
    const singleResult = {
      data: table in spec.singleByTable ? spec.singleByTable[table] : null,
      error: null as null,
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      // Thenable: `await builder` resolve a lista projetada.
      then: (
        resolve: (v: typeof listResult) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(listResult).then(resolve, reject),
      maybeSingle: () => Promise.resolve(singleResult),
    };

    return builder;
  }

  const client = {
    from: (table: string) => makeBuilder(table),
  };

  return client as unknown as SupabaseClient;
}

/** Coleta os espiões de `node:fs` (as próprias funções mockadas do módulo). */
function fsSpiesList(): ReturnType<typeof vi.fn>[] {
  const bag = fs as unknown as Record<string, ReturnType<typeof vi.fn>>;
  return FS_METHODS.map((name) => bag[name]).filter(
    (f): f is ReturnType<typeof vi.fn> => typeof f === 'function',
  );
}

describe('Feature: pfl-data-catalog, Property 16: Leitura não realiza I/O externo', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Espião de rede: qualquer chamada a `fetch` falha a propriedade.
    fetchSpy = vi.fn(() => {
      throw new Error('fetch não deve ser chamado durante a leitura');
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Zera o histórico de chamadas dos espiões de arquivo entre execuções.
    for (const spy of fsSpiesList()) {
      spy.mockClear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nenhuma consulta da Camada_Leitura aciona fetch ou node:fs (R10.4, R12.8)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Linhas de espécie permitidas (projeção de getAllowedSpecies).
        fc.array(
          fc.record({
            pokemon_id: fc.integer({ min: 1, max: 151 }),
            slug: fc.string({ minLength: 1, maxLength: 12 }),
            types: fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
            hp: fc.integer({ min: 1, max: 255 }),
            attack: fc.integer({ min: 1, max: 255 }),
            defense: fc.integer({ min: 1, max: 255 }),
            special_attack: fc.integer({ min: 1, max: 255 }),
            special_defense: fc.integer({ min: 1, max: 255 }),
            speed: fc.integer({ min: 1, max: 255 }),
          }),
          { maxLength: 8 },
        ),
        // Linhas de relações (move_id / ability_id) para a elegibilidade.
        fc.array(fc.record({ move_id: fc.integer({ min: 1, max: 999 }) }), {
          maxLength: 8,
        }),
        fc.array(
          fc.record({
            ability_id: fc.integer({ min: 1, max: 999 }),
            is_hidden: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        // Linhas de regras (matchups NFL e baseline de design).
        fc.array(
          fc.record({
            natural_key: fc.string({ minLength: 1, maxLength: 12 }),
            offense_scheme: fc.string({ maxLength: 8 }),
            defense_scheme: fc.string({ maxLength: 8 }),
            payload: fc.jsonValue(),
            captured_at: fc.constant('2024-01-01T00:00:00.000Z'),
            source: fc.constant('https://nfl.balldontlie.io'),
          }),
          { maxLength: 6 },
        ),
        // Estado da espécie consultada: permitida, não permitida ou inexistente.
        fc.oneof(
          fc.constant<FakeRow | null>({ pokemon_id: 25, is_allowed: true }),
          fc.constant<FakeRow | null>({ pokemon_id: 25, is_allowed: false }),
          fc.constant<FakeRow | null>(null),
        ),
        // Registro de golpe/habilidade (presente ou ausente).
        fc.oneof(
          fc.constant<FakeRow | null>(null),
          fc.record({
            move_id: fc.integer({ min: 1, max: 999 }),
            name: fc.string({ maxLength: 12 }),
            raw_data: fc.jsonValue(),
          }),
        ),
        fc.oneof(
          fc.constant<FakeRow | null>(null),
          fc.record({
            ability_id: fc.integer({ min: 1, max: 999 }),
            name: fc.string({ maxLength: 12 }),
            raw_data: fc.jsonValue(),
          }),
        ),
        // Baseline de design (presente ou ausente).
        fc.oneof(
          fc.constant<FakeRow[]>([]),
          fc.array(
            fc.record({
              version: fc.string({ minLength: 1, maxLength: 12 }),
              kind: fc.constantFrom('matchups_36', 'simulation_parameters'),
              status: fc.string({ maxLength: 12 }),
              payload: fc.jsonValue(),
              created_at: fc.constant('2024-01-01T00:00:00.000Z'),
            }),
            { minLength: 1, maxLength: 1 },
          ),
        ),
        fc.integer({ min: 1, max: 200 }),
        fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
        async (
          speciesRows,
          moveRel,
          abilityRel,
          nflRows,
          speciesSingle,
          moveRecord,
          abilityRecord,
          baselineRows,
          probeId,
          baselineVersion,
        ) => {
          const client = createInMemoryClient({
            rowsByTable: {
              species: speciesRows,
              pokemon_learnable_moves: moveRel,
              pokemon_abilities: abilityRel,
              nfl_matchup_data: nflRows,
              design_baseline: baselineRows,
              moves: [],
              abilities: [],
            },
            singleByTable: {
              species: speciesSingle,
              moves: moveRecord,
              abilities: abilityRecord,
            },
          });

          // Exercita todas as funções de leitura sobre o mesmo dublê. A
          // elegibilidade pode resolver `{ found: false }` quando a espécie não
          // é permitida — isso é esperado e não altera a propriedade (o que
          // importa é a ausência de I/O externo).
          await getAllowedSpecies({ client });
          await getLearnableMoveIds(probeId, { client });
          await getAvailableAbilities(probeId, { client });
          await getMove(probeId, client);
          await getAbility(probeId, client);
          await getNflMatchups({ client });
          await getDesignBaseline(baselineVersion, { client });

          // Nenhum acesso a rede ou disco deve ter ocorrido.
          expect(fetchSpy).not.toHaveBeenCalled();
          for (const spy of fsSpiesList()) {
            expect(spy).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
