import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  abilityInertKey,
  moveInertKey,
  type EligibilitySnapshot,
} from '../team/eligibility-adapter';
import type { AnatomyConventions } from '../anatomy';
import type {
  AthleteDraft,
  LineupAssignment,
  TeamDraft,
} from '../team/model';
import {
  hasBlocking,
  isBlockingCode,
  validateDraft,
  type ValidationWarning,
} from './index';

/**
 * Teste de propriedade: gate de persistência por avisos bloqueantes (Task 4.5).
 *
 * // Feature: pfl-team-strategy-ui, Property 12: Gate de persistência por avisos
 * // bloqueantes
 *
 * **Validates: Requirements 7.6, 9.2, 9.3**
 *
 * Para qualquer `TeamDraft`, salvar e exportar são permitidos se e somente se
 * `hasBlocking(validateDraft(...))` é falso; havendo ao menos um aviso
 * bloqueante, a persistência é recusada.
 *
 * A propriedade é verificada em três eixos complementares:
 *
 * 1. **Caracterização universal**: para qualquer draft gerado,
 *    `hasBlocking(validateDraft(...))` é verdadeiro **se e somente se** existe
 *    ao menos um aviso cujo código é bloqueante (`isBlockingCode`). Isto liga o
 *    gate exatamente à classificação de códigos, sem depender da flag `blocking`
 *    de cada aviso individual.
 * 2. **Drafts válidos** (vazios ou totalmente válidos): não produzem aviso
 *    bloqueante — `hasBlocking` é falso, logo são salváveis.
 * 3. **Drafts com defeito bloqueante injetado**: cada tipo de defeito
 *    (`MOVE_NOT_LEARNABLE`, `ABILITY_NOT_AVAILABLE`, `MOVE_COUNT_NOT_FOUR`,
 *    `MOVE_DUPLICATE`, `SPECIES_NOT_ALLOWED`, `ROSTER_CAP_EXCEEDED`,
 *    `UNIT_INCOMPLETE`, `DUPLICATE_IDENTITY_SNAP`) torna `hasBlocking`
 *    verdadeiro.
 * 4. **Drafts com apenas efeitos inertes** (não bloqueantes): `hasBlocking`
 *    permanece falso — o draft continua salvável.
 *
 * A `Camada_Leitura` é mockada em memória (snapshot síncrono, sem rede). As
 * convenções anatômicas são neutralizadas (sempre `null`) para que o único
 * aviso não bloqueante possível seja `INERT_EFFECT`, isolando o gate dos avisos
 * `ANATOMY_LIMIT`.
 */

/** Convenção anatômica neutra: jamais dispara `ANATOMY_LIMIT`. */
const NEUTRAL_ANATOMY: AnatomyConventions = {
  anatomyWarning: () => null,
};

/** Teto do roster usado pelo motor (R2.4). */
const ROSTER_CAP = 53;

/** Papéis canônicos de uma unidade válida (11 distintos). */
const UNIT_ROLES: readonly string[] = [
  'r1',
  'r2',
  'r3',
  'r4',
  'r5',
  'r6',
  'r7',
  'r8',
  'r9',
  'r10',
  'r11',
];

/**
 * Catálogo de elegibilidade de base compartilhado por todos os cenários:
 * - espécies permitidas: 1..30;
 * - cada espécie aprende os golpes 100..119 (20 golpes) e dispõe das
 *   habilidades 1..5.
 * Nenhum efeito é inerte por padrão (adicionamos inertes seletivamente).
 */
const ALLOWED_SPECIES: ReadonlySet<number> = new Set(
  Array.from({ length: 30 }, (_, i) => i + 1),
);
const LEARNABLE_MOVES: readonly number[] = Array.from(
  { length: 20 },
  (_, i) => 100 + i,
);
const AVAILABLE_ABILITIES: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Constrói o snapshot síncrono base: todas as espécies permitidas aprendem o
 * mesmo conjunto de golpes e dispõem das mesmas habilidades, com nomes legíveis
 * materializados. `inertEffects` começa vazio; cenários específicos injetam
 * chaves inertes.
 */
function buildSnapshot(inertKeys: readonly string[] = []): EligibilitySnapshot {
  const learnable = new Map<number, ReadonlySet<number>>();
  const abilities = new Map<number, ReadonlySet<number>>();
  const moveName = new Map<number, string>();
  const abilityName = new Map<number, string>();

  for (const id of LEARNABLE_MOVES) {
    moveName.set(id, `Golpe ${id}`);
  }
  for (const id of AVAILABLE_ABILITIES) {
    abilityName.set(id, `Habilidade ${id}`);
  }
  for (const pokemonId of ALLOWED_SPECIES) {
    learnable.set(pokemonId, new Set(LEARNABLE_MOVES));
    abilities.set(pokemonId, new Set(AVAILABLE_ABILITIES));
  }

  return {
    allowedSpecies: ALLOWED_SPECIES,
    learnable,
    abilities,
    moveName,
    abilityName,
    inertEffects: new Set(inertKeys),
  };
}

/** Garante 4 golpes distintos e aprendíveis (determinístico e simples). */
function fourValidMoves(seed: number): number[] {
  const start = seed % (LEARNABLE_MOVES.length - 4); // 0..15
  return [
    LEARNABLE_MOVES[start]!,
    LEARNABLE_MOVES[start + 1]!,
    LEARNABLE_MOVES[start + 2]!,
    LEARNABLE_MOVES[start + 3]!,
  ];
}

/** Atleta de resto válido com golpes garantidamente válidos. */
function makeValidAthlete(instanceId: number, pokemonId: number): AthleteDraft {
  return {
    instanceId,
    pokemonId,
    abilityId: 1,
    moveIds: fourValidMoves(instanceId),
    positionDesignation: '',
  };
}

/**
 * Monta uma unidade `offense` completa e válida: 11 atletas distintos, cada um
 * ocupando um papel distinto, 11 identidades distintas no snap.
 */
function completeOffense(
  startInstanceId: number,
): { roster: AthleteDraft[]; lineups: LineupAssignment[] } {
  const roster: AthleteDraft[] = [];
  const lineups: LineupAssignment[] = [];
  for (let i = 0; i < 11; i++) {
    const instanceId = startInstanceId + i;
    const pokemonId = (i % 30) + 1;
    roster.push(makeValidAthlete(instanceId, pokemonId));
    lineups.push({ unit: 'offense', role: UNIT_ROLES[i]!, instanceId });
  }
  return { roster, lineups };
}

/**
 * Draft base totalmente válido: ou vazio (sem roster/lineups) ou com uma
 * unidade offense completa, conforme `withOffense`.
 */
function validDraft(withOffense: boolean): TeamDraft {
  if (!withOffense) {
    return {
      name: 'T',
      roster: [],
      lineups: [],
      strategy: {
        offenseStyle: '',
        defenseStyle: '',
        offensePlayPriority: [],
        defensePlayPriority: [],
      },
    };
  }
  const { roster, lineups } = completeOffense(1);
  return {
    name: 'T',
    roster,
    lineups,
    strategy: {
      offenseStyle: '',
      defenseStyle: '',
      offensePlayPriority: [],
      defensePlayPriority: [],
    },
  };
}

/** Códigos de defeito bloqueante que injetamos deliberadamente. */
type BlockingDefect =
  | 'MOVE_NOT_LEARNABLE'
  | 'ABILITY_NOT_AVAILABLE'
  | 'MOVE_COUNT_NOT_FOUR'
  | 'MOVE_DUPLICATE'
  | 'SPECIES_NOT_ALLOWED'
  | 'ROSTER_CAP_EXCEEDED'
  | 'UNIT_INCOMPLETE'
  | 'DUPLICATE_IDENTITY_SNAP';

const BLOCKING_DEFECTS: readonly BlockingDefect[] = [
  'MOVE_NOT_LEARNABLE',
  'ABILITY_NOT_AVAILABLE',
  'MOVE_COUNT_NOT_FOUR',
  'MOVE_DUPLICATE',
  'SPECIES_NOT_ALLOWED',
  'ROSTER_CAP_EXCEEDED',
  'UNIT_INCOMPLETE',
  'DUPLICATE_IDENTITY_SNAP',
];

/**
 * Injeta um defeito bloqueante específico sobre uma unidade offense válida,
 * retornando o draft defeituoso e o código bloqueante esperado.
 */
function draftWithDefect(defect: BlockingDefect): TeamDraft {
  const draft = validDraft(true);
  const roster = draft.roster.map((a) => ({ ...a, moveIds: [...a.moveIds] }));
  const lineups = draft.lineups.map((l) => ({ ...l }));

  switch (defect) {
    case 'MOVE_NOT_LEARNABLE':
      // Troca um golpe por um id fora do conjunto aprendível (999).
      roster[0] = { ...roster[0]!, moveIds: [999, 101, 102, 103] };
      break;
    case 'ABILITY_NOT_AVAILABLE':
      // Habilidade fora do conjunto disponível (99).
      roster[0] = { ...roster[0]!, abilityId: 99 };
      break;
    case 'MOVE_COUNT_NOT_FOUR':
      // Apenas 3 golpes.
      roster[0] = { ...roster[0]!, moveIds: [100, 101, 102] };
      break;
    case 'MOVE_DUPLICATE':
      // Golpe repetido (ainda 4 ids, mas um duplicado).
      roster[0] = { ...roster[0]!, moveIds: [100, 100, 101, 102] };
      break;
    case 'SPECIES_NOT_ALLOWED':
      // Espécie fora do conjunto permitido (999).
      roster[0] = { ...roster[0]!, pokemonId: 999 };
      break;
    case 'ROSTER_CAP_EXCEEDED': {
      // Excede o teto do roster (54 atletas). Preenche o resto com válidos.
      while (roster.length <= ROSTER_CAP) {
        const instanceId = 1000 + roster.length;
        roster.push(makeValidAthlete(instanceId, (roster.length % 30) + 1));
      }
      break;
    }
    case 'UNIT_INCOMPLETE':
      // Remove um papel da unidade: 10 identidades distintas (<11).
      lineups.pop();
      break;
    case 'DUPLICATE_IDENTITY_SNAP': {
      // A mesma identidade ocupa dois papéis na mesma unidade.
      const dupInstanceId = lineups[0]!.instanceId;
      lineups[1] = { ...lineups[1]!, instanceId: dupInstanceId };
      break;
    }
  }

  return { ...draft, roster, lineups };
}

/**
 * Caracterização independente: `hasBlocking` deve coincidir com "existe aviso
 * de código bloqueante" segundo `isBlockingCode`.
 */
function anyBlockingByCode(warnings: readonly ValidationWarning[]): boolean {
  return warnings.some((w) => isBlockingCode(w.code));
}

describe('Feature: pfl-team-strategy-ui, Property 12: Gate de persistência por avisos bloqueantes', () => {
  it('hasBlocking(validateDraft) coincide exatamente com a existência de aviso de código bloqueante (R7.6, R9.3)', () => {
    const draftArb = fc.oneof(
      fc.constant(validDraft(false)),
      fc.constant(validDraft(true)),
      fc.constantFrom(...BLOCKING_DEFECTS).map((d) => draftWithDefect(d)),
    );

    fc.assert(
      fc.property(draftArb, (draft) => {
        const elig = buildSnapshot();
        const warnings = validateDraft(draft, elig, NEUTRAL_ANATOMY);

        // Núcleo da propriedade: gate ⇔ existe aviso de código bloqueante.
        expect(hasBlocking(warnings)).toBe(anyBlockingByCode(warnings));
      }),
      { numRuns: 100 },
    );
  });

  it('drafts válidos (vazios ou completos) não bloqueiam a persistência (R9.2)', () => {
    fc.assert(
      fc.property(fc.boolean(), (withOffense) => {
        const draft = validDraft(withOffense);
        const elig = buildSnapshot();
        const warnings = validateDraft(draft, elig, NEUTRAL_ANATOMY);

        expect(warnings.some((w) => w.blocking)).toBe(false);
        expect(hasBlocking(warnings)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('cada defeito bloqueante injetado recusa a persistência (R7.6, R9.3)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BLOCKING_DEFECTS), (defect) => {
        const draft = draftWithDefect(defect);
        const elig = buildSnapshot();
        const warnings = validateDraft(draft, elig, NEUTRAL_ANATOMY);

        // O defeito esperado aparece como aviso bloqueante...
        const defectWarning = warnings.find((w) => w.code === defect);
        expect(defectWarning).toBeDefined();
        expect(defectWarning!.blocking).toBe(true);

        // ...e o gate recusa salvar/exportar.
        expect(hasBlocking(warnings)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('drafts com apenas efeitos inertes permanecem salváveis (não bloqueantes)', () => {
    // Gera um draft válido e marca um subconjunto dos seus efeitos como inertes.
    const inertArb = fc.record({
      inertFirstMove: fc.boolean(),
      inertAbility: fc.boolean(),
    });

    fc.assert(
      fc.property(inertArb, ({ inertFirstMove, inertAbility }) => {
        const draft = validDraft(true);
        const firstAthlete = draft.roster[0]!;

        const inertKeys: string[] = [];
        if (inertFirstMove) {
          inertKeys.push(moveInertKey(firstAthlete.moveIds[0]!));
        }
        if (inertAbility) {
          inertKeys.push(abilityInertKey(firstAthlete.abilityId));
        }

        const elig = buildSnapshot(inertKeys);
        const warnings = validateDraft(draft, elig, NEUTRAL_ANATOMY);

        // Avisos INERT_EFFECT aparecem sse há efeito inerte marcado — todos os
        // atletas compartilham a habilidade #1, então marcá-la inerte sinaliza
        // vários atletas; o importante é a presença, não a contagem exata.
        const inertWarnings = warnings.filter((w) => w.code === 'INERT_EFFECT');
        const expectAnyInert = inertFirstMove || inertAbility;
        expect(inertWarnings.length > 0).toBe(expectAnyInert);

        // Todo aviso INERT_EFFECT é não bloqueante.
        for (const w of inertWarnings) {
          expect(w.blocking).toBe(false);
        }

        // Núcleo da propriedade: efeitos inertes nunca bloqueiam a persistência.
        expect(warnings.some((w) => w.blocking)).toBe(false);
        expect(hasBlocking(warnings)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
