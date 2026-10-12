/**
 * Motor de validação puro (`lib/validation/index.ts`).
 *
 * Função **pura**, síncrona, que recebe um `TeamDraft` (ou uma `AthleteDraft`)
 * e um {@link EligibilitySnapshot} (conjuntos já resolvidos da `Camada_Leitura`)
 * mais as convenções de anatomia, e devolve a lista completa de
 * {@link ValidationWarning}. É o coração reusado pela ficha do atleta (feedback
 * inline, R7), pelo salvamento (gate server-side, R9) e pela importação de seed
 * (etapas de regra, R15).
 *
 * Princípios (design · "Motor de validação"):
 * - Sem DOM, sem rede, sem I/O: opera apenas sobre o snapshot síncrono, o que o
 *   mantém barato de testar por PBT (a `Camada_Leitura` é mockada).
 * - Avisos classificados em **bloqueantes** (impedem salvar/exportar) e **não
 *   bloqueantes** ({@link WarningCode}s `INERT_EFFECT` e `ANATOMY_LIMIT`, que
 *   apenas informam — o jogador decide manter).
 * - Mensagens **específicas e legíveis** (R17.6): nomeiam o golpe/habilidade e
 *   reportam contagens reais, nunca números inventados.
 * - Cada aviso carrega um {@link ValidationWarning.target} para associação ARIA
 *   do controle correspondente (R17.7).
 *
 * Este arquivo implementa `validateAthlete` e os tipos/utilitários
 * compartilhados ({@link WarningCode}, {@link ValidationWarning},
 * {@link hasBlocking}), além das funções agregadoras de escalação, roster e
 * draft completo: {@link validateLineups}, {@link validateRoster} e
 * {@link validateDraft}.
 *
 * _Requirements: 2.4, 2.6, 5.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.3, 13.1,
 * 13.2, 13.4, 13.5, 17.6_
 */

import {
  anatomyWarning as defaultAnatomyWarning,
  type AnatomyConventions,
} from '../anatomy';
import {
  abilityInertKey,
  moveInertKey,
  type EligibilitySnapshot,
} from '../team/eligibility-adapter';
import type {
  AthleteDraft,
  LineupAssignment,
  LineupUnit,
  Role,
  TeamDraft,
} from '../team/model';

/** Número exato de golpes exigido por atleta (R6.4/R7.3). */
const REQUIRED_MOVE_COUNT = 4;

/**
 * Número de papéis/identidades distintas exigido por unidade preenchida: cada
 * unidade válida tem 11 papéis com 11 identidades distintas por snap
 * (R13.1/R13.2/R13.4).
 */
const REQUIRED_UNIT_IDENTITIES = 11;

/** Teto do roster: nunca excede 53 atletas (R2.3/R2.4). */
const ROSTER_CAP = 53;

/** Rótulo legível e estável de uma {@link LineupUnit} para mensagens (R17.6). */
const UNIT_LABELS: Readonly<Record<LineupUnit, string>> = {
  offense: 'Ataque',
  defense: 'Defesa',
  kickoff: 'Kickoff',
  kick_return: 'Kick Return',
  punt: 'Punt',
  punt_return: 'Punt Return',
  field_goal: 'Field Goal',
  field_goal_block: 'Field Goal Block',
};

/** Rótulo legível de uma unidade; cai para o próprio id se não mapeado. */
function unitLabel(unit: LineupUnit): string {
  return UNIT_LABELS[unit] ?? unit;
}

/**
 * Código canônico de um aviso de validação. Mapeia 1:1 com uma cláusula de
 * requisito (comentários), permitindo rastreabilidade entre aviso e regra.
 *
 * `INERT_EFFECT` e `ANATOMY_LIMIT` são os **únicos** códigos não bloqueantes;
 * todos os demais impedem salvar/exportar (ver {@link isBlockingCode}).
 */
export type WarningCode =
  | 'MOVE_NOT_LEARNABLE' // R7.1
  | 'ABILITY_NOT_AVAILABLE' // R7.2
  | 'MOVE_COUNT_NOT_FOUR' // R7.3
  | 'MOVE_DUPLICATE' // R7.4
  | 'SPECIES_NOT_ALLOWED' // R2.6
  | 'ROSTER_CAP_EXCEEDED' // R2.4
  | 'UNIT_INCOMPLETE' // R13.4
  | 'DUPLICATE_IDENTITY_SNAP' // R13.5
  | 'INERT_EFFECT' // R8.1 (aviso, não bloqueante)
  | 'ANATOMY_LIMIT'; // R5.3/R8 (aviso, não bloqueante)

/**
 * Alvo de um {@link ValidationWarning}, usado para associar o aviso por ARIA ao
 * controle que o originou (R17.7). O campo `kind` indica o nível do alvo; os
 * demais campos são opcionais e preenchidos conforme a relevância do aviso.
 */
export interface WarningTarget {
  /** Nível do alvo associado ao aviso. */
  kind: 'athlete' | 'move' | 'ability' | 'unit' | 'roster';
  /** Instância de atleta envolvida (quando aplicável). */
  instanceId?: number;
  /** Unidade de escalação envolvida (avisos de escalação). */
  unit?: LineupUnit;
  /** Papel envolvido dentro da unidade (avisos de escalação). */
  role?: Role;
  /** Golpe envolvido (avisos de golpe). */
  moveId?: number;
  /** Habilidade envolvida (avisos de habilidade). */
  abilityId?: number;
}

/**
 * Aviso de validação individual. É específico e legível (R17.6) e sempre
 * acompanha o {@link WarningTarget} para associação ARIA (R17.7).
 */
export interface ValidationWarning {
  /** Código canônico do aviso. */
  code: WarningCode;
  /** `true` quando o aviso impede salvar/exportar; `false` quando é informativo. */
  blocking: boolean;
  /** Mensagem específica e legível para o jogador (R17.6). */
  message: string;
  /** Alvo para associação ARIA ao controle correspondente (R17.7). */
  target: WarningTarget;
}

/**
 * Conjunto dos códigos **não bloqueantes**. Centraliza a classificação para que
 * a construção de avisos e o {@link hasBlocking} compartilhem a mesma regra.
 */
const NON_BLOCKING_CODES: ReadonlySet<WarningCode> = new Set<WarningCode>([
  'INERT_EFFECT',
  'ANATOMY_LIMIT',
]);

/**
 * Decide se um {@link WarningCode} é bloqueante. Todos os códigos são
 * bloqueantes, exceto `INERT_EFFECT` e `ANATOMY_LIMIT` (avisos informativos).
 */
export function isBlockingCode(code: WarningCode): boolean {
  return !NON_BLOCKING_CODES.has(code);
}

/**
 * Gate de persistência (R7.6/R9.3): há ao menos um aviso bloqueante na lista?
 * Salvar e exportar são permitidos se e somente se este predicado é `false`.
 */
export function hasBlocking(warnings: readonly ValidationWarning[]): boolean {
  return warnings.some((w) => w.blocking);
}

/**
 * Nome legível de um golpe a partir do snapshot; cai para `#id` quando a
 * `Camada_Leitura` não forneceu nome (ex.: id inexistente). Mantém a mensagem
 * específica sem inventar texto (R17.5/R17.6).
 */
function moveLabel(moveId: number, elig: EligibilitySnapshot): string {
  const name = elig.moveName.get(moveId);
  return name !== undefined ? `${name} (#${moveId})` : `#${moveId}`;
}

/**
 * Nome legível de uma habilidade a partir do snapshot; cai para `#id` quando a
 * `Camada_Leitura` não forneceu nome.
 */
function abilityLabel(abilityId: number, elig: EligibilitySnapshot): string {
  const name = elig.abilityName.get(abilityId);
  return name !== undefined ? `${name} (#${abilityId})` : `#${abilityId}`;
}

/**
 * Valida a ficha de um único atleta contra o snapshot de elegibilidade e as
 * convenções de anatomia, retornando **todos** os avisos aplicáveis.
 *
 * Avisos emitidos (design · "Motor de validação"):
 * - `MOVE_NOT_LEARNABLE` (bloqueante, R7.1): para **cada** golpe fora de
 *   `getLearnableMoveIds(pokemonId)`, nomeando o golpe.
 * - `ABILITY_NOT_AVAILABLE` (bloqueante, R7.2): se a habilidade está fora de
 *   `getAvailableAbilities(pokemonId)`, nomeando a habilidade.
 * - `MOVE_COUNT_NOT_FOUR` (bloqueante, R7.3): quando o número de golpes é
 *   diferente de quatro, reportando a **contagem atual**.
 * - `MOVE_DUPLICATE` (bloqueante, R7.4): para cada golpe repetido, nomeando-o.
 * - `INERT_EFFECT` (**não bloqueante**, R8.1/R8.3): para cada golpe/habilidade
 *   selecionado marcado como efeito inerte no snapshot; equipável, mas
 *   sinalizado como sem bônus esportivo.
 * - `ANATOMY_LIMIT` (**não bloqueante**, R5.3/R8.2): quando a função esportiva
 *   essencial da posição designada não é fisicamente cumprível pela espécie,
 *   conforme as convenções anatômicas; a atribuição permanece permitida.
 *
 * A função é pura: não lê rede nem DOM, e não muta `a` nem `elig`.
 *
 * @param a Ficha do atleta a validar.
 * @param elig Snapshot síncrono de elegibilidade da `Camada_Leitura`.
 * @param anat Convenções de anatomia (fonte única compartilhada com `lib/anatomy/`).
 * @returns Lista de avisos (vazia quando a ficha é válida e sem sinalizações).
 */
export function validateAthlete(
  a: AthleteDraft,
  elig: EligibilitySnapshot,
  anat: AnatomyConventions,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const learnable = elig.learnable.get(a.pokemonId) ?? new Set<number>();
  const available = elig.abilities.get(a.pokemonId) ?? new Set<number>();

  // R7.1 — golpes não aprendíveis pela espécie (um aviso por golpe).
  for (const moveId of a.moveIds) {
    if (!learnable.has(moveId)) {
      warnings.push({
        code: 'MOVE_NOT_LEARNABLE',
        blocking: true,
        message: `O golpe ${moveLabel(moveId, elig)} não é aprendível pela espécie #${a.pokemonId}.`,
        target: { kind: 'move', instanceId: a.instanceId, moveId },
      });
    }
  }

  // R7.2 — habilidade indisponível para a espécie.
  if (!available.has(a.abilityId)) {
    warnings.push({
      code: 'ABILITY_NOT_AVAILABLE',
      blocking: true,
      message: `A habilidade ${abilityLabel(a.abilityId, elig)} não está disponível para a espécie #${a.pokemonId}.`,
      target: { kind: 'ability', instanceId: a.instanceId, abilityId: a.abilityId },
    });
  }

  // R7.3 — exatamente quatro golpes, reportando a contagem atual.
  if (a.moveIds.length !== REQUIRED_MOVE_COUNT) {
    warnings.push({
      code: 'MOVE_COUNT_NOT_FOUR',
      blocking: true,
      message: `São exigidos exatamente ${REQUIRED_MOVE_COUNT} golpes; atualmente há ${a.moveIds.length}.`,
      target: { kind: 'athlete', instanceId: a.instanceId },
    });
  }

  // R7.4 — golpes repetidos (um aviso por golpe duplicado, nomeando-o).
  const seenMoves = new Set<number>();
  const reportedDuplicates = new Set<number>();
  for (const moveId of a.moveIds) {
    if (seenMoves.has(moveId) && !reportedDuplicates.has(moveId)) {
      reportedDuplicates.add(moveId);
      warnings.push({
        code: 'MOVE_DUPLICATE',
        blocking: true,
        message: `O golpe ${moveLabel(moveId, elig)} está repetido; os quatro golpes devem ser distintos.`,
        target: { kind: 'move', instanceId: a.instanceId, moveId },
      });
    }
    seenMoves.add(moveId);
  }

  // R8.1/R8.3 — efeito inerte em golpe selecionado (não bloqueante, sinalizado).
  for (const moveId of a.moveIds) {
    if (elig.inertEffects.has(moveInertKey(moveId))) {
      warnings.push({
        code: 'INERT_EFFECT',
        blocking: false,
        message: `O golpe ${moveLabel(moveId, elig)} é um efeito inerte: pode ser equipado, mas não produz bônus esportivo.`,
        target: { kind: 'move', instanceId: a.instanceId, moveId },
      });
    }
  }

  // R8.1/R8.3 — efeito inerte na habilidade selecionada (não bloqueante).
  if (elig.inertEffects.has(abilityInertKey(a.abilityId))) {
    warnings.push({
      code: 'INERT_EFFECT',
      blocking: false,
      message: `A habilidade ${abilityLabel(a.abilityId, elig)} é um efeito inerte: pode ser equipada, mas não produz bônus esportivo.`,
      target: { kind: 'ability', instanceId: a.instanceId, abilityId: a.abilityId },
    });
  }

  // R5.3/R8.2 — limitação anatômica da posição designada (não bloqueante).
  if (a.positionDesignation.trim().length > 0) {
    const finding = anat.anatomyWarning(a.pokemonId, a.positionDesignation);
    if (finding !== null) {
      warnings.push({
        code: 'ANATOMY_LIMIT',
        blocking: false,
        message: `A espécie #${a.pokemonId} não cumpre fisicamente ${finding.essentialFunction} em ${finding.position}: ${finding.reason}. A atribuição continua permitida.`,
        target: { kind: 'athlete', instanceId: a.instanceId },
      });
    }
  }

  return warnings;
}

/**
 * Convenções de anatomia padrão (fonte única de `lib/anatomy/`), oferecidas como
 * conveniência para chamadas que não injetam convenções próprias.
 */
export const DEFAULT_ANATOMY_CONVENTIONS: AnatomyConventions = {
  anatomyWarning: defaultAnatomyWarning,
};

// ---------------------------------------------------------------------------
// Validação de escalação, roster e agregação (tarefa 4.2).
// ---------------------------------------------------------------------------

/**
 * Agrega as atribuições de um `TeamDraft` por unidade, preservando a ordem em
 * que aparecem. Só são retornadas as unidades que têm **ao menos uma**
 * atribuição; uma unidade totalmente vazia (ex.: rascunho recém-criado) não
 * gera aviso de escalação, consistente com o design (apenas unidades iniciadas
 * mas incompletas disparam `UNIT_INCOMPLETE`).
 */
function groupAssignmentsByUnit(
  draft: TeamDraft,
): Map<LineupUnit, LineupAssignment[]> {
  const byUnit = new Map<LineupUnit, LineupAssignment[]>();
  for (const assignment of draft.lineups) {
    const bucket = byUnit.get(assignment.unit);
    if (bucket === undefined) {
      byUnit.set(assignment.unit, [assignment]);
    } else {
      bucket.push(assignment);
    }
  }
  return byUnit;
}

/**
 * Valida as escalações do time, emitindo avisos **bloqueantes** por unidade
 * iniciada (design · "Motor de validação"):
 *
 * - `DUPLICATE_IDENTITY_SNAP` (R13.5): quando a **mesma** identidade
 *   (`instanceId`) ocupa dois papéis na mesma unidade/snap. Um aviso por
 *   identidade repetida, nomeando a unidade e a instância.
 * - `UNIT_INCOMPLETE` (R13.4): quando uma unidade iniciada tem **menos de 11**
 *   identidades distintas; a mensagem nomeia a unidade e reporta quantos papéis
 *   ainda faltam (contagem real, nunca inventada — R17.6).
 *
 * Cada unidade válida tem 11 papéis com 11 identidades distintas por snap
 * (R13.1/R13.2). Unidades sem nenhuma atribuição não são avaliadas aqui: uma
 * escalação só é obrigatória quando o jogador começou a montá-la.
 *
 * Função pura: não lê rede nem DOM e não muta `draft`.
 *
 * @param draft Documento do time em edição.
 * @returns Lista de avisos de escalação (vazia quando toda unidade iniciada tem
 *   11 identidades distintas).
 */
export function validateLineups(draft: TeamDraft): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const byUnit = groupAssignmentsByUnit(draft);

  for (const [unit, assignments] of byUnit) {
    // Identidades distintas e detecção de duplicata dentro da unidade/snap.
    const distinctIdentities = new Set<number>();
    const reportedDuplicates = new Set<number>();
    for (const { instanceId } of assignments) {
      if (
        distinctIdentities.has(instanceId) &&
        !reportedDuplicates.has(instanceId)
      ) {
        reportedDuplicates.add(instanceId);
        warnings.push({
          code: 'DUPLICATE_IDENTITY_SNAP',
          blocking: true,
          message: `A identidade #${instanceId} ocupa mais de um papel na unidade ${unitLabel(unit)}; cada identidade pode ocupar apenas um papel por snap.`,
          target: { kind: 'unit', unit, instanceId },
        });
      }
      distinctIdentities.add(instanceId);
    }

    // Unidade iniciada mas com menos de 11 identidades distintas.
    if (distinctIdentities.size < REQUIRED_UNIT_IDENTITIES) {
      const pending = REQUIRED_UNIT_IDENTITIES - distinctIdentities.size;
      const plural = pending === 1 ? 'papel' : 'papéis';
      warnings.push({
        code: 'UNIT_INCOMPLETE',
        blocking: true,
        message: `A unidade ${unitLabel(unit)} tem ${distinctIdentities.size} de ${REQUIRED_UNIT_IDENTITIES} identidades distintas; falta(m) ${pending} ${plural} para completá-la.`,
        target: { kind: 'unit', unit },
      });
    }
  }

  return warnings;
}

/**
 * Valida o roster do time contra o snapshot de elegibilidade, emitindo avisos
 * **bloqueantes** (design · "Motor de validação"):
 *
 * - `SPECIES_NOT_ALLOWED` (R2.6): para **cada** atleta cujo `pokemonId` está
 *   fora de `elig.allowedSpecies`, identificando a espécie e a instância.
 * - `ROSTER_CAP_EXCEEDED` (R2.4): quando o roster ultrapassa {@link ROSTER_CAP}
 *   (53), reportando a contagem real.
 *
 * Função pura: não lê rede nem DOM e não muta `draft` nem `elig`.
 *
 * @param draft Documento do time em edição.
 * @param elig Snapshot síncrono de elegibilidade da `Camada_Leitura`.
 * @returns Lista de avisos de roster (vazia quando todas as espécies são
 *   permitidas e o teto não é excedido).
 */
export function validateRoster(
  draft: TeamDraft,
  elig: EligibilitySnapshot,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // R2.6 — espécie fora do conjunto permitido (um aviso por atleta).
  for (const athlete of draft.roster) {
    if (!elig.allowedSpecies.has(athlete.pokemonId)) {
      warnings.push({
        code: 'SPECIES_NOT_ALLOWED',
        blocking: true,
        message: `A espécie #${athlete.pokemonId} não está no conjunto de espécies permitidas.`,
        target: { kind: 'roster', instanceId: athlete.instanceId },
      });
    }
  }

  // R2.4 — teto do roster (53) excedido, reportando a contagem real.
  if (draft.roster.length > ROSTER_CAP) {
    warnings.push({
      code: 'ROSTER_CAP_EXCEEDED',
      blocking: true,
      message: `O roster tem ${draft.roster.length} atletas, acima do limite de ${ROSTER_CAP}.`,
      target: { kind: 'roster' },
    });
  }

  return warnings;
}

/**
 * Motor de validação completo do time em edição. Agrega, nesta ordem:
 * {@link validateAthlete} sobre **cada** atleta do roster, {@link validateLineups}
 * e {@link validateRoster}. É o ponto único de "válido" compartilhado pela ficha
 * (feedback inline), pelo salvamento (gate server-side, R9.3) e pela etapa de
 * regras do pipeline de importação (R15) — uma só definição evita divergência
 * entre UI e persistência.
 *
 * Função pura: não lê rede nem DOM e não muta nenhum argumento.
 *
 * @param draft Documento do time em edição.
 * @param elig Snapshot síncrono de elegibilidade da `Camada_Leitura`.
 * @param anat Convenções de anatomia (fonte única compartilhada com `lib/anatomy/`).
 * @returns Lista completa de avisos; use {@link hasBlocking} como gate de
 *   salvar/exportar.
 */
export function validateDraft(
  draft: TeamDraft,
  elig: EligibilitySnapshot,
  anat: AnatomyConventions,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const athlete of draft.roster) {
    warnings.push(...validateAthlete(athlete, elig, anat));
  }

  warnings.push(...validateLineups(draft));
  warnings.push(...validateRoster(draft, elig));

  return warnings;
}
