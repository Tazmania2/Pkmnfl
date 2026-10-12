// Feature: pfl-simulation-engine, Property 11: Soma de pontos coerente com eventos de scoring
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SCORING_POINTS } from './fsm';
import {
  assertScoreCoherence,
  checkScoreCoherence,
  scoringPointsByTeam,
} from './stats';
import { PBT_NUM_RUNS } from './test-setup';
import type { GameStats, ScoringEntry, ScoringType, Team } from './types';

/**
 * Teste de propriedade da coerência placar × scoring (Task 13.9).
 *
 * **Feature: pfl-simulation-engine, Property 11: Soma de pontos coerente com
 * eventos de scoring**
 *
 * _Validates: Requirements 3.3, 3.4, 3.5, 3.6_
 *
 * Property 11 (invariante universal): para qualquer `scoringSummary`, a soma dos
 * pontos por time — usando a fonte única `SCORING_POINTS` (TD=6, FG=3, SAFETY=2,
 * PAT=1, TWO_PT=2; R3.3–R3.6) — iguala o `Placar` final de cada time. Verificamos
 * que:
 *   1. `scoringPointsByTeam(summary)` coincide com os totais por time calculados
 *      de forma independente a partir de `SCORING_POINTS`.
 *   2. `checkScoreCoherence(stats, totais)` devolve `coherent = true` quando o
 *      placar é exatamente esses totais.
 *   3. Um placar divergente (`total + 1`) devolve `coherent = false` e
 *      `assertScoreCoherence` lança — não há ponto órfão nem scoring sem
 *      contrapartida no placar.
 */

const SCORING_TYPES: readonly ScoringType[] = [
  'TD',
  'FG',
  'SAFETY',
  'PAT',
  'TWO_PT',
];

const TEAMS: readonly Team[] = ['home', 'away'];

/** Gera uma `ScoringEntry` com tipo/time/quarto arbitrários (dentro do domínio). */
const scoringEntryArb: fc.Arbitrary<ScoringEntry> = fc.record({
  type: fc.constantFrom(...SCORING_TYPES),
  team: fc.constantFrom(...TEAMS),
  quarter: fc.integer({ min: 1, max: 4 }),
});

/** Gera um `scoringSummary` arbitrário (ordem irrelevante para a soma). */
const scoringSummaryArb: fc.Arbitrary<ScoringEntry[]> = fc.array(
  scoringEntryArb,
  { minLength: 0, maxLength: 40 },
);

/** Totais por time calculados independentemente de `scoringPointsByTeam`. */
function expectedTotals(summary: ReadonlyArray<ScoringEntry>): {
  home: number;
  away: number;
} {
  let home = 0;
  let away = 0;
  for (const entry of summary) {
    const points = SCORING_POINTS[entry.type];
    if (entry.team === 'home') {
      home += points;
    } else {
      away += points;
    }
  }
  return { home, away };
}

/** Monta um `GameStats` mínimo carregando o `scoringSummary` dado. */
function statsWithSummary(summary: ReadonlyArray<ScoringEntry>): GameStats {
  return {
    rushes: { attempts: 0, yards: 0 },
    passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
    turnovers: 0,
    fouls: 0,
    scoringSummary: summary,
  };
}

describe('Feature: pfl-simulation-engine, Property 11: Soma de pontos coerente com eventos de scoring', () => {
  it('scoringPointsByTeam(summary) iguala os totais por time derivados de SCORING_POINTS (R3.3–R3.6)', () => {
    fc.assert(
      fc.property(scoringSummaryArb, (summary) => {
        const expected = expectedTotals(summary);
        const actual = scoringPointsByTeam(summary);
        expect(actual.home).toBe(expected.home);
        expect(actual.away).toBe(expected.away);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('checkScoreCoherence é coerente quando o placar final iguala a soma do scoring (R3.3–R3.6)', () => {
    fc.assert(
      fc.property(scoringSummaryArb, (summary) => {
        const expected = expectedTotals(summary);
        const stats = statsWithSummary(summary);
        const result = checkScoreCoherence(stats, expected);
        expect(result.coherent).toBe(true);
        expect(result.fromScoring).toEqual(expected);
        expect(result.finalScore).toEqual(expected);
        // Asserção de invariante não deve lançar no placar coerente.
        expect(() => assertScoreCoherence(stats, expected)).not.toThrow();
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('placar divergente (total + 1) é incoerente e assertScoreCoherence lança (R3.3–R3.6)', () => {
    fc.assert(
      fc.property(
        scoringSummaryArb,
        // Escolhe qual time terá o placar perturbado em +1 ponto.
        fc.constantFrom<Team>('home', 'away'),
        (summary, perturbed) => {
          const expected = expectedTotals(summary);
          const stats = statsWithSummary(summary);
          const mismatched = {
            home: expected.home + (perturbed === 'home' ? 1 : 0),
            away: expected.away + (perturbed === 'away' ? 1 : 0),
          };
          const result = checkScoreCoherence(stats, mismatched);
          expect(result.coherent).toBe(false);
          expect(() => assertScoreCoherence(stats, mismatched)).toThrow();
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
