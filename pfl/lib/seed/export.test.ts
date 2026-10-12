import { describe, expect, it } from 'vitest';

import {
  computeSeedChecksum,
  verifySeedChecksum,
  type SeedDocument as FoundationSeedDocument,
} from './checksum';
import {
  SEED_RULESET,
  SEED_SCHEMA,
  SPECIAL_TEAMS_UNITS,
  exportSeed,
  verifyExportedChecksum,
} from './export';
import {
  DEFENSE_PLAYS,
  OFFENSE_PLAYS,
  type AthleteDraft,
  type LineupAssignment,
  type TeamDraft,
} from '../team/model';

/**
 * Campos exatos esperados no documento exportado (R14.2 + checksum).
 */
const EXPECTED_FIELDS = [
  'schema',
  'ruleset',
  'athletes',
  'lineups',
  'special_teams_full_units',
  'strategy',
  'checksum_sha256',
] as const;

function makeAthlete(instanceId: number): AthleteDraft {
  return {
    instanceId,
    pokemonId: 100 + instanceId,
    abilityId: 7,
    moveIds: [1, 2, 3, 4],
    positionDesignation: 'QB',
  };
}

function makeDraft(): TeamDraft {
  const roster: AthleteDraft[] = [makeAthlete(1), makeAthlete(2)];
  const lineups: LineupAssignment[] = [
    { unit: 'offense', role: 'QB', instanceId: 1 },
    { unit: 'defense', role: 'DL1', instanceId: 2 },
    { unit: 'kickoff', role: 'K', instanceId: 1 },
    { unit: 'punt_return', role: 'PR', instanceId: 2 },
  ];
  return {
    name: 'Testes',
    roster,
    lineups,
    strategy: {
      offenseStyle: 'balanced',
      defenseStyle: 'balanced',
      offensePlayPriority: [...OFFENSE_PLAYS],
      defensePlayPriority: [...DEFENSE_PLAYS],
    },
  };
}

describe('exportSeed (unit)', () => {
  it('produz exatamente os campos do schema (R14.2)', () => {
    const doc = exportSeed(makeDraft());
    expect(Object.keys(doc).sort()).toEqual([...EXPECTED_FIELDS].sort());
    expect(doc.schema).toBe(SEED_SCHEMA);
    expect(doc.ruleset).toBe(SEED_RULESET);
  });

  it('registra instance_id, pokemon_id, ability_id e 4 move_id distintos por atleta (R14.3)', () => {
    const doc = exportSeed(makeDraft());
    expect(doc.athletes).toHaveLength(2);
    for (const a of doc.athletes) {
      expect(typeof a.instance_id).toBe('number');
      expect(typeof a.pokemon_id).toBe('number');
      expect(typeof a.ability_id).toBe('number');
      expect(a.move_ids).toHaveLength(4);
      expect(new Set(a.move_ids).size).toBe(4);
    }
  });

  it('separa escalações de ataque/defesa dos special teams', () => {
    const doc = exportSeed(makeDraft());
    for (const l of doc.lineups) {
      expect(SPECIAL_TEAMS_UNITS).not.toContain(l.unit);
    }
    for (const st of doc.special_teams_full_units) {
      expect(SPECIAL_TEAMS_UNITS).toContain(st.unit);
    }
    expect(doc.lineups.map((l) => l.unit)).toEqual(['offense', 'defense']);
    expect(doc.special_teams_full_units.map((l) => l.unit)).toEqual([
      'kickoff',
      'punt_return',
    ]);
  });

  it('checksum_sha256 recomputa igual via a canonicalização da foundation (R14.4)', () => {
    const doc = exportSeed(makeDraft());
    expect(doc.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyExportedChecksum(doc)).toBe(true);

    // Compatível com a foundation: renomeando checksum_sha256 -> checksum,
    // verifySeedChecksum da foundation confirma o mesmo valor.
    const { checksum_sha256, ...rest } = doc;
    const foundationDoc = {
      ...rest,
      checksum: checksum_sha256,
    } as unknown as FoundationSeedDocument;
    expect(computeSeedChecksum(foundationDoc)).toBe(checksum_sha256);
    expect(verifySeedChecksum(foundationDoc).matches).toBe(true);
  });

  it('não copia referências mutáveis do draft para o documento', () => {
    const draft = makeDraft();
    const doc = exportSeed(draft);
    const firstDraftAthlete = draft.roster[0];
    const firstDocAthlete = doc.athletes[0];
    expect(firstDraftAthlete).toBeDefined();
    expect(firstDocAthlete).toBeDefined();
    firstDraftAthlete!.moveIds.push(99);
    draft.strategy.offensePlayPriority.reverse();
    expect(firstDocAthlete!.move_ids).toHaveLength(4);
    expect(doc.strategy.offensePlayPriority).toEqual([...OFFENSE_PLAYS]);
  });
});
