import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  assignSeq,
  buildGameLog,
  type PowerReason,
} from './log';
import type { PipelineLogEvent } from './play/pipeline';
import type {
  Baseline,
  LogEventType,
  StateSnapshot,
  Team,
  Weather,
} from './types';
import { PBT_NUM_RUNS } from './test-setup';

// Feature: pfl-simulation-engine, Property 38: Motivo de toda (não) ativação de poder

/**
 * Property test de motivo de (não) ativação de poder (Task 13.4).
 *
 * **Feature: pfl-simulation-engine, Property 38: Motivo de toda (não) ativação
 * de poder**
 *
 * **Validates: Requirements 13.2**
 *
 * Para qualquer fluxo de eventos do `Log_Partida`, todo evento de um tipo
 * **relacionado a poder** (`POWER_SUPPRESSED`, `POWER_INERT`, `TELEKINESIS_NOTE`,
 * `ANATOMY_WARNING`) carrega um `powerReason` **não vazio** após
 * `buildGameLog`/`assignSeq` — isto é, nenhuma (não) ativação de poder é
 * registrada sem um motivo explícito. Além disso, os três motivos canônicos
 * (`POWER_SUPPRESSED`, `POWER_INERT`, `TELEKINESIS_NOT_POSSESSION`) são preservados
 * byte a byte do evento de origem para o `LogEvent` carimbado.
 *
 * Estratégia: geram-se arranjos arbitrários de eventos onde eventos de tipo de
 * poder **sempre** incluem um `powerReason` (modelando o contrato das camadas
 * emissoras — o pipeline só emite tais eventos com motivo), intercalados com
 * eventos não-poder (sem `powerReason`). A de-duplicação de avisos inertes é
 * desligada (`dedupeInert: false`) para que a correspondência evento↔evento seja
 * posicional e observável sem perda.
 */

// ---------------------------------------------------------------------------
// Tipos de evento relacionados a poder (os que exigem motivo — R13.2)
// ---------------------------------------------------------------------------

const POWER_EVENT_TYPES = [
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'TELEKINESIS_NOTE',
  'ANATOMY_WARNING',
] as const satisfies ReadonlyArray<LogEventType>;

const POWER_EVENT_TYPE_SET: ReadonlySet<LogEventType> = new Set(
  POWER_EVENT_TYPES,
);

/** `true` quando o tipo de evento é relacionado a poder (exige `powerReason`). */
function isPowerEventType(type: LogEventType): boolean {
  return POWER_EVENT_TYPE_SET.has(type);
}

/** Os três motivos canônicos obrigatórios de (não) ativação de poder (R13.2). */
const CANONICAL_REASONS = [
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'TELEKINESIS_NOT_POSSESSION',
] as const satisfies ReadonlyArray<PowerReason>;

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

const weatherArb = fc.constantFrom<Weather>(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
);

const teamArb = fc.constantFrom<Team>('home', 'away');

/** Snapshot vigente arbitrário (relógio em décimos inteiros, R13.1/R13.3). */
const snapshotArb: fc.Arbitrary<StateSnapshot> = fc.record({
  quarter: fc.integer({ min: 1, max: 4 }),
  gameClock: fc.integer({ min: 0, max: 9000 }),
  down: fc.integer({ min: 1, max: 4 }),
  distance: fc.integer({ min: 0, max: 99 }),
  ballOn: fc.integer({ min: 0, max: 100 }),
  possession: teamArb,
  score: fc.record({
    home: fc.integer({ min: 0, max: 70 }),
    away: fc.integer({ min: 0, max: 70 }),
  }),
  weather: weatherArb,
});

/** Narrativa não vazia (exigência de completude — R13.4). */
const narrativeArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/**
 * Motivo de poder não vazio: inclui os três canônicos e motivos versionados
 * adicionais do baseline (ex.: `ANATOMY_BLOCKED`, `INERT_WITH_WARNING`).
 */
const powerReasonArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...CANONICAL_REASONS),
  fc.constantFrom(
    'ANATOMY_BLOCKED',
    'ANATOMY_LIMITATION',
    'INERT_WITH_WARNING',
  ),
);

/** Tipo de evento NÃO relacionado a poder (não carrega `powerReason`). */
const nonPowerTypeArb = fc.constantFrom<LogEventType>(
  'MATCH_INIT',
  'WEATHER_ROLL',
  'KICKOFF',
  'SNAP',
  'PLAY_SELECTED',
  'MATCHUP_APPLIED',
  'ATTR_CONTEST',
  'PLAY_RESULT',
  'SCORE',
  'POSSESSION_CHANGE',
  'QUARTER_END',
  'GAME_END',
);

/** Evento de poder: sempre com `powerReason` não vazio (contrato emissor). */
const powerEventArb: fc.Arbitrary<PipelineLogEvent> = fc.record({
  type: fc.constantFrom<LogEventType>(...POWER_EVENT_TYPES),
  snap: fc.integer({ min: 0, max: 200 }),
  state: snapshotArb,
  narrative: narrativeArb,
  detail: fc.constant({}),
  powerReason: powerReasonArb,
});

/** Evento não-poder: nunca inclui `powerReason`. */
const nonPowerEventArb: fc.Arbitrary<PipelineLogEvent> = fc.record({
  type: nonPowerTypeArb,
  snap: fc.integer({ min: 0, max: 200 }),
  state: snapshotArb,
  narrative: narrativeArb,
  detail: fc.constant({}),
});

/** Fluxo arbitrário misto de eventos (poder e não-poder), em ordem de emissão. */
const eventStreamArb: fc.Arbitrary<ReadonlyArray<PipelineLogEvent>> = fc.array(
  fc.oneof(powerEventArb, nonPowerEventArb),
  { minLength: 0, maxLength: 40 },
);

/** Baseline mínimo bem-formado para montar o `GameLog`. */
const BASELINE: Baseline = {
  version: 'D1-design-2026-10-09',
  status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
  simulationParameters: {} as Baseline['simulationParameters'],
  matchups: new Map<string, number>(),
};

// ---------------------------------------------------------------------------
// Propriedade
// ---------------------------------------------------------------------------

describe('Property 38: motivo de toda (não) ativação de poder (R13.2)', () => {
  it('todo evento de tipo relacionado a poder carrega um powerReason não vazio', () => {
    fc.assert(
      fc.property(eventStreamArb, (events) => {
        const log = buildGameLog({
          events,
          seed: 42n,
          baseline: BASELINE,
          // Sem de-duplicação: a correspondência evento↔evento é posicional.
          dedupeInert: false,
        });

        // Mesma contagem de eventos (dedup desligado) e correspondência por índice.
        expect(log.events.length).toBe(events.length);

        for (let i = 0; i < log.events.length; i++) {
          const built = log.events[i]!;
          const src = events[i]!;

          if (isPowerEventType(built.type)) {
            // R13.2: toda (não) ativação de poder registra um motivo não vazio.
            expect(built.powerReason).toBeDefined();
            expect(typeof built.powerReason).toBe('string');
            expect((built.powerReason as string).length).toBeGreaterThan(0);
            // O motivo é preservado byte a byte da origem.
            expect(built.powerReason).toBe(src.powerReason);
          } else {
            // Eventos não-poder não introduzem motivo espúrio.
            expect(built.powerReason).toBeUndefined();
          }
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('os três motivos canônicos são preservados pelo carimbo de seq', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CANONICAL_REASONS),
        fc.constantFrom<LogEventType>(...POWER_EVENT_TYPES),
        snapshotArb,
        narrativeArb,
        (reason, type, state, narrative) => {
          const event: PipelineLogEvent = {
            type,
            snap: 0,
            state,
            narrative,
            detail: {},
            powerReason: reason,
          };
          const built = assignSeq([event])[0]!;
          expect(built.powerReason).toBe(reason);
          // O motivo canônico sobrevive como uma das três constantes esperadas.
          expect(CANONICAL_REASONS).toContain(built.powerReason as PowerReason);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
