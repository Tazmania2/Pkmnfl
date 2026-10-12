import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  InertWarningLedger,
  dedupeInertWarnings,
  type InertWarningKey,
} from './log';
import type { PipelineLogEvent } from './play/pipeline';
import type { JsonValue, LogEventType, StateSnapshot, Weather } from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test de aviso único por efeito inerte relevante (Task 13.5).
 *
 * // Feature: pfl-simulation-engine, Property 31: Efeito inerte relevante gera
 * exatamente um aviso
 *
 * **Validates: Requirements 9.4**
 *
 * Um efeito inerte **relevante** — identificado pela ocorrência
 * `(effectId, instanceId, snap)` — gera **exatamente um** aviso por ocorrência:
 *
 * - `InertWarningLedger.shouldWarn` retorna `true` na primeira vez que vê uma
 *   ocorrência e `false` em qualquer repetição exata da mesma tripla; uma
 *   ocorrência que difere em `snap` (ou em `effectId`/`instanceId`) é uma nova
 *   ocorrência e volta a avisar.
 * - `dedupeInertWarnings` aplicado a um fluxo arbitrário de eventos mantém
 *   exatamente um aviso `POWER_INERT` por tripla distinta, descarta repetições
 *   dentro da mesma ocorrência e deixa eventos não-inertes passarem intactos.
 */

// ---------------------------------------------------------------------------
// Geradores (fast-check)
// ---------------------------------------------------------------------------

const WEATHERS: ReadonlyArray<Weather> = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];

/** Snapshot mínimo e válido; os valores não afetam a de-duplicação. */
function fixedSnapshot(weather: Weather): StateSnapshot {
  return {
    quarter: 1,
    gameClock: 9000,
    down: 1,
    distance: 10,
    ballOn: 25,
    possession: 'home',
    score: { home: 0, away: 0 },
    weather,
  };
}

/** `effectId` restrito a um alfabeto pequeno para forçar colisões/repetições. */
const effectIdArb: fc.Arbitrary<string> = fc.constantFrom(
  'EFFECT_A',
  'EFFECT_B',
  'EFFECT_C',
);

/** `instanceId` restrito para forçar colisões/repetições de ocorrência. */
const instanceIdArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 3 });

/** `snap` restrito (inclui `undefined`, mapeado para -1 na de-duplicação). */
const snapArb: fc.Arbitrary<number | undefined> = fc.option(
  fc.integer({ min: 0, max: 3 }),
  { nil: undefined },
);

const inertKeyArb: fc.Arbitrary<InertWarningKey> = fc.record({
  effectId: effectIdArb,
  instanceId: instanceIdArb,
  snap: fc.integer({ min: -1, max: 3 }),
});

/** Aviso de efeito inerte relevante (POWER_INERT com effectId/instanceId). */
const inertEventArb: fc.Arbitrary<PipelineLogEvent> = fc
  .record({
    effectId: effectIdArb,
    instanceId: instanceIdArb,
    snap: snapArb,
    weather: fc.constantFrom(...WEATHERS),
  })
  .map(({ effectId, instanceId, snap, weather }) => {
    const detail: Record<string, JsonValue> = {
      effectId,
      instanceId,
      inert: true,
    };
    const event: PipelineLogEvent = {
      type: 'POWER_INERT',
      ...(snap !== undefined ? { snap } : {}),
      state: fixedSnapshot(weather),
      narrative: `Efeito ${effectId} do atleta ${instanceId} é inerte.`,
      detail,
      powerReason: 'POWER_INERT',
    };
    return event;
  });

/** Evento não-inerte arbitrário (deve passar intacto pela de-duplicação). */
const NON_INERT_TYPES: ReadonlyArray<LogEventType> = [
  'PLAY_SELECTED',
  'MATCHUP_APPLIED',
  'ATTR_CONTEST',
  'PLAY_RESULT',
  'ANATOMY_WARNING',
];

const nonInertEventArb: fc.Arbitrary<PipelineLogEvent> = fc
  .record({
    type: fc.constantFrom(...NON_INERT_TYPES),
    snap: snapArb,
    weather: fc.constantFrom(...WEATHERS),
    tag: fc.integer({ min: 0, max: 1000 }),
  })
  .map(({ type, snap, weather, tag }) => {
    const event: PipelineLogEvent = {
      type,
      ...(snap !== undefined ? { snap } : {}),
      state: fixedSnapshot(weather),
      narrative: `Evento ${type} #${tag}.`,
      detail: { tag },
    };
    return event;
  });

/** Fluxo misto de eventos inertes e não-inertes, em ordem de emissão. */
const eventStreamArb: fc.Arbitrary<ReadonlyArray<PipelineLogEvent>> =
  fc.array(fc.oneof(inertEventArb, nonInertEventArb), { maxLength: 40 });

/** Chave canônica de de-duplicação de um evento inerte (espelha o módulo). */
function occurrenceKeyOf(event: PipelineLogEvent): string {
  const effectId = event.detail.effectId;
  const instanceId = event.detail.instanceId;
  const effId = typeof effectId === 'string' ? effectId : String(effectId);
  const instId = typeof instanceId === 'number' ? instanceId : -1;
  const snap = event.snap ?? -1;
  return `${effId}\u0000${instId}\u0000${snap}`;
}

function isInertEvent(event: PipelineLogEvent): boolean {
  return (
    event.powerReason === 'POWER_INERT' ||
    event.powerReason === 'INERT_WITH_WARNING'
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 31: efeito inerte relevante gera exatamente um aviso (R9.4)', () => {
  it('shouldWarn: true na primeira vez e false em repetições exatas da ocorrência', () => {
    fc.assert(
      fc.property(inertKeyArb, (key) => {
        const ledger = new InertWarningLedger();

        // Primeira vez: avisa.
        expect(ledger.shouldWarn(key)).toBe(true);
        expect(ledger.hasWarned(key)).toBe(true);

        // Repetições exatas da mesma ocorrência: nunca mais avisa.
        expect(ledger.shouldWarn(key)).toBe(false);
        expect(ledger.shouldWarn(key)).toBe(false);

        // Uma única ocorrência distinta registrada.
        expect(ledger.size).toBe(1);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('shouldWarn: um snap diferente (ou effect/instance) conta como nova ocorrência', () => {
    fc.assert(
      fc.property(inertKeyArb, (key) => {
        const ledger = new InertWarningLedger();
        expect(ledger.shouldWarn(key)).toBe(true);

        // Snap diferente ⇒ nova ocorrência ⇒ avisa de novo.
        const otherSnap: InertWarningKey = { ...key, snap: key.snap + 100 };
        expect(ledger.shouldWarn(otherSnap)).toBe(true);

        // Instance diferente ⇒ nova ocorrência ⇒ avisa de novo.
        const otherInstance: InertWarningKey = {
          ...key,
          instanceId: key.instanceId + 100,
        };
        expect(ledger.shouldWarn(otherInstance)).toBe(true);

        // Effect diferente ⇒ nova ocorrência ⇒ avisa de novo.
        const otherEffect: InertWarningKey = {
          ...key,
          effectId: `${key.effectId}_X`,
        };
        expect(ledger.shouldWarn(otherEffect)).toBe(true);

        // Quatro ocorrências distintas no total.
        expect(ledger.size).toBe(4);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('dedupeInertWarnings mantém exatamente um aviso por ocorrência distinta', () => {
    fc.assert(
      fc.property(eventStreamArb, (events) => {
        const result = dedupeInertWarnings(events);

        // Conjunto de ocorrências inertes distintas presentes na entrada.
        const distinctKeys = new Set(
          events.filter(isInertEvent).map(occurrenceKeyOf),
        );

        const resultInert = result.filter(isInertEvent);

        // (1) Exatamente um aviso inerte por ocorrência distinta.
        expect(resultInert.length).toBe(distinctKeys.size);

        // (2) Sem repetição de ocorrência na saída.
        const resultKeys = resultInert.map(occurrenceKeyOf);
        expect(new Set(resultKeys).size).toBe(resultKeys.length);

        // (3) Toda ocorrência distinta da entrada sobrevive uma vez.
        expect(new Set(resultKeys)).toEqual(distinctKeys);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('dedupeInertWarnings deixa eventos não-inertes passarem intactos e em ordem', () => {
    fc.assert(
      fc.property(eventStreamArb, (events) => {
        const result = dedupeInertWarnings(events);

        const inputNonInert = events.filter((e) => !isInertEvent(e));
        const resultNonInert = result.filter((e) => !isInertEvent(e));

        // Mesma quantidade, mesma ordem e mesmas referências (intactos).
        expect(resultNonInert.length).toBe(inputNonInert.length);
        resultNonInert.forEach((e, i) => {
          expect(e).toBe(inputNonInert[i]);
        });
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('dedupeInertWarnings preserva a primeira ocorrência (ordem relativa estável)', () => {
    fc.assert(
      fc.property(eventStreamArb, (events) => {
        const result = dedupeInertWarnings(events);

        // A saída é uma subsequência da entrada (nenhum evento reordenado).
        let cursor = 0;
        for (const e of result) {
          const idx = events.indexOf(e, cursor);
          expect(idx).toBeGreaterThanOrEqual(cursor);
          cursor = idx;
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
