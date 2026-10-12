import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildGameLog } from './log';
import { baselineProvenance } from './matchups';
import type { Baseline, SimulationParameters } from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test de origem versionada e status não-calibrado no log (Task 13.7).
 *
 * // Feature: pfl-simulation-engine, Property 15: Origem versionada e status não-calibrado no log
 *
 * **Validates: Requirements 5.5, 6.10**
 *
 * O baseline de design é **versionado** e **não empiricamente calibrado**; o
 * motor deve registrar essa proveniência no `Log_Partida` de modo que todo
 * resultado seja rastreável à edição exata do baseline que o produziu:
 *
 * - **buildGameLog carimba a proveniência (R5.5/R6.10).** Para um `Baseline`
 *   arbitrário (versão e status arbitrários, incluindo o status canônico
 *   `FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED`), o `GameLog`
 *   produzido tem `baselineVersion === baseline.version` e
 *   `baselineStatus === baseline.status`.
 * - **baselineProvenance projeta os mesmos campos.** `baselineProvenance(baseline)`
 *   devolve `{ version, status }` idênticos aos do baseline.
 */

// ---------------------------------------------------------------------------
// SimulationParameters mínimo e bem-formado (não exercido por este teste; só
// honra o contrato de tipo do Baseline).
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
    inactive_snap_recovery: 0.001,
    max_penalty: 0.12,
  },
  run: { base: 2, coef: 4, loss_min: -4, loss_max: -1 },
  pass: { short: [3, 10], deep: [12, 35] },
};

/** O status canônico do baseline congelado do MVP (não calibrado). */
const CANONICAL_STATUS =
  'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED';

// ---------------------------------------------------------------------------
// Geradores (fast-check)
// ---------------------------------------------------------------------------

/** Versão arbitrária: string qualquer (inclui vazia e com caracteres unicode). */
const versionArb = fc.string();

/**
 * Status arbitrário: string qualquer, com peso extra para o status canônico
 * não-calibrado do MVP, de modo que ele seja exercido com frequência.
 */
const statusArb = fc.oneof(
  fc.string(),
  fc.constant(CANONICAL_STATUS),
);

/** Seed arbitrário em `[0, 2^64 - 1]` para montar o cabeçalho do log. */
const seedArb = fc.bigInt({ min: 0n, max: (1n << 64n) - 1n });

/**
 * `Baseline` arbitrário mas bem-formado: versão/status arbitrários, mapa de
 * matchups vazio e parâmetros mínimos. Só a versão e o status importam para
 * esta propriedade.
 */
const baselineArb: fc.Arbitrary<Baseline> = fc.record({
  version: versionArb,
  status: statusArb,
}).map(({ version, status }) => ({
  version,
  status,
  simulationParameters: BASELINE_PARAMS,
  matchups: new Map<string, number>(),
}));

// ---------------------------------------------------------------------------
// Propriedade 15
// ---------------------------------------------------------------------------

describe('Property 15: origem versionada e status não-calibrado no log', () => {
  it('buildGameLog carimba baselineVersion/baselineStatus do baseline (R5.5/R6.10)', () => {
    fc.assert(
      fc.property(baselineArb, seedArb, (baseline, seed) => {
        const log = buildGameLog({ events: [], seed, baseline });

        expect(log.baselineVersion).toBe(baseline.version);
        expect(log.baselineStatus).toBe(baseline.status);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('baselineProvenance projeta {version, status} do baseline (R5.5/R6.10)', () => {
    fc.assert(
      fc.property(baselineArb, (baseline) => {
        const prov = baselineProvenance(baseline);

        expect(prov).toEqual({
          version: baseline.version,
          status: baseline.status,
        });
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('o status canônico não-calibrado sobrevive intacto ao log', () => {
    const baseline: Baseline = {
      version: 'D1-design-2026-10-09',
      status: CANONICAL_STATUS,
      simulationParameters: BASELINE_PARAMS,
      matchups: new Map<string, number>(),
    };

    const log = buildGameLog({ events: [], seed: 42n, baseline });

    expect(log.baselineStatus).toBe(CANONICAL_STATUS);
    expect(baselineProvenance(baseline).status).toBe(CANONICAL_STATUS);
  });
});
