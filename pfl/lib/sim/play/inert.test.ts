import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  REASON_INERT_WITH_WARNING,
  REASON_NO_APPROVED_DISPOSITION,
  resolveEffectDisposition,
} from './inert';
import type { EffectStatus } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

/**
 * Property test da disposição de efeitos inertes (Task 8.2).
 *
 * // Feature: pfl-simulation-engine, Property 29: Disposição de efeito é sempre inerte-com-motivo
 *
 * **Validates: Requirements 9.1, 9.2**
 *
 * Para QUALQUER `effectId`, tabela de disposição e `athleteInstanceId`,
 * `resolveEffectDisposition` sempre retorna `inert = true` (invariante do MVP:
 * nenhum efeito adicional produz bônus). O que varia é apenas o `reason`:
 *
 * - Efeito **com registro** de status `INERT_WITH_WARNING` (R9.1) → o motivo é
 *   `INERT_WITH_WARNING`.
 * - Efeito **sem registro** na tabela (R9.2) → o motivo é
 *   `SEM_DISPOSICAO_APROVADA` (ausência de disposição aprovada).
 * - Efeito **com registro** de qualquer outro status versionado → ainda inerte,
 *   com o motivo igual ao próprio status registrado (nenhum status ativa bônus).
 *
 * Em todos os casos, `effectId` e `athleteInstanceId` são ecoados de volta na
 * decisão, para que o log identifique efeito e atleta sem ambiguidade.
 */

/** Gerador de identificadores de efeito arbitrários (strings não vazias). */
const effectIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 24 });

/** Gerador de `instance_id` arbitrário (inteiro de time). */
const instanceIdArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100_000 });

/**
 * Gerador de status de disposição versionado "não canônico": qualquer string
 * diferente do valor canônico `INERT_WITH_WARNING`. Usado para checar que um
 * status alternativo é propagado como motivo mas ainda tratado como inerte.
 */
const otherStatusArb: fc.Arbitrary<EffectStatus> = fc
  .string({ maxLength: 24 })
  .filter((s) => s !== REASON_INERT_WITH_WARNING);

/**
 * Gerador de tabela de disposição arbitrária (`ReadonlyMap<string, EffectStatus>`),
 * cobrindo entradas canônicas (`INERT_WITH_WARNING`) e outros status versionados.
 */
const dispositionTableArb: fc.Arbitrary<ReadonlyMap<string, EffectStatus>> = fc
  .array(
    fc.tuple(
      effectIdArb,
      fc.oneof(fc.constant<EffectStatus>(REASON_INERT_WITH_WARNING), otherStatusArb),
    ),
    { maxLength: 12 },
  )
  .map((entries) => new Map<string, EffectStatus>(entries));

describe('resolveEffectDisposition — disposição sempre inerte-com-motivo (Property 29)', () => {
  it('retorna sempre inert=true e ecoa effectId/athleteInstanceId para entradas arbitrárias', () => {
    fc.assert(
      fc.property(
        effectIdArb,
        dispositionTableArb,
        instanceIdArb,
        (effectId, table, athleteInstanceId) => {
          const decision = resolveEffectDisposition(effectId, table, athleteInstanceId);

          // Invariante do MVP: nenhum efeito adicional é ativo (R9.1, R9.2).
          expect(decision.inert).toBe(true);
          // Identificação ecoada de volta para o log.
          expect(decision.effectId).toBe(effectId);
          expect(decision.athleteInstanceId).toBe(athleteInstanceId);

          // O motivo é coerente com a presença/status na tabela.
          if (!table.has(effectId)) {
            expect(decision.reason).toBe(REASON_NO_APPROVED_DISPOSITION);
          } else {
            expect(decision.reason).toBe(table.get(effectId));
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('status INERT_WITH_WARNING (R9.1) → inert=true e reason=INERT_WITH_WARNING', () => {
    fc.assert(
      fc.property(effectIdArb, instanceIdArb, (effectId, athleteInstanceId) => {
        const table = new Map<string, EffectStatus>([[effectId, REASON_INERT_WITH_WARNING]]);
        const decision = resolveEffectDisposition(effectId, table, athleteInstanceId);

        expect(decision.inert).toBe(true);
        expect(decision.reason).toBe(REASON_INERT_WITH_WARNING);
        expect(decision.effectId).toBe(effectId);
        expect(decision.athleteInstanceId).toBe(athleteInstanceId);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('efeito sem registro na tabela (R9.2) → inert=true e reason=SEM_DISPOSICAO_APROVADA', () => {
    fc.assert(
      fc.property(
        effectIdArb,
        dispositionTableArb,
        instanceIdArb,
        (effectId, table, athleteInstanceId) => {
          // Garante ausência do effectId na tabela, removendo-o se presente.
          const absentTable = new Map<string, EffectStatus>(table);
          absentTable.delete(effectId);

          const decision = resolveEffectDisposition(effectId, absentTable, athleteInstanceId);

          expect(decision.inert).toBe(true);
          expect(decision.reason).toBe(REASON_NO_APPROVED_DISPOSITION);
          expect(decision.effectId).toBe(effectId);
          expect(decision.athleteInstanceId).toBe(athleteInstanceId);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('status versionado não canônico → inert=true e reason igual ao status registrado', () => {
    fc.assert(
      fc.property(
        effectIdArb,
        otherStatusArb,
        instanceIdArb,
        (effectId, status, athleteInstanceId) => {
          const table = new Map<string, EffectStatus>([[effectId, status]]);
          const decision = resolveEffectDisposition(effectId, table, athleteInstanceId);

          // Nenhum status ativa bônus no MVP: ainda inerte.
          expect(decision.inert).toBe(true);
          // O status versionado é propagado verbatim como motivo.
          expect(decision.reason).toBe(status);
          expect(decision.effectId).toBe(effectId);
          expect(decision.athleteInstanceId).toBe(athleteInstanceId);
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
