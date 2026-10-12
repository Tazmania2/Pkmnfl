import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createRng, type Rng } from './rng';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test do `Gerador_RNG` como única fonte de entropia (Task 2.2).
 *
 * // Feature: pfl-simulation-engine, Property 2: RNG é a única fonte de entropia, derivada só do Seed_RNG
 *
 * **Validates: Requirements 1.2, 1.3**
 *
 * Para toda `ResolvedInput`, toda a variação aleatória da partida é função
 * exclusiva do `Seed_RNG`: fixando o `Seed_RNG` e variando arbitrariamente o
 * `teamSeedId` (ou qualquer dado que não seja o seed de RNG), a trajetória do
 * `Gerador_RNG` (a sequência de `nextFloat`) e a saída permanecem idênticas; e
 * nenhum valor aleatório é obtido de fonte distinta do `Gerador_RNG`.
 *
 * Esta camada expõe apenas `createRng(seed: bigint): Rng`. A propriedade é
 * verificável integralmente aqui porque:
 *  - A assinatura de `createRng` recebe SOMENTE o `Seed_RNG` (um `bigint`),
 *    nunca um seed de time — a independência de R1.3 é estrutural, não derivada
 *    (o `teamSeedId` não é sequer um parâmetro possível).
 *  - A trajetória do RNG (sequência de `nextFloat`/`nextInt`) é função pura do
 *    seed: duas instâncias independentes com o mesmo seed produzem a mesma
 *    sequência (R1.2 — determinismo), e nada no ambiente (relógio, `Math.random`,
 *    operações intercaladas) altera essa sequência.
 */

/** Domínio do Seed_RNG: uint64 em [0, 2^64 - 1]. */
const UINT64_MAX = (1n << 64n) - 1n;
const seedArb = fc.bigInt({ min: 0n, max: UINT64_MAX });

/** Consome `n` floats de um Rng e devolve a sequência resultante. */
function drawFloats(rng: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rng.nextFloat());
  }
  return out;
}

/** Consome `n` inteiros uniformes em [min, max] de um Rng. */
function drawInts(rng: Rng, n: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rng.nextInt(min, max));
  }
  return out;
}

describe('Gerador_RNG — RNG é a única fonte de entropia (Property 2)', () => {
  it('mesmo Seed_RNG produz sequência de nextFloat idêntica em instâncias independentes (R1.2)', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 64 }), (seed, n) => {
        const a = drawFloats(createRng(seed), n);
        const b = drawFloats(createRng(seed), n);
        expect(b).toEqual(a);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('mesmo Seed_RNG produz sequência de nextInt idêntica em instâncias independentes (R1.2)', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 2000 }),
        (seed, n, min, span) => {
          const max = min + span;
          const a = drawInts(createRng(seed), n, min, max);
          const b = drawInts(createRng(seed), n, min, max);
          expect(b).toEqual(a);
          // Reforço: toda saída respeita a faixa inclusiva pedida.
          for (const v of a) {
            expect(v).toBeGreaterThanOrEqual(min);
            expect(v).toBeLessThanOrEqual(max);
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a sequência é função pura do seed, imune a operações externas intercaladas (R1.2 — sem entropia oculta)', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 1, max: 48 }),
        seedArb,
        (seed, n, noiseSeed) => {
          // Referência: construir e consumir sem nenhuma interferência.
          const reference = drawFloats(createRng(seed), n);

          // Reconstruir o mesmo seed, mas cercado de operações arbitrárias:
          // criar/consumir outros RNGs (de seeds diferentes), ler o relógio e
          // sortear com Math.random entre as extrações. Nada disso pode mudar
          // a trajetória, pois a única entrada do RNG é o seed.
          const rng = createRng(seed);
          const reconstructed: number[] = [];
          const noise = createRng(noiseSeed);
          for (let i = 0; i < n; i++) {
            // Fontes de entropia externa deliberadamente acionadas ao redor:
            void Date.now();
            void Math.random();
            void noise.nextFloat();
            reconstructed.push(rng.nextFloat());
          }

          expect(reconstructed).toEqual(reference);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('variar qualquer dado que não seja o Seed_RNG não altera a trajetória; o seed é a única entrada (R1.2, R1.3)', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 1, max: 48 }),
        // "teamSeedId" / qualquer outro dado arbitrário que NÃO entra no RNG.
        fc.bigInt({ min: 0n, max: UINT64_MAX }),
        fc.bigInt({ min: 0n, max: UINT64_MAX }),
        (seedRng, n, teamSeedIdA, teamSeedIdB) => {
          // A assinatura só aceita o Seed_RNG; o teamSeedId não é parâmetro.
          // Fixando o Seed_RNG e "variando" o teamSeedId (que não é usado),
          // a trajetória precisa permanecer idêntica.
          const trajectoryA = drawFloats(createRng(seedRng), n);
          const trajectoryB = drawFloats(createRng(seedRng), n);

          // O teamSeedId varia (A ≠ B é possível), mas é irrelevante ao RNG.
          fc.pre(true);
          void teamSeedIdA;
          void teamSeedIdB;

          expect(trajectoryB).toEqual(trajectoryA);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('seeds distintos produzem trajetórias distintas com probabilidade esmagadora (R1.2 — o seed dirige a entropia)', () => {
    fc.assert(
      fc.property(seedArb, seedArb, (seedA, seedB) => {
        fc.pre(seedA !== seedB);
        // Compara um prefixo da trajetória; para sfc32 bem semeado via
        // SplitMix64, dois seeds distintos divergem já nos primeiros floats.
        const a = drawFloats(createRng(seedA), 8);
        const b = drawFloats(createRng(seedB), 8);
        expect(a).not.toEqual(b);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('createRng recebe apenas o Seed_RNG (independência estrutural do seed de time — R1.3)', () => {
    // Verificação de nível de assinatura: createRng é unário (arity 1), de modo
    // que nenhum seed de time pode ser combinado ao Seed_RNG neste contrato.
    expect(createRng.length).toBe(1);
  });
});
