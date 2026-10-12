/**
 * Proxy fino de elegibilidade (`app/api/eligibility/route.ts`).
 *
 * Route Handler **GET** do App Router que expõe, ao cliente, os dados de
 * elegibilidade do catálogo **exclusivamente** a partir da `Camada_Leitura`
 * (`lib/data/`), reusando o {@link createEligibilitySource adaptador de
 * elegibilidade} (`lib/team/eligibility-adapter.ts`). É um **proxy fino**: não
 * contém lógica de catálogo própria — apenas delega às consultas de leitura e
 * serializa o resultado. Isto preserva a honestidade de números (R17.5): todo
 * valor devolvido é rastreável à `Camada_Leitura`, nunca inventado aqui.
 *
 * ## Contrato HTTP
 *
 * `GET /api/eligibility`
 *   → `200 { allowedSpecies: number[] }` — o conjunto de `pokemon_id`
 *     permitidos (`getAllowedSpecies`), ordenado de forma estável. (R2.5)
 *
 * `GET /api/eligibility?pokemonId=NN`
 *   → `200 { pokemonId, learnableMoves: Entry[], abilities: Entry[] }` — os
 *     golpes aprendíveis (`getLearnableMoveIds`) e as habilidades disponíveis
 *     (`getAvailableAbilities`) da espécie, cada um com `id` e `name` resolvido
 *     via `getMove`/`getAbility`. (R6.2, R6.3)
 *   → Espécie inexistente ou não permitida resolve para **conjuntos vazios**
 *     (ausência tratada como "nada elegível", nunca erro — alinhado ao
 *     adaptador).
 *   → `400 { error }` se `pokemonId` estiver presente mas malformado.
 *
 * `Entry = { id: number; name: string | null }` — `name` é `null` quando o id
 * não tem registro legível na `Camada_Leitura` (golpe/habilidade ausente).
 *
 * _Requirements: 2.5, 6.2, 6.3, 17.5_
 */

import {
  createEligibilitySource,
  resolveEligibilitySnapshot,
} from '@/lib/team/eligibility-adapter';

// Executa no runtime Node do servidor; o adaptador toca o Supabase de leitura.
export const runtime = 'nodejs';
// Rota puramente dinâmica (reflete o acervo persistido; nunca pré-renderizada).
export const dynamic = 'force-dynamic';

/** Entrada de elegibilidade: id e nome legível (ou `null` se ausente). */
interface EligibilityEntry {
  readonly id: number;
  readonly name: string | null;
}

/** Monta uma resposta JSON canônica com o status informado. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Parseia o parâmetro `pokemonId` da query string.
 *
 * - Ausente → `{ present: false }` (modo "espécies permitidas").
 * - Presente e inteiro não negativo → `{ present: true, value }`.
 * - Presente mas malformado → `{ present: true, invalid: true }` (→ 400).
 */
function parsePokemonId(
  raw: string | null,
): { present: false } | { present: true; value: number } | { present: true; invalid: true } {
  if (raw === null) {
    return { present: false };
  }
  const trimmed = raw.trim();
  // Apenas dígitos decimais: sem sinal, sem ponto, sem notação exponencial.
  if (!/^\d+$/.test(trimmed)) {
    return { present: true, invalid: true };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { present: true, invalid: true };
  }
  return { present: true, value };
}

/**
 * Handler `GET /api/eligibility`.
 *
 * Delega inteiramente à `Camada_Leitura` via o adaptador de elegibilidade:
 * sem `pokemonId`, materializa um snapshot só com o conjunto de espécies
 * permitidas; com `pokemonId`, resolve também os golpes aprendíveis e as
 * habilidades disponíveis daquela espécie (com nomes legíveis). Nenhuma regra
 * de catálogo é computada aqui.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = parsePokemonId(searchParams.get('pokemonId'));

  if (parsed.present && 'invalid' in parsed) {
    return jsonResponse(
      { error: "parâmetro 'pokemonId' deve ser um inteiro não negativo" },
      400,
    );
  }

  const source = createEligibilitySource();

  try {
    // Modo "espécies permitidas": sem pokemonId, só o conjunto permitido.
    if (!parsed.present) {
      const snapshot = await resolveEligibilitySnapshot(source, { pokemonIds: [] });
      const allowedSpecies = [...snapshot.allowedSpecies].sort((a, b) => a - b);
      return jsonResponse({ allowedSpecies });
    }

    // Modo "ficha da espécie": golpes aprendíveis + habilidades disponíveis.
    const { value: pokemonId } = parsed;

    // 1ª passagem: resolve os ids elegíveis para a espécie.
    const idsSnapshot = await resolveEligibilitySnapshot(source, {
      pokemonIds: [pokemonId],
    });
    const moveIds = [...(idsSnapshot.learnable.get(pokemonId) ?? [])].sort(
      (a, b) => a - b,
    );
    const abilityIds = [...(idsSnapshot.abilities.get(pokemonId) ?? [])].sort(
      (a, b) => a - b,
    );

    // 2ª passagem: resolve os nomes legíveis dos ids elegíveis (rastreáveis à
    // Camada_Leitura via getMove/getAbility). A fonte é memoizada, então a
    // reconsulta das espécies não gera round-trips adicionais.
    const namesSnapshot = await resolveEligibilitySnapshot(source, {
      pokemonIds: [pokemonId],
      moveIds,
      abilityIds,
    });

    const learnableMoves: EligibilityEntry[] = moveIds.map((id) => ({
      id,
      name: namesSnapshot.moveName.get(id) ?? null,
    }));
    const abilities: EligibilityEntry[] = abilityIds.map((id) => ({
      id,
      name: namesSnapshot.abilityName.get(id) ?? null,
    }));

    return jsonResponse({ pokemonId, learnableMoves, abilities });
  } catch (err) {
    // Falha de leitura (ex.: Supabase indisponível) → 500 sem valores inventados.
    const message = err instanceof Error ? err.message : 'erro inesperado';
    return jsonResponse(
      { error: `falha ao resolver elegibilidade: ${message}` },
      500,
    );
  }
}
