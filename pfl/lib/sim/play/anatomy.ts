/**
 * Validador_Funcoes — validação anatômica por posição (`lib/sim/play/anatomy.ts`).
 *
 * Puro e determinístico (Task 8.3). O `Validador_Funcoes` roda ANTES de
 * qualquer resolução de jogada (fase (b) do pipeline) e decide se a ação
 * pretendida por um atleta na sua posição é anatomicamente possível. Devolve um
 * `AnatomyOutcome`:
 *
 * - `ok`                      — a anatomia satisfaz o requisito da posição/ação.
 * - `allowed_with_limitation` — a atribuição é possível só com limitação; o
 *   motor permite e registra o aviso de limitação (R10.10).
 * - `blocked`                 — a ação é anatomicamente impossível; o motor
 *   bloqueia e registra o aviso (R10.9). O pipeline NUNCA substitui a jogada
 *   ocultamente — bloqueia e loga.
 *
 * Mapa de requisitos por posição (derivado de `ANATOMY_DECISIONS_FINAL.md`):
 *
 * | Posição | Requisito | Exceção aprovada |
 * |---|---|---|
 * | QB            | snap tangível + lançamento físico (R10.1) | — |
 * | C (center)    | snap físico para trás (R10.2) | Venusaur CURTI: snap por vinha corpórea tangível (R10.8) |
 * | RB            | posse física, incl. handoff na boca p/ quadrúpedes (R10.3) | Rapidash: recebe handoff na boca |
 * | WR/TE/CB (recepção/INT) | contato físico + controle + dois pés (R10.4) | — |
 * | CB/S sem recepção física | deflexão/incompleto, nunca INT por magnetismo/telecinese (R10.5, R10.7) | Magneton: desvia, não intercepta |
 * | K/P           | impacto físico por membro/casco/superfície corporal (R10.6) | — |
 *
 * Pureza: a função não consome RNG, não lê ambiente e não muta a entrada —
 * depende apenas de `(athlete, role, action)`. A espécie é identificada pelo
 * `pokemonId` (National Dex) do atleta resolvido, único dado de identidade que
 * o núcleo carrega; as exceções aprovadas são um mapa mínimo e documentado.
 *
 * _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_
 */

import type { Position, ResolvedAthlete } from '../types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Resultado da validação anatômica de uma ação.
 *
 * - `ok`: anatomia satisfaz o requisito.
 * - `allowed_with_limitation`: possível só com limitação, com aviso (R10.10).
 * - `blocked`: anatomicamente impossível, com aviso (R10.9).
 */
export type AnatomyOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'allowed_with_limitation'; readonly warning: string }
  | { readonly kind: 'blocked'; readonly warning: string };

/**
 * Ação mínima que uma posição pode tentar executar numa jogada, suficiente para
 * expressar os requisitos anatômicos por posição do design.
 *
 * - `snap`      — recebimento/entrega do snap (QB recebe; C entrega para trás).
 * - `throw`     — lançamento físico da bola (QB).
 * - `handoff`   — recebimento de handoff para posse física (RB; na boca p/ quadrúpedes).
 * - `carry`     — posse e condução física da bola (RB e portadores em geral).
 * - `receive`   — recepção aérea com contato + controle + dois pés (WR/TE/CB).
 * - `intercept` — tentativa de interceptação pela secundária (CB/S).
 * - `kick`      — impacto físico corpóreo na bola (K/P).
 */
export type PlayAction =
  | 'snap'
  | 'throw'
  | 'handoff'
  | 'carry'
  | 'receive'
  | 'intercept'
  | 'kick';

// ---------------------------------------------------------------------------
// Espécies com exceção anatômica aprovada (National Dex id)
// ---------------------------------------------------------------------------

/**
 * `pokemonId` (National Dex) das espécies com exceção anatômica aprovada no
 * design. Mapa mínimo e documentado — o núcleo identifica a espécie apenas pelo
 * `pokemonId` do atleta resolvido.
 */
const SPECIES = {
  /** Venusaur (#3): center CURTI com snap por vinha corpórea tangível (R10.8). */
  VENUSAUR: 3,
  /** Rapidash (#78): quadrúpede que recebe handoff na boca (R10.3). */
  RAPIDASH: 78,
  /** Magneton (#82): secundária que desvia, não intercepta (R10.5, R10.7). */
  MAGNETON: 82,
} as const;

// ---------------------------------------------------------------------------
// Resultados canônicos reutilizáveis
// ---------------------------------------------------------------------------

const OK: AnatomyOutcome = { kind: 'ok' };

/** Constrói um resultado de bloqueio com aviso (R10.9). */
function blocked(warning: string): AnatomyOutcome {
  return { kind: 'blocked', warning };
}

/** Constrói um resultado de limitação permitida com aviso (R10.10). */
function limited(warning: string): AnatomyOutcome {
  return { kind: 'allowed_with_limitation', warning };
}

// ---------------------------------------------------------------------------
// Requisitos por posição
// ---------------------------------------------------------------------------

/** Posições de recepção aérea que exigem contato + controle + dois pés (R10.4). */
const RECEIVER_ROLES: ReadonlySet<Position> = new Set<Position>([
  'WR',
  'TE',
  'CB',
]);

/** Posições de secundária (R10.5, R10.7). */
const SECONDARY_ROLES: ReadonlySet<Position> = new Set<Position>(['CB', 'S']);

/**
 * Ações cujo requisito anatômico uma posição está autorizada a tentar.
 * Qualquer `(role, action)` fora deste mapa é anatomicamente incoerente com a
 * função e, portanto, bloqueado (R10.9) — o motor nunca troca a jogada.
 */
const ALLOWED_ACTIONS: Readonly<Record<Position, ReadonlySet<PlayAction>>> = {
  // QB: recebe snap tangível e faz lançamento físico (R10.1); pode conduzir a bola.
  QB: new Set<PlayAction>(['snap', 'throw', 'carry']),
  // C (center): snap físico para trás (R10.2).
  C: new Set<PlayAction>(['snap']),
  // RB: posse física, incl. handoff; conduz a bola (R10.3).
  RB: new Set<PlayAction>(['handoff', 'carry', 'receive']),
  // WR/TE: recepção com contato + controle + dois pés (R10.4); podem conduzir após posse.
  WR: new Set<PlayAction>(['receive', 'carry']),
  TE: new Set<PlayAction>(['receive', 'carry']),
  // CB: recepção/INT na secundária (R10.4, R10.5).
  CB: new Set<PlayAction>(['receive', 'intercept', 'carry']),
  // S (safety): secundária, disputa/INT (R10.5, R10.7).
  S: new Set<PlayAction>(['receive', 'intercept', 'carry']),
  // K/P: impacto físico corpóreo (R10.6).
  K: new Set<PlayAction>(['kick']),
  P: new Set<PlayAction>(['kick']),
  // Linhas: posse eventual após bola solta, sem requisito aéreo específico.
  OL: new Set<PlayAction>(['carry']),
  DL: new Set<PlayAction>(['carry']),
  LB: new Set<PlayAction>(['receive', 'intercept', 'carry']),
};

// ---------------------------------------------------------------------------
// Validador
// ---------------------------------------------------------------------------

/**
 * Valida se `athlete`, atuando como `role`, pode executar `action` conforme a
 * anatomia convencionada pelo PFL.
 *
 * Regras:
 * 1. Se a ação não é coerente com a função (ex.: um K tentando `throw`), a ação
 *    é anatomicamente impossível → `blocked` + aviso (R10.9).
 * 2. QB exige snap tangível + lançamento físico; C exige snap físico para trás;
 *    RB exige posse física (handoff/carry); WR/TE/CB exigem contato + controle +
 *    dois pés em recepção/INT; K/P exigem impacto físico corpóreo (R10.1–R10.6).
 * 3. Secundária (CB/S) tentando `intercept` sem recepção física é resolvida como
 *    deflexão/incompleto, nunca INT por magnetismo/telecinese → `blocked`
 *    (R10.5, R10.7). Magneton tem exceção aprovada: desvia, não intercepta —
 *    sua tentativa de `intercept` é bloqueada com o aviso específico, enquanto
 *    `receive`/`carry` seguem válidos.
 * 4. Exceções aprovadas (R10.8): Rapidash recebe handoff na boca (RB) e Venusaur
 *    CURTI faz snap por vinha corpórea tangível (center), sem golpe sobrenatural
 *    pré-snap gratuito.
 *
 * Pura: não consome RNG, não lê ambiente e não muta a entrada.
 *
 * @param athlete Atleta resolvido (identidade por `pokemonId`).
 * @param role    Posição funcional em que o atleta vai atuar.
 * @param action  Ação pretendida nesta jogada.
 * @returns O `AnatomyOutcome` da validação.
 */
export function validateAnatomy(
  athlete: ResolvedAthlete,
  role: Position,
  action: PlayAction,
): AnatomyOutcome {
  const permitted = ALLOWED_ACTIONS[role];

  // (1) Ação incoerente com a função → impossível (R10.9).
  if (!permitted.has(action)) {
    return blocked(
      `Ação '${action}' é anatomicamente impossível para a posição ${role}.`,
    );
  }

  // (3) Secundária tentando interceptação: só vale com recepção física
  // (contato + controle + dois pés). Telecinese/magnetismo nunca é INT.
  if (action === 'intercept' && SECONDARY_ROLES.has(role)) {
    if (athlete.pokemonId === SPECIES.MAGNETON) {
      // Magneton: exceção aprovada — desvia, não intercepta (R10.5, R10.7).
      return blocked(
        'Magneton desvia a bola (deflexão/incompleto); não intercepta por ' +
          'magnetismo. Interceptação exige recepção física.',
      );
    }
    // Secundária em geral: interceptação exige recepção física; sem ela a
    // disputa resolve-se como deflexão/incompleto (R10.5, R10.7).
    return limited(
      `Interceptação em ${role} exige recepção física (contato + controle + ` +
        'dois pés); sem ela a disputa resolve-se como deflexão/incompleto.',
    );
  }

  // (2) Center (C) recebendo/entregando o snap: snap físico para trás (R10.2).
  if (role === 'C' && action === 'snap') {
    if (athlete.pokemonId === SPECIES.VENUSAUR) {
      // Venusaur CURTI: exceção aprovada — snap por vinha corpórea tangível,
      // sem golpe sobrenatural pré-snap gratuito (R10.8).
      return limited(
        'Venusaur (CURTI) executa o snap de center por vinha corpórea ' +
          'tangível (exceção aprovada); nenhum golpe sobrenatural pré-snap é ' +
          'concedido gratuitamente.',
      );
    }
    return OK;
  }

  // (2) RB recebendo handoff: posse física; quadrúpedes recebem na boca (R10.3).
  if (role === 'RB' && action === 'handoff') {
    if (athlete.pokemonId === SPECIES.RAPIDASH) {
      // Rapidash: quadrúpede recebe handoff na boca (exceção aprovada).
      return limited(
        'Rapidash recebe o handoff na boca (quadrúpede), estabelecendo posse ' +
          'física conforme a exceção aprovada.',
      );
    }
    return OK;
  }

  // (2) Recepção aérea de WR/TE/CB: contato + controle + dois pés (R10.4).
  // (Já coberto estruturalmente por ALLOWED_ACTIONS; o requisito físico é
  // uniforme para todas as espécies, sem exceção que o dispense.)
  if (action === 'receive' && RECEIVER_ROLES.has(role)) {
    return OK;
  }

  // (2) QB (snap/throw/carry), K/P (kick), e demais ações permitidas satisfazem
  // o requisito físico da função sem exceção adicional.
  return OK;
}
