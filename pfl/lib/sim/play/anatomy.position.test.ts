/**
 * Property test de validação anatômica por posição (`validateAnatomy`) — Task 8.4.
 *
 * // Feature: pfl-simulation-engine, Property 32: Validação anatômica por posição
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6**
 *
 * *Para toda* combinação `(athlete, role, action)`, o `Validador_Funcoes`
 * devolve um `AnatomyOutcome` cujo `kind` é inteiramente determinado pelo
 * contrato de requisitos por posição (ALLOWED_ACTIONS) e pelas exceções de
 * espécie aprovadas:
 *
 * | Posição | Ações permitidas (→ ok) | Requisito | Exceção |
 * |---|---|---|---|
 * | QB  | snap, throw, carry       | snap tangível + lançamento físico (R10.1) | — |
 * | C   | snap                     | snap físico para trás (R10.2)             | Venusaur #3 → limitação (R10.8) |
 * | RB  | handoff, carry, receive  | posse física (R10.3)                      | Rapidash #78 handoff → limitação |
 * | WR  | receive, carry           | contato + controle + dois pés (R10.4)     | — |
 * | TE  | receive, carry           | contato + controle + dois pés (R10.4)     | — |
 * | CB  | receive, intercept, carry| recepção física; INT exige recepção (R10.4) | Magneton #82 intercept → bloqueio |
 * | S   | receive, intercept, carry| secundária (R10.5)                        | Magneton #82 intercept → bloqueio |
 * | K   | kick                     | impacto físico corpóreo (R10.6)           | — |
 * | P   | kick                     | impacto físico corpóreo (R10.6)           | — |
 * | OL  | carry                    | posse eventual                            | — |
 * | DL  | carry                    | posse eventual                            | — |
 * | LB  | receive, intercept, carry| disputa (não-secundária)                  | — |
 *
 * Regras de desfecho verificadas:
 * 1. Ação FORA do conjunto permitido da posição → `blocked` (R10.9), sempre com
 *    aviso não vazio e sem substituição oculta da jogada.
 * 2. Secundária (CB/S) tentando `intercept`: `blocked` para Magneton (desvia,
 *    não intercepta — R10.5/R10.7) e `allowed_with_limitation` para as demais
 *    espécies (INT exige recepção física; sem ela resolve-se como deflexão).
 * 3. Center (C) com `snap`: `allowed_with_limitation` para Venusaur (vinha
 *    corpórea tangível — R10.8), `ok` para as demais.
 * 4. RB com `handoff`: `allowed_with_limitation` para Rapidash (handoff na
 *    boca), `ok` para as demais.
 * 5. Toda outra ação permitida satisfaz o requisito físico → `ok`.
 *
 * Pureza: `validateAnatomy` não consome RNG, não lê ambiente e não muta a
 * entrada — depende apenas de `(athlete, role, action)`. Por isso o teste
 * gera atletas mínimos variando `pokemonId` (incluindo as espécies de exceção)
 * e cruza todas as `(role, action)` possíveis.
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
const VENUSAUR = 3;
const RAPIDASH = 78;
const MAGNETON = 82;

// ---------------------------------------------------------------------------
// Oráculo independente do contrato ALLOWED_ACTIONS + exceções
// ---------------------------------------------------------------------------

/**
 * Conjunto de ações permitidas por posição, replicado aqui como oráculo
 * independente (espelha ALLOWED_ACTIONS de `anatomy.ts`). Qualquer `(role,
 * action)` fora deste mapa é anatomicamente incoerente → `blocked`.
 */
const EXPECTED_ALLOWED: Readonly<Record<Position, ReadonlySet<PlayAction>>> = {
  QB: new Set<PlayAction>(['snap', 'throw', 'carry']),
  C: new Set<PlayAction>(['snap']),
  RB: new Set<PlayAction>(['handoff', 'carry', 'receive']),
  WR: new Set<PlayAction>(['receive', 'carry']),
  TE: new Set<PlayAction>(['receive', 'carry']),
  CB: new Set<PlayAction>(['receive', 'intercept', 'carry']),
  S: new Set<PlayAction>(['receive', 'intercept', 'carry']),
  K: new Set<PlayAction>(['kick']),
  P: new Set<PlayAction>(['kick']),
  OL: new Set<PlayAction>(['carry']),
  DL: new Set<PlayAction>(['carry']),
  LB: new Set<PlayAction>(['receive', 'intercept', 'carry']),
};

/** Posições de secundária cuja interceptação exige recepção física (R10.5/R10.7). */
const SECONDARY: ReadonlySet<Position> = new Set<Position>(['CB', 'S']);

type OutcomeKind = 'ok' | 'allowed_with_limitation' | 'blocked';

/**
 * Oráculo: desfecho esperado de `validateAnatomy` dado `(pokemonId, role,
 * action)`, derivado diretamente das regras R10.1–R10.6, R10.8 e das exceções.
 */
function expectedKind(
  pokemonId: number,
  role: Position,
  action: PlayAction,
): OutcomeKind {
  // (1) Ação incoerente com a função → bloqueada (R10.9).
  if (!EXPECTED_ALLOWED[role].has(action)) return 'blocked';

  // (2) Secundária tentando interceptação.
  if (action === 'intercept' && SECONDARY.has(role)) {
    return pokemonId === MAGNETON ? 'blocked' : 'allowed_with_limitation';
  }

  // (3) Center executando o snap: Venusaur é limitação aprovada (R10.8).
  if (role === 'C' && action === 'snap') {
    return pokemonId === VENUSAUR ? 'allowed_with_limitation' : 'ok';
  }

  // (4) RB recebendo handoff: Rapidash é limitação aprovada (handoff na boca).
  if (role === 'RB' && action === 'handoff') {
    return pokemonId === RAPIDASH ? 'allowed_with_limitation' : 'ok';
  }

  // (5) Demais ações permitidas satisfazem o requisito físico.
  return 'ok';
}

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
 * dentro do espaço explorado por `fast-check`.
 */
const pokemonIdArb = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 1025 }) },
  { weight: 1, arbitrary: fc.constantFrom(VENUSAUR, RAPIDASH, MAGNETON) },
);

const roleArb = fc.constantFrom(...ALL_ROLES);
const actionArb = fc.constantFrom(...ALL_ACTIONS);

// ---------------------------------------------------------------------------
// Property 32
// ---------------------------------------------------------------------------

describe('validateAnatomy — Property 32 (validação anatômica por posição)', () => {
  it('o kind do desfecho segue o contrato de posição e as exceções, para toda (espécie, posição, ação)', () => {
    fc.assert(
      fc.property(pokemonIdArb, roleArb, actionArb, (pokemonId, role, action) => {
        const outcome = validateAnatomy(makeAthlete(pokemonId, role), role, action);
        expect(outcome.kind).toBe(expectedKind(pokemonId, role, action));
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('todo bloqueio e toda limitação carregam um aviso não vazio; ok nunca carrega aviso', () => {
    fc.assert(
      fc.property(pokemonIdArb, roleArb, actionArb, (pokemonId, role, action) => {
        const outcome = validateAnatomy(makeAthlete(pokemonId, role), role, action);
        if (outcome.kind === 'ok') {
          expect(outcome).toEqual({ kind: 'ok' });
        } else {
          // blocked (R10.9) e allowed_with_limitation (R10.10) sempre logam.
          expect(typeof outcome.warning).toBe('string');
          expect(outcome.warning.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('não muta a entrada nem depende de outros campos além de pokemonId (pureza)', () => {
    fc.assert(
      fc.property(pokemonIdArb, roleArb, actionArb, (pokemonId, role, action) => {
        const athlete = makeAthlete(pokemonId, role);
        const snapshot = JSON.stringify(athlete);

        const first = validateAnatomy(athlete, role, action);
        const second = validateAnatomy(athlete, role, action);

        // Determinística: mesma entrada → mesmo desfecho.
        expect(second).toEqual(first);
        // Pura: não muta o atleta.
        expect(JSON.stringify(athlete)).toBe(snapshot);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('cada posição permite exatamente seu conjunto de ações (R10.1–R10.6) e bloqueia o restante', () => {
    for (const role of ALL_ROLES) {
      for (const action of ALL_ACTIONS) {
        const permitted = EXPECTED_ALLOWED[role].has(action);
        // Espécie neutra (sem exceção) para isolar o contrato estrutural.
        const outcome = validateAnatomy(makeAthlete(1, role), role, action);
        if (!permitted) {
          expect(outcome.kind).toBe('blocked');
        } else {
          expect(outcome.kind).not.toBe('blocked');
        }
      }
    }
  });

  it('aplica as exceções de espécie aprovadas (Venusaur center, Rapidash handoff, Magneton INT)', () => {
    // Venusaur (#3) como center: snap vira limitação aprovada (R10.8).
    expect(validateAnatomy(makeAthlete(VENUSAUR, 'C'), 'C', 'snap').kind).toBe(
      'allowed_with_limitation',
    );
    // Center não-Venusaur: snap é ok.
    expect(validateAnatomy(makeAthlete(1, 'C'), 'C', 'snap').kind).toBe('ok');

    // Rapidash (#78) como RB: handoff vira limitação (handoff na boca).
    expect(
      validateAnatomy(makeAthlete(RAPIDASH, 'RB'), 'RB', 'handoff').kind,
    ).toBe('allowed_with_limitation');
    // RB não-Rapidash: handoff é ok.
    expect(validateAnatomy(makeAthlete(1, 'RB'), 'RB', 'handoff').kind).toBe(
      'ok',
    );

    // Magneton (#82) na secundária: intercept é bloqueado (desvia, não intercepta).
    expect(
      validateAnatomy(makeAthlete(MAGNETON, 'CB'), 'CB', 'intercept').kind,
    ).toBe('blocked');
    expect(
      validateAnatomy(makeAthlete(MAGNETON, 'S'), 'S', 'intercept').kind,
    ).toBe('blocked');
    // Secundária não-Magneton: intercept é limitação (exige recepção física).
    expect(
      validateAnatomy(makeAthlete(1, 'CB'), 'CB', 'intercept').kind,
    ).toBe('allowed_with_limitation');
  });
});
