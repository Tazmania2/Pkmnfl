/**
 * Property test de manipulação remota nunca ser posse/INT/TD (Task 7.5).
 *
 * // Feature: pfl-simulation-engine, Property 28: Manipulação remota nunca é posse, interceptação nem touchdown
 *
 * **Validates: Requirements 8.7, 8.8, 10.5, 10.7**
 *
 * *Para todo* deslocamento da bola causado por manipulação sobrenatural externa
 * (telecinese ou magnetismo), o resultado nunca é registrado como posse,
 * interceptação ou touchdown, e a ocorrência é logada; consequentemente, atleta
 * de secundária sem recepção física nunca produz interceptação — apenas
 * deflexão ou passe incompleto.
 *
 * Invariantes universais verificadas:
 *
 * R8.8 — Marcadores sempre negativos: *para toda* decisão de telecinese
 * (`resolveTelekinesis`), em QUALQUER caso (protegida por posse, bloqueada
 * dentro da esfera ou manipulação remota permitida), os marcadores de
 * manipulação remota são exatamente `{ countsAsPossession: false,
 * countsAsInterception: false, countsAsTouchdown: false }`. A telecinese nunca
 * cria posse, interceptação ou pontuação.
 *
 * R8.7 — Manipulação remota permitida só com bola SOLTA e FORA da esfera: *para
 * toda* bola solta (sem posse física) e situada **fora** da `Esfera_Supressao`,
 * a manipulação é permitida (`allowed === true`) com motivo
 * `REMOTE_MANIPULATION_NOT_POSSESSION`. Bola solta **dentro** da esfera é
 * bloqueada (`allowed === false`, `BLOCKED_LOOSE_INSIDE_SPHERE`), pois a
 * supressão tem prioridade absoluta.
 *
 * R10.5/R10.7 — Secundária sem recepção física nunca intercepta: reforço via
 * `validateAnatomy`, *para todo* atleta de secundária (CB/S) tentando
 * `intercept`, o desfecho nunca é `ok` INT — é `allowed_with_limitation`
 * (deflexão/incompleto) ou, para Magneton, `blocked` (desvia, não intercepta).
 *
 * Pureza: `resolveTelekinesis` e `validateAnatomy` não consomem RNG, não leem
 * ambiente e não mutam a entrada — dependem apenas dos argumentos. Por isso o
 * teste gera esferas e posições de bola arbitrárias (dentro e fora), além de
 * estados de posse arbitrários, e cruza as espécies/posições de secundária.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isInsideSphere,
  isPhysicalPossession,
  resolveTelekinesis,
  DEFAULT_SUPPRESSION_RADIUS_YARDS,
  type BallPhysicalState,
  type SuppressionSphere,
} from './sphere';
import { validateAnatomy } from './anatomy';
import type { AthleteStats, Position, ResolvedAthlete, Vec3 } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

// ---------------------------------------------------------------------------
// Geradores de geometria (espelham sphere.suppression.test.ts)
// ---------------------------------------------------------------------------

/**
 * Componente de coordenada: doubles finitos de magnitude moderada. Limitamos a
 * `[-1000, 1000]` para que `d²` e `raio²` fiquem bem dentro da precisão de
 * `number`, evitando que arredondamento contamine a classificação dentro/fora.
 */
const coord = fc.double({ min: -1000, max: 1000, noNaN: true });

/** Ponto `Vec3` arbitrário no espaço de jogo. */
const vec3Arb: fc.Arbitrary<Vec3> = fc.record({
  x: coord,
  y: coord,
  z: coord,
});

/**
 * Raio arbitrário estritamente positivo. Inclui o default do baseline (2) e uma
 * faixa densa ao redor para exercitar a política em escalas variadas.
 */
const radiusArb = fc.oneof(
  fc.constant(DEFAULT_SUPPRESSION_RADIUS_YARDS),
  fc.double({ min: 0.1, max: 50, noNaN: true }),
);

/** Esfera arbitrária (centro + raio positivo). */
const sphereArb: fc.Arbitrary<SuppressionSphere> = fc.record({
  center: vec3Arb,
  radiusYards: radiusArb,
});

/** Eixo cartesiano para construir posições de bola dentro/fora de forma controlada. */
const axisArb = fc.constantFrom<'x' | 'y' | 'z'>('x', 'y', 'z');

/**
 * Bola **estritamente dentro** da esfera: desloca o centro por metade do raio
 * ao longo de um eixo (distância `< raio` mesmo com arredondamento).
 */
function insideBallPos(sphere: SuppressionSphere, axis: 'x' | 'y' | 'z'): Vec3 {
  return {
    ...sphere.center,
    [axis]: sphere.center[axis] + sphere.radiusYards / 2,
  };
}

/**
 * Bola **fora** da esfera: desloca o centro por um excesso relativo ao raio ao
 * longo de um eixo (distância `> raio` de forma distinguível em `number`).
 */
function outsideBallPos(sphere: SuppressionSphere, axis: 'x' | 'y' | 'z'): Vec3 {
  return {
    ...sphere.center,
    [axis]: sphere.center[axis] + sphere.radiusYards * 1.0001 + 1e-6,
  };
}

/** Marcadores canônicos esperados: todos negativos (R8.8). */
const EXPECTED_FLAGS = {
  countsAsPossession: false,
  countsAsInterception: false,
  countsAsTouchdown: false,
} as const;

// ---------------------------------------------------------------------------
// Property 28 — parte telecinese (R8.7, R8.8)
// ---------------------------------------------------------------------------

describe('resolveTelekinesis — Property 28 (manipulação remota nunca é posse/INT/TD)', () => {
  it('R8.8: em QUALQUER caso os marcadores de manipulação remota são todos negativos', () => {
    // Estado de bola totalmente arbitrário (posse ou solta; dentro ou fora).
    const ballArb: fc.Arbitrary<BallPhysicalState> = fc.record({
      ballPos: vec3Arb,
      continuousContact: fc.boolean(),
      stableMechanicalControl: fc.boolean(),
    });

    fc.assert(
      fc.property(sphereArb, ballArb, (sphere, ball) => {
        const decision = resolveTelekinesis(sphere, ball);
        // Nunca conta como posse, interceptação ou touchdown — qualquer caso.
        expect(decision.remoteManipulation).toEqual(EXPECTED_FLAGS);
        expect(decision.remoteManipulation.countsAsPossession).toBe(false);
        expect(decision.remoteManipulation.countsAsInterception).toBe(false);
        expect(decision.remoteManipulation.countsAsTouchdown).toBe(false);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.7: bola SOLTA e FORA da esfera → permitida com reason REMOTE_MANIPULATION_NOT_POSSESSION (nunca posse)', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, (sphere, axis) => {
        const ballPos = outsideBallPos(sphere, axis);
        // Pré-condição: a bola está de fato fora da esfera.
        expect(isInsideSphere(sphere.center, ballPos, sphere.radiusYards)).toBe(
          false,
        );
        // Bola solta: sem contato contínuo nem controle mecânico estável.
        const ball: BallPhysicalState = {
          ballPos,
          continuousContact: false,
          stableMechanicalControl: false,
        };
        expect(isPhysicalPossession(ball)).toBe(false);

        const decision = resolveTelekinesis(sphere, ball);
        expect(decision.allowed).toBe(true);
        expect(decision.protectedByPossession).toBe(false);
        expect(decision.reason).toBe('REMOTE_MANIPULATION_NOT_POSSESSION');
        // Mesmo permitida, nunca é posse/INT/TD.
        expect(decision.remoteManipulation).toEqual(EXPECTED_FLAGS);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.7: bola SOLTA e DENTRO da esfera → bloqueada com reason BLOCKED_LOOSE_INSIDE_SPHERE', () => {
    fc.assert(
      fc.property(sphereArb, axisArb, (sphere, axis) => {
        const ballPos = insideBallPos(sphere, axis);
        // Pré-condição: a bola está de fato dentro da esfera.
        expect(isInsideSphere(sphere.center, ballPos, sphere.radiusYards)).toBe(
          true,
        );
        const ball: BallPhysicalState = {
          ballPos,
          continuousContact: false,
          stableMechanicalControl: false,
        };

        const decision = resolveTelekinesis(sphere, ball);
        expect(decision.allowed).toBe(false);
        expect(decision.protectedByPossession).toBe(false);
        expect(decision.reason).toBe('BLOCKED_LOOSE_INSIDE_SPHERE');
        expect(decision.remoteManipulation).toEqual(EXPECTED_FLAGS);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('R8.6/R8.8: bola em posse física nunca é manipulável e seus marcadores também são negativos (independe da esfera)', () => {
    fc.assert(
      fc.property(sphereArb, vec3Arb, (sphere, ballPos) => {
        // Posse física: contato contínuo E controle mecânico estável.
        const ball: BallPhysicalState = {
          ballPos,
          continuousContact: true,
          stableMechanicalControl: true,
        };
        expect(isPhysicalPossession(ball)).toBe(true);

        const decision = resolveTelekinesis(sphere, ball);
        expect(decision.allowed).toBe(false);
        expect(decision.protectedByPossession).toBe(true);
        expect(decision.reason).toBe('PROTECTED_PHYSICAL_POSSESSION');
        expect(decision.remoteManipulation).toEqual(EXPECTED_FLAGS);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('não muta a entrada e é determinística (pureza)', () => {
    const ballArb: fc.Arbitrary<BallPhysicalState> = fc.record({
      ballPos: vec3Arb,
      continuousContact: fc.boolean(),
      stableMechanicalControl: fc.boolean(),
    });

    fc.assert(
      fc.property(sphereArb, ballArb, (sphere, ball) => {
        const sphereSnap = JSON.stringify(sphere);
        const ballSnap = JSON.stringify(ball);

        const first = resolveTelekinesis(sphere, ball);
        const second = resolveTelekinesis(sphere, ball);

        expect(second).toEqual(first);
        expect(JSON.stringify(sphere)).toBe(sphereSnap);
        expect(JSON.stringify(ball)).toBe(ballSnap);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 28 — reforço anatômico (R10.5, R10.7)
// ---------------------------------------------------------------------------

/** `pokemonId` da espécie com exceção aprovada na secundária (desvia, não intercepta). */
const MAGNETON = 82;

/** Posições de secundária cuja interceptação exige recepção física (R10.5/R10.7). */
const SECONDARY_ROLES: readonly Position[] = ['CB', 'S'];

const STATS: AthleteStats = {
  hp: 60,
  attack: 60,
  defense: 60,
  specialAttack: 60,
  specialDefense: 60,
  speed: 60,
};

/** Constrói um `ResolvedAthlete` mínimo cuja identidade relevante é o `pokemonId`. */
function makeAthlete(pokemonId: number, role: Position): ResolvedAthlete {
  return {
    instanceId: 1,
    pokemonId,
    types: ['NORMAL'],
    stats: STATS,
    abilityId: 0,
    moveIds: [0, 0, 0, 0],
    additionalEffectIds: [],
    positionDesignation: role,
  };
}

/**
 * Gerador de `pokemonId`: mistura espécies arbitrárias (National Dex válido)
 * com Magneton, garantindo cobertura explícita da exceção de secundária.
 */
const pokemonIdArb = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 1025 }) },
  { weight: 1, arbitrary: fc.constant(MAGNETON) },
);

const secondaryRoleArb = fc.constantFrom(...SECONDARY_ROLES);

describe('validateAnatomy — Property 28 (secundária sem recepção física nunca intercepta por telecinese/magnetismo)', () => {
  it('R10.5/R10.7: interceptação de secundária (CB/S) nunca é ok — é limitação (deflexão) ou bloqueio (Magneton)', () => {
    fc.assert(
      fc.property(pokemonIdArb, secondaryRoleArb, (pokemonId, role) => {
        const outcome = validateAnatomy(
          makeAthlete(pokemonId, role),
          role,
          'intercept',
        );
        // Nunca é INT "ok": magnetismo/telecinese não produz interceptação.
        expect(outcome.kind).not.toBe('ok');
        if (pokemonId === MAGNETON) {
          // Magneton desvia a bola (deflexão/incompleto); não intercepta.
          expect(outcome.kind).toBe('blocked');
        } else {
          // Demais: INT exige recepção física; sem ela resolve-se como deflexão.
          expect(outcome.kind).toBe('allowed_with_limitation');
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
