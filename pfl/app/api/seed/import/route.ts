/**
 * Rota de importação de seed (`app/api/seed/import/route.ts`).
 *
 * `POST /api/seed/import` recebe os **bytes crus** de um `.pflseed.json` no
 * corpo da requisição, reconstitui server-side um {@link EligibilitySnapshot}
 * (via `lib/data/` → {@link createEligibilitySource}/
 * {@link resolveEligibilitySnapshot}) e executa o pipeline puro
 * {@link importSeed} da foundation (`lib/seed/import.ts`).
 *
 * - **Recusa** (`ok:false`): retorna **422** `{ ok:false, step, message }` e
 *   **não persiste nada** — o estado corrente do cliente é preservado (R15.11).
 * - **Sucesso** (`ok:true`): quando um `teamId` é informado (query `?teamId=`
 *   ou cabeçalho `x-team-id`), persiste o documento em `team_seeds`
 *   (`seed_document` jsonb, `schema_version`, `checksum_sha256`) e retorna
 *   **200** `{ ok:true, teamId }`. Sem `teamId`, a importação é validada e o
 *   draft é devolvido sem persistência (R15.1).
 *
 * A rota é a **fronteira impura**: lê o corpo, resolve a elegibilidade no
 * Supabase e persiste; o pipeline de validação em si (`importSeed`) é puro.
 *
 * _Requirements: 14.1, 15.1, 15.11_
 */

import { exportSeed } from '@/lib/seed/export';
import {
  importSeed,
  type ImportResult,
} from '@/lib/seed/import';
import {
  createEligibilitySource,
  resolveEligibilitySnapshot,
  type EligibilitySnapshot,
  type SnapshotRequest,
} from '@/lib/team/eligibility-adapter';
import { createPublicClient } from '@/lib/supabase/public-client';

// Executa exclusivamente no runtime Node do servidor (parity com /api/simulate).
export const runtime = 'nodejs';
// Rota puramente dinâmica (nunca pré-renderizada em build).
export const dynamic = 'force-dynamic';

/** `true` para objetos simples (não-nulos, não-arranjos). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Monta uma resposta JSON com corpo e status informados. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Snapshot de elegibilidade vazio, usado quando o pré-parse dos bytes falha
 * (ex.: JSON ilegível ou estrutura ausente). O {@link importSeed} então recusa
 * cedo em `PARSE`/`STRUCTURE`/`SIZE`, sem depender de dados do catálogo.
 */
const EMPTY_SNAPSHOT: EligibilitySnapshot = {
  allowedSpecies: new Set<number>(),
  learnable: new Map(),
  abilities: new Map(),
  moveName: new Map(),
  abilityName: new Map(),
  inertEffects: new Set<string>(),
};

/**
 * Pré-parseia os bytes do documento o suficiente para coletar as espécies,
 * golpes e habilidades referenciadas, de modo a resolver o
 * {@link EligibilitySnapshot} necessário para as etapas `ALLOWED_IDS`/`MOVES`/
 * `ABILITY` do pipeline. É best-effort: se o parse falhar, devolve `null` e o
 * chamador usa o snapshot vazio (o pipeline recusará em `PARSE`).
 */
function collectReferencedIds(rawBytes: Uint8Array): SnapshotRequest | null {
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.athletes)) {
    return null;
  }

  const pokemonIds = new Set<number>();
  const moveIds = new Set<number>();
  const abilityIds = new Set<number>();
  for (const rawAthlete of parsed.athletes) {
    if (!isObject(rawAthlete)) {
      continue;
    }
    if (typeof rawAthlete.pokemon_id === 'number') {
      pokemonIds.add(rawAthlete.pokemon_id);
    }
    if (typeof rawAthlete.ability_id === 'number') {
      abilityIds.add(rawAthlete.ability_id);
    }
    if (Array.isArray(rawAthlete.move_ids)) {
      for (const m of rawAthlete.move_ids) {
        if (typeof m === 'number') {
          moveIds.add(m);
        }
      }
    }
  }

  return { pokemonIds, moveIds, abilityIds };
}

/**
 * Lê o `teamId` opcional de destino, da query (`?teamId=`) ou do cabeçalho
 * `x-team-id`. Quando presente, a importação bem-sucedida persiste em
 * `team_seeds` sob esse time; quando ausente, apenas valida (R15.1).
 */
function readTeamId(request: Request): string | undefined {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('teamId');
  if (fromQuery !== null && fromQuery.length > 0) {
    return fromQuery;
  }
  const fromHeader = request.headers.get('x-team-id');
  if (fromHeader !== null && fromHeader.length > 0) {
    return fromHeader;
  }
  return undefined;
}

/**
 * Persiste o resultado de uma importação aprovada em `team_seeds`.
 *
 * A tabela da foundation exige `team_id` (FK a `user_teams`), `seed_document`
 * (jsonb), `schema_version` e `checksum_sha256`. Além disso, a CHECK
 * `team_seeds_required_fields` exige a chave `checksum` dentro do
 * `seed_document` — a foundation nomeia o checksum `checksum`, enquanto esta UI
 * o chama `checksum_sha256`. Para satisfazer a CHECK sem perder o documento
 * canônico, espelhamos o valor sob ambas as chaves no jsonb persistido (o
 * `checksum_sha256` canônico permanece íntegro e verificável).
 *
 * @returns `null` em sucesso; uma mensagem de erro legível em falha de I/O.
 */
async function persistTeamSeed(
  teamId: string,
  result: Extract<ImportResult, { ok: true }>,
): Promise<string | null> {
  const draft = result.draft;
  // Reexporta a partir do draft aprovado para obter o SeedDocument canônico com
  // checksum_sha256 recomputado (fonte única de verdade do documento).
  const document = exportSeed(draft);

  const seedDocument: Record<string, unknown> = {
    ...document,
    // Alias exigido pela CHECK `team_seeds_required_fields` da foundation.
    checksum: document.checksum_sha256,
  };

  const client = createPublicClient();
  const { error } = await client.from('team_seeds').insert({
    team_id: teamId,
    seed_document: seedDocument,
    schema_version: document.schema,
    checksum_sha256: document.checksum_sha256,
  });

  if (error !== null) {
    return error.message;
  }
  return null;
}

/**
 * Handler `POST /api/seed/import`.
 *
 * Fluxo:
 * 1. Lê o corpo cru (`arrayBuffer`) como `Uint8Array`.
 * 2. Pré-parseia para coletar ids referenciados e resolve o
 *    {@link EligibilitySnapshot} server-side (snapshot vazio se o parse falhar).
 * 3. Executa o pipeline puro {@link importSeed}.
 *    - Recusa → **422** `{ ok:false, step, message }`, sem persistir (R15.11).
 *    - Sucesso com `teamId` → persiste `team_seeds` e **200** `{ ok:true, teamId }`.
 *    - Sucesso sem `teamId` → **200** `{ ok:true }` (apenas validação).
 */
export async function POST(request: Request): Promise<Response> {
  const buffer = await request.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);

  // Resolve o snapshot de elegibilidade a partir dos ids referenciados.
  let elig: EligibilitySnapshot = EMPTY_SNAPSHOT;
  const referenced = collectReferencedIds(rawBytes);
  if (referenced !== null) {
    try {
      const source = createEligibilitySource();
      elig = await resolveEligibilitySnapshot(source, referenced);
    } catch (err) {
      return jsonResponse(
        {
          error: `falha ao resolver elegibilidade: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        500,
      );
    }
  }

  // Pipeline puro de importação.
  const result = importSeed(rawBytes, elig);

  if (!result.ok) {
    // Recusa: estado preservado, sem persistência (R15.11).
    return jsonResponse(
      {
        ok: false,
        step: result.reason.step,
        message: result.reason.message,
      },
      422,
    );
  }

  // Aprovada: persiste em team_seeds quando um time de destino é informado.
  const teamId = readTeamId(request);
  if (teamId !== undefined) {
    let persistError: string | null;
    try {
      persistError = await persistTeamSeed(teamId, result);
    } catch (err) {
      persistError = err instanceof Error ? err.message : String(err);
    }
    if (persistError !== null) {
      return jsonResponse(
        { error: `falha ao persistir team_seeds: ${persistError}` },
        500,
      );
    }
    return jsonResponse({ ok: true, teamId }, 200);
  }

  return jsonResponse({ ok: true }, 200);
}
