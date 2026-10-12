/**
 * Property test de sensibilidade ao seed do núcleo `simulate`
 * (`simulate.seedsensitivity`) — Task 14.3.
 *
 * // Feature: pfl-simulation-engine, Property 3: Sensibilidade ao seed
 *
 * **Validates: Requirements 1.4**
 *
 * R1.4 é **permissivo**: mantidas as mesmas escalações e estratégias, mas
 * variando o `Seed_RNG`, os resultados **podem** divergir. O requisito não
 * exige que seeds distintos produzam resultados distintos para cada par
 * particular (duas partidas podem coincidir por acaso), mas exige que o motor
 * seja **genuinamente sensível ao seed** — isto é, que ele NÃO force uma saída
 * idêntica para todos os seeds. Se toda escolha de seed colapsasse no mesmo
 * log, o seed seria inerte e R1.4 seria violado.
 *
 * ## Formulação da propriedade (permissiva, mas falseável)
 *
 * Para uma forma de entrada fixa (mesmas escalações, mesmas estratégias),
 * coletamos `simulate` sobre uma amostra de `N` seeds **distintos** e exigimos
 * que o conjunto de `stableStringify(log)` tenha **mais de um valor distinto**:
 * existe divergência observável no log serializado entre pelo menos dois seeds.
 * Essa é a asserção de "o motor é sensível ao seed".
 *
 * Para **ancorar** que a divergência é dirigida pelo seed (e não por
 * não-determinismo espúrio — o que violaria a Property 1), cada seed individual
 * é verificado como **internamente determinístico**: `simulate` chamado duas
 * vezes com o mesmo seed produz logs byte a byte idênticos. Assim, a variação
 * observada no conjunto é necessariamente **função do seed**, não de ruído.
 *
 * ## Custo
 *
 * `simulate` é pesado (uma partida completa por chamada). Mantemos a amostra de
 * seeds modesta (`SEED_SAMPLE`) e elevamos o timeout bem acima do padrão.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { simulate } from './simulate';
import { stableStringify } from './log';
import type {
  Baseline,
  EffectStatus,
  Preset,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  SimulationParameters,
  Strategy,
} from './types';

// ---------------------------------------------------------------------------
// Baseline MVP de design (não calibrado) — valores do design
// (mesma fixture de simulate.determinism.test.ts)
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
// Fixtures de atletas / escalações (mesmo padrão da determinism.test.ts)
// ---------------------------------------------------------------------------

/** Spec de stats variáveis de um atleta, gerada pelo fast-check. */
interface AthleteSpec {
  readonly offenseAttack: number;
  readonly defenseAttack: number;
}

/**
 * Constrói um `ResolvedAthlete` mínimo e válido com `attack` dado. O
 * `instanceId` deve ser único por time — gerado pelo chamador.
 */
function makeAthlete(
  instanceId: number,
  position: ResolvedAthlete['positionDesignation'],
  attack: number,
): ResolvedAthlete {
  return {
    instanceId,
    pokemonId: 1 + (instanceId % 100),
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
 * Escalação resolvida com ataque (QB/RB/WR) e defesa (CB/S/LB). Os `instanceId`
 * são offsetados por `base` para garantir unicidade por time dentro do input.
 */
function makeLineup(base: number, spec: AthleteSpec): ResolvedLineup {
  return {
    units: {
      offense: [
        makeAthlete(base + 1, 'QB', spec.offenseAttack),
        makeAthlete(base + 2, 'RB', spec.offenseAttack),
        makeAthlete(base + 3, 'WR', spec.offenseAttack),
      ],
      defense: [
        makeAthlete(base + 4, 'CB', spec.defenseAttack),
        makeAthlete(base + 5, 'S', spec.defenseAttack),
        makeAthlete(base + 6, 'LB', spec.defenseAttack),
      ],
      specialTeams: [],
    },
  };
}

/** Monta um `ResolvedInput` com forma fixa variando apenas o `seed`. */
function makeInput(
  seed: bigint,
  shape: {
    readonly strategyHome: Strategy;
    readonly strategyAway: Strategy;
    readonly homeSpec: AthleteSpec;
    readonly awaySpec: AthleteSpec;
  },
): ResolvedInput {
  return {
    home: makeLineup(0, shape.homeSpec),
    away: makeLineup(100, shape.awaySpec),
    strategyHome: shape.strategyHome,
    strategyAway: shape.strategyAway,
    baseline: BASELINE,
    effectDisposition: EMPTY_DISPOSITION,
    seed,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const PRESETS: readonly Preset[] = ['BALANCED', 'GROUND', 'AERIAL', 'CURTI'];
const presetArb: fc.Arbitrary<Preset> = fc.constantFrom(...PRESETS);
const strategyArb: fc.Arbitrary<Strategy> = presetArb.map((preset) => ({
  preset,
}));

const attackArb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 200 });
const athleteSpecArb: fc.Arbitrary<AthleteSpec> = fc.record({
  offenseAttack: attackArb,
  defenseAttack: attackArb,
});

/** Forma de entrada fixa (escalações + estratégias) sobre a qual o seed varia. */
const shapeArb = fc.record({
  strategyHome: strategyArb,
  strategyAway: strategyArb,
  homeSpec: athleteSpecArb,
  awaySpec: athleteSpecArb,
});

/**
 * Amostra de seeds uint64 **distintos**. Usamos um `Set` sob o capô para
 * garantir distinção; `SEED_SAMPLE` controla o tamanho (modesto por custo).
 */
const SEED_SAMPLE = 24;
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});
const distinctSeedsArb: fc.Arbitrary<ReadonlyArray<bigint>> = fc
  .uniqueArray(seedArb, {
    minLength: SEED_SAMPLE,
    maxLength: SEED_SAMPLE,
    selector: (s) => s.toString(),
  });

// ---------------------------------------------------------------------------
// Property 3 — sensibilidade ao seed
// ---------------------------------------------------------------------------

describe('simulate — Property 3 (sensibilidade ao seed)', () => {
  // `simulate` roda uma partida completa por seed; uma amostra de SEED_SAMPLE
  // seeds (cada um simulado duas vezes para a âncora de determinismo) é cara,
  // então mantemos poucas iterações do fast-check e timeout elevado.
  const SENSITIVITY_RUNS = 8;

  it(
    'sobre uma amostra de seeds distintos (mesma forma), o log serializado NÃO colapsa num único valor — e cada seed é internamente determinístico (R1.4)',
    () => {
      fc.assert(
        fc.property(shapeArb, distinctSeedsArb, (shape, seeds) => {
          const serializedLogs = new Set<string>();

          for (const seed of seeds) {
            const input = makeInput(seed, shape);

            const first = simulate(input);
            const second = simulate(input);

            // Âncora: cada seed é internamente determinístico (a divergência
            // observada entre seeds é, portanto, dirigida pelo seed, não por
            // não-determinismo espúrio — reforça a Property 1).
            const firstLog = stableStringify(first.log);
            const secondLog = stableStringify(second.log);
            expect(secondLog).toBe(firstLog);

            // `seedUsed` ecoa exatamente o seed de entrada.
            expect(first.seedUsed).toBe(seed);

            serializedLogs.add(firstLog);
          }

          // Sensibilidade ao seed: o motor NÃO força a mesma saída para todos os
          // seeds — existe divergência observável em pelo menos dois deles.
          expect(serializedLogs.size).toBeGreaterThan(1);
        }),
        { numRuns: SENSITIVITY_RUNS },
      );
    },
    120_000,
  );
});
