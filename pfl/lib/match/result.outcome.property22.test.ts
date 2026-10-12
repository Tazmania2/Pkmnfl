import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { determineOutcome } from './result';
import type { Score } from './contracts';

/**
 * Teste de propriedade do desfecho derivado exclusivamente do placar (Task 6.2).
 *
 * // Feature: pfl-gameday-result-ui, Property 22: Desfecho derivado exclusivamente do placar
 *
 * **Validates: Requirements 13.2, 13.3, 13.4**
 *
 * *Para todo* `Placar`, `determineOutcome(score)` retorna `winner` com o lado de
 * maior pontuação quando `score.home ≠ score.away` (R13.2), e `tie` quando
 * `score.home === score.away` (R13.3); além disso o desfecho depende **apenas**
 * de `home`/`away` — variar `score.final`/`score.tie` de forma independente das
 * pontuações nunca altera o resultado (R13.4). A função não recalcula nem
 * inventa resultado algum.
 *
 * Os campos `final`/`tie` são gerados de forma **independente** de `home`/`away`
 * (inclusive em combinações incoerentes, ex.: `tie === true` com `home ≠ away`)
 * justamente para provar que `determineOutcome` os ignora.
 */

/** Pontuação não negativa típica de um placar. */
const scoreValue = fc.nat({ max: 200 });

/**
 * `Placar` com `final`/`tie` sorteados independentemente de `home`/`away`,
 * permitindo combinações incoerentes de propósito (prova que são ignorados).
 */
const arbitraryScore: fc.Arbitrary<Score> = fc.record({
  home: scoreValue,
  away: scoreValue,
  final: fc.boolean(),
  tie: fc.boolean(),
});

describe('determineOutcome — Property 22: desfecho derivado só do placar', () => {
  it('home > away → winner home (R13.2)', () => {
    fc.assert(
      fc.property(scoreValue, scoreValue, fc.boolean(), fc.boolean(), (lo, delta, final, tie) => {
        const away = lo;
        const home = lo + delta + 1; // garante home > away
        const outcome = determineOutcome({ home, away, final, tie });
        expect(outcome).toEqual({ kind: 'winner', team: 'home' });
      }),
    );
  });

  it('away > home → winner away (R13.2)', () => {
    fc.assert(
      fc.property(scoreValue, scoreValue, fc.boolean(), fc.boolean(), (lo, delta, final, tie) => {
        const home = lo;
        const away = lo + delta + 1; // garante away > home
        const outcome = determineOutcome({ home, away, final, tie });
        expect(outcome).toEqual({ kind: 'winner', team: 'away' });
      }),
    );
  });

  it('home === away → tie (R13.3)', () => {
    fc.assert(
      fc.property(scoreValue, fc.boolean(), fc.boolean(), (value, final, tie) => {
        const outcome = determineOutcome({ home: value, away: value, final, tie });
        expect(outcome).toEqual({ kind: 'tie' });
      }),
    );
  });

  it('o desfecho depende apenas de home/away: variar final/tie não o altera (R13.4)', () => {
    fc.assert(
      fc.property(
        scoreValue,
        scoreValue,
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (home, away, finalA, tieA, finalB, tieB) => {
          const a = determineOutcome({ home, away, final: finalA, tie: tieA });
          const b = determineOutcome({ home, away, final: finalB, tie: tieB });
          expect(a).toEqual(b);
        },
      ),
    );
  });

  it('coerência global com arbitrary de Placar: resultado segue estritamente home vs away', () => {
    fc.assert(
      fc.property(arbitraryScore, (score) => {
        const outcome = determineOutcome(score);
        if (score.home > score.away) {
          expect(outcome).toEqual({ kind: 'winner', team: 'home' });
        } else if (score.away > score.home) {
          expect(outcome).toEqual({ kind: 'winner', team: 'away' });
        } else {
          expect(outcome).toEqual({ kind: 'tie' });
        }
      }),
    );
  });
});
