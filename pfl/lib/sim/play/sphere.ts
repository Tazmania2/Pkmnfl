/**
 * Esfera_Supressao e política de telecinese (`lib/sim/play/sphere.ts`).
 *
 * Este módulo modela a regra universal da `Esfera_Supressao`: a região
 * esférica de raio `suppression_radius_yards = 2` centrada na bola, que
 * acompanha a bola a cada Tick e dentro da qual poderes sobrenaturais não
 * ativam nem produzem efeito. Modela também a política de telecinese (R8.6–8.8)
 * — proteção da posse física e marcação de manipulação remota como
 * não-posse/não-interceptação/não-touchdown.
 *
 * Tudo aqui é **puro**: funções/predicados sem efeitos externos, sem I/O, sem
 * relógio de sistema e sem entropia. Cada decisão sobre (não) ativação de poder
 * retorna um resultado **estruturado com motivo** (`reason`), para que o módulo
 * de log (`log.ts`) registre honestamente — a cada tentativa de poder — por que
 * o poder foi suprimido/suspenso ou por que a manipulação remota não conta.
 *
 * Nota de MVP: como todos os efeitos adicionais são inertes (`inert.ts`), a
 * esfera e a telecinese são as regras universais que, ainda assim, precisam ser
 * **modeladas e logadas**. A cada tick registra-se a posição da esfera e o
 * motivo da não-ativação de qualquer poder (supressão aqui, inércia em
 * `inert.ts`).
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
 */

import type { Vec3 } from '../types';

// ---------------------------------------------------------------------------
// Constantes e geometria da esfera (R8.1)
// ---------------------------------------------------------------------------

/**
 * Raio-padrão da `Esfera_Supressao` em jardas, igual a
 * `simulation_parameters.suppression_radius_yards = 2`. O chamador deve passar
 * o valor do baseline; esta constante é apenas o default de domínio para
 * conveniência e documentação.
 */
export const DEFAULT_SUPPRESSION_RADIUS_YARDS = 2;

/**
 * A `Esfera_Supressao` representada como centro + raio. O centro é sempre a
 * posição corrente da bola (`ballPos`): a esfera **acompanha a bola** (R8.1).
 */
export interface SuppressionSphere {
  readonly center: Vec3;
  readonly radiusYards: number;
}

/**
 * Distância euclidiana ao quadrado entre dois pontos. Trabalhar com o quadrado
 * evita a raiz quadrada (mais barato e sem erro de arredondamento da `sqrt`),
 * já que a comparação com o raio é feita contra `raio²`.
 */
function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Decide se um ponto está **dentro** da `Esfera_Supressao` centrada na bola.
 *
 * O interior **inclui a casca** (R8.1): pontos situados exatamente a
 * `radiusYards` da bola são considerados interiores. Por isso a comparação usa
 * `d² <= raio²` (e não `<`): a desigualdade não-estrita garante a inclusão da
 * casca. Comparar quadrados preserva a semântica porque ambos os lados são
 * não-negativos.
 *
 * @param ballPos Centro da esfera (posição corrente da bola).
 * @param point Ponto a testar (ex.: posição de um atleta ou efeito).
 * @param radiusYards Raio em jardas (`suppression_radius_yards`, 2 no baseline).
 * @returns `true` se o ponto está no interior fechado (incluindo a casca).
 */
export function isInsideSphere(
  ballPos: Vec3,
  point: Vec3,
  radiusYards: number,
): boolean {
  // d² <= raio²  →  "<=" inclui a casca (pontos exatamente a `radiusYards`).
  return distanceSquared(ballPos, point) <= radiusYards * radiusYards;
}

// ---------------------------------------------------------------------------
// Reposicionamento da esfera a cada tick (R8.2)
// ---------------------------------------------------------------------------

/**
 * Reposiciona a `Esfera_Supressao` para a nova posição da bola, devolvendo uma
 * **nova** esfera (sem mutar nada). O chamador (loop de ticks) invoca esta
 * função **no mesmo tick em que a bola muda de posição e ANTES** de resolver
 * qualquer poder sobrenatural daquele tick (R8.2): primeiro a esfera segue a
 * bola, só então os poderes do tick são avaliados contra a esfera já atual.
 *
 * O centro é copiado (novo `Vec3`) para que a esfera não compartilhe referência
 * mutável com o estado espacial de origem.
 *
 * @param newBallPos Nova posição da bola neste tick.
 * @param radiusYards Raio da esfera (`suppression_radius_yards`).
 * @returns Nova `SuppressionSphere` centrada na posição atualizada da bola.
 */
export function repositionSphere(
  newBallPos: Vec3,
  radiusYards: number = DEFAULT_SUPPRESSION_RADIUS_YARDS,
): SuppressionSphere {
  return {
    center: { x: newBallPos.x, y: newBallPos.y, z: newBallPos.z },
    radiusYards,
  };
}

// ---------------------------------------------------------------------------
// Supressão de poderes dentro da esfera (R8.3, R8.4, R8.5)
// ---------------------------------------------------------------------------

/**
 * Resultado da decisão de supressão para uma tentativa de poder sobrenatural.
 * `active = false` significa que o poder **não** ativa nem afeta a jogada.
 * `reason` carrega o motivo canônico para o log.
 */
export interface SuppressionDecision {
  /** `true` apenas quando o poder pode agir (fora da esfera). */
  readonly active: boolean;
  /** `true` quando o poder foi neutralizado por estar dentro da esfera. */
  readonly suppressed: boolean;
  /** `true` quando um efeito previamente ativo é suspenso ao entrar na esfera. */
  readonly suspended: boolean;
  /** Motivo canônico para o `Log_Partida`. */
  readonly reason: SuppressionReason;
}

/** Motivos canônicos de uma decisão de supressão, registrados no log. */
export type SuppressionReason =
  /** Poder dentro da esfera: neutralizado com prioridade absoluta (R8.3). */
  | 'POWER_SUPPRESSED_INSIDE_SPHERE'
  /** Efeito antes ativo que entrou na esfera: suspenso enquanto dentro (R8.4). */
  | 'EFFECT_SUSPENDED_ON_ENTER'
  /** Poder fora da esfera: a esfera não o neutraliza. */
  | 'OUTSIDE_SPHERE_NOT_SUPPRESSED';

/**
 * Decide a disposição de um poder sobrenatural face à `Esfera_Supressao`, com
 * **prioridade absoluta** sobre qualquer outra regra de efeito (R8.3).
 *
 * - Se a fonte do poder está **dentro** da esfera, o poder não ativa nem afeta
 *   a jogada (R8.3). Se o efeito estava **previamente ativo**, o motivo é
 *   "suspenso ao entrar" (R8.4) — a suspensão vale enquanto permanecer dentro;
 *   em ambos os casos o poder fica inativo.
 * - Se a fonte está **fora** da esfera, esta função não neutraliza o poder
 *   (outras regras — posse física, inércia, anatomia — ainda se aplicam).
 *
 * Esta decisão é tomada **após** o reposicionamento da esfera no tick
 * (`repositionSphere`), nunca antes.
 *
 * @param sphere Esfera já reposicionada para a bola neste tick.
 * @param powerSource Posição da fonte do poder (atleta/efeito).
 * @param wasActive Se o efeito já estava ativo antes deste tick (default `false`).
 * @returns Decisão estruturada com motivo para o log.
 */
export function resolveSuppression(
  sphere: SuppressionSphere,
  powerSource: Vec3,
  wasActive = false,
): SuppressionDecision {
  const inside = isInsideSphere(sphere.center, powerSource, sphere.radiusYards);
  if (!inside) {
    return {
      active: true,
      suppressed: false,
      suspended: false,
      reason: 'OUTSIDE_SPHERE_NOT_SUPPRESSED',
    };
  }
  // Dentro da esfera: inativo com prioridade absoluta. Um efeito antes ativo é
  // "suspenso ao entrar" (R8.4); um poder que apenas tenta ativar é "suprimido".
  return {
    active: false,
    suppressed: true,
    suspended: wasActive,
    reason: wasActive
      ? 'EFFECT_SUSPENDED_ON_ENTER'
      : 'POWER_SUPPRESSED_INSIDE_SPHERE',
  };
}

/**
 * Categorias de fenômeno físico que a esfera **preserva** mesmo em seu interior
 * (R8.5): a supressão atinge apenas poderes sobrenaturais, nunca a física
 * natural já em curso.
 */
export type PreservedPhysical = 'anatomy' | 'natural_physics' | 'physical_momentum';

/** Conjunto canônico dos fenômenos físicos preservados dentro da esfera (R8.5). */
const PRESERVED_PHYSICAL: ReadonlySet<PreservedPhysical> = new Set([
  'anatomy',
  'natural_physics',
  'physical_momentum',
]);

/**
 * Indica se um fenômeno é preservado dentro da esfera. Anatomia, física natural
 * e **momentum já adquirido por meios físicos** são preservados (R8.5); a
 * supressão atinge apenas poderes sobrenaturais, nunca a física natural já em
 * curso. É um predicado explícito (em vez de um comentário) para que o pipeline
 * e o log possam afirmar — de forma rastreável — que esses fenômenos não foram
 * suprimidos.
 *
 * @param phenomenon Categoria física consultada.
 * @returns `true` para anatomia, física natural e momentum físico (R8.5).
 */
export function isPreservedInsideSphere(phenomenon: PreservedPhysical): boolean {
  return PRESERVED_PHYSICAL.has(phenomenon);
}

// ---------------------------------------------------------------------------
// Política de telecinese / manipulação remota (R8.6, R8.7, R8.8)
// ---------------------------------------------------------------------------

/**
 * Estado físico da bola relevante para a política de telecinese.
 *
 * `physicalPossession` caracteriza a **posse física** (R8.6): contato contínuo
 * **e** controle mecânico estável de um atleta sobre a bola. Quando `true`, a
 * bola está em posse; quando `false`, a bola está solta.
 */
export interface BallPhysicalState {
  /** Posição corrente da bola (centro da esfera). */
  readonly ballPos: Vec3;
  /** Contato contínuo de um portador com a bola. */
  readonly continuousContact: boolean;
  /** Controle mecânico estável do portador sobre a bola. */
  readonly stableMechanicalControl: boolean;
}

/**
 * Verdadeiro quando a bola está em **posse física** (R8.6): exige contato
 * contínuo **e** controle mecânico estável simultaneamente. A ausência de
 * qualquer um dos dois caracteriza bola solta.
 */
export function isPhysicalPossession(ball: BallPhysicalState): boolean {
  return ball.continuousContact && ball.stableMechanicalControl;
}

/** Resultado da decisão de telecinese sobre uma manipulação externa da bola. */
export interface TelekinesisDecision {
  /** `true` se a manipulação sobrenatural externa é permitida. */
  readonly allowed: boolean;
  /**
   * `true` se bola e portador estão protegidos contra poderes externos por
   * estarem em posse física (R8.6).
   */
  readonly protectedByPossession: boolean;
  /**
   * Marcadores de que uma manipulação remota permitida **não** constitui posse,
   * interceptação nem touchdown (R8.8). Significativos apenas quando `allowed`.
   */
  readonly remoteManipulation: RemoteManipulationFlags;
  /** Motivo canônico para o `Log_Partida`. */
  readonly reason: TelekinesisReason;
}

/**
 * Marcadores que o log registra quando a bola é deslocada por manipulação
 * sobrenatural externa (R8.8). Todos negativos por definição: a telecinese
 * nunca cria posse, interceptação ou pontuação.
 */
export interface RemoteManipulationFlags {
  readonly countsAsPossession: false;
  readonly countsAsInterception: false;
  readonly countsAsTouchdown: false;
}

/** Motivos canônicos de uma decisão de telecinese, registrados no log. */
export type TelekinesisReason =
  /** Bola em posse física: protegida contra poderes externos (R8.6). */
  | 'PROTECTED_PHYSICAL_POSSESSION'
  /** Bola solta mas dentro da esfera: supressão impede a manipulação. */
  | 'BLOCKED_LOOSE_INSIDE_SPHERE'
  /** Bola solta e fora da esfera: manipulação remota permitida, mas não é posse. */
  | 'REMOTE_MANIPULATION_NOT_POSSESSION';

/** Marcadores canônicos de manipulação remota (todos negativos — R8.8). */
const REMOTE_MANIPULATION_FLAGS: RemoteManipulationFlags = {
  countsAsPossession: false,
  countsAsInterception: false,
  countsAsTouchdown: false,
};

/**
 * Decide se uma ação sobrenatural externa pode manipular a bola e como o log
 * deve classificá-la, aplicando a política de telecinese (R8.6–8.8):
 *
 * - **Posse física** (contato contínuo + controle estável): bola e portador são
 *   **protegidos** contra poderes externos (R8.6) → `allowed = false`.
 * - **Bola solta mas dentro da esfera**: a supressão (prioridade absoluta)
 *   impede a manipulação → `allowed = false`.
 * - **Bola solta e fora da esfera**: manipulação remota **permitida** (R8.7),
 *   mas o deslocamento resultante **não** constitui posse, interceptação nem
 *   touchdown, e isso é marcado para o log (R8.8).
 *
 * A verificação de posse física tem precedência sobre a geometria: mesmo que a
 * bola em posse esteja fora da esfera, a posse continua protegida.
 *
 * @param sphere Esfera já reposicionada para a bola neste tick.
 * @param ball Estado físico da bola (posição, contato, controle).
 * @returns Decisão estruturada com marcadores e motivo para o log.
 */
export function resolveTelekinesis(
  sphere: SuppressionSphere,
  ball: BallPhysicalState,
): TelekinesisDecision {
  // R8.6: posse física protege bola e portador, independentemente da esfera.
  if (isPhysicalPossession(ball)) {
    return {
      allowed: false,
      protectedByPossession: true,
      remoteManipulation: REMOTE_MANIPULATION_FLAGS,
      reason: 'PROTECTED_PHYSICAL_POSSESSION',
    };
  }

  // Bola solta: a manipulação externa só é possível fora da esfera (R8.7),
  // pois dentro dela a supressão tem prioridade absoluta (R8.3).
  const insideSphere = isInsideSphere(
    sphere.center,
    ball.ballPos,
    sphere.radiusYards,
  );
  if (insideSphere) {
    return {
      allowed: false,
      protectedByPossession: false,
      remoteManipulation: REMOTE_MANIPULATION_FLAGS,
      reason: 'BLOCKED_LOOSE_INSIDE_SPHERE',
    };
  }

  // Bola solta e fora da esfera: manipulação remota permitida, mas nunca é
  // posse, interceptação ou touchdown (R8.8) — o log registra os marcadores.
  return {
    allowed: true,
    protectedByPossession: false,
    remoteManipulation: REMOTE_MANIPULATION_FLAGS,
    reason: 'REMOTE_MANIPULATION_NOT_POSSESSION',
  };
}
