// Feature: pfl-team-strategy-ui, Property 19: Importação recusada preserva o estado e importação aprovada reconstitui fielmente
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { exportSeed, type SeedDocument } from './export';
import { importSeed } from './import';
import type { EligibilitySnapshot } from '../team/eligibility-adapter';
import {
  DEFENSE_PLAYS,
  OFFENSE_PLAYS,
  type AthleteDraft,
  type LineupAssignment,
  type TeamDraft,
} from '../team/model';

/**
 * Teste de propriedade da importação de seed (Task 7.6).
 *
 * **Feature: pfl-team-strategy-ui, Property 19: Importação recusada preserva o
 * estado e importação aprovada reconstitui fielmente**
 *
 * **Validates: Requirements 15.10, 15.11, 16.1, 16.2**
 *
 * Duas facetas complementares:
 *
 * 1. **Pureza / preservação de estado (R15.10/R15.11):** `importSeed` é uma
 *    função pura — não muta nenhum estado externo. Para uma importação
 *    recusada em qualquer etapa, o "time corrente" que o chamador mantém
 *    permanece byte-a-byte igual (deep-equal antes/depois da chamada), e nem os
 *    `rawBytes` nem o `EligibilitySnapshot` de entrada são mutados. A recusa
 *    traz `ok: false` com uma `step` e uma `message` legível.
 *
 * 2. **Fidelidade de round-trip (R16.1/R16.2):** para um `TeamDraft` válido,
 *    `exportSeed → bytes → importSeed` (com um `EligibilitySnapshot` derivado
 *    do próprio draft) resulta em `ok: true`, e o draft reconstituído reproduz:
 *    - atletas do roster por `{ instanceId, pokemonId, abilityId, moveIds }`;
 *    - escalações (`{ unit, role, instanceId }`), que carregam a posição/papel
 *      (fidelidade de posição via `role`);
 *    - estratégia (`offenseStyle`, `defenseStyle`, `offensePlayPriority`,
 *      `defensePlayPriority`).
 *
 *    NOTA: o seed NÃO carrega `positionDesignation` nem `name` da ficha — a
 *    importação os reconstitui como `''`. Portanto a comparação de fidelidade é
 *    feita sobre os campos que o seed de fato faz round-trip (acima). A
 *    fidelidade de "posição" exigida pela propriedade é preservada pelas
 *    escalações, que carregam `role` (o papel/posição em cada unidade).
 */

/** Codifica um documento de seed em bytes UTF-8, como o fluxo real de export. */
function encode(doc: SeedDocument): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc));
}

/**
 * Deriva um {@link EligibilitySnapshot} que torna TODO o conteúdo do draft
 * elegível: toda espécie é permitida, cada espécie aprende exatamente seus 4
 * golpes e disponibiliza sua habilidade, e nenhum efeito é inerte. Isto garante
 * que o motor de validação (reusado por `importSeed`) não produza nenhum aviso
 * bloqueante — a importação só pode falhar por adulteração deliberada.
 */
function snapshotFor(draft: TeamDraft): EligibilitySnapshot {
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
    moveName: new Map<number, string>(),
    abilityName: new Map<number, string>(),
    inertEffects: new Set<string>(),
  };
}

/**
 * Projeção comparável de um draft para fidelidade de round-trip: só os campos
 * que o seed de fato carrega. Normaliza o roster por `instanceId` e ordena as
 * escalações para que a igualdade independa da ordem de serialização.
 */
function fidelityView(draft: TeamDraft) {
  const roster = draft.roster
    .map((a) => ({
      instanceId: a.instanceId,
      pokemonId: a.pokemonId,
      abilityId: a.abilityId,
      moveIds: [...a.moveIds],
    }))
    .sort((x, y) => x.instanceId - y.instanceId);

  const lineups = draft.lineups
    .map((l) => ({ unit: l.unit, role: l.role, instanceId: l.instanceId }))
    .sort(
      (x, y) =>
        x.unit.localeCompare(y.unit) ||
        x.role.localeCompare(y.role) ||
        x.instanceId - y.instanceId,
    );

  return {
    roster,
    lineups,
    strategy: {
      offenseStyle: draft.strategy.offenseStyle,
      defenseStyle: draft.strategy.defenseStyle,
      offensePlayPriority: [...draft.strategy.offensePlayPriority],
      defensePlayPriority: [...draft.strategy.defensePlayPriority],
    },
  };
}

/**
 * Gera um `TeamDraft` válido o suficiente para passar por TODAS as etapas de
 * `importSeed` quando acompanhado do snapshot derivado:
 * - roster com 11 instâncias distintas (≤ 53), cada atleta com 4 golpes
 *   distintos;
 * - unidades `offense`/`defense` com exatamente as 11 identidades distintas em
 *   11 papéis (satisfaz `UNIT_INCOMPLETE`/`DUPLICATE_IDENTITY_SNAP`);
 * - estratégia com permutações canônicas das jogadas.
 */
const validDraftArb: fc.Arbitrary<TeamDraft> = fc
  .record({
    pokemonIds: fc.array(fc.integer({ min: 1, max: 300 }), {
      minLength: 11,
      maxLength: 11,
    }),
    abilityIds: fc.array(fc.integer({ min: 1, max: 100 }), {
      minLength: 11,
      maxLength: 11,
    }),
    moveSets: fc.array(
      fc.uniqueArray(fc.integer({ min: 1, max: 500 }), {
        minLength: 4,
        maxLength: 4,
      }),
      { minLength: 11, maxLength: 11 },
    ),
    offenseStyle: fc.string(),
    defenseStyle: fc.string(),
    name: fc.string(),
  })
  .map(({ pokemonIds, abilityIds, moveSets, offenseStyle, defenseStyle, name }) => {
    const roster: AthleteDraft[] = pokemonIds.map((pokemonId, i) => ({
      instanceId: i + 1,
      pokemonId,
      abilityId: abilityIds[i]!,
      moveIds: moveSets[i]!,
      positionDesignation: '',
    }));

    // 11 identidades distintas por unidade em offense e defense: cada atleta
    // ocupa um papel único (ROLE_1..ROLE_11) na unidade.
    const lineups: LineupAssignment[] = [];
    for (const unit of ['offense', 'defense'] as const) {
      roster.forEach((athlete, i) => {
        lineups.push({ unit, role: `ROLE_${i + 1}`, instanceId: athlete.instanceId });
      });
    }

    return {
      name,
      roster,
      lineups,
      strategy: {
        offenseStyle,
        defenseStyle,
        offensePlayPriority: [...OFFENSE_PLAYS],
        defensePlayPriority: [...DEFENSE_PLAYS],
      },
    } satisfies TeamDraft;
  });

describe('Feature: pfl-team-strategy-ui, Property 19: Importação recusada preserva o estado e importação aprovada reconstitui fielmente', () => {
  it('round-trip aprovado reconstitui fielmente atletas, escalações e estratégia (R16.1/R16.2)', () => {
    fc.assert(
      fc.property(validDraftArb, (draft) => {
        const elig = snapshotFor(draft);
        const bytes = encode(exportSeed(draft));

        const result = importSeed(bytes, elig);

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Fidelidade sobre os campos que o seed carrega.
          expect(fidelityView(result.draft)).toEqual(fidelityView(draft));
          // O seed não carrega positionDesignation nem name da ficha.
          expect(result.draft.name).toBe('');
          for (const athlete of result.draft.roster) {
            expect(athlete.positionDesignation).toBe('');
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('importação recusada preserva o estado corrente e não muta as entradas (R15.10/R15.11)', () => {
    fc.assert(
      fc.property(
        validDraftArb,
        // Escolhe uma forma de adulteração que recusa a importação em alguma etapa.
        // (A etapa SIZE já é coberta pelo teste de etapas 7.5; aqui focamos em
        // recusas com payloads pequenos para manter o PBT barato.)
        fc.constantFrom<'parse' | 'structure' | 'schema' | 'checksum'>(
          'parse',
          'structure',
          'schema',
          'checksum',
        ),
        (currentTeam, tamper) => {
          // Snapshot profundo do "time corrente" que o chamador mantém, para
          // provar que importSeed nunca o toca.
          const currentBefore = structuredClone(currentTeam);

          // Payload separado a ser importado (NÃO é o time corrente).
          const otherDraft = currentTeam;
          const doc = exportSeed(otherDraft);
          const elig = snapshotFor(otherDraft);

          let bytes: Uint8Array;
          switch (tamper) {
            case 'parse':
              // JSON inválido → recusa em PARSE.
              bytes = new TextEncoder().encode('{ not valid json');
              break;
            case 'structure':
              // Remove um campo obrigatório → recusa em STRUCTURE.
              bytes = new TextEncoder().encode(
                JSON.stringify({ ruleset: doc.ruleset, athletes: doc.athletes }),
              );
              break;
            case 'schema':
              // Versão de schema incompatível → recusa em SCHEMA_VERSION.
              bytes = encode({ ...doc, schema: 'versao-desconhecida-x' });
              break;
            case 'checksum':
              // Adultera o checksum mantendo o resto → recusa em CHECKSUM.
              bytes = encode({ ...doc, checksum_sha256: '0'.repeat(64) });
              break;
          }

          const eligBefore = structuredClone({
            allowedSpecies: [...elig.allowedSpecies],
            learnable: [...elig.learnable].map(([k, v]) => [k, [...v]]),
            abilities: [...elig.abilities].map(([k, v]) => [k, [...v]]),
            inertEffects: [...elig.inertEffects],
          });
          const bytesBefore = Uint8Array.from(bytes);

          const result = importSeed(bytes, elig);

          // Recusa legível identificando o motivo.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(typeof result.reason.step).toBe('string');
            expect(result.reason.message.length).toBeGreaterThan(0);
          }

          // Estado corrente preservado (importSeed não o toca).
          expect(currentTeam).toEqual(currentBefore);

          // Entradas não mutadas.
          expect(bytes).toEqual(bytesBefore);
          expect({
            allowedSpecies: [...elig.allowedSpecies],
            learnable: [...elig.learnable].map(([k, v]) => [k, [...v]]),
            abilities: [...elig.abilities].map(([k, v]) => [k, [...v]]),
            inertEffects: [...elig.inertEffects],
          }).toEqual(eligBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recusa por tamanho (SIZE) também preserva o estado corrente (R15.1/R15.10)', () => {
    // Caso de exemplo da etapa SIZE, exercido uma única vez para manter o custo
    // baixo (o payload > 5 MiB é caro de alocar/comparar sob 100 iterações).
    const currentTeam: TeamDraft = {
      name: 'Atual',
      roster: [
        {
          instanceId: 1,
          pokemonId: 25,
          abilityId: 9,
          moveIds: [1, 2, 3, 4],
          positionDesignation: 'QB',
        },
      ],
      lineups: [{ unit: 'offense', role: 'ROLE_1', instanceId: 1 }],
      strategy: {
        offenseStyle: 'balanced',
        defenseStyle: 'balanced',
        offensePlayPriority: [...OFFENSE_PLAYS],
        defensePlayPriority: [...DEFENSE_PLAYS],
      },
    };
    const currentBefore = structuredClone(currentTeam);

    // > 5 MiB → recusa determinística em SIZE.
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const result = importSeed(oversized, snapshotFor(currentTeam));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.step).toBe('SIZE');
      expect(result.reason.message.length).toBeGreaterThan(0);
    }
    expect(currentTeam).toEqual(currentBefore);
  });
});
