import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { exportSeed, verifyExportedChecksum } from './export';
import {
  DEFENSE_PLAYS,
  OFFENSE_PLAYS,
  type AthleteDraft,
  type LineupUnit,
  type TeamDraft,
} from '../team/model';

/** Campos exatos esperados no documento exportado (R14.2 + checksum). */
const EXPECTED_FIELDS = [
  'schema',
  'ruleset',
  'athletes',
  'lineups',
  'special_teams_full_units',
  'strategy',
  'checksum_sha256',
] as const;

/** Campos proibidos de aleatoriedade/log/vencedor/resultado (R14.5). */
const FORBIDDEN_FIELDS = ['match_rng', 'logs', 'winners', 'results'];

/**
 * Feature: pfl-team-strategy-ui, Property 16
 *
 * **Property 16: Documento de seed exportado é bem formado e sem conteúdo de
 * partida**
 *
 * Para qualquer TeamDraft válido, exportSeed produz um documento contendo
 * exatamente os campos schema, ruleset, athletes, lineups,
 * special_teams_full_units, strategy e checksum_sha256, com cada atleta
 * registrando instance_id, pokemon_id, ability_id e quatro move_id distintos, e
 * sem nenhum campo de aleatoriedade de partida, log, vencedor ou resultado.
 *
 * **Validates: Requirements 14.2, 14.3, 14.5**
 */
describe('Property 16: seed exportado bem formado e sem conteúdo de partida', () => {
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

  it('campos exatos, atletas bem formados e sem conteúdo de partida', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const doc = exportSeed(draft);

        // Campos exatos (R14.2).
        expect(Object.keys(doc).sort()).toEqual([...EXPECTED_FIELDS].sort());

        // Atletas bem formados (R14.3).
        expect(doc.athletes).toHaveLength(draft.roster.length);
        for (const a of doc.athletes) {
          expect(Number.isInteger(a.instance_id)).toBe(true);
          expect(Number.isInteger(a.pokemon_id)).toBe(true);
          expect(Number.isInteger(a.ability_id)).toBe(true);
          expect(a.move_ids).toHaveLength(4);
          expect(new Set(a.move_ids).size).toBe(4);
        }

        // Sem conteúdo de partida (R14.5).
        for (const forbidden of FORBIDDEN_FIELDS) {
          expect(Object.prototype.hasOwnProperty.call(doc, forbidden)).toBe(
            false,
          );
        }

        // Checksum recomputável (R14.4).
        expect(verifyExportedChecksum(doc)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
