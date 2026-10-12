/**
 * Property test — preservação do time importado no modo seed de terceiros
 * (`lib/sim/bots/seededBot.test.ts`, Task 15.4).
 *
 * // Feature: pfl-simulation-engine, Property 36: Preservação do time importado no modo seed de terceiros
 *
 * **Validates: Requirements 12.4**
 *
 * R12.4 exige que, no modo "seed de terceiros", o time importado seja mantido
 * **exatamente** como importado: nenhum atributo de atleta é modificado. O
 * módulo `seededBot.ts` materializa essa invariante com `preserveImportedLineup`,
 * que é a identidade sobre a `ResolvedLineup` (mesma referência, sem clone nem
 * mutação), e provê a IA do preset padrão (`BALANCED`) via
 * `createSeededBotPolicy`, sem jamais tocar na escalação.
 *
 * Esta suíte verifica, sobre uma `ResolvedLineup` arbitrária:
 *
 * 1. **Identidade / byte-identidade.** `preserveImportedLineup(lineup)` devolve
 *    uma escalação deep-equal à entrada e, de fato, a MESMA referência — provando
 *    que nenhum atributo (stats, moveIds, abilityId, instanceId,
 *    positionDesignation, types, teamSeedId) sofre drift por clone ou mutação.
 *
 * 2. **Não mutação da entrada.** O objeto `lineup` de entrada permanece idêntico
 *    a um snapshot profundo tirado antes da chamada (nenhuma mutação lateral).
 *
 * 3. **Política padrão válida e sem efeito colateral na escalação.**
 *    `createSeededBotPolicy()` produz uma `PlayPolicy` do preset `BALANCED` cuja
 *    escolha permanece sempre dentro do `Catalogo_Jogadas`, e invocá-la não
 *    altera a escalação importada (o snapshot continua intacto após o uso).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createRng } from '../rng';
import { PBT_NUM_RUNS } from '../test-setup';
import type {
  AthleteStats,
  LineupUnit,
  Position,
  ResolvedAthlete,
  ResolvedLineup,
  Weather,
} from '../types';
import {
  createSeededBotPolicy,
  preserveImportedLineup,
  SEEDED_BOT_DEFAULT_PRESET,
} from './seededBot';
import {
  isInCatalog,
  PLAY_CATALOG,
  type PlaySelectionContext,
} from './policy';

// ---------------------------------------------------------------------------
// Arbitrários — ResolvedLineup variada (stats/moveIds/abilityId/instanceId/...)
// ---------------------------------------------------------------------------

/** Posições funcionais do `Validador_Funcoes`. */
const positionArb = fc.constantFrom<Position>(
  'QB',
  'C',
  'RB',
  'WR',
  'TE',
  'CB',
  'S',
  'K',
  'P',
  'OL',
  'DL',
  'LB',
);

/** Estatística base inteira num intervalo plausível. */
const statArb = fc.integer({ min: 1, max: 255 });

/** As seis estatísticas base de um atleta. */
const statsArb: fc.Arbitrary<AthleteStats> = fc.record({
  hp: statArb,
  attack: statArb,
  defense: statArb,
  specialAttack: statArb,
  specialDefense: statArb,
  speed: statArb,
});

/** Exatamente quatro golpes por atleta (contrato da foundation). */
const moveIdsArb: fc.Arbitrary<readonly [number, number, number, number]> =
  fc.tuple(
    fc.integer({ min: 1, max: 900 }),
    fc.integer({ min: 1, max: 900 }),
    fc.integer({ min: 1, max: 900 }),
    fc.integer({ min: 1, max: 900 }),
  );

/** Atleta resolvido com atributos variados. */
const athleteArb: fc.Arbitrary<ResolvedAthlete> = fc.record({
  instanceId: fc.integer({ min: 1, max: 1000 }),
  pokemonId: fc.integer({ min: 1, max: 1025 }),
  types: fc.array(
    fc.constantFrom('NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC'),
    { minLength: 1, maxLength: 2 },
  ),
  stats: statsArb,
  abilityId: fc.integer({ min: 1, max: 300 }),
  moveIds: moveIdsArb,
  additionalEffectIds: fc.array(
    fc.constantFrom('eff-a', 'eff-b', 'eff-c'),
    { maxLength: 3 },
  ),
  positionDesignation: positionArb,
});

/** Lista pequena e não-vazia de atletas de uma unidade. */
const unitArb: fc.Arbitrary<ReadonlyArray<ResolvedAthlete>> = fc.array(
  athleteArb,
  { minLength: 1, maxLength: 5 },
);

/** `ResolvedLineup` arbitrária com as três unidades e `teamSeedId` opcional. */
const lineupArb: fc.Arbitrary<ResolvedLineup> = fc.record({
  teamSeedId: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
    nil: undefined,
  }),
  units: fc.record<Record<LineupUnit, ReadonlyArray<ResolvedAthlete>>>({
    offense: unitArb,
    defense: unitArb,
    specialTeams: unitArb,
  }),
});

/** Clima vigente arbitrário (parte pública da situação). */
const weatherArb = fc.constantFrom<Weather>(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
);

/** `PlaySelectionContext` arbitrário (situação pública) para exercitar a política. */
const ctxArb: fc.Arbitrary<PlaySelectionContext> = fc.record({
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 1, max: 30 }),
  fieldPosition: fc.integer({ min: 0, max: 100 }),
  gameClock: fc.integer({ min: 0, max: 9000 }),
  weather: weatherArb,
  fatigueByInstance: fc
    .array(
      fc.tuple(
        fc.integer({ min: 1, max: 22 }),
        fc.double({ min: 0, max: 0.12, noNaN: true }),
      ),
      { maxLength: 11 },
    )
    .map((pairs) => new Map<number, number>(pairs)),
  hasPossession: fc.boolean(),
});

/** Seeds uint64 arbitrários para o `Gerador_RNG` compartilhado. */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

// ---------------------------------------------------------------------------
// Propriedade 36
// ---------------------------------------------------------------------------

describe('Feature: pfl-simulation-engine, Property 36: Preservação do time importado no modo seed de terceiros', () => {
  it('preserveImportedLineup é identidade: deep-equal e mesma referência (R12.4)', () => {
    fc.assert(
      fc.property(lineupArb, (lineup) => {
        // Snapshot profundo da entrada ANTES da chamada.
        const before = structuredClone(lineup);

        const result = preserveImportedLineup(lineup);

        // (1a) Byte-identidade estrutural: resultado deep-equal à entrada
        //      (comparação estrutural, agnóstica ao protótipo do snapshot clonado).
        expect(result).toEqual(before);
        // (1b) Identidade de referência: nenhum clone — mesma referência imutável,
        //      prova mais forte de que nenhum atributo pôde sofrer drift.
        expect(result).toBe(lineup);

        // (2) Não mutação: a entrada continua idêntica ao snapshot inicial.
        expect(lineup).toEqual(before);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('createSeededBotPolicy usa o preset padrão (BALANCED) e escolhe dentro do catálogo, sem alterar a escalação (R12.4)', () => {
    // O modo seed de terceiros aplica o preset padrão documentado.
    expect(SEEDED_BOT_DEFAULT_PRESET).toBe('BALANCED');

    fc.assert(
      fc.property(lineupArb, ctxArb, seedArb, (lineup, ctx, seed) => {
        const before = structuredClone(lineup);

        const policy = createSeededBotPolicy();
        const play = policy.choosePlay(ctx, PLAY_CATALOG, createRng(seed));

        // (3a) A escolha pertence sempre ao Catalogo_Jogadas, coerente com a posse.
        expect(isInCatalog(play)).toBe(true);
        if (ctx.hasPossession) {
          expect(PLAY_CATALOG.offense).toContain(play);
        } else {
          expect(PLAY_CATALOG.defense).toContain(play);
        }

        // (3b) A escalação importada permanece intacta: a política não a toca.
        expect(lineup).toEqual(before);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
