import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  defenseDelta,
  matchupDelta,
  matchupKey,
} from './matchups';
import { compute } from './play/probability';
import type {
  Baseline,
  DefensivePlayId,
  OffensivePlayId,
  PlayId,
  SimulationParameters,
} from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test do delta de matchup aplicado antes da disputa, de forma
 * simétrica (Task 9.2).
 *
 * // Feature: pfl-simulation-engine, Property 14: Delta de matchup é o do baseline, aplicado antes da disputa, de forma simétrica
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 *
 * Para todo par (`Jogada_Ofensiva`, `Jogada_Defensiva`):
 *
 * - **R5.1 (valor do baseline).** `matchupDelta(baseline, O, D)` devolve
 *   exatamente o `offense_probability_delta` armazenado em `baseline.matchups`
 *   sob a chave `${O}|${D}`; para pares ausentes/neutros devolve `0` — nunca um
 *   valor inventado.
 * - **R5.3 (simetria).** `defenseDelta(baseline, O, D) === -matchupDelta(baseline, O, D)`
 *   para todo par: a desvantagem imposta à defesa é o oposto exato da vantagem
 *   concedida ao ataque, e a soma dos efeitos espelhados é zero.
 * - **R5.2 (antes da disputa, aditivo).** Em `probability.compute`, o
 *   `matchupDelta` entra na soma bruta ANTES do clamp final: no regime não
 *   saturado, computar com um `delta` difere de computar com `0` por exatamente
 *   esse `delta`; e a vantagem ofensiva de `+delta` corresponde (em magnitude)
 *   à desvantagem defensiva de `-delta`.
 */

// ---------------------------------------------------------------------------
// Baseline MVP de design (não calibrado) — valores do design.
// ---------------------------------------------------------------------------

/**
 * `SimulationParameters` do baseline congelado do MVP. `compute` lê `base`,
 * `difference_coefficient`, `min`, `max` e `skill_mod_max_abs`; os demais campos
 * constam para honrar o contrato de tipo.
 */
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

// ---------------------------------------------------------------------------
// Geradores (fast-check)
// ---------------------------------------------------------------------------

/** As seis `Jogada_Ofensiva` do catálogo. */
const OFFENSE_PLAYS: readonly OffensivePlayId[] = [
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
];

/** As seis `Jogada_Defensiva` do catálogo. */
const DEFENSE_PLAYS: readonly DefensivePlayId[] = [
  'D_RUN_FIT',
  'D_EDGE_CONTAIN',
  'D_ZONE',
  'D_MAN',
  'D_RUSH',
  'D_CONTAIN_QB',
];

const offenseArb = fc.constantFrom<OffensivePlayId>(...OFFENSE_PLAYS);
const defenseArb = fc.constantFrom<DefensivePlayId>(...DEFENSE_PLAYS);

/** Delta de matchup plausível — faixa pequena em torno de zero, inclusive 0. */
const deltaArb = fc.double({
  min: -0.4,
  max: 0.4,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Constrói um `Baseline` com um mapa de matchups keyed por `${offense}|${defense}`
 * a partir de uma lista de triplas (offense, defense, delta). Pares não
 * fornecidos ficam ausentes (neutros → delta 0).
 */
function makeBaseline(
  entries: ReadonlyArray<readonly [PlayId, PlayId, number]>,
): Baseline {
  const matchups = new Map<string, number>();
  for (const [offense, defense, delta] of entries) {
    matchups.set(matchupKey(offense, defense), delta);
  }
  return {
    version: 'D1-design-2026-10-09',
    status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
    simulationParameters: BASELINE_PARAMS,
    matchups,
  };
}

/**
 * Gera um conjunto de entradas de matchup (pares únicos por chave) + o delta de
 * cada par, para construir um baseline arbitrário mas bem-formado.
 */
const matchupEntriesArb = fc
  .array(fc.tuple(offenseArb, defenseArb, deltaArb), {
    minLength: 0,
    maxLength: 12,
  })
  .map((rows) => {
    // Deduplica por chave `${offense}|${defense}` mantendo a última ocorrência,
    // de modo que o mapa resultante seja determinístico e sem colisões.
    const byKey = new Map<string, readonly [PlayId, PlayId, number]>();
    for (const [offense, defense, delta] of rows) {
      byKey.set(matchupKey(offense, defense), [offense, defense, delta]);
    }
    return [...byKey.values()];
  });

// ---------------------------------------------------------------------------
// R5.1 — matchupDelta devolve exatamente o valor do baseline (0 se ausente)
// ---------------------------------------------------------------------------

describe('matchupDelta — valor exato do baseline (Property 14, R5.1)', () => {
  it('devolve exatamente o offense_probability_delta armazenado para o par', () => {
    fc.assert(
      fc.property(
        offenseArb,
        defenseArb,
        deltaArb,
        (offense, defense, delta) => {
          const baseline = makeBaseline([[offense, defense, delta]]);
          expect(matchupDelta(baseline, offense, defense)).toBe(delta);
          // E o valor é exatamente o que está no mapa sob a chave canônica.
          expect(baseline.matchups.get(matchupKey(offense, defense))).toBe(
            delta,
          );
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('devolve 0 para pares ausentes/neutros (resolução por conta dos atributos)', () => {
    fc.assert(
      fc.property(
        matchupEntriesArb,
        offenseArb,
        defenseArb,
        (entries, offense, defense) => {
          const key = matchupKey(offense, defense);
          // Garante que o par consultado NÃO está no baseline.
          const absent = entries.filter(
            ([o, d]) => matchupKey(o, d) !== key,
          );
          const baseline = makeBaseline(absent);
          expect(matchupDelta(baseline, offense, defense)).toBe(0);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// R5.3 — simetria: defenseDelta === -matchupDelta para todo par
// ---------------------------------------------------------------------------

describe('defenseDelta — simetria do delta (Property 14, R5.3)', () => {
  it('defenseDelta é exatamente o oposto de matchupDelta (soma espelhada = 0)', () => {
    fc.assert(
      fc.property(matchupEntriesArb, offenseArb, defenseArb, (entries, o, d) => {
        const baseline = makeBaseline(entries);
        const off = matchupDelta(baseline, o, d);
        const def = defenseDelta(baseline, o, d);
        expect(def).toBe(-off);
        // A soma dos efeitos espelhados é exatamente zero.
        expect(off + def).toBe(0);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('mantém a simetria também para pares presentes com delta não trivial', () => {
    fc.assert(
      fc.property(offenseArb, defenseArb, deltaArb, (o, d, delta) => {
        const baseline = makeBaseline([[o, d, delta]]);
        expect(defenseDelta(baseline, o, d)).toBe(-delta);
        expect(matchupDelta(baseline, o, d) + defenseDelta(baseline, o, d)).toBe(
          0,
        );
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// R5.2 — aplicado antes da disputa, de forma aditiva e simétrica
// ---------------------------------------------------------------------------

/**
 * `attrDelta` que mantém `compute` no regime NÃO saturado (longe do clamp
 * `[0.05, 0.95]`), para que a diferença causada pelo matchupDelta seja
 * exatamente aditiva e observável. Mantemos |attrDelta| pequeno e combinamos com
 * deltas pequenos para que a soma bruta permaneça dentro de `(min, max)`.
 */
const attrDeltaArb = fc.double({
  min: -0.3,
  max: 0.3,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Verifica se uma probabilidade bruta está estritamente dentro de `(min, max)`,
 * ou seja, no regime onde o clamp não atua.
 */
function isUnsaturated(pBruta: number): boolean {
  return pBruta > BASELINE_PARAMS.min && pBruta < BASELINE_PARAMS.max;
}

describe('compute — matchupDelta entra na soma antes do clamp (Property 14, R5.2)', () => {
  it('computar com delta difere de computar com 0 por exatamente delta (regime não saturado)', () => {
    fc.assert(
      fc.property(attrDeltaArb, deltaArb, (attrDelta, delta) => {
        const withDelta = compute(
          { attrDelta, matchupDelta: delta },
          BASELINE_PARAMS,
        );
        const withZero = compute(
          { attrDelta, matchupDelta: 0 },
          BASELINE_PARAMS,
        );

        // Soma bruta sem clamp para decidir o regime.
        const rawZero =
          BASELINE_PARAMS.base +
          BASELINE_PARAMS.difference_coefficient * attrDelta;
        const rawDelta = rawZero + delta;

        // Só exigimos a igualdade aditiva exata quando AMBAS as probabilidades
        // estão no regime não saturado (o clamp não interferiu).
        fc.pre(isUnsaturated(rawZero) && isUnsaturated(rawDelta));

        expect(withDelta - withZero).toBeCloseTo(delta, 10);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a vantagem ofensiva de +delta espelha a desvantagem defensiva de -delta', () => {
    fc.assert(
      fc.property(attrDeltaArb, deltaArb, (attrDelta, delta) => {
        // Linha de base sem matchup.
        const neutral = compute(
          { attrDelta, matchupDelta: 0 },
          BASELINE_PARAMS,
        );
        // Lado ofensivo: aplica +delta (vantagem do ataque).
        const offensive = compute(
          { attrDelta, matchupDelta: delta },
          BASELINE_PARAMS,
        );
        // Lado defensivo: aplica -delta (desvantagem imposta à defesa, via
        // defenseDelta == -matchupDelta).
        const defensive = compute(
          { attrDelta, matchupDelta: -delta },
          BASELINE_PARAMS,
        );

        const rawNeutral =
          BASELINE_PARAMS.base +
          BASELINE_PARAMS.difference_coefficient * attrDelta;

        // Regime não saturado para os três pontos relevantes.
        fc.pre(
          isUnsaturated(rawNeutral) &&
            isUnsaturated(rawNeutral + delta) &&
            isUnsaturated(rawNeutral - delta),
        );

        const advantage = offensive - neutral; // +delta
        const disadvantage = defensive - neutral; // -delta

        // Simetria aplicada antes da disputa: ganho ofensivo e perda defensiva
        // são espelhos exatos; a soma é zero.
        expect(advantage).toBeCloseTo(delta, 10);
        expect(disadvantage).toBeCloseTo(-delta, 10);
        expect(advantage + disadvantage).toBeCloseTo(0, 10);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
