import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { assignSeq } from './log';
import type { PipelineLogEvent } from './play/pipeline';
import type {
  LogEventType,
  StateSnapshot,
  Team,
  Weather,
} from './types';
import { PBT_NUM_RUNS } from './test-setup';

/**
 * Property test de completude do log por snap (Task 13.3).
 *
 * // Feature: pfl-simulation-engine, Property 37: Completude do log por snap
 *
 * **Validates: Requirements 13.1, 13.3, 13.4**
 *
 * Para todo fluxo de `PipelineLogEvent` em ordem de emissão:
 *
 * - **R13.1 / R13.3 (completude por snap).** Cada `LogEvent` produzido por
 *   `assignSeq` registra o `StateSnapshot` completo vigente — posição da bola
 *   (`ballOn`), posse (`possession`), decisão de jogada / clima (`weather`,
 *   refletidos no snapshot e no `detail`), fadiga refletida no estado, placar
 *   (`score`), quarto (`quarter`), relógio como **inteiro** (`gameClock`),
 *   `down` e `distance` — e uma `narrative` não vazia. O `seq` atribuído é o
 *   índice do evento (`0, 1, 2, …`) e a ordem relativa é preservada.
 * - **R13.4 (completude exigida).** Um evento com narrativa vazia / só espaços
 *   faz `assignSeq` lançar erro — o log nunca é silenciosamente incompleto.
 */

// ---------------------------------------------------------------------------
// Geradores de StateSnapshot válido e PipelineLogEvent válido
// ---------------------------------------------------------------------------

const WEATHERS: ReadonlyArray<Weather> = [
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
];

const TEAMS: ReadonlyArray<Team> = ['home', 'away'];

const EVENT_TYPES: ReadonlyArray<LogEventType> = [
  'MATCH_INIT',
  'WEATHER_ROLL',
  'KICKOFF',
  'SNAP',
  'TICK',
  'PLAY_SELECTED',
  'MATCHUP_APPLIED',
  'ATTR_CONTEST',
  'PLAY_RESULT',
  'SCORE',
  'POSSESSION_CHANGE',
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'TELEKINESIS_NOTE',
  'ANATOMY_WARNING',
  'FOUL',
  'PENDING_DECISION',
  'TIMEOUT',
  'QUARTER_END',
  'GAME_END',
];

/** `StateSnapshot` completo e válido: relógio sempre inteiro (décimos). */
const snapshotArb: fc.Arbitrary<StateSnapshot> = fc.record({
  quarter: fc.integer({ min: 1, max: 4 }),
  gameClock: fc.integer({ min: 0, max: 9000 }), // décimos de segundo (inteiro)
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 0, max: 99 }),
  ballOn: fc.integer({ min: 0, max: 100 }),
  possession: fc.constantFrom(...TEAMS),
  score: fc.record({
    home: fc.nat({ max: 99 }),
    away: fc.nat({ max: 99 }),
  }),
  weather: fc.constantFrom(...WEATHERS),
});

/**
 * `PipelineLogEvent` válido: snapshot completo + narrativa não vazia. O
 * `detail` carrega a decisão de jogada e o clima vigente, e a fadiga é
 * refletida no estado (snapshot) e opcionalmente em `detail`.
 */
const pipelineEventArb: fc.Arbitrary<PipelineLogEvent> = fc
  .tuple(
    fc.constantFrom(...EVENT_TYPES),
    snapshotArb,
    fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    fc.option(fc.nat({ max: 300 }), { nil: undefined }),
    fc.option(fc.nat({ max: 9000 }), { nil: undefined }),
  )
  .map(([type, state, narrative, snap, tick]) => {
    const event: PipelineLogEvent = {
      type,
      ...(snap !== undefined ? { snap } : {}),
      ...(tick !== undefined ? { tick } : {}),
      state,
      narrative,
      detail: {
        offense: 'O_RUN_INSIDE',
        defense: 'D_RUN_FIT',
        weather: state.weather,
        // Fadiga refletida: valor vigente de um participante do snap.
        fatiguePenalty: 0,
      },
    };
    return event;
  });

/**
 * Verifica que o `StateSnapshot` registrado em um evento é completo e bem
 * formado (todos os campos exigidos presentes e com tipos corretos; relógio
 * inteiro).
 */
function assertCompleteSnapshot(snap: StateSnapshot): void {
  expect(typeof snap.quarter).toBe('number');
  expect(Number.isInteger(snap.quarter)).toBe(true);
  // Relógio deve ser inteiro (décimos de segundo) — estabilidade do log.
  expect(typeof snap.gameClock).toBe('number');
  expect(Number.isInteger(snap.gameClock)).toBe(true);
  expect(typeof snap.down).toBe('number');
  expect(typeof snap.distance).toBe('number');
  expect(typeof snap.ballOn).toBe('number');
  expect(TEAMS).toContain(snap.possession);
  expect(typeof snap.score.home).toBe('number');
  expect(typeof snap.score.away).toBe('number');
  expect(WEATHERS).toContain(snap.weather);
}

// ---------------------------------------------------------------------------
// Propriedades
// ---------------------------------------------------------------------------

describe('Property 37: completude do log por snap (assignSeq)', () => {
  it('atribui seq sequencial, preserva ordem e exige snapshot completo + narrativa (R13.1, R13.3)', () => {
    fc.assert(
      fc.property(
        fc.array(pipelineEventArb, { minLength: 0, maxLength: 30 }),
        (events) => {
          const log = assignSeq(events);

          // Nenhum evento é perdido nem inventado: um LogEvent por entrada.
          expect(log.length).toBe(events.length);

          log.forEach((logEvent, index) => {
            // R13.6 (ordenação estável): seq é o índice sequencial 0,1,2,…
            expect(logEvent.seq).toBe(index);

            // Ordem relativa preservada: o conteúdo corresponde à entrada.
            const source = events[index];
            if (source === undefined) {
              throw new Error('fonte ausente para índice preservado');
            }
            expect(logEvent.type).toBe(source.type);
            expect(logEvent.narrative).toBe(source.narrative);
            expect(logEvent.state).toBe(source.state);
            expect(logEvent.detail).toBe(source.detail);

            // R13.4: narrativa não vazia preservada.
            expect(logEvent.narrative.trim().length).toBeGreaterThan(0);

            // R13.1 / R13.3: snapshot completo (bola, posse, placar, quarto,
            // relógio inteiro, down, distância, clima) e decisão/clima no detail.
            assertCompleteSnapshot(logEvent.state);
            expect(logEvent.detail.weather).toBe(logEvent.state.weather);

            // Campos opcionais preservados fielmente quando presentes.
            if (source.snap !== undefined) {
              expect(logEvent.snap).toBe(source.snap);
            }
            if (source.tick !== undefined) {
              expect(logEvent.tick).toBe(source.tick);
            }
          });

          // seq estritamente crescente de 1 em 1.
          for (let i = 1; i < log.length; i++) {
            const prev = log[i - 1];
            const curr = log[i];
            if (prev === undefined || curr === undefined) {
              throw new Error('índice fora do intervalo inesperado');
            }
            expect(curr.seq).toBe(prev.seq + 1);
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('rejeita (lança) quando algum evento tem narrativa vazia ou só espaços (R13.4)', () => {
    const blankNarrative = fc.oneof(
      fc.constant(''),
      fc.stringMatching(/^[ \t\n\r]+$/),
    );

    fc.assert(
      fc.property(
        fc.array(pipelineEventArb, { minLength: 0, maxLength: 10 }),
        fc.array(pipelineEventArb, { minLength: 0, maxLength: 10 }),
        snapshotArb,
        blankNarrative,
        (before, after, state, narrative) => {
          const bad: PipelineLogEvent = {
            type: 'SNAP',
            state,
            narrative,
            detail: { weather: state.weather },
          };
          const events = [...before, bad, ...after];
          expect(() => assignSeq(events)).toThrow();
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
