import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isPhysicalPossession,
  resolveTelekinesis,
  DEFAULT_SUPPRESSION_RADIUS_YARDS,
  type BallPhysicalState,
  type SuppressionSphere,
} from './sphere';
import type { Vec3 } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test de proteção por posse física (Task 7.4).
 *
 * // Feature: pfl-simulation-engine, Property 27: Posse física protege contra poderes externos
 *
 * **Validates: Requirements 8.6**
 *
 * Invariante universal: sempre que a bola está em **posse física** — isto é,
 * `continuousContact` **e** `stableMechanicalControl` ambos verdadeiros —
 * `resolveTelekinesis` nega a manipulação externa e assinala a proteção:
 *
 *   - `allowed === false`
 *   - `protectedByPossession === true`
 *   - `reason === 'PROTECTED_PHYSICAL_POSSESSION'`
 *
 * Essa proteção tem **precedência sobre a geometria da esfera** (R8.6): vale
 * qualquer que seja o raio, a posição do centro e a posição da bola — isto é,
 * independentemente de a bola estar dentro ou fora da `Esfera_Supressao`.
 *
 * Como `isPhysicalPossession` é verdadeiro **se e somente se** ambos os flags
 * são verdadeiros, também verificamos que a proteção ocorre exatamente no mesmo
 * conjunto de estados em que `isPhysicalPossession` retorna `true`.
 */

/**
 * Gerador de componentes de coordenada: doubles finitos de magnitude moderada.
 * O alcance `[-1000, 1000]` mantém `d²` e `raio²` bem dentro da precisão de
 * `number`, de modo que a classificação dentro/fora da esfera (irrelevante para
 * a posse, mas gerada livremente) nunca seja contaminada por arredondamento.
 */
const coord = fc.double({ min: -1000, max: 1000, noNaN: true });

/** Gerador de pontos `Vec3` arbitrários no espaço de jogo. */
const vec3Arb: fc.Arbitrary<Vec3> = fc.record({
  x: coord,
  y: coord,
  z: coord,
});

/**
 * Raio arbitrário estritamente positivo. Inclui o default do baseline (2) e
 * uma faixa densa ao redor para variar a geometria da esfera — que a proteção
 * por posse deve ignorar por completo.
 */
const radiusArb = fc.oneof(
  fc.constant(DEFAULT_SUPPRESSION_RADIUS_YARDS),
  fc.double({ min: 0.1, max: 50, noNaN: true }),
);

/** Esfera arbitrária (centro + raio positivo), geometria irrelevante à posse. */
const sphereArb: fc.Arbitrary<SuppressionSphere> = fc.record({
  center: vec3Arb,
  radiusYards: radiusArb,
});

/**
 * Estado físico da bola em **posse física**: ambos os flags verdadeiros, com
 * posição da bola arbitrária (pode cair dentro OU fora da esfera gerada).
 */
const possessedBallArb: fc.Arbitrary<BallPhysicalState> = fc.record({
  ballPos: vec3Arb,
  continuousContact: fc.constant(true),
  stableMechanicalControl: fc.constant(true),
});

/** Estado físico da bola com flags arbitrários (posse ou solta). */
const anyBallArb: fc.Arbitrary<BallPhysicalState> = fc.record({
  ballPos: vec3Arb,
  continuousContact: fc.boolean(),
  stableMechanicalControl: fc.boolean(),
});

describe('sphere — proteção por posse física (Property 27)', () => {
  it('R8.6: bola em posse física é protegida contra poderes externos, independentemente da geometria da esfera', () => {
    fc.assert(
      fc.property(sphereArb, possessedBallArb, (sphere, ball) => {
        // Pré-condição: a bola está de fato em posse física.
        expect(isPhysicalPossession(ball)).toBe(true);

        const decision = resolveTelekinesis(sphere, ball);
        expect(decision.allowed).toBe(false);
        expect(decision.protectedByPossession).toBe(true);
        expect(decision.reason).toBe('PROTECTED_PHYSICAL_POSSESSION');
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.6: isPhysicalPossession é verdadeiro se e somente se ambos os flags são verdadeiros', () => {
    fc.assert(
      fc.property(anyBallArb, (ball) => {
        expect(isPhysicalPossession(ball)).toBe(
          ball.continuousContact && ball.stableMechanicalControl,
        );
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.6: a proteção por posse ocorre exatamente quando isPhysicalPossession é verdadeiro (precedência sobre a esfera)', () => {
    // Flags arbitrários: quando há posse, a proteção é afirmada e a manipulação
    // negada; quando não há posse, nunca se marca proteção por posse. A decisão
    // de proteção não depende da geometria dentro/fora da esfera.
    fc.assert(
      fc.property(sphereArb, anyBallArb, (sphere, ball) => {
        const possessed = isPhysicalPossession(ball);
        const decision = resolveTelekinesis(sphere, ball);

        if (possessed) {
          expect(decision.protectedByPossession).toBe(true);
          expect(decision.allowed).toBe(false);
          expect(decision.reason).toBe('PROTECTED_PHYSICAL_POSSESSION');
        } else {
          expect(decision.protectedByPossession).toBe(false);
          expect(decision.reason).not.toBe('PROTECTED_PHYSICAL_POSSESSION');
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
