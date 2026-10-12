import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { runSimulation } from './simulate-client';
import type { SimulateInput } from './types';
import type {
  AthleteInput,
  BotMode,
  LineupInput,
  StrategyInput,
} from './contracts';

/**
 * Teste de propriedade: forma do request de simulação (Task 9.2).
 *
 * // Feature: pfl-gameday-result-ui, Property 7: O request de simulação contém
 * // as duas escalações, as duas estratégias e o Seed_RNG
 *
 * **Validates: Requirements 6.1, 2.3**
 *
 * R6.1 — "WHEN o jogador confirma a simulação, THE Tela_Game_Day SHALL montar o
 * request da Funcao_Simulacao com **as duas escalações, as duas estratégias e o
 * Seed_RNG**." R2.3 — o `Modo_Importar_Seed` conduz o adversário como bot de
 * seed de terceiros, cujo `botModeAway` (= `modoParaBot(modo)`) é transportado
 * ao motor para que a simulação use o bot correto.
 *
 * `runSimulation` é a **única borda de rede** da spec: ele monta o
 * `SimulateRequest` a partir do `SimulateInput` e faz **`POST /api/simulate`
 * uma única vez**. Esta propriedade fixa o **contrato de montagem do corpo**:
 * *para todo* `SimulateInput` arbitrário, o corpo serializado enviado contém,
 * **sem transformar nenhum valor**:
 *
 * - `home`         === `input.playerLineup`      (escalação do jogador)
 * - `away`         === `input.adversaryLineup`   (escalação do adversário)
 * - `strategyHome` === `input.playerStrategy`    (estratégia do jogador)
 * - `strategyAway` === `input.adversaryStrategy` (estratégia do adversário)
 * - `seed`         === `input.seedRng`           (Seed_RNG, R6.1/R6.2)
 * - `botModeAway`  === `input.botModeAway`        (bot do adversário, R2.3)
 *
 * E a chamada de rede acontece **exatamente uma vez**, em `POST /api/simulate`.
 *
 * O `fetch` global é mockado (`vi.fn`) para **capturar o corpo** da requisição e
 * devolver um 200 válido `{ log, score }` — assim a verificação é sobre o
 * request montado, não sobre a resposta. O mock é restaurado após cada caso.
 */

// ---------------------------------------------------------------------------
// Arbitrários — forma mínima de cada campo do SimulateInput
// ---------------------------------------------------------------------------

/** As três chaves de unidade exigidas em toda `LineupInput`. */
const arbitraryAthlete: fc.Arbitrary<AthleteInput> = fc.record({
  instanceId: fc.integer({ min: 1, max: 1_000_000 }),
  pokemonId: fc.integer({ min: 1, max: 1025 }),
  types: fc.array(fc.string(), { maxLength: 2 }),
  stats: fc.record({
    hp: fc.integer({ min: 1, max: 255 }),
    attack: fc.integer({ min: 1, max: 255 }),
    defense: fc.integer({ min: 1, max: 255 }),
    specialAttack: fc.integer({ min: 1, max: 255 }),
    specialDefense: fc.integer({ min: 1, max: 255 }),
    speed: fc.integer({ min: 1, max: 255 }),
  }),
  abilityId: fc.integer({ min: 1, max: 10_000 }),
  moveIds: fc.array(fc.integer({ min: 1, max: 10_000 }), {
    minLength: 4,
    maxLength: 4,
  }),
  positionDesignation: fc.string(),
});

/** `LineupInput` mínima: as três unidades, com 0..3 atletas cada. */
const arbitraryLineup: fc.Arbitrary<LineupInput> = fc.record({
  teamSeedId: fc.option(fc.string(), { nil: undefined }),
  units: fc.record({
    offense: fc.array(arbitraryAthlete, { maxLength: 3 }),
    defense: fc.array(arbitraryAthlete, { maxLength: 3 }),
    specialTeams: fc.array(arbitraryAthlete, { maxLength: 3 }),
  }),
});

/** `StrategyInput` mínima: um preset de estilo + prioridades opcionais. */
const arbitraryStrategy: fc.Arbitrary<StrategyInput> = fc.record({
  preset: fc.constantFrom('EQUILIBRADO', 'AGRESSIVO', 'DEFENSIVO'),
  playWeights: fc.option(
    fc.dictionary(fc.string(), fc.integer({ min: 0, max: 100 })),
    { nil: undefined },
  ),
  priorities: fc.option(
    fc.dictionary(fc.string(), fc.integer({ min: 0, max: 100 })),
    { nil: undefined },
  ),
});

/** Os três modos de bot do motor — alvo de `modoParaBot(modo)` (R2.*). */
const arbitraryBotMode: fc.Arbitrary<BotMode> = fc.constantFrom(
  'random',
  'curti',
  'seeded',
);

/** `Seed_RNG` como string decimal uint64 (gerado nunca derivado de seed de time). */
const arbitrarySeed: fc.Arbitrary<string> = fc.oneof(
  fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((n) => n.toString()),
  fc.constantFrom('0', '1', '18446744073709551615'),
);

const arbitrarySimulateInput: fc.Arbitrary<SimulateInput> = fc.record({
  playerLineup: arbitraryLineup,
  playerStrategy: arbitraryStrategy,
  adversaryLineup: arbitraryLineup,
  adversaryStrategy: arbitraryStrategy,
  seedRng: arbitrarySeed,
  botModeAway: arbitraryBotMode,
});

/** Resposta 200 válida mínima `{ log, score }` (objetos, retidos verbatim). */
function okResponse(): Response {
  const body = { log: {}, score: {} };
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

describe('runSimulation — Property 7: forma do request de simulação', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('monta o corpo com as duas escalações, as duas estratégias, o Seed_RNG e o botModeAway, num único POST /api/simulate (R6.1, R2.3)', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrarySimulateInput, async (input) => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal('fetch', fetchMock);

        await runSimulation(input);

        // (1) Rede: exatamente UMA chamada (R5.2), em POST /api/simulate.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
        expect(url).toBe('/api/simulate');
        expect(init.method).toBe('POST');

        // (2) Corpo serializado: parse e verificação campo a campo.
        expect(typeof init.body).toBe('string');
        const sent = JSON.parse(init.body as string) as Record<
          string,
          unknown
        >;

        // Serializamos o esperado da mesma forma (JSON) para comparar valores
        // sem acoplar à igualdade de referência (o corpo passou por JSON).
        const roundtrip = (v: unknown) => JSON.parse(JSON.stringify(v));

        // Duas escalações.
        expect(sent.home).toEqual(roundtrip(input.playerLineup));
        expect(sent.away).toEqual(roundtrip(input.adversaryLineup));
        // Duas estratégias.
        expect(sent.strategyHome).toEqual(roundtrip(input.playerStrategy));
        expect(sent.strategyAway).toEqual(roundtrip(input.adversaryStrategy));
        // Seed_RNG transportado como está (R6.1/R6.2).
        expect(sent.seed).toBe(input.seedRng);
        // Bot do adversário conduzido ao motor (R2.3).
        expect(sent.botModeAway).toBe(input.botModeAway);

        // O jogador não é bot: botModeHome não é enviado.
        expect(sent.botModeHome).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
