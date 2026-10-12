/**
 * Property test — bot sem vantagem oculta (`lib/sim/bots/policy.test.ts`, Task 15.3).
 *
 * // Feature: pfl-simulation-engine, Property 35: Bot não recebe vantagem oculta
 *
 * **Validates: Requirements 12.1**
 *
 * R12.1 exige que todo bot rode sob o MESMO motor, as mesmas regras, o mesmo
 * `Gerador_RNG`, a mesma Fadiga e a mesma Esfera que o time do jogador — sem
 * atributos ocultos, bônus de atributos ou leitura do estado oculto do
 * adversário. A `PlayPolicy` dos bots recebe **apenas** o `PlaySelectionContext`
 * (situação pública: down, distância, posição, relógio, clima, fadiga
 * compartilhada e posse), o `PlayCatalog` e o `Rng` compartilhado.
 *
 * Esta suíte verifica, para os quatro presets (BALANCED, GROUND, AERIAL, CURTI):
 *
 * 1. **Pureza / determinismo.** `choosePlay` é função pura de
 *    `(ctx, catálogo, estado do RNG)`: o MESMO `ctx` + o MESMO seed sempre
 *    produzem a MESMA jogada (reprodutibilidade — R12.1, R12.7-adjacente).
 *
 * 2. **Restrição ao catálogo.** A jogada escolhida está sempre no
 *    `Catalogo_Jogadas` (`isInCatalog`), e é ofensiva quando `hasPossession` é
 *    verdadeiro e defensiva caso contrário — nunca uma jogada fora do catálogo.
 *
 * 3. **Nenhum canal de informação do oponente (âncora de determinismo).** O tipo
 *    `PlaySelectionContext` NÃO carrega escalação/atributos/jogada do adversário:
 *    por construção, a política é cega ao estado oculto do oponente. Afirmamos
 *    isso operacionalmente mostrando que, fixados `ctx` e seed, a escolha não
 *    muda quando qualquer fator não-contexto/não-seed varia (um "oponente"
 *    hipotético arbitrário, que a assinatura simplesmente não expõe).
 *
 * 4. **RNG apenas pelo gerador compartilhado.** O único consumo de entropia é via
 *    o `Rng` injetado: dois RNGs semeados com o mesmo seed produzem a mesma
 *    escolha e deixam o estado interno idêntico após a chamada.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createRng } from '../rng';
import { PBT_NUM_RUNS } from '../test-setup';
import type { Preset, Weather } from '../types';
import {
  isInCatalog,
  PLAY_CATALOG,
  presetPolicy,
  type PlaySelectionContext,
} from './policy';

// ---------------------------------------------------------------------------
// Arbitrários
// ---------------------------------------------------------------------------

/** Os quatro presets suportados — a ÚNICA diferença legítima entre bot e jogador. */
const presetArb = fc.constantFrom<Preset>(
  'BALANCED',
  'GROUND',
  'AERIAL',
  'CURTI',
);

/** Clima vigente arbitrário (parte pública da situação). */
const weatherArb = fc.constantFrom<Weather>(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
);

/** Seeds uint64 arbitrários para o `Gerador_RNG` compartilhado (R1.2). */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

/** Mapa de fadiga compartilhada por `instance_id` (penalidade em [0, 0.12]). */
const fatigueArb: fc.Arbitrary<ReadonlyMap<number, number>> = fc
  .array(
    fc.tuple(
      fc.integer({ min: 1, max: 22 }),
      fc.double({ min: 0, max: 0.12, noNaN: true }),
    ),
    { maxLength: 11 },
  )
  .map((pairs) => new Map<number, number>(pairs));

/**
 * `PlaySelectionContext` arbitrário — somente a situação PÚBLICA. Note que não há
 * (nem pode haver) campo de escalação/atributos/jogada do adversário: o tipo
 * expõe apenas o estado público, materializando a ausência de canal oculto.
 */
const ctxArb: fc.Arbitrary<PlaySelectionContext> = fc.record({
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 1, max: 30 }),
  fieldPosition: fc.integer({ min: 0, max: 100 }),
  gameClock: fc.integer({ min: 0, max: 9000 }),
  weather: weatherArb,
  fatigueByInstance: fatigueArb,
  hasPossession: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Propriedade 35
// ---------------------------------------------------------------------------

describe('Feature: pfl-simulation-engine, Property 35: Bot não recebe vantagem oculta', () => {
  it('escolha é pura em (ctx, seed) e sempre dentro do catálogo (R12.1)', () => {
    fc.assert(
      fc.property(ctxArb, seedArb, presetArb, (ctx, seed, preset) => {
        const policy = presetPolicy(preset);

        // Duas invocações independentes com RNGs recém-semeados com o MESMO seed.
        const first = policy.choosePlay(ctx, PLAY_CATALOG, createRng(seed));
        const second = policy.choosePlay(ctx, PLAY_CATALOG, createRng(seed));

        // (1) Determinismo: mesmo ctx + mesmo seed → mesma jogada.
        expect(second).toBe(first);

        // (2) Restrição ao catálogo: jogada sempre pertence ao Catalogo_Jogadas,
        //     ofensiva quando há posse, defensiva caso contrário (R4.3, R12.2).
        expect(isInCatalog(first)).toBe(true);
        if (ctx.hasPossession) {
          expect(PLAY_CATALOG.offense).toContain(first);
          expect(PLAY_CATALOG.defense).not.toContain(first);
        } else {
          expect(PLAY_CATALOG.defense).toContain(first);
          expect(PLAY_CATALOG.offense).not.toContain(first);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('sem canal do oponente: um "oponente" hipotético arbitrário não altera a escolha (R12.1)', () => {
    fc.assert(
      fc.property(
        ctxArb,
        seedArb,
        presetArb,
        // Estado OCULTO hipotético do adversário (escalação/atributos/jogada):
        // a assinatura de `choosePlay` não o expõe, então ele é inerte por
        // construção. Variá-lo não pode mudar a saída.
        fc.record({
          opponentPlay: fc.constantFrom(...PLAY_CATALOG.offense),
          opponentAttack: fc.integer({ min: 0, max: 999 }),
          opponentLineupSize: fc.integer({ min: 0, max: 53 }),
        }),
        (ctx, seed, preset, _hiddenOpponentState) => {
          const policy = presetPolicy(preset);

          // Baseline: escolha dependendo apenas de (ctx, catálogo, seed).
          const baseline = policy.choosePlay(ctx, PLAY_CATALOG, createRng(seed));

          // Mesma entrada pública + mesmo seed, com o estado oculto do oponente
          // variando livremente (ele sequer entra na assinatura): a saída é
          // invariante — não há vantagem oculta (R12.1).
          const again = policy.choosePlay(ctx, PLAY_CATALOG, createRng(seed));

          expect(again).toBe(baseline);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('entropia só pelo Rng compartilhado: mesmo seed → mesmo estado final e mesma escolha (R12.1, R12.7)', () => {
    fc.assert(
      fc.property(ctxArb, seedArb, presetArb, (ctx, seed, preset) => {
        const policy = presetPolicy(preset);

        const rngA = createRng(seed);
        const rngB = createRng(seed);

        const playA = policy.choosePlay(ctx, PLAY_CATALOG, rngA);
        const playB = policy.choosePlay(ctx, PLAY_CATALOG, rngB);

        // Mesma jogada e MESMO estado interno do RNG após a escolha: a política
        // consome entropia exclusivamente via o `Rng` injetado (nenhuma fonte
        // oculta de aleatoriedade altera o consumo entre execuções idênticas).
        expect(playB).toBe(playA);
        expect(rngB.state()).toEqual(rngA.state());
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('todos os quatro presets permanecem no catálogo para a mesma situação (R12.1)', () => {
    fc.assert(
      fc.property(ctxArb, seedArb, (ctx, seed) => {
        for (const preset of ['BALANCED', 'GROUND', 'AERIAL', 'CURTI'] as const) {
          const play = presetPolicy(preset).choosePlay(
            ctx,
            PLAY_CATALOG,
            createRng(seed),
          );
          expect(isInCatalog(play)).toBe(true);
          const inExpectedGroup = ctx.hasPossession
            ? PLAY_CATALOG.offense.includes(play as never)
            : PLAY_CATALOG.defense.includes(play as never);
          expect(inExpectedGroup).toBe(true);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
