import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { runSimulation } from './simulate-client';
import type { SimulateInput } from './types';
import type {
  BotMode,
  LineupInput,
  StrategyInput,
  SimulateRequest,
} from './contracts';

/**
 * Teste de propriedade: o `Seed_RNG` enviado ao motor é independente do seed de
 * time (Task 9.3).
 *
 * // Feature: pfl-gameday-result-ui, Property 8: Seed_RNG é independente do seed de time
 *
 * **Validates: Requirements 6.2**
 *
 * *Para todo* par (seed de time, `Seed_RNG`), o `seed` enviado ao motor em
 * `POST /api/simulate` é exatamente o `input.seedRng` fornecido. Em particular:
 *
 * - o `seed` do corpo da requisição é **sempre** `input.seedRng`,
 *   independentemente do `teamSeedId` carregado pelas escalações — presente,
 *   ausente, igual ou diferente do `seedRng`;
 * - **variar o `teamSeedId`** (de qualquer das escalações) mantendo o `seedRng`
 *   **fixo** NÃO altera o `seed` enviado;
 * - **variar o `seedRng`** mantendo o `teamSeedId` **fixo** altera o `seed`
 *   enviado para casar com o novo `seedRng`.
 *
 * Juntas, essas invariâncias provam que o `Seed_RNG` é um campo próprio da
 * entrada e **nunca** é derivado do seed de time (R6.2).
 *
 * A borda de rede (`fetch`) é mockada para capturar o corpo serializado e
 * devolver um 200 `{ log, score }` mínimo; `fetch` é restaurado após cada teste.
 */

/** `Seed_RNG`/`teamSeedId` como string decimal uint64, com casos degenerados. */
const arbitrarySeedString: fc.Arbitrary<string> = fc.oneof(
  fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((n) => n.toString()),
  fc.constantFrom('0', '1', '18446744073709551615'),
);

/** `teamSeedId`: pode estar ausente (`undefined`) ou ser uma string de seed. */
const arbitraryTeamSeedId: fc.Arbitrary<string | undefined> = fc.option(
  arbitrarySeedString,
  { nil: undefined },
);

const arbitraryBotMode: fc.Arbitrary<BotMode> = fc.constantFrom(
  'random',
  'curti',
  'seeded',
);

const arbitraryStrategy: fc.Arbitrary<StrategyInput> = fc.record({
  preset: fc.constantFrom('EQUILIBRADO', 'AGRESSIVO', 'DEFENSIVO'),
});

/** `LineupInput` mínimo (sem atletas), parametrizado pelo `teamSeedId`. */
function makeLineup(teamSeedId: string | undefined): LineupInput {
  const units = {
    offense: [] as const,
    defense: [] as const,
    specialTeams: [] as const,
  };
  return teamSeedId === undefined ? { units } : { teamSeedId, units };
}

/**
 * Instala um mock de `fetch` que captura o `seed` do corpo serializado de cada
 * chamada e sempre responde 200 `{ log, score }` mínimo. Retorna o array de
 * seeds capturados (na ordem das chamadas).
 */
function installFetchCapture(): string[] {
  const capturedSeeds: string[] = [];
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as SimulateRequest;
    capturedSeeds.push(body.seed);
    return new Response(JSON.stringify({ log: {}, score: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
  return capturedSeeds;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runSimulation — Property 8: Seed_RNG independente do seed de time', () => {
  it('o seed enviado é sempre input.seedRng, qualquer que seja o teamSeedId (R6.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrarySeedString, // seedRng, gerado independentemente...
        arbitraryTeamSeedId, // ...do teamSeedId do time do jogador...
        arbitraryTeamSeedId, // ...e do time do adversário.
        arbitraryStrategy,
        arbitraryStrategy,
        arbitraryBotMode,
        async (
          seedRng,
          homeTeamSeedId,
          awayTeamSeedId,
          playerStrategy,
          adversaryStrategy,
          botModeAway,
        ) => {
          const captured = installFetchCapture();

          const input: SimulateInput = {
            playerLineup: makeLineup(homeTeamSeedId),
            playerStrategy,
            adversaryLineup: makeLineup(awayTeamSeedId),
            adversaryStrategy,
            seedRng,
            botModeAway,
          };

          await runSimulation(input);

          // Uma única chamada (R5.2), e o seed enviado é exatamente o seedRng.
          expect(captured).toHaveLength(1);
          expect(captured[0]).toBe(seedRng);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('variar o teamSeedId com seedRng fixo NÃO muda o seed enviado (R6.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrarySeedString, // seedRng fixo entre as duas chamadas
        arbitraryTeamSeedId, // teamSeedId variante A
        arbitraryTeamSeedId, // teamSeedId variante B
        async (seedRng, teamSeedA, teamSeedB) => {
          const captured = installFetchCapture();

          const base: Omit<SimulateInput, 'playerLineup' | 'adversaryLineup'> = {
            playerStrategy: { preset: 'EQUILIBRADO' },
            adversaryStrategy: { preset: 'EQUILIBRADO' },
            seedRng,
            botModeAway: 'random',
          };

          // Mesmo seedRng, teamSeedId diferentes nas duas escalações.
          await runSimulation({
            ...base,
            playerLineup: makeLineup(teamSeedA),
            adversaryLineup: makeLineup(teamSeedB),
          });
          await runSimulation({
            ...base,
            playerLineup: makeLineup(teamSeedB),
            adversaryLineup: makeLineup(teamSeedA),
          });

          // Ambas as chamadas enviam o mesmo seed (= seedRng), sem influência do time.
          expect(captured).toEqual([seedRng, seedRng]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('variar o seedRng com teamSeedId fixo muda o seed enviado para o novo seedRng (R6.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrarySeedString,
        arbitrarySeedString,
        arbitraryTeamSeedId, // teamSeedId fixo entre as duas chamadas
        async (seedRngA, seedRngB, teamSeedId) => {
          // Só nos interessa o caso em que os dois seeds de RNG diferem.
          fc.pre(seedRngA !== seedRngB);

          const captured = installFetchCapture();

          const fixedLineups = {
            playerLineup: makeLineup(teamSeedId),
            adversaryLineup: makeLineup(teamSeedId),
            playerStrategy: { preset: 'EQUILIBRADO' } as StrategyInput,
            adversaryStrategy: { preset: 'EQUILIBRADO' } as StrategyInput,
            botModeAway: 'random' as BotMode,
          };

          await runSimulation({ ...fixedLineups, seedRng: seedRngA });
          await runSimulation({ ...fixedLineups, seedRng: seedRngB });

          // O seed enviado acompanha o seedRng, não o teamSeedId (fixo).
          expect(captured).toEqual([seedRngA, seedRngB]);
          expect(captured[0]).not.toBe(captured[1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
