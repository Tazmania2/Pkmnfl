import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isInsideSphere,
  isPreservedInsideSphere,
  resolveSuppression,
  DEFAULT_SUPPRESSION_RADIUS_YARDS,
  type PreservedPhysical,
  type SuppressionSphere,
} from './sphere';
import type { Vec3 } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test da supressão com prioridade absoluta (Task 7.3).
 *
 * // Feature: pfl-simulation-engine, Property 26: Supressão neutraliza poderes sobrenaturais com prioridade absoluta
 *
 * **Validates: Requirements 8.3, 8.4, 8.5**
 *
 * Três invariantes universais, uma por requisito:
 *
 * R8.3 — Prioridade absoluta: *para toda* fonte de poder situada **dentro** da
 * `Esfera_Supressao`, a decisão é sempre inativa e suprimida
 * (`active === false`, `suppressed === true`), independentemente de qualquer
 * outro fator (incluindo `wasActive`). Fora da esfera, a esfera não neutraliza
 * o poder (`active === true`, `suppressed === false`). Como a decisão depende
 * *apenas* da geometria (dentro/fora), ela coincide exatamente com
 * `isInsideSphere`.
 *
 * R8.4 — Suspensão ao entrar vs. supressão simples: *para toda* fonte dentro da
 * esfera, um efeito **previamente ativo** (`wasActive === true`) é suspenso
 * (`suspended === true`, `reason === 'EFFECT_SUSPENDED_ON_ENTER'`); um poder que
 * apenas tentava ativar (`wasActive === false`) é suprimido
 * (`suspended === false`, `reason === 'POWER_SUPPRESSED_INSIDE_SPHERE'`). Fora
 * da esfera, nunca há supressão nem suspensão
 * (`reason === 'OUTSIDE_SPHERE_NOT_SUPPRESSED'`), independentemente de `wasActive`.
 *
 * R8.5 — Física preservada: `isPreservedInsideSphere` retorna `true` exatamente
 * para 'anatomy', 'natural_physics' e 'physical_momentum' — a supressão atinge
 * apenas poderes sobrenaturais, nunca a física natural já em curso.
 */

/**
 * Gerador de componentes de coordenada: doubles finitos de magnitude moderada.
 * Limitamos o alcance a `[-1000, 1000]` para que `d²` e `raio²` permaneçam bem
 * dentro da faixa de precisão de `number`, evitando que erros de arredondamento
 * contaminem a classificação dentro/fora.
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
 * uma faixa densa ao redor para exercitar a supressão em escalas variadas.
 */
const radiusArb = fc.oneof(
  fc.constant(DEFAULT_SUPPRESSION_RADIUS_YARDS),
  fc.double({ min: 0.1, max: 50, noNaN: true }),
);

/** Esfera arbitrária (centro na bola + raio positivo). */
const sphereArb: fc.Arbitrary<SuppressionSphere> = fc.record({
  center: vec3Arb,
  radiusYards: radiusArb,
});

/** Eixo cartesiano usado para construir pontos dentro/fora de forma controlada. */
const axisArb = fc.constantFrom<'x' | 'y' | 'z'>('x', 'y', 'z');

/**
 * Constrói uma fonte de poder **estritamente dentro** da esfera deslocando o
 * centro por metade do raio ao longo de um eixo. Metade do raio garante
 * distância `< raio` mesmo com arredondamento de ponto flutuante.
 */
function insidePoint(sphere: SuppressionSphere, axis: 'x' | 'y' | 'z'): Vec3 {
  return { ...sphere.center, [axis]: sphere.center[axis] + sphere.radiusYards / 2 };
}

/**
 * Constrói uma fonte de poder **fora** da esfera deslocando o centro por um
 * excesso relativo ao raio ao longo de um eixo, garantindo distância `> raio`
 * de forma distinguível em `number`.
 */
function outsidePoint(sphere: SuppressionSphere, axis: 'x' | 'y' | 'z'): Vec3 {
  return {
    ...sphere.center,
    [axis]: sphere.center[axis] + sphere.radiusYards * 1.0001 + 1e-6,
  };
}

describe('sphere — supressão com prioridade absoluta (Property 26)', () => {
  it('R8.3: fonte DENTRO da esfera é sempre inativa e suprimida, qualquer que seja wasActive', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, fc.boolean(), (sphere, axis, wasActive) => {
        const source = insidePoint(sphere, axis);
        // Pré-condição: o ponto está de fato dentro da esfera.
        expect(isInsideSphere(sphere.center, source, sphere.radiusYards)).toBe(true);

        const decision = resolveSuppression(sphere, source, wasActive);
        // Prioridade absoluta: inativo e suprimido independentemente de wasActive.
        expect(decision.active).toBe(false);
        expect(decision.suppressed).toBe(true);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.3: fonte FORA da esfera não é suprimida (ativa), qualquer que seja wasActive', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, fc.boolean(), (sphere, axis, wasActive) => {
        const source = outsidePoint(sphere, axis);
        // Pré-condição: o ponto está de fato fora da esfera.
        expect(isInsideSphere(sphere.center, source, sphere.radiusYards)).toBe(false);

        const decision = resolveSuppression(sphere, source, wasActive);
        expect(decision.active).toBe(true);
        expect(decision.suppressed).toBe(false);
        expect(decision.suspended).toBe(false);
        expect(decision.reason).toBe('OUTSIDE_SPHERE_NOT_SUPPRESSED');
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.3: a decisão de supressão coincide exatamente com isInsideSphere (prioridade absoluta sobre a geometria)', () => {
    // Fonte arbitrária (dentro OU fora): a classificação active/suppressed é
    // função apenas da geometria dentro/fora, sem depender de outros fatores.
    fc.assert(
      fc.property(sphereArb, vec3Arb, fc.boolean(), (sphere, source, wasActive) => {
        const inside = isInsideSphere(sphere.center, source, sphere.radiusYards);
        const decision = resolveSuppression(sphere, source, wasActive);
        expect(decision.suppressed).toBe(inside);
        expect(decision.active).toBe(!inside);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.4: efeito previamente ativo que entra na esfera é suspenso com reason EFFECT_SUSPENDED_ON_ENTER', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, (sphere, axis) => {
        const source = insidePoint(sphere, axis);
        const decision = resolveSuppression(sphere, source, /* wasActive */ true);
        expect(decision.suspended).toBe(true);
        expect(decision.reason).toBe('EFFECT_SUSPENDED_ON_ENTER');
        // Continua inativo e suprimido (R8.3 vale sempre dentro da esfera).
        expect(decision.active).toBe(false);
        expect(decision.suppressed).toBe(true);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.4: poder não previamente ativo dentro da esfera é suprimido com reason POWER_SUPPRESSED_INSIDE_SPHERE', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, (sphere, axis) => {
        const source = insidePoint(sphere, axis);
        const decision = resolveSuppression(sphere, source, /* wasActive */ false);
        expect(decision.suspended).toBe(false);
        expect(decision.reason).toBe('POWER_SUPPRESSED_INSIDE_SPHERE');
        expect(decision.active).toBe(false);
        expect(decision.suppressed).toBe(true);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.4: fora da esfera não há suspensão nem supressão, qualquer que seja wasActive', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, fc.boolean(), (sphere, axis, wasActive) => {
        const source = outsidePoint(sphere, axis);
        const decision = resolveSuppression(sphere, source, wasActive);
        expect(decision.suspended).toBe(false);
        expect(decision.reason).toBe('OUTSIDE_SPHERE_NOT_SUPPRESSED');
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.5: isPreservedInsideSphere é verdadeiro exatamente para anatomy, natural_physics e physical_momentum', () => {
    const preserved: ReadonlyArray<PreservedPhysical> = [
      'anatomy',
      'natural_physics',
      'physical_momentum',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...preserved), (phenomenon) => {
        expect(isPreservedInsideSphere(phenomenon)).toBe(true);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
