/**
 * Property test de ordem fixa de consumo do RNG (`pipeline.rngorder`) — Task 10.4.
 *
 * // Feature: pfl-simulation-engine, Property 5: Ordem fixa de consumo do RNG
 *
 * **Validates: Requirements 1.2**
 *
 * O design define que o `resolvePlay` consome o `Gerador_RNG` em uma **ordem
 * fixa documentada**, pulando passos inaplicáveis à jogada (ver pipeline.ts,
 * "Ordem fixa de consumo do RNG"):
 *
 *   1. decisão do bot ofensivo  (seleção O — `choosePlay`);
 *   2. decisão do bot defensivo (seleção D — `choosePlay`);
 *   3. teste de sucesso         (`decideSuccess`, 1 `nextFloat`);
 *   4. amostragens de resultado (passe: `nextInt` de jardas-alvo; corrida:
 *      `nextInt` de perda; e o teste de fumble `nextFloat`), todas APÓS o teste
 *      de sucesso.
 *
 * Como consequência dessa ordem fixa e de o RNG ser a única fonte de entropia
 * (R1.2), `resolvePlay` é **determinístico e reprodutível**: dois `Rng`
 * recém-semeados com o mesmo seed produzem o MESMO `PlayOutcome` e a MESMA
 * sequência de chamadas ao RNG. Seeds diferentes podem divergir.
 *
 * Estratégia de verificação:
 * - **Determinismo**: dois RNGs com o mesmo seed + mesmo estado/entrada/políticas
 *   produzem `PlayOutcome` profundamente iguais; a sequência de chamadas ao RNG
 *   também é idêntica.
 * - **Reprodutibilidade da sequência**: a sequência gravada de chamadas
 *   (`método`, argumentos e resultado) é estável para um mesmo seed entre
 *   execuções repetidas.
 * - **Ordem fixa por tipo de jogada**: com uma seleção forçada a UMA opção de
 *   peso positivo (seleção não consome RNG — ver `select.ts`), a primeira
 *   chamada de RNG do pipeline é sempre o teste de sucesso (`nextFloat`), e as
 *   amostragens de resultado (`nextInt`/fumble) vêm sempre DEPOIS, nunca antes.
 * - Para o passe, após o `nextFloat` de sucesso, quando a disputa é bem-sucedida
 *   há exatamente um `nextInt` (jardas-alvo) e então o `nextFloat` de fumble —
 *   nessa ordem.
 * - Para a corrida, após o `nextFloat` de sucesso, o ganho é determinístico (sem
 *   RNG) e o teste de fumble (`nextFloat`) é a próxima chamada.
 *
 * Nota de alcance: no pipeline do MVP, a ação-chave validada é sempre uma
 * combinação `(role, action)` permitida pelo `Validador_Funcoes` (QB/throw,
 * RB/carry), de modo que o ramo de aborto por `blocked` não é alcançável por
 * `resolvePlay`. A ausência de consumo de RNG após a seleção em uma jogada
 * abortada é, portanto, uma propriedade do caminho `blocked` do pipeline que não
 * pode ser exercitada publicamente aqui; esta suíte valida a ordem fixa e a
 * reprodutibilidade do caminho vivo (seleção → sucesso → resultado).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolvePlay, type PlayPolicies } from './pipeline';
import { createSituationalPolicy, PLAY_CATALOG } from './select';
import { createRng, type Rng } from '../rng';
import { createInitialState } from '../state';
import type {
  Baseline,
  EffectStatus,
  GameState,
  OffensivePlayId,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  SimulationParameters,
  Strategy,
  Weather,
} from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

// ---------------------------------------------------------------------------
// Baseline MVP de design (não calibrado) — valores do design
// ---------------------------------------------------------------------------

const BASELINE_PARAMS: SimulationParameters = {
  base: 0.5,
  difference_coefficient: 0.45,
  min: 0.05,
  max: 0.95,
  skill_mod_max_abs: 0.15,
  tick_s: 0.1,
  quarter_seconds: 900,
  play_timeout_s: 30,
  suppression_radius_yards: 2,
  weather: { CLEAR: 0.4, RAIN: 0.2, WIND: 0.15, HEAT: 0.15, COLD: 0.1 },
  weather_modifiers: {
    RAIN: { reception: -0.04, fumble: 0.02 },
    WIND: { deep_pass: -0.05, long_kick: -0.05 },
    HEAT: { fatigue_per_snap: 0.002 },
    COLD: { reception: -0.02 },
  },
  fatigue: {
    active: 0.003,
    extreme_action: 0.005,
    inactive_snap_recovery: -0.001,
    max_penalty: 0.12,
  },
  run: { base: 2, coef: 4, loss_min: -4, loss_max: -1 },
  pass: { short: [3, 10], deep: [12, 35] },
};

/**
 * Baseline com um mapa de matchups pequeno (alguns pares com delta explícito e o
 * resto neutro por ausência). `matchupDelta` devolve 0 para pares ausentes, de
 * modo que o baseline minimalista basta para exercitar o pipeline.
 */
const BASELINE: Baseline = {
  version: 'D1-design-2026-10-09',
  status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
  simulationParameters: BASELINE_PARAMS,
  matchups: new Map<string, number>([
    ['O_RUN_INSIDE|D_RUN_FIT', 0.05],
    ['O_PASS_DEEP|D_ZONE', -0.03],
  ]),
};

/** Tabela de disposição de efeitos vazia (nenhum efeito adicional nos fixtures). */
const EMPTY_DISPOSITION: ReadonlyMap<string, EffectStatus> = new Map();

// ---------------------------------------------------------------------------
// Fixtures de atletas / escalações
// ---------------------------------------------------------------------------

let nextInstanceId = 1;

/**
 * Constrói um `ResolvedAthlete` mínimo e válido. `attack` controla o rating
 * ofensivo/defensivo médio para variar a probabilidade de sucesso (e assim
 * exercitar os dois ramos sucesso/falha). Sem efeitos adicionais (não consomem
 * nem desviam o caminho de RNG).
 */
function makeAthlete(
  position: ResolvedAthlete['positionDesignation'],
  attack: number,
): ResolvedAthlete {
  const id = nextInstanceId++;
  return {
    instanceId: id,
    pokemonId: 1 + (id % 100),
    types: ['NORMAL'],
    stats: {
      hp: 100,
      attack,
      defense: attack,
      specialAttack: attack,
      specialDefense: attack,
      speed: attack,
    },
    abilityId: 1,
    moveIds: [1, 2, 3, 4],
    additionalEffectIds: [],
    positionDesignation: position,
  };
}

/**
 * Escalação resolvida com unidades de ataque e defesa. A unidade ofensiva inclui
 * sempre um QB (lançamento) e um RB (condução), de modo que a ação-chave de
 * qualquer jogada (passe/corrida) encontra o atleta correto e a validação
 * anatômica resulta em `ok`.
 */
function makeLineup(offenseAttack: number, defenseAttack: number): ResolvedLineup {
  return {
    units: {
      offense: [
        makeAthlete('QB', offenseAttack),
        makeAthlete('RB', offenseAttack),
        makeAthlete('WR', offenseAttack),
      ],
      defense: [
        makeAthlete('CB', defenseAttack),
        makeAthlete('S', defenseAttack),
        makeAthlete('LB', defenseAttack),
      ],
      specialTeams: [],
    },
  };
}

/**
 * `ResolvedInput` mínimo e válido para `resolvePlay`. `homeAttack`/`awayAttack`
 * ajustam os ratings para variar a probabilidade de sucesso. `strategies`
 * controla a seleção de jogada (ver `forcedStrategy`).
 */
function makeInput(
  homeAttack: number,
  awayAttack: number,
  strategyHome: Strategy,
  strategyAway: Strategy,
  seed: bigint,
): ResolvedInput {
  return {
    home: makeLineup(homeAttack, homeAttack),
    away: makeLineup(awayAttack, awayAttack),
    strategyHome,
    strategyAway,
    baseline: BASELINE,
    effectDisposition: EMPTY_DISPOSITION,
    seed,
  };
}

// ---------------------------------------------------------------------------
// Estratégias que forçam uma única jogada (seleção não consome RNG)
// ---------------------------------------------------------------------------

/**
 * Estratégia que deixa exatamente UMA jogada do catálogo com peso positivo
 * (todas as demais zeradas). Com uma única opção positiva, `weightedChoice`
 * **não** consome o RNG (ver `select.ts`), de modo que a primeira chamada de RNG
 * do pipeline é sempre o teste de sucesso — tornando a ordem fixa observável.
 */
function forcedStrategy(onlyPositive: string): Strategy {
  const weights: Record<string, number> = {};
  const allPlays = [...PLAY_CATALOG.offense, ...PLAY_CATALOG.defense];
  for (const p of allPlays) {
    weights[p] = 0;
  }
  weights[onlyPositive] = 1;
  return { preset: 'BALANCED', playWeights: weights };
}

// ---------------------------------------------------------------------------
// RNG gravador: delega ao RNG real e registra cada chamada em ordem
// ---------------------------------------------------------------------------

/** Uma chamada gravada ao RNG: método, argumentos e resultado retornado. */
interface RngCall {
  readonly method: 'nextFloat' | 'nextInt';
  readonly args: readonly number[];
  readonly result: number;
}

/**
 * Envolve um `Rng` real em um proxy gravador que registra cada chamada a
 * `nextFloat`/`nextInt` (na ordem exata de consumo) delegando ao RNG subjacente.
 * `state()` é delegado sem gravação (não participa da resolução).
 */
function recordingRng(inner: Rng): { rng: Rng; calls: RngCall[] } {
  const calls: RngCall[] = [];
  const rng: Rng = {
    nextFloat(): number {
      const result = inner.nextFloat();
      calls.push({ method: 'nextFloat', args: [], result });
      return result;
    },
    nextInt(min: number, max: number): number {
      const result = inner.nextInt(min, max);
      calls.push({ method: 'nextInt', args: [min, max], result });
      return result;
    },
    state() {
      return inner.state();
    },
  };
  return { rng, calls };
}

/** Serializa a sequência de chamadas em uma string estável para comparação. */
function serializeCalls(calls: readonly RngCall[]): string {
  return calls
    .map((c) => `${c.method}(${c.args.join(',')})=${c.result}`)
    .join('|');
}

/** Serializa apenas a sequência de métodos (assinatura da ordem de consumo). */
function serializeMethods(methods: readonly string[]): string {
  return methods.join('|');
}

// ---------------------------------------------------------------------------
// Políticas e estado base
// ---------------------------------------------------------------------------

function policiesFrom(input: ResolvedInput): PlayPolicies {
  return {
    home: createSituationalPolicy(input.strategyHome),
    away: createSituationalPolicy(input.strategyAway),
  };
}

/** Estado inicial de Drive (home em posse) com o clima informado. */
function driveState(weather: Weather): GameState {
  const base = createInitialState({ weather, possession: 'home' });
  return { ...base, phase: 'Drive', down: 1, distance: 10, ballOn: 50 };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Seeds uint64 arbitrários para o `Gerador_RNG`. */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];
const weatherArb: fc.Arbitrary<Weather> = fc.constantFrom(...WEATHERS);

/** Ratings que variam a probabilidade de sucesso para exercitar ambos os ramos. */
const attackArb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 200 });

/** Jogada ofensiva forçada (uma de corrida e uma de passe, para ambos os ramos). */
const forcedOffenseArb: fc.Arbitrary<OffensivePlayId> = fc.constantFrom(
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
);

const RUN_PLAYS: ReadonlySet<string> = new Set(['O_RUN_INSIDE', 'O_RUN_OUTSIDE']);

// ---------------------------------------------------------------------------
// Property 5 — determinismo e ordem fixa de consumo do RNG
// ---------------------------------------------------------------------------

describe('pipeline — Property 5 (ordem fixa de consumo do RNG)', () => {
  it('mesmo seed + mesma entrada produz PlayOutcome idêntico e mesma sequência de RNG (R1.2)', () => {
    fc.assert(
      fc.property(
        seedArb,
        weatherArb,
        attackArb,
        attackArb,
        forcedOffenseArb,
        (seed, weather, homeAttack, awayAttack, offensePlay) => {
          const strategyHome = forcedStrategy(offensePlay);
          const strategyAway = forcedStrategy('D_ZONE');
          const input = makeInput(
            homeAttack,
            awayAttack,
            strategyHome,
            strategyAway,
            seed,
          );
          const policies = policiesFrom(input);
          const state = driveState(weather);

          const a = recordingRng(createRng(seed));
          const b = recordingRng(createRng(seed));

          const outcomeA = resolvePlay(state, input, policies, a.rng, {
            catalog: PLAY_CATALOG,
          });
          const outcomeB = resolvePlay(state, input, policies, b.rng, {
            catalog: PLAY_CATALOG,
          });

          // Determinismo: resultados profundamente iguais.
          expect(outcomeB).toEqual(outcomeA);
          // E a sequência de chamadas ao RNG é idêntica (mesmos métodos, args e
          // resultados, na mesma ordem).
          expect(serializeCalls(b.calls)).toBe(serializeCalls(a.calls));
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a sequência gravada de chamadas ao RNG é reprodutível entre execuções com o mesmo seed', () => {
    fc.assert(
      fc.property(
        seedArb,
        weatherArb,
        forcedOffenseArb,
        (seed, weather, offensePlay) => {
          const input = makeInput(
            80,
            60,
            forcedStrategy(offensePlay),
            forcedStrategy('D_ZONE'),
            seed,
          );
          const policies = policiesFrom(input);
          const state = driveState(weather);

          const run1 = recordingRng(createRng(seed));
          resolvePlay(state, input, policies, run1.rng, { catalog: PLAY_CATALOG });

          const run2 = recordingRng(createRng(seed));
          resolvePlay(state, input, policies, run2.rng, { catalog: PLAY_CATALOG });

          expect(serializeCalls(run2.calls)).toBe(serializeCalls(run1.calls));
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('com seleção forçada (não consome RNG), a 1ª chamada é o teste de sucesso (nextFloat) e as amostragens vêm depois', () => {
    fc.assert(
      fc.property(
        seedArb,
        weatherArb,
        attackArb,
        attackArb,
        forcedOffenseArb,
        (seed, weather, homeAttack, awayAttack, offensePlay) => {
          const input = makeInput(
            homeAttack,
            awayAttack,
            forcedStrategy(offensePlay),
            forcedStrategy('D_ZONE'),
            seed,
          );
          const policies = policiesFrom(input);
          const state = driveState(weather);

          const rec = recordingRng(createRng(seed));
          resolvePlay(state, input, policies, rec.rng, { catalog: PLAY_CATALOG });

          // A seleção (uma única opção positiva de cada lado) não consome RNG,
          // então a primeira chamada do pipeline é SEMPRE o teste de sucesso.
          expect(rec.calls.length).toBeGreaterThanOrEqual(1);
          expect(rec.calls[0]!.method).toBe('nextFloat');

          // O resultado do sucesso NÃO é previsível pelo valor bruto do float
          // (o limiar é a probabilidade final, dependente de ratings/matchup/
          // clima). Em vez disso, validamos a ESTRUTURA da sequência gravada,
          // que é a assinatura observável da ordem fixa de consumo.
          //
          // Padrões válidos (sempre começando pelo teste de sucesso = float):
          //   Passe completo:    [float(sucesso), nextInt(jardas), float(fumble)]
          //   Passe incompleto:  [float(sucesso)]
          //   Corrida (sucesso): [float(sucesso), float(fumble)]           (ganho determinístico)
          //   Corrida (falha):   [float(sucesso), nextInt(perda), float(fumble)]
          const methods = rec.calls.map((c) => c.method);

          if (RUN_PLAYS.has(offensePlay)) {
            // Toda corrida é avanço vivo → sempre há teste de fumble (float) ao
            // final. Qualquer nextInt presente é a perda amostrada em [-4,-1],
            // nunca uma amostragem de passe.
            for (const c of rec.calls) {
              if (c.method === 'nextInt') {
                expect(c.args).toEqual([-4, -1]);
              }
            }
            // A última chamada é sempre o teste de fumble (nextFloat).
            expect(methods[methods.length - 1]).toBe('nextFloat');
            // Estrutura: sucesso → [float, float]; falha → [float, nextInt, float].
            const validRun =
              serializeMethods(methods) === 'nextFloat|nextFloat' ||
              serializeMethods(methods) === 'nextFloat|nextInt|nextFloat';
            expect(validRun).toBe(true);
          } else {
            const isDeep = offensePlay === 'O_PASS_DEEP';
            const expectedRange = isDeep ? [12, 35] : [3, 10];
            // Passe completo é identificado pela presença da amostragem de
            // jardas-alvo (nextInt) como SEGUNDA chamada, seguida do fumble.
            if (rec.calls.length === 1) {
              // Passe incompleto: só o teste de sucesso, nenhuma amostragem.
              expect(serializeMethods(methods)).toBe('nextFloat');
            } else {
              // Passe completo: ordem fixa float(sucesso) → nextInt(jardas) →
              // float(fumble).
              expect(serializeMethods(methods)).toBe('nextFloat|nextInt|nextFloat');
              const second = rec.calls[1]!;
              expect(second.method).toBe('nextInt');
              expect(second.args).toEqual(expectedRange);
            }
          }

          // Em qualquer caso, nenhuma chamada de RNG precede o teste de sucesso.
          expect(rec.calls[0]!.method).toBe('nextFloat');
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('seeds diferentes podem divergir, mas cada seed é internamente determinístico', () => {
    fc.assert(
      fc.property(
        seedArb,
        seedArb,
        weatherArb,
        (seedA, seedB, weather) => {
          fc.pre(seedA !== seedB);
          const input = (seed: bigint) =>
            makeInput(80, 80, forcedStrategy('O_PASS_SHORT'), forcedStrategy('D_ZONE'), seed);

          const inA = input(seedA);
          const inB = input(seedB);
          const state = driveState(weather);

          // Cada seed é determinístico consigo mesmo.
          const a1 = resolvePlay(state, inA, policiesFrom(inA), createRng(seedA), {
            catalog: PLAY_CATALOG,
          });
          const a2 = resolvePlay(state, inA, policiesFrom(inA), createRng(seedA), {
            catalog: PLAY_CATALOG,
          });
          expect(a2).toEqual(a1);

          const b1 = resolvePlay(state, inB, policiesFrom(inB), createRng(seedB), {
            catalog: PLAY_CATALOG,
          });
          const b2 = resolvePlay(state, inB, policiesFrom(inB), createRng(seedB), {
            catalog: PLAY_CATALOG,
          });
          expect(b2).toEqual(b1);
          // Não exigimos divergência entre seeds (podem coincidir); exigimos
          // apenas o determinismo interno de cada seed (acima).
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
