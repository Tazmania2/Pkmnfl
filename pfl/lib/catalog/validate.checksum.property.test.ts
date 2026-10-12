// Feature: pfl-data-catalog, Property 12: Round-trip de checksum SHA-256
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  VALIDATION_CHECKS,
  checkManifestChecksums,
  computeSha256,
  type RawResource,
} from './validate';
import type { ManifestEntry } from './types';

/**
 * Teste de propriedade do round-trip de checksum SHA-256 do validador
 * pós-ingestão (Task 7.2).
 *
 * **Feature: pfl-data-catalog, Property 12: Round-trip de checksum SHA-256**
 *
 * Validates: Requirements 8.5 (Correctness Property 12).
 *
 * Para todo conteúdo cru registrado no `manifest.json` (com o `sha256`
 * computado sobre o próprio conteúdo), `checkManifestChecksums` não reporta
 * nenhum problema enquanto o conteúdo permanece íntegro; e, ao alterar
 * qualquer byte do conteúdo mantendo o checksum registrado, a verificação
 * reporta ao menos uma divergência de `manifest_sha256` para aquele `path`.
 */

/** Caminho relativo arbitrário, não vazio, para a chave do manifest. */
const pathArb = fc.string({ minLength: 1, maxLength: 40 });

/** Conteúdo cru arbitrário como bytes (inclui vazio). */
const bytesArb = fc.uint8Array({ maxLength: 64 });

describe('Feature: pfl-data-catalog, Property 12: Round-trip de checksum SHA-256', () => {
  it('conteúdo íntegro bate com o sha256 registrado — sem issues (R8.5)', () => {
    fc.assert(
      fc.property(pathArb, bytesArb, (path, bytes) => {
        const sha256 = computeSha256(bytes);
        const manifest: ManifestEntry[] = [{ path, sha256 }];
        const resources: RawResource[] = [{ path, bytes }];

        const issues = checkManifestChecksums(resources, manifest);
        expect(issues).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('mutação de um byte diverge do sha256 registrado — reporta issue (R8.5)', () => {
    fc.assert(
      fc.property(
        pathArb,
        // Conteúdo com ao menos um byte para que haja posição a mutar.
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        // Índice e delta (1..255) para garantir alteração efetiva do byte.
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (path, bytes, rawIndex, delta) => {
          const sha256 = computeSha256(bytes);
          const manifest: ManifestEntry[] = [{ path, sha256 }];

          // Muta exatamente um byte: novo valor != valor original (mod 256).
          const index = rawIndex % bytes.length;
          const mutated = Uint8Array.from(bytes);
          mutated[index] = (mutated[index]! + delta) & 0xff;

          // Confirma que o conteúdo realmente mudou neste índice.
          expect(mutated[index]).not.toBe(bytes[index]);

          const resources: RawResource[] = [{ path, bytes: mutated }];
          const issues = checkManifestChecksums(resources, manifest);

          // O digest recomputado difere do registrado → divergência reportada.
          expect(computeSha256(mutated)).not.toBe(sha256);
          expect(issues.length).toBeGreaterThan(0);
          expect(
            issues.every((issue) => issue.check === VALIDATION_CHECKS.checksum),
          ).toBe(true);
          expect(issues.some((issue) => issue.ids?.includes(path) ?? false)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
