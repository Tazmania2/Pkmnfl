// Feature: pfl-team-strategy-ui, Property 17: Checksum do seed é determinístico e recomputável
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  canonicalizeSeedForChecksum,
  type JsonObject,
  type JsonValue,
} from './checksum';
import { exportSeed, verifyExportedChecksum, type SeedDocument } from './export';
import {
  DEFENSE_PLAYS,
  OFFENSE_PLAYS,
  type AthleteDraft,
  type LineupUnit,
  type TeamDraft,
} from '../team/model';

/**
 * Teste de propriedade do checksum do seed exportado (Task 7.4).
 *
 * **Feature: pfl-team-strategy-ui, Property 17: Checksum do seed é
 * determinístico e recomputável**
 *
 * Validates: Requirements 14.4, 16.3.
 *
 * Para qualquer `TeamDraft` válido, `exportSeed(draft).checksum_sha256` é o
 * SHA-256 sobre o JSON canônico do documento SEM o campo de checksum (chaves
 * ordenadas, UTF-8, separadores compactos), e recomputar reproduz o mesmo
 * valor. Reserializar o documento sem alteração produz um checksum idêntico;
 * mutar qualquer campo de atleta/estratégia produz um checksum diferente.
 */

/** Todas as unidades de escalação reconhecidas (ataque/defesa + special). */
const UNITS: LineupUnit[] = [
  'offense',
  'defense',
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
];

/** Atleta válido: 4 golpes distintos e identidade de instância fixa. */
const athleteArb = (instanceId: number): fc.Arbitrary<AthleteDraft> =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: 500 }), {
      minLength: 4,
      maxLength: 4,
    })
    .chain((moveIds) =>
      fc.record({
        instanceId: fc.constant(instanceId),
        pokemonId: fc.integer({ min: 1, max: 300 }),
        abilityId: fc.integer({ min: 1, max: 100 }),
        moveIds: fc.constant(moveIds),
        positionDesignation: fc.constantFrom('QB', 'RB', 'WR', 'DL', 'LB'),
      }),
    );

/** `TeamDraft` arbitrário com roster não vazio e estratégia canônica. */
const draftArb: fc.Arbitrary<TeamDraft> = fc
  .integer({ min: 1, max: 10 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_, i) => athleteArb(i + 1)),
    ) as fc.Arbitrary<AthleteDraft[]>,
  )
  .chain((roster) => {
    const lineupArb = fc.array(
      fc.record({
        unit: fc.constantFrom(...UNITS),
        role: fc.string({ minLength: 1, maxLength: 4 }),
        instanceId: fc.constantFrom(...roster.map((a) => a.instanceId)),
      }),
      { maxLength: 20 },
    );
    return fc.record({
      name: fc.string(),
      roster: fc.constant(roster),
      lineups: lineupArb,
      strategy: fc.record({
        offenseStyle: fc.string(),
        defenseStyle: fc.string(),
        offensePlayPriority: fc.constant([...OFFENSE_PLAYS]),
        defensePlayPriority: fc.constant([...DEFENSE_PLAYS]),
      }),
    });
  });

/**
 * Recomputa o checksum do documento exatamente como o export: SHA-256 hex
 * minúsculo sobre a forma canônica SEM o campo `checksum_sha256`. Independente
 * de `exportSeed`, serve de oráculo da definição (glossário Checksum_Seed).
 */
function recomputeChecksum(doc: SeedDocument): string {
  const withoutChecksum: JsonObject = {};
  for (const key of Object.keys(doc)) {
    if (key === 'checksum_sha256') {
      continue;
    }
    withoutChecksum[key] = (doc as unknown as JsonObject)[key] as JsonValue;
  }
  const canonical = canonicalizeSeedForChecksum(withoutChecksum);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

describe('Feature: pfl-team-strategy-ui, Property 17: Checksum do seed é determinístico e recomputável', () => {
  it('determinismo: mesmo draft produz o mesmo checksum, no formato hex de 64 (R14.4/R16.3)', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const first = exportSeed(draft).checksum_sha256;
        const second = exportSeed(draft).checksum_sha256;
        expect(first).toBe(second);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 },
    );
  });

  it('recomputabilidade: verifyExportedChecksum é true e o SHA-256 canônico recomputado bate (R14.4/R16.3)', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const doc = exportSeed(draft);
        expect(verifyExportedChecksum(doc)).toBe(true);
        expect(recomputeChecksum(doc)).toBe(doc.checksum_sha256);
      }),
      { numRuns: 100 },
    );
  });

  it('round-trip: reserializar (JSON parse/stringify) preserva o checksum (R16.3)', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const doc = exportSeed(draft);
        const reserialized = JSON.parse(JSON.stringify(doc)) as SeedDocument;
        expect(recomputeChecksum(reserialized)).toBe(doc.checksum_sha256);
        expect(verifyExportedChecksum(reserialized)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('sensibilidade: mutar um campo de atleta altera o checksum recomputado (R16.3)', () => {
    fc.assert(
      fc.property(
        draftArb,
        fc.nat(),
        fc.integer({ min: 1, max: 1000 }),
        (draft, rawIndex, delta) => {
          const doc = exportSeed(draft);
          const index = rawIndex % doc.athletes.length;
          const target = doc.athletes[index]!;

          // Documento adulterado: muda o pokemon_id de um atleta mantendo o
          // checksum_sha256 original — recomputar deve divergir.
          const tampered: SeedDocument = {
            ...doc,
            athletes: doc.athletes.map((a, i) =>
              i === index ? { ...a, pokemon_id: a.pokemon_id + delta } : a,
            ),
          };

          expect(tampered.athletes[index]!.pokemon_id).not.toBe(
            target.pokemon_id,
          );
          expect(recomputeChecksum(tampered)).not.toBe(doc.checksum_sha256);
          expect(verifyExportedChecksum(tampered)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sensibilidade: mutar um campo de estratégia altera o checksum recomputado (R16.3)', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const doc = exportSeed(draft);

        // Troca a prioridade de ataque por uma permutação distinta.
        const tampered: SeedDocument = {
          ...doc,
          strategy: {
            ...doc.strategy,
            offensePlayPriority: [...doc.strategy.offensePlayPriority].reverse(),
          },
        };

        expect(tampered.strategy.offensePlayPriority).not.toEqual(
          doc.strategy.offensePlayPriority,
        );
        expect(recomputeChecksum(tampered)).not.toBe(doc.checksum_sha256);
        expect(verifyExportedChecksum(tampered)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
