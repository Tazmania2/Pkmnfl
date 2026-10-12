import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type {
  LineupAssignment,
  LineupUnit,
  StrategyDraft,
  TeamDraft,
} from '../team/model';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../team/model';
import { validateLineups } from './index';

/**
 * Teste de propriedade: unidade válida tem exatamente 11 identidades distintas
 * por snap (Task 4.6).
 *
 * // Feature: pfl-team-strategy-ui, Property 15: Unidade válida tem exatamente
 * // 11 identidades distintas por snap
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**
 *
 * Uma unidade válida tem exatamente 11 identidades distintas por snap.
 * {@link validateLineups}:
 *
 * - emite `UNIT_INCOMPLETE` quando uma unidade iniciada tem **menos de 11**
 *   identidades distintas (nomeando a unidade e reportando os papéis
 *   pendentes) — R13.1/R13.2/R13.4;
 * - emite `DUPLICATE_IDENTITY_SNAP` quando a **mesma** `instanceId` ocupa dois
 *   papéis na mesma unidade/snap — R13.3/R13.5;
 * - não emite nenhum desses avisos para uma unidade com 11 papéis e 11
 *   identidades distintas;
 * - permite que a **mesma** instância sirva unidades diferentes sem conflito
 *   entre unidades (R13.3).
 *
 * O `TeamDraft` é construído em memória; `validateLineups` é puro (sem rede nem
 * DOM), bastando montar `lineups` com as atribuições do cenário.
 */

/** Todas as unidades de escalação do modelo. */
const ALL_UNITS: readonly LineupUnit[] = [
  'offense',
  'defense',
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
];

/** Estratégia neutra: validateLineups não a consulta, mas o tipo a exige. */
const NEUTRAL_STRATEGY: StrategyDraft = {
  offenseStyle: '',
  defenseStyle: '',
  offensePlayPriority: [...OFFENSE_PLAYS],
  defensePlayPriority: [...DEFENSE_PLAYS],
};

/** Monta um TeamDraft com as atribuições fornecidas (roster vazio irrelevante aqui). */
function draftWithLineups(lineups: LineupAssignment[]): TeamDraft {
  return {
    name: 'Teste',
    roster: [],
    lineups,
    strategy: NEUTRAL_STRATEGY,
  };
}

/**
 * Constrói 11 atribuições para `unit` usando 11 identidades distintas tomadas
 * de `instanceIds` (que deve ter >= 11 elementos distintos), uma por papel.
 */
function completeUnit(
  unit: LineupUnit,
  instanceIds: readonly number[],
): LineupAssignment[] {
  return instanceIds
    .slice(0, 11)
    .map((instanceId, i) => ({ unit, role: `role_${i}`, instanceId }));
}

describe('Feature: pfl-team-strategy-ui, Property 15: Unidade válida tem exatamente 11 identidades distintas por snap', () => {
  it('não emite UNIT_INCOMPLETE nem DUPLICATE_IDENTITY_SNAP para uma unidade com 11 identidades distintas em 11 papéis (R13.1, R13.2)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_UNITS),
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 11,
          maxLength: 11,
        }),
        (unit, instanceIds) => {
          const draft = draftWithLineups(completeUnit(unit, instanceIds));
          const warnings = validateLineups(draft);

          const incomplete = warnings.filter(
            (w) => w.code === 'UNIT_INCOMPLETE' && w.target.unit === unit,
          );
          const dup = warnings.filter(
            (w) =>
              w.code === 'DUPLICATE_IDENTITY_SNAP' && w.target.unit === unit,
          );

          expect(incomplete).toHaveLength(0);
          expect(dup).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('emite UNIT_INCOMPLETE nomeando a unidade quando uma unidade iniciada tem menos de 11 identidades distintas (R13.4)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_UNITS),
        // 1..10 identidades distintas: unidade iniciada mas incompleta.
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (unit, instanceIds) => {
          const lineups: LineupAssignment[] = instanceIds.map(
            (instanceId, i) => ({ unit, role: `role_${i}`, instanceId }),
          );
          const draft = draftWithLineups(lineups);
          const warnings = validateLineups(draft);

          const incomplete = warnings.filter(
            (w) => w.code === 'UNIT_INCOMPLETE' && w.target.unit === unit,
          );

          // Exatamente um aviso de incompletude para a unidade iniciada.
          expect(incomplete).toHaveLength(1);
          expect(incomplete[0]!.target.kind).toBe('unit');
          expect(incomplete[0]!.target.unit).toBe(unit);
          expect(incomplete[0]!.blocking).toBe(true);
          // Sem duplicatas: nenhuma identidade repetida foi inserida.
          const dup = warnings.filter(
            (w) =>
              w.code === 'DUPLICATE_IDENTITY_SNAP' && w.target.unit === unit,
          );
          expect(dup).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('emite DUPLICATE_IDENTITY_SNAP quando a mesma identidade ocupa dois papéis na mesma unidade (R13.3, R13.5)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_UNITS),
        // 11 identidades distintas para completar a unidade...
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 11,
          maxLength: 11,
        }),
        // ...e o índice da identidade que será repetida num 12o papel.
        fc.integer({ min: 0, max: 10 }),
        (unit, instanceIds, dupIndex) => {
          const base = completeUnit(unit, instanceIds);
          const duplicated = instanceIds[dupIndex]!;
          const lineups: LineupAssignment[] = [
            ...base,
            { unit, role: 'role_dup', instanceId: duplicated },
          ];
          const draft = draftWithLineups(lineups);
          const warnings = validateLineups(draft);

          const dup = warnings.filter(
            (w) =>
              w.code === 'DUPLICATE_IDENTITY_SNAP' && w.target.unit === unit,
          );

          // Exatamente um aviso de duplicata, apontando a identidade repetida.
          expect(dup).toHaveLength(1);
          expect(dup[0]!.target.kind).toBe('unit');
          expect(dup[0]!.target.unit).toBe(unit);
          expect(dup[0]!.target.instanceId).toBe(duplicated);
          expect(dup[0]!.blocking).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('permite a mesma identidade em duas unidades diferentes sem DUPLICATE_IDENTITY_SNAP (R13.3)', () => {
    fc.assert(
      fc.property(
        // Duas unidades distintas.
        fc.uniqueArray(fc.constantFrom(...ALL_UNITS), {
          minLength: 2,
          maxLength: 2,
        }),
        // 11 identidades distintas, usadas igualmente nas duas unidades.
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 11,
          maxLength: 11,
        }),
        ([unitA, unitB], instanceIds) => {
          const lineups: LineupAssignment[] = [
            ...completeUnit(unitA!, instanceIds),
            ...completeUnit(unitB!, instanceIds),
          ];
          const draft = draftWithLineups(lineups);
          const warnings = validateLineups(draft);

          // Nenhum conflito entre unidades: a mesma instância pode servir ambas.
          const dup = warnings.filter(
            (w) => w.code === 'DUPLICATE_IDENTITY_SNAP',
          );
          expect(dup).toHaveLength(0);
          // Ambas as unidades estão completas: nenhuma incompletude.
          const incomplete = warnings.filter(
            (w) => w.code === 'UNIT_INCOMPLETE',
          );
          expect(incomplete).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
