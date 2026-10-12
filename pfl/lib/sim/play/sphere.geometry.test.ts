import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isInsideSphere,
  repositionSphere,
  DEFAULT_SUPPRESSION_RADIUS_YARDS,
} from './sphere';
import type { Vec3 } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test da geometria da `Esfera_Supressao` (Task 7.2).
 *
 * // Feature: pfl-simulation-engine, Property 25: Esfera de supressão inclui a casca e segue a bola
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * Duas invariantes universais, uma por requisito:
 *
 * R8.1 — Casca inclusiva: *para todo* ponto e toda posição da bola, o ponto
 * está dentro da esfera se e somente se sua distância euclidiana à bola é menor
 * ou igual ao raio (`d <= raio`). Em particular, um ponto situado exatamente a
 * `raio` jardas da bola (sobre a casca) é considerado interior; um ponto apenas
 * além da casca é exterior; e um ponto estritamente dentro é interior. A prova
 * usa `isInsideSphere` como oráculo contra a definição `d <= raio`, e constrói
 * pontos de borda deslocando o centro por exatamente `raio` ao longo de um eixo.
 *
 * R8.2 — A esfera segue a bola: *para toda* nova posição da bola, `repositionSphere`
 * devolve uma esfera cujo centro coincide com a nova posição da bola (a esfera
 * acompanha a bola) e cujo raio é preservado. O centro é uma cópia por valor
 * (não compartilha referência) e, portanto, qualquer ponto é interior à esfera
 * reposicionada exatamente quando sua distância à nova bola é `<= raio`.
 */

/**
 * Gerador de componentes de coordenada: doubles finitos de magnitude moderada.
 * Limitamos o alcance a `[-1000, 1000]` para que `d²` e `raio²` permaneçam bem
 * dentro da faixa de precisão de `number`, evitando que erros de arredondamento
 * em distâncias enormes contaminem a semântica da casca (que é exata por
 * construção nos casos de borda abaixo).
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
 * uma faixa densa ao redor para exercitar a geometria em escalas variadas.
 */
const radiusArb = fc.oneof(
  fc.constant(DEFAULT_SUPPRESSION_RADIUS_YARDS),
  fc.double({ min: 0.1, max: 50, noNaN: true }),
);

/** Distância euclidiana entre dois pontos (oráculo independente do SUT). */
function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

describe('sphere — geometria da Esfera_Supressao (Property 25)', () => {
  it('R8.1: isInsideSphere coincide com d <= raio para pontos e raios arbitrários', () => {
    fc.assert(
      fc.property(vec3Arb, vec3Arb, radiusArb, (ballPos, point, radius) => {
        const inside = isInsideSphere(ballPos, point, radius);
        const expected = distance(ballPos, point) <= radius;
        expect(inside).toBe(expected);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.1: a casca é inclusiva — ponto exatamente a `raio` da bola é interior', () => {
    // Para testar a casca de forma EXATA, usamos centro e raio inteiros (sempre
    // representáveis em `number`) e deslocamos a bola por exatamente `radius` ao
    // longo de um eixo. Com inteiros, `point[axis] - ballPos[axis]` recupera o
    // raio sem erro de arredondamento e, como só uma componente é não-nula,
    // `d²` é exatamente `radius²`. Assim a distância é EXATAMENTE o raio e o
    // ponto está sobre a casca — o teste prova a inclusão da casca sem o ruído
    // de ponto flutuante da adição `float + float`.
    const intCoord = fc.integer({ min: -1000, max: 1000 });
    const intVec3 = fc.record({ x: intCoord, y: intCoord, z: intCoord });
    const intRadius = fc.integer({ min: 1, max: 50 });
    const axisArb = fc.constantFrom<'x' | 'y' | 'z'>('x', 'y', 'z');
    fc.assert(
      fc.property(intVec3, intRadius, axisArb, (ballPos, radius, axis) => {
        const shellPoint: Vec3 = { ...ballPos, [axis]: ballPos[axis] + radius };
        // Pré-condição exata: a distância recuperada é precisamente o raio.
        expect(distance(ballPos, shellPoint)).toBe(radius);
        // Sobre a casca (distância == raio) ⇒ interior fechado.
        expect(isInsideSphere(ballPos, shellPoint, radius)).toBe(true);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.1: ponto estritamente dentro é interior; ponto além da casca é exterior', () => {
    // Novamente com inteiros para que as distâncias construídas sejam exatas.
    const intCoord = fc.integer({ min: -1000, max: 1000 });
    const intVec3 = fc.record({ x: intCoord, y: intCoord, z: intCoord });
    const intRadius = fc.integer({ min: 2, max: 50 });
    const axisArb = fc.constantFrom<'x' | 'y' | 'z'>('x', 'y', 'z');
    fc.assert(
      fc.property(intVec3, intRadius, axisArb, (ballPos, radius, axis) => {
        // `radius - 1` jardas ao longo de um eixo ⇒ estritamente dentro.
        const innerPoint: Vec3 = {
          ...ballPos,
          [axis]: ballPos[axis] + (radius - 1),
        };
        expect(distance(ballPos, innerPoint)).toBe(radius - 1);
        expect(isInsideSphere(ballPos, innerPoint, radius)).toBe(true);

        // `radius + 1` jardas ao longo de um eixo ⇒ estritamente fora (além da
        // casca). Distância exata = radius + 1 > radius ⇒ exterior.
        const outerPoint: Vec3 = {
          ...ballPos,
          [axis]: ballPos[axis] + (radius + 1),
        };
        expect(distance(ballPos, outerPoint)).toBe(radius + 1);
        expect(isInsideSphere(ballPos, outerPoint, radius)).toBe(false);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.2: repositionSphere centra a esfera na nova posição da bola e preserva o raio', () => {
    fc.assert(
      fc.property(vec3Arb, radiusArb, (newBallPos, radius) => {
        const sphere = repositionSphere(newBallPos, radius);
        // A esfera segue a bola: centro == nova posição da bola.
        expect(sphere.center.x).toBe(newBallPos.x);
        expect(sphere.center.y).toBe(newBallPos.y);
        expect(sphere.center.z).toBe(newBallPos.z);
        // Raio preservado.
        expect(sphere.radiusYards).toBe(radius);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.2: o centro é cópia por valor — não compartilha referência com a bola', () => {
    fc.assert(
      fc.property(vec3Arb, radiusArb, (newBallPos, radius) => {
        const sphere = repositionSphere(newBallPos, radius);
        expect(sphere.center).not.toBe(newBallPos);
        expect(sphere.center).toEqual(newBallPos);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.1 + R8.2: pertinência à esfera reposicionada equivale a d <= raio da nova bola', () => {
    fc.assert(
      fc.property(vec3Arb, vec3Arb, radiusArb, (newBallPos, point, radius) => {
        const sphere = repositionSphere(newBallPos, radius);
        const inside = isInsideSphere(sphere.center, point, sphere.radiusYards);
        const expected = distance(newBallPos, point) <= radius;
        expect(inside).toBe(expected);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
