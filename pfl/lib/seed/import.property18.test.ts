import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { exportSeed, SEED_SCHEMA, type SeedDocument } from './export';
import { importSeed, type ImportStep } from './import';
import { SEED_FORBIDDEN_FIELDS, type JsonObject } from './checksum';
import {
  DEFENSE_PLAYS,
  OFFENSE_PLAYS,
  type AthleteDraft,
  type LineupAssignment,
  type TeamDraft,
} from '../team/model';
import type { EligibilitySnapshot } from '../team/eligibility-adapter';

/**
 * Feature: pfl-team-strategy-ui, Property 18
 *
 * **Property 18: Importação aceita apenas documentos íntegros e rejeita cada
 * violação identificando a causa (a etapa).**
 *
 * Para qualquer documento `.pflseed.json` íntegro, {@link importSeed} aceita
 * (`ok === true`) e reconstitui o `TeamDraft`. Para cada violação deliberada —
 * `SIZE`, `PARSE`, `STRUCTURE`, `SCHEMA_VERSION`, `ROSTER_CAP`, `ALLOWED_IDS`,
 * `MOVES`, `ABILITY`, `LINEUP_IDENTITIES`, `FORBIDDEN_CONTENT` — a importação é
 * recusada (`ok === false`) nomeando a etapa exata que falhou. Como as etapas
 * curto-circuitam em ordem, cada violação é injetada num documento que de outra
 * forma seria íntegro, de modo que a etapa testada seja a primeira a disparar.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9,
 * 15.12, 15.13**
 */

// ---------------------------------------------------------------------------
// Builders: construção de uma baseline VÁLIDA (draft + elegibilidade + bytes).
// ---------------------------------------------------------------------------

/** Teto do roster do pipeline (R15.3). */
const ROSTER_CAP = 53;

/** Limite de tamanho do payload (R15.1): 5 MiB. */
const MAX_SEED_BYTES = 5 * 1024 * 1024;

/** Número de identidades distintas por unidade preenchida (R15.7). */
const UNIT_SIZE = 11;

/** Serializa um documento em bytes UTF-8, exatamente como o chamador real. */
function encodeDoc(doc: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc));
}

/**
 * Dados de um cenário íntegro: o draft de origem, o snapshot de elegibilidade
 * que o aceita, o documento exportado e seus bytes. 22 titulares (11 ataque +
 * 11 defesa), cada um com 4 golpes distintos aprendíveis e habilidade
 * disponível, todas as espécies permitidas.
 */
interface ValidScenario {
  draft: TeamDraft;
  elig: EligibilitySnapshot;
  doc: SeedDocument;
  bytes: Uint8Array;
}

/**
 * Arbitrário de um cenário íntegro. Cada atleta recebe `pokemonId`,
 * `abilityId` e 4 `moveIds` distintos únicos globalmente, e o snapshot de
 * elegibilidade é derivado para aceitar exatamente o que cada atleta usa.
 */
const validScenarioArb: fc.Arbitrary<ValidScenario> = fc
  .record({
    // Base para derivar ids distintos por atleta sem colisão.
    pokemonBase: fc.integer({ min: 1, max: 50 }),
    abilityBase: fc.integer({ min: 1, max: 50 }),
    moveBase: fc.integer({ min: 1, max: 50 }),
    offenseStyle: fc.constantFrom('balanced', 'ground', 'aerial'),
    defenseStyle: fc.constantFrom('zone', 'man', 'blitz'),
  })
  .map(({ pokemonBase, abilityBase, moveBase, offenseStyle, defenseStyle }) => {
    const count = UNIT_SIZE * 2; // 22 titulares.
    const roster: AthleteDraft[] = [];
    const allowedSpecies = new Set<number>();
    const learnable = new Map<number, Set<number>>();
    const abilities = new Map<number, Set<number>>();

    for (let i = 0; i < count; i++) {
      const instanceId = i + 1;
      const pokemonId = pokemonBase * 1000 + i; // distinto por atleta.
      const abilityId = abilityBase * 1000 + i;
      const moveIds = [0, 1, 2, 3].map((k) => moveBase * 10000 + i * 10 + k);

      roster.push({
        instanceId,
        pokemonId,
        abilityId,
        moveIds,
        positionDesignation: '',
      });

      allowedSpecies.add(pokemonId);
      learnable.set(pokemonId, new Set(moveIds));
      abilities.set(pokemonId, new Set([abilityId]));
    }

    // Escalações: 11 primeiros atletas no ataque, 11 seguintes na defesa.
    const lineups: LineupAssignment[] = [];
    for (let i = 0; i < UNIT_SIZE; i++) {
      lineups.push({
        unit: 'offense',
        role: `off_${i}`,
        instanceId: roster[i]!.instanceId,
      });
      lineups.push({
        unit: 'defense',
        role: `def_${i}`,
        instanceId: roster[UNIT_SIZE + i]!.instanceId,
      });
    }

    const draft: TeamDraft = {
      name: 'Baseline',
      roster,
      lineups,
      strategy: {
        offenseStyle,
        defenseStyle,
        offensePlayPriority: [...OFFENSE_PLAYS],
        defensePlayPriority: [...DEFENSE_PLAYS],
      },
    };

    const elig: EligibilitySnapshot = {
      allowedSpecies,
      learnable,
      abilities,
      moveName: new Map(),
      abilityName: new Map(),
      inertEffects: new Set(),
    };

    const doc = exportSeed(draft);
    return { draft, elig, doc, bytes: encodeDoc(doc) };
  });

// ---------------------------------------------------------------------------
// Caso de sucesso: documento íntegro é aceito e reconstitui o draft.
// ---------------------------------------------------------------------------

describe('Feature: pfl-team-strategy-ui, Property 18: importação aceita só documentos íntegros', () => {
  it('aceita um documento íntegro e reconstitui o roster, escalações e estratégia (R15.10)', () => {
    fc.assert(
      fc.property(validScenarioArb, ({ draft, elig, bytes }) => {
        const result = importSeed(bytes, elig);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        // Roster reconstituído fielmente.
        expect(result.draft.roster).toHaveLength(draft.roster.length);
        for (let i = 0; i < draft.roster.length; i++) {
          const original = draft.roster[i]!;
          const imported = result.draft.roster[i]!;
          expect(imported.instanceId).toBe(original.instanceId);
          expect(imported.pokemonId).toBe(original.pokemonId);
          expect(imported.abilityId).toBe(original.abilityId);
          expect(imported.moveIds).toEqual(original.moveIds);
        }
        // Escalações preservadas.
        expect(result.draft.lineups).toHaveLength(draft.lineups.length);
        // Estratégia preservada.
        expect(result.draft.strategy.offenseStyle).toBe(
          draft.strategy.offenseStyle,
        );
        expect(result.draft.strategy.defenseStyle).toBe(
          draft.strategy.defenseStyle,
        );
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Cada violação é recusada nomeando a etapa exata.
  // -------------------------------------------------------------------------

  it('SIZE: bytes acima de 5 MiB são recusados na etapa SIZE (R15.1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1024 }),
        validScenarioArb,
        (extra, { elig }) => {
          // Buffer maior que o limite — não precisa ser JSON válido, pois SIZE
          // é a primeira etapa e curto-circuita antes do PARSE.
          const bytes = new Uint8Array(MAX_SEED_BYTES + extra);
          const result = importSeed(bytes, elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('SIZE');
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('PARSE: conteúdo não-JSON é recusado na etapa PARSE (R15.12)', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          // Garante que não começa como JSON válido simples.
          .map((s) => `>>>${s}<<< not json {[`),
        validScenarioArb,
        (garbage, { elig }) => {
          const bytes = new TextEncoder().encode(garbage);
          const result = importSeed(bytes, elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('PARSE');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('STRUCTURE: remover um campo obrigatório é recusado na etapa STRUCTURE (R15.13)', () => {
    const REQUIRED = [
      'schema',
      'ruleset',
      'athletes',
      'lineups',
      'special_teams_full_units',
      'strategy',
      'checksum_sha256',
    ] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED),
        validScenarioArb,
        (field, { doc, elig }) => {
          const mutated: JsonObject = { ...(doc as unknown as JsonObject) };
          delete mutated[field];
          const result = importSeed(encodeDoc(mutated), elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('STRUCTURE');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('SCHEMA_VERSION: schema diferente do suportado é recusado na etapa SCHEMA_VERSION (R15.2)', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== SEED_SCHEMA),
        validScenarioArb,
        (wrongSchema, { doc, elig }) => {
          const mutated = { ...doc, schema: wrongSchema };
          // Reseal: recomputa o checksum para isolar a etapa SCHEMA_VERSION,
          // que roda antes de CHECKSUM de qualquer forma — mas mantemos o doc
          // internamente consistente para não depender da ordem.
          const result = importSeed(encodeDoc(mutated), elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('SCHEMA_VERSION');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ROSTER_CAP: mais de 53 atletas é recusado na etapa ROSTER_CAP (R15.3)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        validScenarioArb,
        (extra, { doc, elig }) => {
          const target = ROSTER_CAP + extra;
          // Preenche o roster acima do teto duplicando o primeiro atleta com
          // instance_ids novos (schema permanece o suportado).
          const base = doc.athletes[0]!;
          const athletes = [...doc.athletes];
          let nextId = 10_000;
          while (athletes.length < target) {
            athletes.push({ ...base, instance_id: nextId++ });
          }
          const mutated = { ...doc, athletes };
          const result = importSeed(encodeDoc(mutated), elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('ROSTER_CAP');
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('ALLOWED_IDS: pokemon_id fora de allowedSpecies é recusado na etapa ALLOWED_IDS (R15.4)', () => {
    fc.assert(
      fc.property(
        validScenarioArb,
        fc.nat(),
        ({ doc, elig }, which) => {
          const idx = which % doc.athletes.length;
          const athletes = doc.athletes.map((a, i) =>
            i === idx ? { ...a, pokemon_id: 999_999 } : a,
          );
          const mutated = { ...doc, athletes };
          const result = importSeed(encodeDoc(mutated), elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('ALLOWED_IDS');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('MOVES: golpe não aprendível / contagem != 4 / duplicata é recusado na etapa MOVES (R15.5)', () => {
    const movesMutation = fc.constantFrom<'not-learnable' | 'count' | 'dup'>(
      'not-learnable',
      'count',
      'dup',
    );
    fc.assert(
      fc.property(
        validScenarioArb,
        fc.nat(),
        movesMutation,
        ({ doc, elig }, which, kind) => {
          const idx = which % doc.athletes.length;
          const athletes = doc.athletes.map((a, i) => {
            if (i !== idx) {
              return a;
            }
            if (kind === 'not-learnable') {
              return { ...a, move_ids: [...a.move_ids.slice(1), 888_888] };
            }
            if (kind === 'count') {
              return { ...a, move_ids: a.move_ids.slice(0, 3) };
            }
            // dup: repete o primeiro golpe no lugar do último (continua len 4).
            return {
              ...a,
              move_ids: [a.move_ids[0]!, a.move_ids[1]!, a.move_ids[2]!, a.move_ids[0]!],
            };
          });
          const mutated = { ...doc, athletes };
          const result = importSeed(encodeDoc(mutated), elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('MOVES');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ABILITY: habilidade indisponível é recusada na etapa ABILITY (R15.6)', () => {
    fc.assert(
      fc.property(validScenarioArb, fc.nat(), ({ doc, elig }, which) => {
        const idx = which % doc.athletes.length;
        const athletes = doc.athletes.map((a, i) =>
          i === idx ? { ...a, ability_id: 777_777 } : a,
        );
        const mutated = { ...doc, athletes };
        const result = importSeed(encodeDoc(mutated), elig);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason.step).toBe<ImportStep>('ABILITY');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('LINEUP_IDENTITIES: unidade com identidade duplicada é recusada na etapa LINEUP_IDENTITIES (R15.7)', () => {
    fc.assert(
      fc.property(validScenarioArb, ({ doc, elig }) => {
        // Introduz uma duplicata de identidade no ataque: o segundo papel de
        // ataque passa a referenciar a mesma instance_id do primeiro.
        const offenseIdx = doc.lineups
          .map((l, i) => (l.unit === 'offense' ? i : -1))
          .filter((i) => i >= 0);
        const firstId = doc.lineups[offenseIdx[0]!]!.instance_id;
        const secondOffenseIdx = offenseIdx[1]!;
        const lineups = doc.lineups.map((l, i) =>
          i === secondOffenseIdx ? { ...l, instance_id: firstId } : l,
        );
        const mutated = { ...doc, lineups };
        const result = importSeed(encodeDoc(mutated), elig);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason.step).toBe<ImportStep>('LINEUP_IDENTITIES');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('LINEUP_IDENTITIES: unidade incompleta (<11 identidades) é recusada na etapa LINEUP_IDENTITIES (R15.7)', () => {
    fc.assert(
      fc.property(validScenarioArb, ({ doc, elig }) => {
        // Remove um papel do ataque, deixando 10 identidades distintas.
        const offenseSeen = { removed: false };
        const lineups = doc.lineups.filter((l) => {
          if (l.unit === 'offense' && !offenseSeen.removed) {
            offenseSeen.removed = true;
            return false;
          }
          return true;
        });
        const mutated = { ...doc, lineups };
        const result = importSeed(encodeDoc(mutated), elig);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason.step).toBe<ImportStep>('LINEUP_IDENTITIES');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('FORBIDDEN_CONTENT: campo proibido presente é recusado na etapa FORBIDDEN_CONTENT (R15.9)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEED_FORBIDDEN_FIELDS),
        validScenarioArb,
        (forbidden, { doc, elig }) => {
          // Adiciona o campo proibido mantendo o restante íntegro. O checksum
          // armazenado não cobre o campo novo, mas FORBIDDEN_CONTENT roda antes
          // de CHECKSUM, então a etapa esperada é FORBIDDEN_CONTENT.
          const mutated = { ...(doc as unknown as JsonObject), [forbidden]: [] };
          const result = importSeed(encodeDoc(mutated), elig);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason.step).toBe<ImportStep>('FORBIDDEN_CONTENT');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
