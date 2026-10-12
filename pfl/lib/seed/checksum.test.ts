import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  SEED_CHECKSUM_FIELD,
  computeSeedChecksum,
  verifySeedChecksum,
  type JsonObject,
  type JsonValue,
  type SeedDocument,
} from './checksum';

/**
 * Teste de propriedade do Checksum_Seed (Task 12.3).
 *
 * **Feature: pfl-foundation, Property 5: Checksum do seed é determinístico e
 * recomputável**
 *
 * Validates: Requirements 16.3, 16.6 (Correctness Property P-5).
 *
 * Para todo documento de Seed_Time, o SHA-256 calculado sobre sua forma
 * canônica (sem o campo de checksum, chaves ordenadas, UTF-8, separadores
 * `','`/`':'`) produz sempre o mesmo valor em recomputações sucessivas e é
 * invariante à ordem de inserção das chaves; e a importação é aceita sse o
 * checksum recomputado é igual ao checksum armazenado no documento.
 */

/** Arbitrário para valores JSON aninhados (profundidade limitada). */
const jsonValueArb: fc.Arbitrary<JsonValue> = fc.letrec<{ value: JsonValue }>(
  (tie) => ({
    value: fc.oneof(
      { maxDepth: 4, depthSize: 'small' },
      // Primitivos.
      fc.string(),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
      fc.constant(null),
      // Compostos.
      fc.array(tie('value'), { maxLength: 5 }),
      fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
    ),
  }),
).value;

/** Arbitrário para documentos de seed (objeto JSON de topo). */
const seedDocumentArb: fc.Arbitrary<SeedDocument> = fc.dictionary(
  fc.string(),
  jsonValueArb,
  { maxKeys: 8 },
);

/**
 * Reconstrói um objeto JSON recursivamente com a ordem de chaves embaralhada,
 * preservando a identidade semântica (mesmo conjunto de pares chave/valor). A
 * ordem de arrays é significativa e é preservada.
 */
function shuffleKeys(value: JsonValue, rng: () => number): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => shuffleKeys(item, rng));
  }
  const obj = value as JsonObject;
  const keys = Object.keys(obj);
  // Embaralhamento Fisher–Yates determinístico pelo rng fornecido.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  const rebuilt: JsonObject = {};
  for (const key of keys) {
    rebuilt[key] = shuffleKeys(obj[key] as JsonValue, rng);
  }
  return rebuilt;
}

describe('Feature: pfl-foundation, Property 5: Checksum do seed é determinístico e recomputável', () => {
  it('o checksum é determinístico em recomputações sucessivas e invariante à ordem das chaves (R16.3)', () => {
    fc.assert(
      fc.property(seedDocumentArb, fc.integer(), (doc, seedInt) => {
        // Determinismo: chamadas repetidas sobre o mesmo documento coincidem.
        const first = computeSeedChecksum(doc);
        const second = computeSeedChecksum(doc);
        expect(second).toBe(first);
        // Formato: SHA-256 hex minúsculo.
        expect(first).toMatch(/^[0-9a-f]{64}$/);

        // Invariância à ordem das chaves: um documento equivalente com chaves
        // reembaralhadas produz o mesmo checksum.
        let state = seedInt >>> 0;
        const rng = (): number => {
          // LCG determinístico (parâmetros de Numerical Recipes).
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 0x100000000;
        };
        const reordered = shuffleKeys(doc, rng) as SeedDocument;
        expect(computeSeedChecksum(reordered)).toBe(first);
      }),
      { numRuns: 100 },
    );
  });

  it('o checksum independe do campo `checksum` de topo (glossário Checksum_Seed, R16.3)', () => {
    fc.assert(
      fc.property(
        seedDocumentArb,
        jsonValueArb,
        jsonValueArb,
        (doc, checksumA, checksumB) => {
          // Base de comparação: documento sem qualquer campo `checksum`.
          const base: SeedDocument = {};
          for (const key of Object.keys(doc)) {
            if (key === SEED_CHECKSUM_FIELD) {
              continue;
            }
            base[key] = doc[key] as JsonValue;
          }
          const baseChecksum = computeSeedChecksum(base);

          // Definir, alterar ou remover o campo `checksum` não muda o valor.
          const withA: SeedDocument = { ...base, [SEED_CHECKSUM_FIELD]: checksumA };
          const withB: SeedDocument = { ...base, [SEED_CHECKSUM_FIELD]: checksumB };
          expect(computeSeedChecksum(withA)).toBe(baseChecksum);
          expect(computeSeedChecksum(withB)).toBe(baseChecksum);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('verifySeedChecksum aceita o checksum recomputado e rejeita conteúdo adulterado (R16.6)', () => {
    fc.assert(
      fc.property(
        seedDocumentArb,
        // Chave de conteúdo a adulterar/injetar para forçar divergência.
        fc.string({ minLength: 1 }),
        (doc, tamperKey) => {
          // Aceitação: setar `checksum` ao valor recomputado faz `matches` ser
          // verdadeiro e `computed === stored`.
          const sealed: SeedDocument = {
            ...doc,
            [SEED_CHECKSUM_FIELD]: computeSeedChecksum(doc),
          };
          const ok = verifySeedChecksum(sealed);
          expect(ok.matches).toBe(true);
          expect(ok.stored).toBe(ok.computed);

          // Adulteração: injeta um campo de conteúdo NOVO (não o `checksum`) de
          // modo que a forma canônica mude de maneira comprovável, mantendo o
          // checksum armazenado antigo. A detecção não depende de um valor
          // "sentinela que provavelmente difere" (frágil para `__proto__` ou
          // chaves que colidem com conteúdo/checksum existente): em vez disso,
          // derivamos uma chave FRESCA, garantidamente ausente do documento e
          // diferente do campo de checksum. Adicionar um par chave/valor
          // próprio e enumerável SEMPRE altera o resultado de
          // `canonicalizeSeedForChecksum` (uma nova entrada `"chave":valor`
          // aparece no objeto ordenado), logo o checksum recomputado diverge
          // necessariamente — o que testa fielmente a rejeição de adulteração
          // de conteúdo (R16.6).
          const existingKeys = new Set(Object.keys(sealed));
          // `tamperKey` dirige a variedade; a garantia de detecção vem de
          // incrementar um sufixo até obter uma chave inédita e != checksum.
          let tamperIndex = 0;
          let freshKey = `__pfl_tamper__${tamperKey}__${tamperIndex}`;
          while (existingKeys.has(freshKey) || freshKey === SEED_CHECKSUM_FIELD) {
            tamperIndex += 1;
            freshKey = `__pfl_tamper__${tamperKey}__${tamperIndex}`;
          }
          // Valor fresco (objeto) que adiciona bytes à forma canônica.
          const freshValue: JsonValue = { __pfl_tamper_value__: tamperIndex };

          // Reconstrói o documento adulterado copiando as próprias chaves
          // enumeráveis (como seeds reais vindos de JSON.parse) e definindo a
          // chave fresca via `Object.defineProperty` para que seja uma
          // propriedade própria enumerável mesmo que `freshKey` interaja com
          // nomes especiais — assim `Object.keys` (usado por `canonicalize`)
          // sempre a enxerga.
          const tampered: SeedDocument = {};
          for (const key of Object.keys(sealed)) {
            tampered[key] = sealed[key] as JsonValue;
          }
          Object.defineProperty(tampered, freshKey, {
            value: freshValue,
            enumerable: true,
            writable: true,
            configurable: true,
          });

          // A chave fresca é própria e enumerável, então `Object.keys` a inclui.
          expect(Object.keys(tampered)).toContain(freshKey);

          // Como o conteúdo canônico ganhou um par novo, o checksum recomputado
          // difere do armazenado e a verificação de integridade rejeita (R16.6).
          const recomputed = computeSeedChecksum(tampered);
          expect(recomputed).not.toBe(sealed[SEED_CHECKSUM_FIELD]);
          const bad = verifySeedChecksum(tampered);
          expect(bad.matches).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
