/**
 * Rota de exportação de seed (`app/api/seed/export/route.ts`).
 *
 * `POST /api/seed/export` recebe um {@link TeamDraft} (diretamente no corpo ou
 * sob `{ draft }`), invoca o núcleo puro {@link exportSeed} da foundation
 * (`lib/seed/export.ts`) e devolve o documento `.pflseed.json` resultante como
 * JSON, com um `Content-Disposition` sugerindo um nome de arquivo
 * `*.pflseed.json` para download (R14.1/R14.2).
 *
 * A rota é um adaptador fino: toda a canonicalização e o cálculo de checksum
 * vivem em `exportSeed`; aqui só validamos a **forma** do corpo e serializamos a
 * resposta. Corpo malformado → 400 `{ error }` sem produzir seed (R14.1).
 *
 * _Requirements: 14.1, 14.2_
 */

import { exportSeed } from '@/lib/seed/export';
import type {
  AthleteDraft,
  LineupAssignment,
  StrategyDraft,
  TeamDraft,
} from '@/lib/team/model';

// Executa exclusivamente no runtime Node do servidor (parity com /api/simulate).
export const runtime = 'nodejs';
// Rota puramente dinâmica (nunca pré-renderizada em build).
export const dynamic = 'force-dynamic';

/** `true` para objetos simples (não-nulos, não-arranjos). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Monta uma resposta de erro `{ error }` com o status informado. */
function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Valida a **forma** mínima de um {@link TeamDraft} necessária para o export:
 * `roster` (lista de atletas), `lineups` (lista de atribuições) e `strategy`
 * (estilos + prioridades como listas). Projeta num `TeamDraft` canônico. Em
 * qualquer desvio de forma, lança uma mensagem legível (→ 400).
 */
function validateDraftShape(raw: unknown): TeamDraft {
  if (!isObject(raw)) {
    throw new Error("o corpo deve ser um TeamDraft (ou { draft }) em JSON");
  }

  if (!Array.isArray(raw.roster)) {
    throw new Error("campo 'roster' deve ser uma lista de atletas");
  }
  const roster: AthleteDraft[] = raw.roster.map((rawAthlete, index) => {
    if (!isObject(rawAthlete)) {
      throw new Error(`atleta na posição ${index} não é um objeto`);
    }
    const { instanceId, pokemonId, abilityId, moveIds } = rawAthlete;
    if (
      typeof instanceId !== 'number' ||
      typeof pokemonId !== 'number' ||
      typeof abilityId !== 'number' ||
      !Array.isArray(moveIds) ||
      !moveIds.every((m) => typeof m === 'number')
    ) {
      throw new Error(
        `atleta na posição ${index} tem campos inválidos (instanceId, pokemonId, abilityId, moveIds)`,
      );
    }
    const positionDesignation =
      typeof rawAthlete.positionDesignation === 'string'
        ? rawAthlete.positionDesignation
        : '';
    return {
      instanceId,
      pokemonId,
      abilityId,
      moveIds: [...moveIds],
      positionDesignation,
    };
  });

  if (!Array.isArray(raw.lineups)) {
    throw new Error("campo 'lineups' deve ser uma lista de atribuições");
  }
  const lineups: LineupAssignment[] = raw.lineups.map((rawLineup, index) => {
    if (!isObject(rawLineup)) {
      throw new Error(`atribuição na posição ${index} não é um objeto`);
    }
    const { unit, role, instanceId } = rawLineup;
    if (
      typeof unit !== 'string' ||
      typeof role !== 'string' ||
      typeof instanceId !== 'number'
    ) {
      throw new Error(`atribuição na posição ${index} tem campos inválidos`);
    }
    return {
      unit: unit as LineupAssignment['unit'],
      role,
      instanceId,
    };
  });

  if (!isObject(raw.strategy)) {
    throw new Error("campo 'strategy' deve ser um objeto");
  }
  const {
    offenseStyle,
    defenseStyle,
    offensePlayPriority,
    defensePlayPriority,
  } = raw.strategy;
  if (
    typeof offenseStyle !== 'string' ||
    typeof defenseStyle !== 'string' ||
    !Array.isArray(offensePlayPriority) ||
    !Array.isArray(defensePlayPriority)
  ) {
    throw new Error("campo 'strategy' tem campos inválidos");
  }
  const strategy: StrategyDraft = {
    offenseStyle,
    defenseStyle,
    offensePlayPriority: [
      ...(offensePlayPriority as StrategyDraft['offensePlayPriority']),
    ],
    defensePlayPriority: [
      ...(defensePlayPriority as StrategyDraft['defensePlayPriority']),
    ],
  };

  const draft: TeamDraft = {
    name: typeof raw.name === 'string' ? raw.name : '',
    roster,
    lineups,
    strategy,
  };
  if (typeof raw.teamId === 'string') {
    draft.teamId = raw.teamId;
  }
  return draft;
}

/**
 * Handler `POST /api/seed/export`.
 *
 * Fluxo:
 * 1. **Parse** do corpo JSON (corpo malformado → 400).
 * 2. **Validação de forma** do `TeamDraft` (aceita o draft diretamente ou sob
 *    `{ draft }`); forma inválida → 400 `{ error }` (R14.1).
 * 3. **Núcleo puro** {@link exportSeed} produz o `SeedDocument` com checksum.
 * 4. **200** com o documento JSON e `Content-Disposition: attachment;
 *    filename="team.pflseed.json"` (R14.2).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('corpo da requisição não é JSON válido', 400);
  }

  // Aceita o draft diretamente ou aninhado sob `{ draft }`.
  const rawDraft =
    isObject(body) && 'draft' in body ? (body as { draft: unknown }).draft : body;

  let draft: TeamDraft;
  try {
    draft = validateDraftShape(rawDraft);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : 'TeamDraft inválido',
      400,
    );
  }

  const document = exportSeed(draft);

  return new Response(JSON.stringify(document), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="team.pflseed.json"',
    },
  });
}
