/**
 * Salvamento de time com revalidação server-side (`app/api/team/route.ts`).
 *
 * Route Handler **POST** do App Router que recebe um {@link TeamDraft}, **reexecuta
 * `validateDraft` no servidor** (o mesmo motor puro usado pela ficha e pelo
 * pipeline de importação) e **recusa persistir** se houver qualquer aviso
 * bloqueante (`hasBlocking`). Esta é a fronteira de confiança: o cliente nunca é
 * a autoridade sobre validade — o servidor revalida antes de tocar o banco
 * (R9.2, R9.3). Só quando a revalidação passa o time é persistido nas tabelas da
 * foundation e o sucesso é confirmado ao cliente (R9.4).
 *
 * ## Contrato HTTP
 *
 * `POST /api/team` com corpo JSON:
 *
 * ```jsonc
 * {
 *   "userId": "uuid-do-usuário",   // dono do time (user_teams.user_id, NOT NULL)
 *   "draft": TeamDraft             // documento do time em edição (lib/team/model)
 * }
 * ```
 *
 * - **200** `{ ok: true, teamId }` em sucesso: time persistido e confirmado (R9.4).
 * - **409** `{ error, warnings }` quando a revalidação encontra avisos
 *   **bloqueantes** — nada é persistido (R9.3). Os `warnings` acompanham a
 *   recusa para o cliente reexibir os motivos.
 * - **400** `{ error, field? }` para corpo malformado / forma inválida do draft,
 *   **sem** tocar o banco.
 * - **500** `{ error }` para falha de resolução de dados ou de persistência.
 *
 * ## Mapeamento de jogadas autoritativas
 *
 * A `strategy` da foundation guarda `offense_play_ids` / `defense_play_ids` como
 * `integer[]`. Os {@link PlayId} autoritativos (`O_RUN_INSIDE`, `D_RUN_FIT`, …)
 * são mapeados para esses inteiros pela **posição 1-based na ordem canônica do
 * `play_catalog_18.json`** (que coincide com {@link OFFENSE_PLAYS}/
 * {@link DEFENSE_PLAYS}). A **ordem das prioridades** do draft é preservada no
 * array persistido — o índice do array reflete a prioridade escolhida pelo
 * jogador (R12.3/R12.4). Decisão: não há tabela `play_catalog` na foundation,
 * então o id inteiro é o ordinal autoritativo do catálogo (1..6 por lado),
 * estável e recomputável a partir do `play_catalog_18.json`.
 *
 * _Requirements: 9.2, 9.3, 9.4_
 */

import { createPublicClient } from '@/lib/supabase/public-client';
import { createEligibilitySource } from '@/lib/team/eligibility-adapter';
import {
  OFFENSE_PLAYS,
  DEFENSE_PLAYS,
  type PlayId,
  type TeamDraft,
  type AthleteDraft,
  type LineupAssignment,
  type LineupUnit,
} from '@/lib/team/model';
import {
  saveTeam,
  BlockingValidationError,
} from '@/lib/team/persistence';

// Executa exclusivamente no runtime Node do servidor; o motor e o adaptador
// tocam o Supabase e nunca vão ao cliente.
export const runtime = 'nodejs';
// Rota puramente dinâmica (persistência; nunca pré-renderizada em build).
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Erro de validação de forma (campo + status) — nunca toca o banco
// ---------------------------------------------------------------------------

/** Erro de validação de forma do corpo da requisição; default 400. */
class BadRequestError extends Error {
  readonly field?: string;
  readonly httpStatus: number;

  constructor(message: string, field?: string, httpStatus = 400) {
    super(message);
    this.name = 'BadRequestError';
    this.field = field;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Helpers de validação de forma (apenas forma; a validade de regra é do motor)
// ---------------------------------------------------------------------------

/** `true` para objetos simples (não-nulos, não-arranjos). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Exige um inteiro finito, lançando com o campo em caso contrário. */
function requireInteger(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new BadRequestError(`campo '${field}' deve ser um inteiro`, field);
  }
  return v;
}

/** Exige uma string, lançando com o campo em caso contrário. */
function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') {
    throw new BadRequestError(`campo '${field}' deve ser uma string`, field);
  }
  return v;
}

/** Unidades de escalação reconhecidas (espelha o enum `lineup_unit`). */
const LINEUP_UNITS: readonly LineupUnit[] = [
  'offense',
  'defense',
  'kickoff',
  'kick_return',
  'punt',
  'punt_return',
  'field_goal',
  'field_goal_block',
] as const;

/** Valida a forma de um {@link AthleteDraft} e o projeta imutável. */
function parseAthlete(raw: unknown, field: string): AthleteDraft {
  if (!isObject(raw)) {
    throw new BadRequestError(`campo '${field}' é obrigatório`, field);
  }
  const instanceId = requireInteger(raw.instanceId, `${field}.instanceId`);
  const pokemonId = requireInteger(raw.pokemonId, `${field}.pokemonId`);
  const abilityId = requireInteger(raw.abilityId, `${field}.abilityId`);
  if (!Array.isArray(raw.moveIds)) {
    throw new BadRequestError(
      `campo '${field}.moveIds' deve ser um arranjo`,
      `${field}.moveIds`,
    );
  }
  const moveIds = raw.moveIds.map((m, i) =>
    requireInteger(m, `${field}.moveIds[${i}]`),
  );
  const positionDesignation = requireString(
    raw.positionDesignation,
    `${field}.positionDesignation`,
  );
  return { instanceId, pokemonId, abilityId, moveIds, positionDesignation };
}

/** Valida a forma de uma {@link LineupAssignment}. */
function parseLineup(raw: unknown, field: string): LineupAssignment {
  if (!isObject(raw)) {
    throw new BadRequestError(`campo '${field}' é obrigatório`, field);
  }
  const unit = requireString(raw.unit, `${field}.unit`) as LineupUnit;
  if (!LINEUP_UNITS.includes(unit)) {
    throw new BadRequestError(`campo '${field}.unit' inválido`, `${field}.unit`);
  }
  const role = requireString(raw.role, `${field}.role`);
  const instanceId = requireInteger(raw.instanceId, `${field}.instanceId`);
  return { unit, role, instanceId };
}

/** Valida uma permutação de {@link PlayId} contra o conjunto fixo esperado. */
function parsePlayPriority(
  raw: unknown,
  field: string,
  allowed: readonly PlayId[],
): PlayId[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestError(`campo '${field}' deve ser um arranjo`, field);
  }
  const set = new Set<PlayId>(allowed);
  const out: PlayId[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (typeof value !== 'string' || !set.has(value as PlayId)) {
      throw new BadRequestError(
        `campo '${field}[${i}]' não é um PlayId esperado`,
        `${field}[${i}]`,
      );
    }
    out.push(value as PlayId);
  }
  return out;
}

/**
 * Valida a forma do {@link TeamDraft} recebido e o projeta. Esta validação é de
 * **forma** apenas (tipos, presença). A validade de **regra** (golpes
 * aprendíveis, 4 golpes, 11 identidades, roster cap, …) é delegada ao motor
 * `validateDraft`, que reexecutamos server-side antes de persistir.
 */
function parseDraft(raw: unknown, field: string): TeamDraft {
  if (!isObject(raw)) {
    throw new BadRequestError(`campo '${field}' é obrigatório`, field);
  }
  const name = requireString(raw.name, `${field}.name`);

  if (!Array.isArray(raw.roster)) {
    throw new BadRequestError(`campo '${field}.roster' deve ser um arranjo`, `${field}.roster`);
  }
  const roster = raw.roster.map((a, i) => parseAthlete(a, `${field}.roster[${i}]`));

  if (!Array.isArray(raw.lineups)) {
    throw new BadRequestError(`campo '${field}.lineups' deve ser um arranjo`, `${field}.lineups`);
  }
  const lineups = raw.lineups.map((l, i) => parseLineup(l, `${field}.lineups[${i}]`));

  if (!isObject(raw.strategy)) {
    throw new BadRequestError(`campo '${field}.strategy' é obrigatório`, `${field}.strategy`);
  }
  const strategy = {
    offenseStyle: requireString(raw.strategy.offenseStyle, `${field}.strategy.offenseStyle`),
    defenseStyle: requireString(raw.strategy.defenseStyle, `${field}.strategy.defenseStyle`),
    offensePlayPriority: parsePlayPriority(
      raw.strategy.offensePlayPriority,
      `${field}.strategy.offensePlayPriority`,
      OFFENSE_PLAYS,
    ),
    defensePlayPriority: parsePlayPriority(
      raw.strategy.defensePlayPriority,
      `${field}.strategy.defensePlayPriority`,
      DEFENSE_PLAYS,
    ),
  };

  const draft: TeamDraft = { name, roster, lineups, strategy };
  if (typeof raw.teamId === 'string') {
    draft.teamId = raw.teamId;
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Respostas JSON canônicas
// ---------------------------------------------------------------------------

/** Monta uma resposta JSON canônica com o status informado. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ---------------------------------------------------------------------------
// Route Handler: POST /api/team
// ---------------------------------------------------------------------------

/**
 * Handler `POST /api/team`.
 *
 * Fluxo:
 * 1. **Parse** do corpo JSON (malformado → 400).
 * 2. **Validação de forma** do `userId` e do `draft` (`parseDraft`); forma
 *    inválida → 400 `{ error, field }`, sem tocar o banco.
 * 3. **Resolução de elegibilidade** server-side (via `lib/data/`) para as
 *    espécies/golpes/habilidades do draft, montando o `EligibilitySnapshot`.
 * 4. **Revalidação** com `validateDraft`; se `hasBlocking` → 409
 *    `{ error, warnings }`, **sem persistir** (R9.3).
 * 5. **Persistência** nas 5 tabelas da foundation; sucesso → 200
 *    `{ ok: true, teamId }` (R9.4).
 */
export async function POST(request: Request): Promise<Response> {
  // (1) Parse do corpo.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'corpo da requisição não é JSON válido', field: 'body' }, 400);
  }

  // (2) Validação de forma.
  let userId: string;
  let draft: TeamDraft;
  try {
    if (!isObject(body)) {
      throw new BadRequestError('corpo da requisição deve ser um objeto JSON');
    }
    userId = requireString(body.userId, 'userId');
    draft = parseDraft(body.draft, 'draft');
  } catch (err) {
    if (err instanceof BadRequestError) {
      const payload: Record<string, string> = { error: err.message };
      if (err.field !== undefined) {
        payload.field = err.field;
      }
      return jsonResponse(payload, err.httpStatus);
    }
    throw err;
  }

  // (3) Resolução de elegibilidade + (4) revalidação + (5) persistência.
  //
  // A orquestração mora em `lib/team/persistence.saveTeam`, que resolve o
  // snapshot server-side via a fonte injetada, reexecuta `validateDraft` e,
  // só então, persiste nas 5 tabelas da foundation. O handler apenas injeta as
  // dependências de produção e traduz o resultado em respostas HTTP.
  try {
    const result = await saveTeam(userId, draft, {
      client: createPublicClient(),
      eligibilitySource: createEligibilitySource(),
    });
    // (5) Persistência confirmada ao cliente (R9.4).
    return jsonResponse({ ok: true, teamId: result.teamId });
  } catch (err) {
    // (4) Gate de persistência: avisos bloqueantes recusam o salvamento (R9.3).
    if (err instanceof BlockingValidationError) {
      return jsonResponse(
        { error: err.message, warnings: err.warnings },
        409,
      );
    }
    const message = err instanceof Error ? err.message : 'erro inesperado';
    return jsonResponse({ error: `falha ao salvar o time: ${message}` }, 500);
  }
}
