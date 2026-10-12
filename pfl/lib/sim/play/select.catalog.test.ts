/**
 * Property test de jogada pertencer sempre ao catálogo (`select.catalog`) — Task 10.2.
 *
 * // Feature: pfl-simulation-engine, Property 12: Jogada selecionada pertence sempre ao catálogo
 *
 * **Validates: Requirements 4.1, 4.3, 12.2**
 *
 * *Para todo* contexto de seleção (`PlaySelectionContext`), *toda* `Estrategia`
 * (qualquer um dos 4 presets, com `playWeights` arbitrários incluindo zeros e
 * negativos) e *todo* seed do `Gerador_RNG`, a jogada escolhida pertence sempre
 * às 18 jogadas do `Catalogo_Jogadas`:
 * - `chooseOffense` devolve sempre uma `Jogada_Ofensiva` em `OFFENSIVE_PLAYS`;
 * - `chooseDefense` devolve sempre uma `Jogada_Defensiva` em `DEFENSIVE_PLAYS`;
 * - `isInCatalog(resultado)` é sempre verdadeiro;
 * - nenhuma jogada fora do catálogo é jamais produzida;
 * - `createSituationalPolicy().choosePlay` roteia por `hasPossession` (posse →
 *   ataque; sem posse → defesa) e permanece sempre dentro do catálogo.
 *
 * Este arquivo cobre SOMENTE o pertencimento ao catálogo (Property 12). As
 * demais propriedades da seleção (ordem/consumo de RNG, fórmula de peso) têm
 * arquivos dedicados.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEFENSIVE_PLAYS,
  OFFENSIVE_PLAYS,
  PLAY_CATALOG,
  SPECIAL_TEAMS_PLAYS,
  chooseDefense,
  chooseOffense,
  createSituationalPolicy,
  isInCatalog,
  type PlaySelectionContext,
} from './select';
import { createRng } from '../rng';
import type { PlayId, Preset, Strategy, Weather } from '../types';

// ---------------------------------------------------------------------------
// Conjuntos canônicos para asserções de pertencimento
// ---------------------------------------------------------------------------

/** As 6 jogadas ofensivas do catálogo, como `Set` para checagem O(1). */
const OFFENSE_SET: ReadonlySet<PlayId> = new Set<PlayId>(OFFENSIVE_PLAYS);

/** As 6 jogadas defensivas do catálogo, como `Set` para checagem O(1). */
const DEFENSE_SET: ReadonlySet<PlayId> = new Set<PlayId>(DEFENSIVE_PLAYS);

/** O conjunto completo das 18 jogadas do `Catalogo_Jogadas`. */
const ALL_CATALOG: ReadonlySet<PlayId> = new Set<PlayId>([
  ...OFFENSIVE_PLAYS,
  ...DEFENSIVE_PLAYS,
  ...SPECIAL_TEAMS_PLAYS,
]);

/** Os quatro presets de estilo possíveis. */
const PRESETS: readonly Preset[] = ['BALANCED', 'GROUND', 'AERIAL', 'CURTI'];

/** Os cinco climas possíveis. */
const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];

/**
 * Nomes de jogadas usados como chaves de `playWeights` arbitrários. Inclui as
 * 18 jogadas reais do catálogo mais algumas chaves espúrias que NÃO existem no
 * catálogo: pesos sobre chaves inexistentes nunca podem introduzir uma jogada
 * fora do catálogo, pois a seleção itera somente sobre o `catalog`.
 */
const WEIGHT_KEYS: readonly string[] = [
  ...OFFENSIVE_PLAYS,
  ...DEFENSIVE_PLAYS,
  ...SPECIAL_TEAMS_PLAYS,
  'O_NOT_A_PLAY',
  'D_FAKE',
  'ZZZ_UNKNOWN',
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * `playWeights` arbitrário: mapa parcial de chave → peso, com pesos que
 * incluem explicitamente zeros, negativos e positivos (fronteiras do sorteio
 * ponderado). Pode também ser `undefined` (a estratégia usa só o preset).
 */
const playWeightsArb: fc.Arbitrary<Record<string, number> | undefined> =
  fc.option(
    fc.dictionary(
      fc.constantFrom(...WEIGHT_KEYS),
      // Pesos de borda: negativos, zero e positivos (inteiros e fracionários).
      fc.oneof(
        fc.constantFrom(-5, -1, 0, 0.0, 1, 2.5),
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
      ),
    ),
    { nil: undefined },
  );

/** `Strategy` arbitrária: qualquer preset + `playWeights` de borda + priorities. */
const strategyArb: fc.Arbitrary<Strategy> = fc.record({
  preset: fc.constantFrom(...PRESETS),
  playWeights: playWeightsArb,
  priorities: fc.option(
    fc.dictionary(fc.string(), fc.double({ noNaN: true })),
    { nil: undefined },
  ),
}) as fc.Arbitrary<Strategy>;

/**
 * `PlaySelectionContext` arbitrário cobrindo todo o espaço de entrada relevante:
 * down 1..4, distância 0..30, posição 0..100, relógio 0..9000 décimos, clima
 * qualquer, fadiga arbitrária por `instance_id` (penalidades em [0, 0.12]) e
 * `hasPossession` controlado pelo caller (ataque vs. defesa).
 */
function contextArb(hasPossession: boolean): fc.Arbitrary<PlaySelectionContext> {
  return fc.record({
    down: fc.integer({ min: 1, max: 4 }),
    distance: fc.integer({ min: 0, max: 30 }),
    fieldPosition: fc.integer({ min: 0, max: 100 }),
    gameClock: fc.integer({ min: 0, max: 9000 }),
    weather: fc.constantFrom(...WEATHERS),
    fatigueByInstance: fc
      .array(
        fc.tuple(
          fc.integer({ min: 0, max: 200 }),
          fc.double({ min: 0, max: 0.12, noNaN: true }),
        ),
        { maxLength: 12 },
      )
      .map((pairs) => new Map<number, number>(pairs)),
    hasPossession: fc.constant(hasPossession),
  });
}

/** Seeds uint64 arbitrários para o `Gerador_RNG`. */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

// ---------------------------------------------------------------------------
// Property 12 — jogada selecionada pertence sempre ao catálogo
// ---------------------------------------------------------------------------

describe('select — Property 12 (jogada pertence sempre ao catálogo)', () => {
  it('chooseOffense sempre devolve uma Jogada_Ofensiva do catálogo (R4.1, R4.3, R12.2)', () => {
    fc.assert(
      fc.property(
        contextArb(true),
        strategyArb,
        seedArb,
        (ctx, strategy, seed) => {
          const play = chooseOffense(ctx, PLAY_CATALOG, strategy, createRng(seed));

          // Pertence às 6 ofensivas, está no catálogo, e nunca é defensiva/ST.
          expect(OFFENSE_SET.has(play)).toBe(true);
          expect(isInCatalog(play)).toBe(true);
          expect(ALL_CATALOG.has(play)).toBe(true);
          expect(DEFENSE_SET.has(play)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('chooseDefense sempre devolve uma Jogada_Defensiva do catálogo (R4.1, R4.3, R12.2)', () => {
    fc.assert(
      fc.property(
        contextArb(false),
        strategyArb,
        seedArb,
        (ctx, strategy, seed) => {
          const play = chooseDefense(ctx, PLAY_CATALOG, strategy, createRng(seed));

          // Pertence às 6 defensivas, está no catálogo, e nunca é ofensiva/ST.
          expect(DEFENSE_SET.has(play)).toBe(true);
          expect(isInCatalog(play)).toBe(true);
          expect(ALL_CATALOG.has(play)).toBe(true);
          expect(OFFENSE_SET.has(play)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('createSituationalPolicy().choosePlay roteia por hasPossession e fica no catálogo (R4.1, R4.3, R12.2)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        strategyArb,
        seedArb,
        (hasPossession, strategy, seed) => {
          const ctxArb = contextArb(hasPossession);
          // Amostra um contexto consistente com o lado de posse sob teste.
          const ctx = fc.sample(ctxArb, { numRuns: 1, seed: Number(seed % 2147483647n) })[0]!;

          const policy = createSituationalPolicy(strategy);
          const play = policy.choosePlay(ctx, PLAY_CATALOG, createRng(seed));

          // Sempre no catálogo (18 jogadas).
          expect(isInCatalog(play)).toBe(true);
          expect(ALL_CATALOG.has(play)).toBe(true);

          // Roteamento por posse: ataque escolhe ofensiva; defesa, defensiva.
          if (hasPossession) {
            expect(OFFENSE_SET.has(play)).toBe(true);
            expect(DEFENSE_SET.has(play)).toBe(false);
          } else {
            expect(DEFENSE_SET.has(play)).toBe(true);
            expect(OFFENSE_SET.has(play)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mesmo com todos os pesos <= 0, a seleção cai no fallback do catálogo (nunca inventa jogada)', () => {
    // Estratégia que zera/nega todas as 18 jogadas do catálogo: força o caminho
    // de fallback de `weightedChoice` (nenhuma opção com peso positivo).
    const zeroWeights: Record<string, number> = {};
    for (const key of [...OFFENSIVE_PLAYS, ...DEFENSIVE_PLAYS, ...SPECIAL_TEAMS_PLAYS]) {
      zeroWeights[key] = 0;
    }

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom(...PRESETS),
        seedArb,
        (hasPossession, preset, seed) => {
          const strategy: Strategy = { preset, playWeights: zeroWeights };
          const ctx: PlaySelectionContext = {
            down: 1,
            distance: 10,
            fieldPosition: 25,
            gameClock: 9000,
            weather: 'CLEAR',
            fatigueByInstance: new Map(),
            hasPossession,
          };

          const play = hasPossession
            ? chooseOffense(ctx, PLAY_CATALOG, strategy, createRng(seed))
            : chooseDefense(ctx, PLAY_CATALOG, strategy, createRng(seed));

          expect(isInCatalog(play)).toBe(true);
          expect(ALL_CATALOG.has(play)).toBe(true);
          expect(hasPossession ? OFFENSE_SET.has(play) : DEFENSE_SET.has(play)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
