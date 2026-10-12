// Feature: pfl-team-strategy-ui, Property 20: Avisos são específicos, únicos por caso e associados ao alvo
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { AnatomyConventions } from '../anatomy';
import {
  abilityInertKey,
  moveInertKey,
  type EligibilitySnapshot,
} from '../team/eligibility-adapter';
import type {
  AthleteDraft,
  LineupAssignment,
  LineupUnit,
  TeamDraft,
} from '../team/model';
import {
  validateAthlete,
  validateDraft,
  type ValidationWarning,
  type WarningCode,
  type WarningTarget,
} from './index';

/**
 * Teste de propriedade de especificidade e associação de avisos (Task 11.4).
 *
 * **Property 20: Avisos são específicos, únicos por caso e associados ao alvo.**
 *
 * **Validates: Requirements 17.6**
 *
 * *Para qualquer* `TeamDraft` + `EligibilitySnapshot`, cada
 * {@link ValidationWarning} produzido por `validateDraft`/`validateAthlete`:
 * - tem mensagem específica e legível que referencia o item/controle concreto
 *   (nomeia golpe/habilidade por id/nome, nomeia a unidade, reporta contagens
 *   reais) — nunca uma string genérica reusada entre casos distintos;
 * - carrega um `target` ({@link WarningTarget}) que identifica o item associado
 *   (kind + instanceId/unit/role/moveId/abilityId) para associação ARIA
 *   (R17.6/R17.7).
 *
 * Os snapshots e rascunhos são construídos em memória (sem rede): controlamos
 * `learnable`/`abilities`/`inertEffects`/`moveName`/`abilityName` por espécie.
 * Usamos uma `AnatomyConventions` neutra para isolar o teste de `ANATOMY_LIMIT`.
 */

/** Convenção anatômica neutra: nunca gera `ANATOMY_LIMIT`. */
const NEUTRAL_ANATOMY: AnatomyConventions = {
  anatomyWarning: () => null,
};

/** Conjunto fixo de unidades usadas nos geradores de escalação. */
const UNITS: readonly LineupUnit[] = [
  'offense',
  'defense',
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
];

/** Kinds válidos para o alvo de um aviso. */
const VALID_KINDS: ReadonlySet<WarningTarget['kind']> = new Set<
  WarningTarget['kind']
>(['athlete', 'move', 'ability', 'unit', 'roster']);

/**
 * Snapshot em memória onde:
 * - a espécie `POKEMON_ID` aprende os golpes `[1..40]` e dispõe das habilidades
 *   `[1..20]` — ids fora desses conjuntos disparam avisos bloqueantes;
 * - todo golpe/habilidade de `[1..100]` recebe nome legível;
 * - golpes/habilidades de id **par** são marcados como efeito inerte.
 */
const POKEMON_ID = 25;

function makeSnapshot(): EligibilitySnapshot {
  const learnableMoves = new Set<number>();
  for (let id = 1; id <= 40; id += 1) {
    learnableMoves.add(id);
  }
  const availableAbilities = new Set<number>();
  for (let id = 1; id <= 20; id += 1) {
    availableAbilities.add(id);
  }
  const moveName = new Map<number, string>();
  const abilityName = new Map<number, string>();
  const inertEffects = new Set<string>();
  for (let id = 1; id <= 100; id += 1) {
    moveName.set(id, `Golpe ${id}`);
    abilityName.set(id, `Habilidade ${id}`);
    if (id % 2 === 0) {
      inertEffects.add(moveInertKey(id));
      inertEffects.add(abilityInertKey(id));
    }
  }
  return {
    allowedSpecies: new Set<number>([POKEMON_ID]),
    learnable: new Map<number, ReadonlySet<number>>([
      [POKEMON_ID, learnableMoves],
    ]),
    abilities: new Map<number, ReadonlySet<number>>([
      [POKEMON_ID, availableAbilities],
    ]),
    moveName,
    abilityName,
    inertEffects,
  };
}

const SNAPSHOT = makeSnapshot();

/**
 * Gera uma ficha de atleta que pode disparar qualquer combinação de avisos de
 * golpe/habilidade: ids no intervalo `[1..100]` com até 6 golpes (permitindo
 * contagem != 4 e duplicatas) e espécie permitida ou não.
 */
function athleteArb(instanceId: number): fc.Arbitrary<AthleteDraft> {
  return fc.record({
    instanceId: fc.constant(instanceId),
    pokemonId: fc.oneof(fc.constant(POKEMON_ID), fc.integer({ min: 200, max: 300 })),
    abilityId: fc.integer({ min: 1, max: 100 }),
    moveIds: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 0, maxLength: 6 }),
    positionDesignation: fc.constant(''),
  });
}

/** Gera uma escalação (unidade + papéis + identidades) possivelmente incompleta/duplicada. */
function lineupsArb(): fc.Arbitrary<LineupAssignment[]> {
  const assignmentArb = fc.record({
    unit: fc.constantFrom(...UNITS),
    role: fc.integer({ min: 0, max: 12 }).map((n) => `role_${n}`),
    instanceId: fc.integer({ min: 1, max: 15 }),
  });
  return fc.array(assignmentArb, { minLength: 0, maxLength: 20 });
}

/** Gera um `TeamDraft` completo capaz de disparar a variedade de avisos. */
function draftArb(): fc.Arbitrary<TeamDraft> {
  return fc
    .array(fc.integer({ min: 1, max: 60 }), { minLength: 0, maxLength: 5 })
    .chain((instanceIds) => {
      const uniqueIds = Array.from(new Set(instanceIds));
      const rosterArb =
        uniqueIds.length === 0
          ? fc.constant<AthleteDraft[]>([])
          : fc.tuple(...uniqueIds.map((id) => athleteArb(id)));
      return fc.record({
        name: fc.constant('Time'),
        roster: rosterArb,
        lineups: lineupsArb(),
        strategy: fc.constant({
          offenseStyle: '',
          defenseStyle: '',
          offensePlayPriority: [],
          defensePlayPriority: [],
        }),
      }) as fc.Arbitrary<TeamDraft>;
    });
}

/** Prefixo "código → kind esperado" para asserções de consistência de alvo. */
function assertTargetConsistency(w: ValidationWarning): void {
  const { code, target } = w;
  switch (code) {
    case 'MOVE_NOT_LEARNABLE':
    case 'MOVE_DUPLICATE':
      expect(target.kind).toBe('move');
      expect(typeof target.moveId).toBe('number');
      break;
    case 'MOVE_COUNT_NOT_FOUR':
      expect(target.kind).toBe('athlete');
      break;
    case 'ABILITY_NOT_AVAILABLE':
      expect(target.kind).toBe('ability');
      expect(typeof target.abilityId).toBe('number');
      break;
    case 'INERT_EFFECT':
      // Pode ser golpe ou habilidade.
      expect(target.kind === 'move' || target.kind === 'ability').toBe(true);
      if (target.kind === 'move') {
        expect(typeof target.moveId).toBe('number');
      } else {
        expect(typeof target.abilityId).toBe('number');
      }
      break;
    case 'SPECIES_NOT_ALLOWED':
    case 'ROSTER_CAP_EXCEEDED':
      expect(target.kind).toBe('roster');
      break;
    case 'UNIT_INCOMPLETE':
    case 'DUPLICATE_IDENTITY_SNAP':
      expect(target.kind).toBe('unit');
      expect(target.unit).toBeDefined();
      break;
    case 'ANATOMY_LIMIT':
      expect(target.kind).toBe('athlete');
      break;
    default: {
      const _exhaustive: never = code;
      throw new Error(`código inesperado: ${String(_exhaustive)}`);
    }
  }
}

describe('Property 20: avisos específicos, únicos por caso e associados ao alvo', () => {
  it('todo aviso tem mensagem não vazia e um target com kind válido', () => {
    fc.assert(
      fc.property(draftArb(), (draft) => {
        const warnings = validateDraft(draft, SNAPSHOT, NEUTRAL_ANATOMY);
        for (const w of warnings) {
          expect(w.message.trim().length).toBeGreaterThan(0);
          expect(VALID_KINDS.has(w.target.kind)).toBe(true);
          assertTargetConsistency(w);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('mensagens de MOVE_NOT_LEARNABLE referenciam o golpe (id/nome) e são distintas por golpe', () => {
    fc.assert(
      fc.property(
        // Dois golpes distintos NÃO aprendíveis (ids > 40) na mesma ficha.
        fc.integer({ min: 41, max: 70 }),
        fc.integer({ min: 71, max: 100 }),
        (moveA, moveB) => {
          const athlete: AthleteDraft = {
            instanceId: 7,
            pokemonId: POKEMON_ID,
            abilityId: 1,
            moveIds: [moveA, moveB],
            positionDesignation: '',
          };
          const warnings = validateAthlete(athlete, SNAPSHOT, NEUTRAL_ANATOMY);
          const notLearnable = warnings.filter(
            (w) => w.code === 'MOVE_NOT_LEARNABLE',
          );
          expect(notLearnable).toHaveLength(2);

          const wa = notLearnable[0]!;
          const wb = notLearnable[1]!;
          // Cada mensagem nomeia o próprio golpe (id presente no texto).
          expect(wa.message).toContain(String(wa.target.moveId));
          expect(wb.message).toContain(String(wb.target.moveId));
          // Alvos distintos (moveId diferente).
          expect(wa.target.moveId).not.toBe(wb.target.moveId);
          // Mesmo código, itens distintos ⇒ mensagens não idênticas.
          expect(wa.message).not.toBe(wb.message);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('MOVE_COUNT_NOT_FOUR reporta a contagem real na mensagem', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: 1, max: 40 }), { minLength: 0, maxLength: 7 })
          .filter((ids) => ids.length !== 4),
        (moveIds) => {
          const athlete: AthleteDraft = {
            instanceId: 3,
            pokemonId: POKEMON_ID,
            abilityId: 1,
            moveIds,
            positionDesignation: '',
          };
          const warnings = validateAthlete(athlete, SNAPSHOT, NEUTRAL_ANATOMY);
          const countWarn = warnings.find((w) => w.code === 'MOVE_COUNT_NOT_FOUR');
          expect(countWarn).toBeDefined();
          expect(countWarn!.message).toContain(String(moveIds.length));
          expect(countWarn!.target.kind).toBe('athlete');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('UNIT_INCOMPLETE nomeia a unidade e associa o target à unidade', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNITS),
        // Entre 1 e 10 identidades distintas (sempre < 11 ⇒ incompleta).
        fc.uniqueArray(fc.integer({ min: 1, max: 50 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (unit, instanceIds) => {
          const draft: TeamDraft = {
            name: 'Time',
            roster: [],
            lineups: instanceIds.map((instanceId, i) => ({
              unit,
              role: `role_${i}`,
              instanceId,
            })),
            strategy: {
              offenseStyle: '',
              defenseStyle: '',
              offensePlayPriority: [],
              defensePlayPriority: [],
            },
          };
          const warnings = validateDraft(draft, SNAPSHOT, NEUTRAL_ANATOMY);
          const incomplete = warnings.find((w) => w.code === 'UNIT_INCOMPLETE');
          expect(incomplete).toBeDefined();
          expect(incomplete!.target.kind).toBe('unit');
          expect(incomplete!.target.unit).toBe(unit);
          // A mensagem reporta a contagem real de identidades distintas.
          expect(incomplete!.message).toContain(String(instanceIds.length));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('o mesmo texto nunca é reusado entre itens ofensores distintos do mesmo código', () => {
    fc.assert(
      fc.property(draftArb(), (draft) => {
        const warnings = validateDraft(draft, SNAPSHOT, NEUTRAL_ANATOMY);
        // A unicidade é sobre o **item concreto** que a mensagem nomeia — o
        // golpe, a habilidade, a unidade — e não sobre a instância de atleta.
        // Dois atletas distintos da mesma espécie com a mesma habilidade
        // inválida produzem, por design, a mesma mensagem (que nomeia espécie e
        // habilidade); o `target.instanceId` é quem os desambigua para o ARIA.
        //
        // Então, para cada código cuja mensagem deriva de um item nomeável,
        // mapeamos item ofensor → mensagem e exigimos:
        // (a) o mesmo ofensor sempre tem o mesmo texto;
        // (b) ofensores distintos sempre têm textos distintos.
        // Mapa instanceId → espécie, para compor a chave de ofensor dos avisos
        // de golpe/habilidade (cuja mensagem nomeia a espécie).
        const speciesByInstance = new Map<number, number>();
        for (const a of draft.roster) {
          speciesByInstance.set(a.instanceId, a.pokemonId);
        }
        const byCode = new Map<WarningCode, Map<string, string>>();
        for (const w of warnings) {
          const offender = offenderKey(w, speciesByInstance);
          if (offender === null) {
            continue; // código fora do escopo de unicidade por item
          }
          const perCode = byCode.get(w.code) ?? new Map<string, string>();
          const existing = perCode.get(offender);
          if (existing !== undefined) {
            // (a) mesmo ofensor ⇒ mesma mensagem.
            expect(w.message).toBe(existing);
          } else {
            // (b) nenhum outro ofensor deste código pode ter esta mensagem.
            for (const [otherOffender, otherMessage] of perCode) {
              expect(otherOffender).not.toBe(offender);
              expect(otherMessage).not.toBe(w.message);
            }
            perCode.set(offender, w.message);
          }
          byCode.set(w.code, perCode);
        }
      }),
      { numRuns: 200 },
    );
  });
});

/**
 * Chave do **item ofensor** que uma mensagem de aviso nomeia (estável por
 * item, independente da instância de atleta), para os códigos cuja mensagem é
 * derivada de um item concreto nomeável. Retorna `null` para códigos cuja
 * mensagem reporta uma condição agregada (contagem/função/teto) que pode,
 * legitimamente, repetir texto entre atletas distintos — esses ficam fora do
 * escopo de unicidade por item desta propriedade.
 */
function offenderKey(
  w: ValidationWarning,
  speciesByInstance: ReadonlyMap<number, number>,
): string | null {
  const t = w.target;
  const species =
    t.instanceId !== undefined ? speciesByInstance.get(t.instanceId) : undefined;
  switch (w.code) {
    case 'MOVE_NOT_LEARNABLE':
      // Mensagem nomeia o golpe (id/nome) + a espécie que não o aprende.
      return `move:${t.moveId}:sp:${species ?? ''}`;
    case 'MOVE_DUPLICATE':
      // Mensagem nomeia apenas o golpe repetido (sem espécie no texto).
      return `move:${t.moveId}`;
    case 'ABILITY_NOT_AVAILABLE':
      // Mensagem nomeia a habilidade (id/nome) + a espécie.
      return `ability:${t.abilityId}:sp:${species ?? ''}`;
    case 'INERT_EFFECT':
      // Mensagem nomeia o golpe OU a habilidade sinalizada como inerte.
      return t.moveId !== undefined
        ? `move:${t.moveId}`
        : `ability:${t.abilityId}`;
    case 'UNIT_INCOMPLETE':
    case 'DUPLICATE_IDENTITY_SNAP':
      // Mensagem nomeia a unidade; UNIT_INCOMPLETE é no máximo um por unidade e
      // DUPLICATE_IDENTITY_SNAP é por identidade repetida na unidade.
      return `unit:${String(t.unit)}:${t.instanceId ?? ''}`;
    case 'MOVE_COUNT_NOT_FOUR':
    case 'ANATOMY_LIMIT':
    case 'SPECIES_NOT_ALLOWED':
    case 'ROSTER_CAP_EXCEEDED':
      return null;
    default: {
      const _exhaustive: never = w.code;
      return _exhaustive;
    }
  }
}
