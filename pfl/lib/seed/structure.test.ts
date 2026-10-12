import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  SEED_FORBIDDEN_FIELDS,
  SEED_REQUIRED_FIELDS,
  validateSeedStructure,
  type JsonValue,
  type SeedDocument,
  type SeedForbiddenField,
  type SeedRequiredField,
} from './checksum';

/**
 * Teste de propriedade da validade estrutural do Seed_Time (Task 12.4).
 *
 * **Feature: pfl-foundation, Property 6: Validade estrutural do seed**
 *
 * Validates: Requirements 16.2, 16.4, 16.5
 *
 * Para todo documento de seed, `validateSeedStructure(doc).accepted === true`
 * se e somente se (bicondicional) TODOS os campos obrigatórios estão presentes
 * e não vazios (R16.2) E NENHUM campo proibido está presente (R16.4/R16.5). A
 * verificação compara o SUT (`validateSeedStructure`) contra um oráculo de
 * referência independente, reimplementado de forma mínima e direta a partir
 * dos critérios de aceitação, sem compartilhar a lógica do módulo sob teste.
 */

/**
 * Oráculo independente de "não vazio" para um campo obrigatório (R16.2),
 * derivado diretamente dos critérios de aceitação: `null`/`undefined` são
 * vazios; strings só contam quando têm conteúdo não-espaço; arrays e objetos só
 * contam quando têm ao menos um elemento/chave; números e booleanos (incluindo
 * `0`/`false`) contam sempre como presentes.
 */
function oracleIsNonEmpty(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  // objeto JSON
  return Object.keys(value).length > 0;
}

/**
 * Oráculo de referência da aceitação estrutural (bicondicional de R16.2 +
 * R16.4/R16.5), independente da implementação de `validateSeedStructure`.
 */
function oracleAccepts(doc: SeedDocument): boolean {
  const allRequiredPresentAndNonEmpty = SEED_REQUIRED_FIELDS.every(
    (field) =>
      Object.prototype.hasOwnProperty.call(doc, field) &&
      oracleIsNonEmpty(doc[field]),
  );
  const noForbiddenPresent = SEED_FORBIDDEN_FIELDS.every(
    (field) => !Object.prototype.hasOwnProperty.call(doc, field),
  );
  return allRequiredPresentAndNonEmpty && noForbiddenPresent;
}

/** Valor não vazio para um campo obrigatório, variando o tipo JSON. */
const nonEmptyValue: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(0),
  fc.constant(false),
  fc.array(fc.integer(), { minLength: 1, maxLength: 4 }),
  fc.dictionary(fc.string({ minLength: 1 }), fc.integer(), {
    minKeys: 1,
    maxKeys: 3,
  }) as fc.Arbitrary<JsonValue>,
);

/** Valor "vazio" para um campo obrigatório, exercitando cada ramo de R16.2. */
const emptyValue: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.constant<JsonValue>(null),
  fc.constantFrom<JsonValue>('', '   ', '\t\n'),
  fc.constant<JsonValue>([]),
  fc.constant<JsonValue>({}),
);

/**
 * Gera um documento de seed aleatório, para cada campo obrigatório decidindo
 * independentemente entre ausente / presente-não-vazio / presente-vazio, e para
 * cada campo proibido decidindo independentemente entre ausente / presente.
 */
const seedDocumentArbitrary: fc.Arbitrary<SeedDocument> = fc
  .record({
    required: fc.record(
      Object.fromEntries(
        SEED_REQUIRED_FIELDS.map((field) => [
          field,
          fc.oneof(
            fc.constant<{ kind: 'absent' }>({ kind: 'absent' }),
            nonEmptyValue.map((value) => ({ kind: 'nonEmpty' as const, value })),
            emptyValue.map((value) => ({ kind: 'empty' as const, value })),
          ),
        ]),
      ) as Record<
        SeedRequiredField,
        fc.Arbitrary<
          | { kind: 'absent' }
          | { kind: 'nonEmpty'; value: JsonValue }
          | { kind: 'empty'; value: JsonValue }
        >
      >,
    ),
    forbidden: fc.record(
      Object.fromEntries(
        SEED_FORBIDDEN_FIELDS.map((field) => [
          field,
          fc.oneof(
            fc.constant<{ present: false }>({ present: false }),
            nonEmptyValue.map((value) => ({ present: true as const, value })),
          ),
        ]),
      ) as Record<
        SeedForbiddenField,
        fc.Arbitrary<{ present: false } | { present: true; value: JsonValue }>
      >,
    ),
    // Campos extraneous arbitrários que não devem influenciar a aceitação.
    extra: fc.dictionary(
      fc
        .string({ minLength: 1 })
        .filter(
          (k) =>
            !SEED_REQUIRED_FIELDS.includes(k as SeedRequiredField) &&
            !SEED_FORBIDDEN_FIELDS.includes(k as SeedForbiddenField),
        ),
      nonEmptyValue,
      { maxKeys: 3 },
    ),
  })
  .map(({ required, forbidden, extra }) => {
    const doc: SeedDocument = { ...extra };
    for (const field of SEED_REQUIRED_FIELDS) {
      const choice = required[field];
      if (choice.kind !== 'absent') {
        doc[field] = choice.value;
      }
    }
    for (const field of SEED_FORBIDDEN_FIELDS) {
      const choice = forbidden[field];
      if (choice.present) {
        doc[field] = choice.value;
      }
    }
    return doc;
  });

describe('Feature: pfl-foundation, Property 6: Validade estrutural do seed', () => {
  it('accepted é verdadeiro sse todos os obrigatórios presentes/não vazios e nenhum proibido (R16.2, R16.4, R16.5)', () => {
    fc.assert(
      fc.property(seedDocumentArbitrary, (doc) => {
        const result = validateSeedStructure(doc);
        // Bicondicional: SUT concorda com o oráculo de referência.
        expect(result.accepted).toBe(oracleAccepts(doc));

        // O relatório detalhado é coerente com a decisão de aceitação.
        if (result.accepted) {
          expect(result.missing).toEqual([]);
          expect(result.empty).toEqual([]);
          expect(result.forbidden).toEqual([]);
        } else {
          expect(
            result.missing.length +
              result.empty.length +
              result.forbidden.length,
          ).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('um documento com todos os obrigatórios não vazios e sem proibidos é aceito (R16.2)', () => {
    fc.assert(
      fc.property(
        fc.record(
          Object.fromEntries(
            SEED_REQUIRED_FIELDS.map((field) => [field, nonEmptyValue]),
          ) as Record<SeedRequiredField, fc.Arbitrary<JsonValue>>,
        ),
        (base) => {
          const doc = base as unknown as SeedDocument;
          const result = validateSeedStructure(doc);
          expect(result.accepted).toBe(true);
          expect(oracleAccepts(doc)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a presença de qualquer campo proibido rejeita um documento de outra forma válido (R16.4, R16.5)', () => {
    fc.assert(
      fc.property(
        fc.record(
          Object.fromEntries(
            SEED_REQUIRED_FIELDS.map((field) => [field, nonEmptyValue]),
          ) as Record<SeedRequiredField, fc.Arbitrary<JsonValue>>,
        ),
        fc.constantFrom(...SEED_FORBIDDEN_FIELDS),
        nonEmptyValue,
        (base, forbiddenField, forbiddenVal) => {
          const doc = { ...base, [forbiddenField]: forbiddenVal } as SeedDocument;
          const result = validateSeedStructure(doc);
          expect(result.accepted).toBe(false);
          expect(result.forbidden).toContain(forbiddenField);
          expect(oracleAccepts(doc)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
