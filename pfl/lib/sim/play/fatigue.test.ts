import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEFAULT_FATIGUE_PARAMETERS,
  DEFAULT_HEAT_FATIGUE_PER_SNAP,
  FATIGUE_MIN,
  applyFatigue,
  type FatigueSnapInput,
} from './fatigue';
import type { Weather } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test de fadiga compartilhada, acumulada e limitada (Task 5.2).
 *
 * // Feature: pfl-simulation-engine, Property 19: Fadiga compartilhada, acumulada e limitada
 *
 * **Validates: Requirements 6.4, 6.5, 6.6, 6.7, 7.4, 11.5**
 *
 * Para toda sequência de snaps e todo `instance_id`, a fadiga é indexada por
 * indivíduo (compartilhada entre todas as unidades em que ele atua e persistente
 * por toda a partida), acrescida de `0.003` por snap ativo (`0.005` em ação
 * extrema), reduzida de `0.001` por snap inativo, com acréscimo adicional de
 * `0.002` por snap sob clima HEAT, e permanece sempre no intervalo [0, 0.12].
 *
 * `applyFatigue(prev, input)` é a transição pura: devolve um NOVO `ReadonlyMap`
 * sem mutar `prev`. A propriedade é verificável integralmente aqui porque toda
 * a lógica de acúmulo/recuperação/limite e de compartilhamento por `instance_id`
 * mora nesse módulo puro.
 */

const PARAMS = DEFAULT_FATIGUE_PARAMETERS;
const HEAT_DELTA = DEFAULT_HEAT_FATIGUE_PER_SNAP;
const MAX = PARAMS.max_penalty; // 0.12
const EPS = 1e-9;

const WEATHERS: readonly Weather[] = ['CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD'];

/** `instance_id` arbitrário (inteiro pequeno para favorecer sobreposições). */
const instanceIdArb = fc.integer({ min: 0, max: 20 });

/** Conjunto arbitrário de `instance_id`. */
const idSetArb = fc.uniqueArray(instanceIdArb, { maxLength: 8 });

const weatherArb = fc.constantFrom(...WEATHERS) as fc.Arbitrary<Weather>;

/** Mapa de fadiga prévio arbitrário, com valores sempre dentro de [0, 0.12]. */
const prevArb: fc.Arbitrary<ReadonlyMap<number, number>> = fc
  .array(
    fc.tuple(instanceIdArb, fc.double({ min: 0, max: MAX, noNaN: true })),
    { maxLength: 10 },
  )
  .map((entries) => new Map<number, number>(entries));

/**
 * Gera um `FatigueSnapInput` arbitrário com conjuntos disjuntos ou sobrepostos.
 * Os três conjuntos podem compartilhar `instance_id` de propósito, para
 * exercitar a precedência extreme > active > inactive.
 */
const snapInputArb: fc.Arbitrary<FatigueSnapInput> = fc.record({
  activeInstances: idSetArb.map((xs) => new Set(xs)),
  extremeInstances: idSetArb.map((xs) => new Set(xs)),
  inactiveInstances: idSetArb.map((xs) => new Set(xs)),
  weather: weatherArb,
});

/** Classifica a disposição efetiva de um `instance_id` com a precedência do módulo. */
function disposition(
  id: number,
  input: FatigueSnapInput,
): 'extreme' | 'active' | 'inactive' | 'untouched' {
  if (input.extremeInstances.has(id)) return 'extreme';
  if (input.activeInstances.has(id)) return 'active';
  if (input.inactiveInstances.has(id)) return 'inactive';
  return 'untouched';
}

describe('Fadiga compartilhada, acumulada e limitada (Property 19)', () => {
  it('todo valor resultante permanece no intervalo fechado [0, 0.12] (R6.6)', () => {
    fc.assert(
      fc.property(prevArb, snapInputArb, (prev, input) => {
        const next = applyFatigue(prev, input);
        for (const value of next.values()) {
          expect(value).toBeGreaterThanOrEqual(FATIGUE_MIN);
          expect(value).toBeLessThanOrEqual(MAX + EPS);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('aplica o delta correto por disposição com precedência extreme > active > inactive (R6.4, R6.5, R7.4)', () => {
    fc.assert(
      fc.property(prevArb, snapInputArb, (prev, input) => {
        const next = applyFatigue(prev, input);
        const isHeat = input.weather === 'HEAT';
        const touched = new Set<number>([
          ...input.extremeInstances,
          ...input.activeInstances,
          ...input.inactiveInstances,
        ]);

        for (const id of touched) {
          const base = prev.get(id) ?? 0;
          const d = disposition(id, input);

          let expectedDelta: number;
          if (d === 'extreme') {
            // Ação extrema: +0.005 (NÃO somado com +0.003), + HEAT se participar.
            expectedDelta = PARAMS.extreme_action + (isHeat ? HEAT_DELTA : 0);
          } else if (d === 'active') {
            expectedDelta = PARAMS.active + (isHeat ? HEAT_DELTA : 0);
          } else {
            // Inativo: recupera -0.001, nunca recebe acréscimo de HEAT.
            expectedDelta = -PARAMS.inactive_snap_recovery;
          }

          const expected = Math.min(MAX, Math.max(FATIGUE_MIN, base + expectedDelta));
          expect(next.get(id)).toBeCloseTo(expected, 9);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('precedência: um extremo recebe +0.005 e nunca a soma com +0.003 nem recupera no mesmo snap (R6.4)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        weatherArb,
        (base, weather) => {
          const id = 7;
          const prev = new Map<number, number>([[id, base]]);
          // O mesmo id aparece em todos os três conjuntos: extreme vence.
          const input: FatigueSnapInput = {
            extremeInstances: new Set([id]),
            activeInstances: new Set([id]),
            inactiveInstances: new Set([id]),
            weather,
          };
          const next = applyFatigue(prev, input);
          const heat = weather === 'HEAT' ? HEAT_DELTA : 0;
          const expected = Math.min(MAX, base + PARAMS.extreme_action + heat);
          expect(next.get(id)).toBeCloseTo(expected, 9);
          // Prova de não-soma: delta aplicado < extreme + active.
          const applied = (next.get(id) ?? 0) - base;
          expect(applied).toBeLessThan(
            PARAMS.extreme_action + PARAMS.active + heat + EPS,
          );
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('acúmulo em snaps repetidos cresce monotonicamente até saturar no teto 0.12 (R6.4, R6.6)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'extreme' | 'active'>('extreme', 'active'),
        fc.boolean(),
        (kind, heat) => {
          const id = 1;
          const weather: Weather = heat ? 'HEAT' : 'CLEAR';
          const input: FatigueSnapInput = {
            extremeInstances: new Set(kind === 'extreme' ? [id] : []),
            activeInstances: new Set(kind === 'active' ? [id] : []),
            inactiveInstances: new Set<number>(),
            weather,
          };

          let map: ReadonlyMap<number, number> = new Map();
          let prevValue = 0;
          // 60 snaps bastam para saturar mesmo com o menor incremento (0.003).
          for (let i = 0; i < 60; i++) {
            map = applyFatigue(map, input);
            const value = map.get(id) ?? 0;
            // Monotonicamente não decrescente enquanto participa.
            expect(value).toBeGreaterThanOrEqual(prevValue - EPS);
            expect(value).toBeLessThanOrEqual(MAX + EPS);
            prevValue = value;
          }
          // Após snaps suficientes, satura exatamente no teto.
          expect(prevValue).toBeCloseTo(MAX, 9);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('inativo recupera -0.001 por snap, monotonicamente até o piso 0 (R6.5, R6.6)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: MAX, noNaN: true }), (base) => {
        const id = 3;
        const input: FatigueSnapInput = {
          extremeInstances: new Set<number>(),
          activeInstances: new Set<number>(),
          inactiveInstances: new Set([id]),
          weather: 'CLEAR',
        };
        let map: ReadonlyMap<number, number> = new Map([[id, base]]);
        let prevValue = base;
        // 0.12 / 0.001 = 120 snaps bastam para esgotar a recuperação.
        for (let i = 0; i < 130; i++) {
          map = applyFatigue(map, input);
          const value = map.get(id) ?? 0;
          expect(value).toBeLessThanOrEqual(prevValue + EPS);
          expect(value).toBeGreaterThanOrEqual(FATIGUE_MIN);
          prevValue = value;
        }
        expect(prevValue).toBeCloseTo(FATIGUE_MIN, 9);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('HEAT adiciona +0.002 apenas para participantes; inativos nunca recebem o acréscimo (R7.4)', () => {
    fc.assert(
      fc.property(
        prevArb,
        idSetArb.map((xs) => new Set(xs)),
        idSetArb.map((xs) => new Set(xs)),
        (prev, activeSet, inactiveSet) => {
          // Inativos "puros": removem qualquer id que também esteja ativo.
          const pureInactive = new Set(
            [...inactiveSet].filter((id) => !activeSet.has(id)),
          );
          const base: Omit<FatigueSnapInput, 'weather'> = {
            extremeInstances: new Set<number>(),
            activeInstances: activeSet,
            inactiveInstances: pureInactive,
          };
          const clear = applyFatigue(prev, { ...base, weather: 'CLEAR' });
          const hot = applyFatigue(prev, { ...base, weather: 'HEAT' });

          for (const id of activeSet) {
            const prevVal = prev.get(id) ?? 0;
            const clearVal = clear.get(id) ?? 0;
            const hotVal = hot.get(id) ?? 0;
            // Participante: a diferença entre HEAT e CLEAR é +0.002, salvo saturação.
            if (clearVal < MAX - EPS && prevVal + PARAMS.active + HEAT_DELTA <= MAX + EPS) {
              expect(hotVal - clearVal).toBeCloseTo(HEAT_DELTA, 9);
            } else {
              // Perto do teto, HEAT nunca produz menos fadiga que CLEAR.
              expect(hotVal).toBeGreaterThanOrEqual(clearVal - EPS);
            }
          }

          for (const id of pureInactive) {
            // Inativo: HEAT não altera a recuperação (idêntico a CLEAR).
            expect(hot.get(id)).toBeCloseTo(clear.get(id) ?? 0, 9);
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('a fadiga é compartilhada por instance_id entre unidades: a mesma entrada é lida e escrita uma vez (R6.7, R11.5)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        weatherArb,
        (base, weather) => {
          const id = 9;
          const prev = new Map<number, number>([[id, base]]);
          // Mesmo indivíduo "atuando" em offense e special teams no mesmo snap:
          // ambas as participações referenciam o MESMO instance_id => uma entrada.
          const input: FatigueSnapInput = {
            extremeInstances: new Set<number>(),
            activeInstances: new Set([id]),
            inactiveInstances: new Set<number>(),
            weather,
          };
          const next = applyFatigue(prev, input);
          const heat = weather === 'HEAT' ? HEAT_DELTA : 0;
          const expected = Math.min(MAX, base + PARAMS.active + heat);
          // Uma única escrita por instance_id (não dobra por aparecer em 2 unidades).
          expect(next.get(id)).toBeCloseTo(expected, 9);
          expect(next.size).toBe(1);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('instance_id intocados persistem inalterados e prev nunca é mutado (R6.7, R11.5)', () => {
    fc.assert(
      fc.property(prevArb, snapInputArb, (prev, input) => {
        const prevSnapshot = new Map(prev);
        const next = applyFatigue(prev, input);

        const touched = new Set<number>([
          ...input.extremeInstances,
          ...input.activeInstances,
          ...input.inactiveInstances,
        ]);

        // Todo id prévio NÃO tocado pelo snap persiste exatamente igual.
        for (const [id, value] of prevSnapshot) {
          if (!touched.has(id)) {
            expect(next.get(id)).toBe(value);
          }
        }

        // Pureza: applyFatigue não muta o mapa de entrada.
        expect(new Map(prev)).toEqual(prevSnapshot);
        // Devolve um novo mapa (nunca a mesma referência).
        expect(next).not.toBe(prev);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('persistência por toda a partida: um id tocado só no 1º snap mantém sua fadiga pelos snaps seguintes (R11.5)', () => {
    fc.assert(
      fc.property(weatherArb, (weather) => {
        const persistent = 100; // participa só uma vez
        const other = 200; // participa nos snaps seguintes

        let map: ReadonlyMap<number, number> = new Map();
        // Snap 1: ambos participam ativamente.
        map = applyFatigue(map, {
          extremeInstances: new Set<number>(),
          activeInstances: new Set([persistent, other]),
          inactiveInstances: new Set<number>(),
          weather,
        });
        const persistedValue = map.get(persistent);

        // Snaps 2..6: apenas `other` participa; `persistent` fica fora de todos os conjuntos.
        for (let i = 0; i < 5; i++) {
          map = applyFatigue(map, {
            extremeInstances: new Set<number>(),
            activeInstances: new Set([other]),
            inactiveInstances: new Set<number>(),
            weather,
          });
          // `persistent` conserva seu valor inalterado por toda a partida.
          expect(map.get(persistent)).toBe(persistedValue);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
