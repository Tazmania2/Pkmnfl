/**
 * Property test de bloqueio/limitação logados (`validateAnatomy`) — Task 8.5.
 *
 * // Feature: pfl-simulation-engine, Property 33: Ação impossível bloqueia,
 * // limitação permite, ambas logam
 *
 * **Validates: Requirements 10.9, 10.10, 4.4**
 *
 * Enquanto a Property 32 (`anatomy.position.test.ts`) fixa o *contrato de kind*
 * — qual `(espécie, posição, ação)` leva a `ok`, `allowed_with_limitation` ou
 * `blocked` —, esta propriedade é complementar e foca o **invariante de
 * logging/aviso** do `Validador_Funcoes`:
 *
 * - **R10.9** — Sempre que uma ação é anatomicamente *impossível*, o motor
 *   BLOQUEIA e REGISTRA o aviso; nunca substitui a jogada ocultamente. Logo
 *   todo `blocked` precisa carregar um `warning` não vazio (o payload que será
 *   logado como `ANATOMY_WARNING`).
 * - **R10.10** — Sempre que a ação só é possível *com limitação*, o motor
 *   PERMITE e REGISTRA o aviso de limitação. Logo todo
 *   `allowed_with_limitation` precisa carregar um `warning` não vazio.
 * - **R4.4** — Nenhuma jogada é trocada silenciosamente: um desfecho sem `ok`
 *   JAMAIS vem sem aviso (sem aviso = substituição/silenciamento oculto). Por
 *   simetria, `ok` NUNCA carrega aviso — não há limitação a comunicar e o
 *   objeto é exatamente `{ kind: 'ok' }`.
 *
 * O invariante central, para toda combinação `(athlete, role, action)`:
 *
 *     outcome.kind === 'ok'
 *       ⟺  outcome não possui campo `warning`
 *     outcome.kind ∈ { 'blocked', 'allowed_with_limitation' }
 *       ⟹  outcome.warning é string com comprimento > 0 (após trim)
 *
 * Pureza: `validateAnatomy` não consome RNG, não lê ambiente e não muta a
 * entrada — depende apenas de `(athlete, role, action)`. O teste gera atletas
 * mínimos variando `pokemonId` (incluindo explicitamente as espécies de
 * exceção, que são justamente as que produzem bloqueio/limitação por espécie) e
 * cruza todas as `(role, action)` possíveis.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { validateAnatomy, type PlayAction } from './anatomy';
import type { AthleteStats, Position, ResolvedAthlete } from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

// ---------------------------------------------------------------------------
// Espaço de entrada
// ---------------------------------------------------------------------------

/** Todas as posições funcionais do núcleo. */
const ALL_ROLES: readonly Position[] = [
  'QB',
  'C',
  'RB',
  'WR',
  'TE',
  'CB',
  'S',
  'K',
  'P',
  'OL',
  'DL',
  'LB',
];

/** Todas as ações que uma posição pode tentar numa jogada. */
const ALL_ACTIONS: readonly PlayAction[] = [
  'snap',
  'throw',
  'handoff',
  'carry',
  'receive',
  'intercept',
  'kick',
];

/** `pokemonId` das espécies com exceção anatômica aprovada (National Dex). */
const VENUSAUR = 3; // center: snap vira limitação (R10.8/R10.10)
const RAPIDASH = 78; // RB: handoff na boca vira limitação (R10.10)
const MAGNETON = 82; // secundária: intercept é bloqueado (R10.9)

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

const STATS: AthleteStats = {
  hp: 60,
  attack: 60,
  defense: 60,
  specialAttack: 60,
  specialDefense: 60,
  speed: 60,
};

/**
 * Constrói um `ResolvedAthlete` mínimo cuja única identidade relevante para o
 * validador anatômico é o `pokemonId`. Os demais campos existem apenas para
 * honrar o contrato de tipo e não são lidos por `validateAnatomy`.
 */
function makeAthlete(pokemonId: number, role: Position): ResolvedAthlete {
  return {
    instanceId: 1,
    pokemonId,
    types: ['NORMAL'],
    stats: STATS,
    abilityId: 0,
    moveIds: [0, 0, 0, 0],
    additionalEffectIds: [],
    positionDesignation: role,
  };
}

/**
 * Gerador de `pokemonId`: mistura espécies arbitrárias (National Dex válido)
 * com as três espécies de exceção, garantindo cobertura explícita das exceções
 * — justamente os casos que produzem bloqueio/limitação por espécie — dentro do
 * espaço explorado por `fast-check`.
 */
const pokemonIdArb = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 1025 }) },
  { weight: 1, arbitrary: fc.constantFrom(VENUSAUR, RAPIDASH, MAGNETON) },
);

const roleArb = fc.constantFrom(...ALL_ROLES);
const actionArb = fc.constantFrom(...ALL_ACTIONS);

// ---------------------------------------------------------------------------
// Property 33
// ---------------------------------------------------------------------------

describe('validateAnatomy — Property 33 (bloqueio/limitação sempre logados)', () => {
  it('todo bloqueio carrega aviso não vazio e nunca substitui a jogada em silêncio (R10.9, R4.4)', () => {
    fc.assert(
      fc.property(pokemonIdArb, roleArb, actionArb, (pokemonId, role, action) => {
        const outcome = validateAnatomy(makeAthlete(pokemonId, role), role, action);
        if (outcome.kind === 'blocked') {
          // Impossível → BLOQUEIA e LOGA: o aviso é o payload de ANATOMY_WARNING.
          // Sem aviso = substituição/silenciamento oculto, proibido por R4.4.
          expect(typeof outcome.warning).toBe('string');
          expect(outcome.warning.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('toda limitação permite a ação mas carrega aviso não vazio (R10.10)', () => {
    fc.assert(
      fc.property(pokemonIdArb, roleArb, actionArb, (pokemonId, role, action) => {
        const outcome = validateAnatomy(makeAthlete(pokemonId, role), role, action);
        if (outcome.kind === 'allowed_with_limitation') {
          // Possível só com limitação → PERMITE e LOGA o aviso de limitação.
          expect(typeof outcome.warning).toBe('string');
          expect(outcome.warning.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('invariante de logging: (kind !== ok) ⟺ aviso não vazio; ok nunca carrega aviso', () => {
    fc.assert(
      fc.property(pokemonIdArb, roleArb, actionArb, (pokemonId, role, action) => {
        const outcome = validateAnatomy(makeAthlete(pokemonId, role), role, action);
        const hasWarning = 'warning' in outcome;

        if (outcome.kind === 'ok') {
          // Sem limitação a comunicar: objeto é exatamente { kind: 'ok' }.
          expect(hasWarning).toBe(false);
          expect(outcome).toEqual({ kind: 'ok' });
        } else {
          // blocked (R10.9) e allowed_with_limitation (R10.10) SEMPRE logam.
          expect(hasWarning).toBe(true);
          expect(typeof outcome.warning).toBe('string');
          expect(outcome.warning.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('cobre explicitamente as exceções que logam por espécie (Magneton bloqueia, Venusaur/Rapidash limitam)', () => {
    // Magneton na secundária: intercept é BLOQUEADO e logado (R10.9).
    for (const role of ['CB', 'S'] as const) {
      const blockedOutcome = validateAnatomy(
        makeAthlete(MAGNETON, role),
        role,
        'intercept',
      );
      expect(blockedOutcome.kind).toBe('blocked');
      if (blockedOutcome.kind !== 'ok') {
        expect(blockedOutcome.warning.trim().length).toBeGreaterThan(0);
      }
    }

    // Venusaur como center: snap vira LIMITAÇÃO logada (R10.10).
    const venusaur = validateAnatomy(makeAthlete(VENUSAUR, 'C'), 'C', 'snap');
    expect(venusaur.kind).toBe('allowed_with_limitation');
    if (venusaur.kind !== 'ok') {
      expect(venusaur.warning.trim().length).toBeGreaterThan(0);
    }

    // Rapidash como RB: handoff vira LIMITAÇÃO logada (R10.10).
    const rapidash = validateAnatomy(makeAthlete(RAPIDASH, 'RB'), 'RB', 'handoff');
    expect(rapidash.kind).toBe('allowed_with_limitation');
    if (rapidash.kind !== 'ok') {
      expect(rapidash.warning.trim().length).toBeGreaterThan(0);
    }
  });
});
