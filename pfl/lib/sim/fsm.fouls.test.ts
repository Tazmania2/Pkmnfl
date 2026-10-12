/**
 * Property test de faltas: detecção, log traceável e inescapabilidade pela
 * estratégia (`lib/sim/fsm.fouls.test.ts`).
 *
 * Feature: pfl-simulation-engine, Property 40
 * Validates: Requirements 14.1, 14.2, 14.3
 *
 * Propriedade 40 — "Faltas detectadas, logadas e inescapáveis pela estratégia":
 * - R14.1: `detectFouls` detecta formação (jogadores na linha < mínimo),
 *   elegibilidade (recebedor inelegível adiante) e interferência de passe
 *   (ofensiva/defensiva) a partir do contexto objetivo da jogada.
 * - R14.2: a detecção é uma função pura **apenas** do `FoulContext` — não há
 *   parâmetro de `Strategy`; logo nenhuma estratégia pode desativá-la. Mesma
 *   entrada → mesmas faltas (determinismo), e um contexto com uma falta sempre
 *   produz essa falta.
 * - R14.3: cada `FoulResult` carrega `type`/`party`/`resolution`/`description`
 *   rastreáveis para o log: a `resolution` espelha `FOUL_RESOLUTIONS` e a
 *   `description` é não vazia. `applyFoul` aplica a penalidade imutavelmente
 *   (estado de entrada inalterado) e traceavelmente (PI defensiva → 1º down
 *   automático; jardas aplicadas).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PBT_NUM_RUNS } from './test-setup';
import {
  detectFouls,
  applyFoul,
  FOUL_RESOLUTIONS,
  MIN_PLAYERS_ON_LINE,
  type FoulContext,
  type FoulResult,
} from './fsm';
import { createInitialState } from './state';
import type { GameState } from './types';

/** Gerador de `FoulContext` cobrindo o espaço objetivo da jogada. */
const foulContextArb: fc.Arbitrary<FoulContext> = fc.record({
  // Até 15 jogadores: cobre amplamente < 7 (falta) e >= 7 (legal).
  playersOnLine: fc.integer({ min: 0, max: 15 }),
  ineligibleReceiverDownfield: fc.boolean(),
  offensivePassInterference: fc.boolean(),
  defensivePassInterference: fc.boolean(),
});

/** Snapshot estrutural de um estado para checar imutabilidade. */
function snapshot(state: GameState): string {
  return JSON.stringify({
    down: state.down,
    distance: state.distance,
    ballOn: state.ballOn,
    quarter: state.quarter,
    gameClockDeci: state.gameClockDeci,
    possession: state.possession,
    score: state.score,
    phase: state.phase,
  });
}

/** Localiza a falta de um tipo+lado específico na lista. */
function find(
  fouls: ReadonlyArray<FoulResult>,
  type: FoulResult['type'],
  party: FoulResult['party'],
): FoulResult | undefined {
  return fouls.find((f) => f.type === type && f.party === party);
}

describe('Property 40 — faltas detectadas, logadas e inescapáveis (R14.1–R14.3)', () => {
  it('detecta cada falta exatamente conforme o contexto objetivo (R14.1)', () => {
    fc.assert(
      fc.property(foulContextArb, (ctx) => {
        const fouls = detectFouls(ctx);

        const formation = find(fouls, 'FORMATION', 'offense');
        expect(Boolean(formation)).toBe(ctx.playersOnLine < MIN_PLAYERS_ON_LINE);

        const eligibility = find(fouls, 'ELIGIBILITY', 'offense');
        expect(Boolean(eligibility)).toBe(ctx.ineligibleReceiverDownfield);

        const offPi = find(fouls, 'INTERFERENCE', 'offense');
        expect(Boolean(offPi)).toBe(ctx.offensivePassInterference);

        const defPi = find(fouls, 'INTERFERENCE', 'defense');
        expect(Boolean(defPi)).toBe(ctx.defensivePassInterference);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('cada FoulResult é traceável: resolução canônica e descrição não vazia (R14.3)', () => {
    fc.assert(
      fc.property(foulContextArb, (ctx) => {
        for (const foul of detectFouls(ctx)) {
          // Descrição rastreável para o log não vazia.
          expect(foul.description.trim().length).toBeGreaterThan(0);
          // Resolução espelha a fonte de verdade FOUL_RESOLUTIONS...
          const canonical = FOUL_RESOLUTIONS[foul.type];
          expect(foul.resolution.penaltyYards).toBe(canonical.penaltyYards);
          expect(foul.resolution.replayDown).toBe(canonical.replayDown);
          // ...exceto o 1º down automático da interferência defensiva.
          const expectedAfd =
            foul.type === 'INTERFERENCE' && foul.party === 'defense';
          expect(foul.resolution.automaticFirstDown).toBe(expectedAfd);
          // Jardas de penalidade sempre >= 0.
          expect(foul.resolution.penaltyYards).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('é determinística e pura do contexto — a estratégia não pode desativar (R14.2)', () => {
    fc.assert(
      fc.property(foulContextArb, (ctx) => {
        // Mesmo contexto → faltas idênticas em chamadas independentes. A
        // assinatura `detectFouls(context: FoulContext)` não admite Strategy;
        // não há canal pelo qual uma estratégia possa interferir.
        const a = detectFouls(ctx);
        const b = detectFouls({ ...ctx });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));

        // Um contexto com uma falta SEMPRE rende aquela falta.
        if (ctx.playersOnLine < MIN_PLAYERS_ON_LINE) {
          expect(find(a, 'FORMATION', 'offense')).toBeDefined();
        }
        if (ctx.ineligibleReceiverDownfield) {
          expect(find(a, 'ELIGIBILITY', 'offense')).toBeDefined();
        }
        if (ctx.offensivePassInterference) {
          expect(find(a, 'INTERFERENCE', 'offense')).toBeDefined();
        }
        if (ctx.defensivePassInterference) {
          expect(find(a, 'INTERFERENCE', 'defense')).toBeDefined();
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('applyFoul aplica a penalidade de forma imutável e traceável (R14.3)', () => {
    fc.assert(
      fc.property(
        foulContextArb,
        fc.constantFrom<'CLEAR' | 'RAIN' | 'WIND' | 'HEAT' | 'COLD'>(
          'CLEAR',
          'RAIN',
          'WIND',
          'HEAT',
          'COLD',
        ),
        (ctx, weather) => {
          const state = createInitialState({ weather });
          const before = snapshot(state);

          for (const foul of detectFouls(ctx)) {
            const next = applyFoul(state, foul);

            // Imutabilidade: estado de entrada inalterado e nova referência.
            expect(snapshot(state)).toBe(before);
            expect(next).not.toBe(state);

            // ballOn permanece no campo [0, 100].
            expect(next.ballOn).toBeGreaterThanOrEqual(0);
            expect(next.ballOn).toBeLessThanOrEqual(100);

            const yards = foul.resolution.penaltyYards;
            if (foul.party === 'defense') {
              // Penalidade defensiva avança a bola do ataque.
              const expectedBallOn = Math.min(100, Math.max(0, state.ballOn + yards));
              expect(next.ballOn).toBe(expectedBallOn);
              if (foul.resolution.automaticFirstDown) {
                // PI defensiva → 1º down automático traceável.
                expect(next.down).toBe(1);
                expect(next.distance).toBe(10);
              }
            } else {
              // Penalidade ofensiva recua a bola do ataque.
              const expectedBallOn = Math.min(100, Math.max(0, state.ballOn - yards));
              expect(next.ballOn).toBe(expectedBallOn);
            }
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
