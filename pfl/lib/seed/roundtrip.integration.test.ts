/**
 * Teste de integração de round-trip de seed (`lib/seed/roundtrip.integration.test.ts`)
 * — spec `pfl-team-strategy-ui`, Task 11.5.
 *
 * Exercita o fluxo ponta a ponta do design "Serialização de seed" (R16.1/R16.2):
 * montar um {@link TeamDraft} válido → exportar o documento `.pflseed.json`
 * ({@link exportSeed}) → serializar em bytes UTF-8 (como o chamador real) →
 * importar em estado limpo ({@link importSeed}) com um {@link EligibilitySnapshot}
 * derivado do próprio draft → **igualdade com o original** nos campos carregados
 * pelo seed.
 *
 * O que o seed carrega (e, portanto, o que comparamos): por atleta `instanceId`,
 * `pokemonId`, `abilityId`, `moveIds`; por escalação `unit`, `role`, `instanceId`;
 * e a estratégia `offenseStyle`, `defenseStyle`, `offensePlayPriority`,
 * `defensePlayPriority`. O seed **não** carrega `positionDesignation` nem `name`
 * (o `name` é opcional e não faz parte do contrato do documento, e a posição é
 * carregada implicitamente pelos papéis `role` das escalações). Documentamos essa
 * fronteira e comparamos apenas os campos carregados.
 *
 * R16.3 (checksum) já é coberto pelos testes de propriedade do checksum (7.4 /
 * `checksum.test.ts` / `export.property17.test.ts`); aqui apenas confirmamos que
 * `importSeed` retornar `ok: true` implica que o checksum recomputado bateu — a
 * etapa CHECKSUM é a última do pipeline e só é alcançada quando o documento é
 * íntegro.
 *
 * _Requirements: 16.1, 16.2_
 */

import { describe, expect, it } from 'vitest';

import { exportSeed, SPECIAL_TEAMS_UNITS, verifyExportedChecksum } from './export';
import { importSeed } from './import';
import {
  DEFENSE_PLAYS,
  OFFENSE_PLAYS,
  type AthleteDraft,
  type LineupAssignment,
  type LineupUnit,
  type TeamDraft,
} from '../team/model';
import type { EligibilitySnapshot } from '../team/eligibility-adapter';
import { clonePresetToDraft } from '../presets';

const UNIT_SIZE = 11;

/** Serializa um documento em bytes UTF-8, exatamente como o chamador real. */
function encodeDoc(doc: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc));
}

/**
 * Deriva um {@link EligibilitySnapshot} síncrono que aceita exatamente o que o
 * `draft` usa: todas as espécies do roster são permitidas, cada atleta aprende
 * seus próprios golpes e dispõe de sua própria habilidade. Assim as etapas de
 * regra da importação (`ALLOWED_IDS`, `MOVES`, `ABILITY`) passam para um draft
 * que já é válido por construção.
 */
function eligFromDraft(draft: TeamDraft): EligibilitySnapshot {
  const allowedSpecies = new Set<number>();
  const learnable = new Map<number, Set<number>>();
  const abilities = new Map<number, Set<number>>();

  for (const athlete of draft.roster) {
    allowedSpecies.add(athlete.pokemonId);

    const moves = learnable.get(athlete.pokemonId) ?? new Set<number>();
    for (const moveId of athlete.moveIds) {
      moves.add(moveId);
    }
    learnable.set(athlete.pokemonId, moves);

    const abis = abilities.get(athlete.pokemonId) ?? new Set<number>();
    abis.add(athlete.abilityId);
    abilities.set(athlete.pokemonId, abis);
  }

  return {
    allowedSpecies,
    learnable,
    abilities,
    moveName: new Map(),
    abilityName: new Map(),
    inertEffects: new Set(),
  };
}

/**
 * Constrói, à mão, um {@link TeamDraft} válido de 22 titulares (11 de ataque +
 * 11 de defesa), com espécies permitidas, 4 golpes distintos aprendíveis por
 * atleta e habilidade disponível. Serve como cenário determinístico e autônomo,
 * independente dos dados de preset.
 */
function buildHandCraftedDraft(): TeamDraft {
  const count = UNIT_SIZE * 2;
  const roster: AthleteDraft[] = [];
  for (let i = 0; i < count; i += 1) {
    roster.push({
      instanceId: i + 1,
      pokemonId: 1000 + i,
      abilityId: 2000 + i,
      moveIds: [0, 1, 2, 3].map((k) => 30_000 + i * 10 + k),
      positionDesignation: `pos_${i}`,
    });
  }

  const lineups: LineupAssignment[] = [];
  for (let i = 0; i < UNIT_SIZE; i += 1) {
    lineups.push({ unit: 'offense', role: `off_${i}`, instanceId: roster[i]!.instanceId });
    lineups.push({
      unit: 'defense',
      role: `def_${i}`,
      instanceId: roster[UNIT_SIZE + i]!.instanceId,
    });
  }

  return {
    name: 'Hand-crafted',
    roster,
    lineups,
    strategy: {
      offenseStyle: 'balanced',
      defenseStyle: 'zone',
      // Permutações não-triviais dos conjuntos fixos para exercitar a ordem.
      offensePlayPriority: [...OFFENSE_PLAYS].reverse(),
      defensePlayPriority: [...DEFENSE_PLAYS].reverse(),
    },
  };
}

/**
 * Projeção comparável de um atleta — apenas os campos carregados pelo seed
 * (R14.3). Exclui `positionDesignation`, que o seed não carrega.
 */
function carriedAthlete(athlete: AthleteDraft) {
  return {
    instanceId: athlete.instanceId,
    pokemonId: athlete.pokemonId,
    abilityId: athlete.abilityId,
    moveIds: [...athlete.moveIds],
  };
}

/** Projeção comparável de uma escalação — `unit`, `role`, `instanceId`. */
function carriedLineup(l: LineupAssignment) {
  return { unit: l.unit, role: l.role, instanceId: l.instanceId };
}

/**
 * Ordena um conjunto de escalações de forma estável para comparação
 * insensível à ordem (a importação reparticiona `lineups` +
 * `special_teams_full_units`, podendo reordenar unidades entre si).
 */
function sortLineups(ls: readonly LineupAssignment[]) {
  return ls
    .map(carriedLineup)
    .sort((a, b) => {
      if (a.unit !== b.unit) return a.unit < b.unit ? -1 : 1;
      if (a.role !== b.role) return a.role < b.role ? -1 : 1;
      return a.instanceId - b.instanceId;
    });
}

/**
 * Asserção central de round-trip: exporta → bytes → importa em estado limpo e
 * confere igualdade nos campos carregados pelo seed.
 */
function assertRoundTrip(original: TeamDraft): void {
  const elig = eligFromDraft(original);

  // Montar → exportar → bytes `.pflseed.json`.
  const doc = exportSeed(original);
  // O export produz um checksum que faz round-trip sobre si mesmo (R16.3).
  expect(verifyExportedChecksum(doc)).toBe(true);
  const bytes = encodeDoc(doc);

  // Importar em estado limpo (função pura, sem estado externo).
  const result = importSeed(bytes, elig);

  // ok:true implica que TODAS as etapas passaram, inclusive a última (CHECKSUM):
  // o checksum recomputado bateu com o armazenado (R16.3, aqui confirmado).
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  const reconstituted = result.draft;

  // Roster: igualdade nos campos carregados (ordem preservada).
  expect(reconstituted.roster.map(carriedAthlete)).toEqual(
    original.roster.map(carriedAthlete),
  );

  // Escalações: igualdade insensível à ordem (reparticionamento interno).
  expect(sortLineups(reconstituted.lineups)).toEqual(sortLineups(original.lineups));

  // Estratégia: estilos e as duas permutações carregadas na íntegra.
  expect(reconstituted.strategy.offenseStyle).toBe(original.strategy.offenseStyle);
  expect(reconstituted.strategy.defenseStyle).toBe(original.strategy.defenseStyle);
  expect(reconstituted.strategy.offensePlayPriority).toEqual(
    original.strategy.offensePlayPriority,
  );
  expect(reconstituted.strategy.defensePlayPriority).toEqual(
    original.strategy.defensePlayPriority,
  );
}

describe('Round-trip de seed ponta a ponta (export → import) — Task 11.5 (R16.1/R16.2)', () => {
  it('faz round-trip de um draft montado à mão (22 titulares válidos)', () => {
    assertRoundTrip(buildHandCraftedDraft());
  });

  it('faz round-trip do preset "balanced" clonado para draft', () => {
    assertRoundTrip(clonePresetToDraft('balanced'));
  });

  it('faz round-trip do preset "curti" (22 titulares históricos)', () => {
    assertRoundTrip(clonePresetToDraft('curti'));
  });

  it('preserva escalações de special teams no round-trip (reparticionadas e reunidas)', () => {
    // Acrescenta uma unidade de special teams ao draft base e confirma que ela
    // sobrevive ao round-trip (export separa em `special_teams_full_units`,
    // import reúne em `draft.lineups`).
    const base = buildHandCraftedDraft();
    const stUnit: LineupUnit = SPECIAL_TEAMS_UNITS[0]!; // 'kickoff'
    const withSpecialTeams: TeamDraft = {
      ...base,
      lineups: [
        ...base.lineups,
        ...Array.from({ length: UNIT_SIZE }, (_, i) => ({
          unit: stUnit,
          role: `st_${i}`,
          instanceId: base.roster[i]!.instanceId,
        })),
      ],
    };

    assertRoundTrip(withSpecialTeams);

    // Confirma explicitamente que a unidade de special teams reaparece.
    const result = importSeed(
      encodeDoc(exportSeed(withSpecialTeams)),
      eligFromDraft(withSpecialTeams),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const stCount = result.draft.lineups.filter((l) => l.unit === stUnit).length;
      expect(stCount).toBe(UNIT_SIZE);
    }
  });

  it('ok:true confirma o round-trip do checksum (R16.3): adulterar o doc o quebra', () => {
    const original = buildHandCraftedDraft();
    const elig = eligFromDraft(original);
    const doc = exportSeed(original);

    // Documento íntegro: aceito (checksum bateu).
    expect(importSeed(encodeDoc(doc), elig).ok).toBe(true);

    // Adultera um campo carregado SEM recomputar o checksum: a importação deve
    // falhar na etapa CHECKSUM — prova de que ok:true implica checksum válido.
    const tampered = {
      ...doc,
      athletes: doc.athletes.map((a, i) =>
        i === 0 ? { ...a, ability_id: a.ability_id + 1 } : a,
      ),
    };
    // A elegibilidade também aceita o id adulterado para isolar a etapa CHECKSUM
    // (do contrário a recusa seria em ABILITY, antes de CHECKSUM).
    const tamperedElig: EligibilitySnapshot = {
      ...elig,
      abilities: new Map(
        [...elig.abilities].map(([pk, set]) => [pk, new Set(set)]),
      ),
    };
    const firstPokemon = original.roster[0]!.pokemonId;
    (tamperedElig.abilities.get(firstPokemon) as Set<number>).add(
      original.roster[0]!.abilityId + 1,
    );

    const result = importSeed(encodeDoc(tampered), tamperedElig);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.step).toBe('CHECKSUM');
    }
  });
});
