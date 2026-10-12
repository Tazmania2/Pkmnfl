/**
 * Property 20 — Fidelidade de avisos de efeito inerte, sem bônus silencioso.
 *
 * **Validates: Requirements 12.1, 12.2, 12.3**
 *
 * `progressAt(log, i).warnings` deriva os avisos de efeito inerte/supressão
 * EXCLUSIVAMENTE do `powerReason` do próprio `LogEvent` (mais campos rastreáveis
 * do `detail`). O teste exercita `LogEvent`s arbitrários — alguns COM
 * `powerReason` (ex.: `INERT_WITH_WARNING`, `POWER_SUPPRESSED`, `POWER_INERT`),
 * outros SEM — e verifica:
 *
 * - Ausência de `powerReason` (ausente/vazio) ⇒ `warnings` vazio: nenhum aviso
 *   nem bônus é fabricado quando o log não o registra (R12.3).
 * - Presença de `powerReason` ⇒ `warnings` não vazio, e cada aviso é rastreável
 *   ao `powerReason`/`detail` do evento: nenhum valor é inventado além do que o
 *   evento carrega (R12.1, R12.2).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { progressAt } from './progress';
import type { GameLog, LogEvent, JsonValue } from './contracts';

// ---------------------------------------------------------------------------
// Arbitrários autossuficientes de GameLog/LogEvent
// ---------------------------------------------------------------------------

const teamArb = fc.constantFrom<'home' | 'away'>('home', 'away');
const weatherArb = fc.constantFrom('CLEAR', 'RAIN', 'WIND', 'HEAT', 'COLD');

/** `StateSnapshot` válido — valores apenas espelhados por `progressAt`. */
const stateArb = fc.record({
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

/** Motivos de poder canônicos/plausíveis que o log pode registrar. */
const powerReasonArb = fc.constantFrom(
  'INERT_WITH_WARNING',
  'POWER_SUPPRESSED',
  'POWER_INERT',
  'TELEKINESIS_NOTE',
  'ANATOMY_WARNING',
);

/** Valor JSON arbitrário raso para `detail` (sem recursão profunda). */
const jsonLeafArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

/** `detail` arbitrário, possivelmente carregando campos rastreáveis conhecidos. */
const detailArb: fc.Arbitrary<Readonly<Record<string, JsonValue>>> = fc.record(
  {
    effectId: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
      nil: undefined,
    }),
    instanceId: fc.option(fc.integer({ min: 1, max: 9999 }), { nil: undefined }),
    outcome: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
      nil: undefined,
    }),
    noise: fc.option(jsonLeafArb, { nil: undefined }),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<Readonly<Record<string, JsonValue>>>;

/**
 * `LogEvent` arbitrário. `withPowerReason` força metade dos casos a carregar um
 * `powerReason` presente e a outra metade a NÃO carregar (ausente) ou carregar
 * a string vazia — cobrindo os dois ramos de `deriveWarnings`.
 */
const eventArb: fc.Arbitrary<LogEvent> = fc
  .record({
    seq: fc.integer({ min: 0, max: 10_000 }),
    type: fc.constantFrom(
      'SNAP',
      'PLAY_RESULT',
      'POWER_SUPPRESSED',
      'POWER_INERT',
      'FOUL',
    ),
    state: stateArb,
    narrative: fc.string({ maxLength: 60 }),
    detail: detailArb,
    // `undefined` (ausente) | '' (vazio) | motivo presente.
    powerReason: fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      powerReasonArb,
    ),
  })
  .map((e) => {
    // Omite a chave quando `undefined` para refletir um evento sem `powerReason`.
    const base: LogEvent = {
      seq: e.seq,
      type: e.type as LogEvent['type'],
      state: e.state,
      narrative: e.narrative,
      detail: e.detail,
    };
    return e.powerReason === undefined
      ? base
      : { ...base, powerReason: e.powerReason };
  });

/** `GameLog` mínimo porém válido, com ao menos um evento. */
const logArb: fc.Arbitrary<GameLog> = fc
  .array(eventArb, { minLength: 1, maxLength: 8 })
  .map((events) => ({
    seedUsed: '0',
    baselineVersion: 'test',
    baselineStatus: 'FROZEN_MVP_TEST',
    events,
    stats: {
      rushes: { attempts: 0, yards: 0 },
      passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
      turnovers: 0,
      fouls: 0,
      scoringSummary: [],
    },
  }));

// ---------------------------------------------------------------------------
// Property 20
// ---------------------------------------------------------------------------

describe('Property 20: fidelidade de avisos de efeito inerte, sem bônus silencioso', () => {
  it('deriva warnings somente do powerReason/detail do evento — vazio quando ausente', () => {
    fc.assert(
      fc.property(
        logArb,
        // índice de evento válido escolhido relativamente ao log gerado
        fc.nat(),
        (log, rawIndex) => {
          const i = rawIndex % log.events.length;
          const event = log.events[i]!;
          const { warnings } = progressAt(log, i);

          const reason = event.powerReason;
          const hasReason = reason !== undefined && reason !== '';

          if (!hasReason) {
            // R12.3: sem powerReason registrado ⇒ nenhum aviso/bônus fabricado.
            expect(warnings).toEqual([]);
            return;
          }

          // R12.1: há aviso quando o evento registra o motivo.
          expect(warnings.length).toBeGreaterThan(0);

          for (const w of warnings) {
            // R12.1/R12.2: o motivo registrado aparece textualmente no aviso.
            expect(w).toContain(reason);

            // R12.2: cada segmento rastreável vem de um campo real do detail;
            // nada é inventado além do que o evento carrega.
            const effectId = readString(event.detail, 'effectId');
            if (effectId !== null) {
              expect(w).toContain(effectId);
            }
            const instanceId = readNumber(event.detail, 'instanceId');
            if (instanceId !== null) {
              expect(w).toContain(String(instanceId));
            }
            const outcome = readString(event.detail, 'outcome');
            if (outcome !== null) {
              expect(w).toContain(outcome);
            }
          }
        },
      ),
    );
  });

  it('não introduz warnings quando nenhum evento carrega powerReason (R12.3)', () => {
    const noReasonEventArb: fc.Arbitrary<LogEvent> = fc.record({
      seq: fc.integer({ min: 0, max: 1000 }),
      type: fc.constant('SNAP' as LogEvent['type']),
      state: stateArb,
      narrative: fc.string({ maxLength: 40 }),
      detail: detailArb,
    });

    const noReasonLogArb: fc.Arbitrary<GameLog> = fc
      .array(noReasonEventArb, { minLength: 1, maxLength: 6 })
      .map((events) => ({
        seedUsed: '0',
        baselineVersion: 'test',
        baselineStatus: 'FROZEN_MVP_TEST',
        events,
        stats: {
          rushes: { attempts: 0, yards: 0 },
          passes: {
            attempts: 0,
            completions: 0,
            yards: 0,
            interceptions: 0,
          },
          turnovers: 0,
          fouls: 0,
          scoringSummary: [],
        },
      }));

    fc.assert(
      fc.property(noReasonLogArb, (log) => {
        for (let i = 0; i < log.events.length; i++) {
          expect(progressAt(log, i).warnings).toEqual([]);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers de leitura de `detail` (espelham a derivação do módulo sob teste)
// ---------------------------------------------------------------------------

function readString(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): string | null {
  const value = detail[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): number | null {
  const value = detail[key];
  return typeof value === 'number' ? value : null;
}
