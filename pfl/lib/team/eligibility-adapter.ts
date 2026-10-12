/**
 * Adaptador de elegibilidade (`lib/team/eligibility-adapter.ts`).
 *
 * A spec `pfl-team-strategy-ui` **não** reimplementa catálogo: este módulo é um
 * adaptador fino sobre a `Camada_Leitura` (`lib/data/`) que
 *
 * 1. expõe uma {@link EligibilitySource} assíncrona memoizada por `pokemonId`,
 *    reusando `getAllowedSpecies`, `getLearnableMoveIds`, `getAvailableAbilities`,
 *    `getMove` e `getAbility`; e
 * 2. resolve um {@link EligibilitySnapshot} **síncrono** (conjuntos/mapas já
 *    materializados, incluindo nomes legíveis e os ids com efeito inerte) que
 *    alimenta os seletores da ficha e o motor de validação puro
 *    (`lib/validation/`).
 *
 * O motor de validação nunca recebe a fonte assíncrona: ele opera apenas sobre
 * o snapshot síncrono, o que o mantém puro e barato de testar (a `Camada_Leitura`
 * é mockada nos testes de propriedade, sem rede).
 *
 * A memoização por `pokemonId` garante que cada espécie seja consultada na
 * `Camada_Leitura` no máximo uma vez por instância de fonte, mesmo quando o
 * roster contém duplicatas de espécie (R2.2).
 *
 * _Requirements: 2.5, 6.2, 6.3, 17.5_
 */

import type { AbilityRecord, MoveRecord } from '../catalog/types';
import {
  getAvailableAbilities as readAvailableAbilities,
  getLearnableMoveIds as readLearnableMoveIds,
  type EligibilityDeps,
} from '../data/eligibility';
import { getAbility as readAbility, getMove as readMove } from '../data/registry';
import { getAllowedSpecies as readAllowedSpecies } from '../data/species';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fonte assíncrona de elegibilidade. Cada método projeta uma consulta da
 * `Camada_Leitura` para o formato consumido pelo adaptador. As assinaturas
 * refletem `pfl-data-catalog`:
 *
 * - `allowedSpeciesIds` → `getAllowedSpecies`
 * - `learnableMoveIds` → `getLearnableMoveIds`
 * - `availableAbilityIds` → `getAvailableAbilities`
 * - `move` → `getMove` (nome + `raw_data`)
 * - `ability` → `getAbility` (nome + `raw_data`)
 *
 * Espécie inexistente ou não permitida resolve para o **conjunto vazio** em
 * `learnableMoveIds`/`availableAbilityIds` (ausência tratada como "nada
 * elegível", nunca exceção) e `move`/`ability` resolvem `null` para ids
 * inexistentes.
 */
export interface EligibilitySource {
  /** Conjunto de `pokemon_id` permitidos (`is_allowed = true`). */
  allowedSpeciesIds(): Promise<Set<number>>;
  /** Conjunto de `move_id` aprendíveis pela espécie; vazio se ausente. */
  learnableMoveIds(pokemonId: number): Promise<Set<number>>;
  /** Conjunto de `ability_id` disponíveis à espécie; vazio se ausente. */
  availableAbilityIds(pokemonId: number): Promise<Set<number>>;
  /** Registro do golpe (nome, `raw_data`) ou `null` se inexistente. */
  move(moveId: number): Promise<MoveRecord | null>;
  /** Registro da habilidade (nome, `raw_data`) ou `null` se inexistente. */
  ability(abilityId: number): Promise<AbilityRecord | null>;
}

/**
 * Snapshot **síncrono** de elegibilidade: conjuntos e mapas já resolvidos a
 * partir da `Camada_Leitura`. É a fronteira pura consumida pelos seletores da
 * ficha e pelo motor de validação (`lib/validation/`).
 *
 * - `allowedSpecies`: `pokemon_id` permitidos.
 * - `learnable`: `pokemonId → { move_id }` aprendíveis.
 * - `abilities`: `pokemonId → { ability_id }` disponíveis.
 * - `moveName` / `abilityName`: nome legível por id (texto rastreável à
 *   `Camada_Leitura`, R17.5).
 * - `inertEffects`: ids (golpe/habilidade) sem regra executável — equipáveis,
 *   mas sinalizados como sem bônus (R8).
 */
export interface EligibilitySnapshot {
  allowedSpecies: ReadonlySet<number>;
  learnable: ReadonlyMap<number, ReadonlySet<number>>;
  abilities: ReadonlyMap<number, ReadonlySet<number>>;
  moveName: ReadonlyMap<number, string>;
  abilityName: ReadonlyMap<number, string>;
  inertEffects: ReadonlySet<string>;
}

/**
 * Dependências para construir a fonte de produção. O cliente Supabase é opcional
 * e injetável; quando omitido, cada consulta cria o cliente público de leitura
 * sob demanda (comportamento padrão das funções da `Camada_Leitura`).
 */
export interface CreateEligibilitySourceDeps {
  /** Cliente Supabase de leitura, compartilhado por todas as consultas. */
  readonly client?: SupabaseClient;
}

/**
 * Chave de efeito inerte para um golpe. Prefixada por tipo para evitar colisão
 * entre ids de golpe e de habilidade no mesmo conjunto `inertEffects`.
 */
export function moveInertKey(moveId: number): string {
  return `move:${moveId}`;
}

/**
 * Chave de efeito inerte para uma habilidade.
 */
export function abilityInertKey(abilityId: number): string {
  return `ability:${abilityId}`;
}

/**
 * Decide se o `raw_data` de um golpe/habilidade representa um **efeito inerte**
 * — isto é, sem regra executável para o motor de simulação.
 *
 * A convenção da `Camada_Leitura` marca efeitos inertes explicitamente no
 * `raw_data` (campo `pfl.inert` ou ausência de qualquer efeito mecânico). Como
 * `raw_data` é preservado fielmente (sem conversão), olhamos apenas por essa
 * marcação explícita e, na ausência de qualquer sinal, tratamos como **não
 * inerte** (o motor assume regra padrão). Isto mantém a honestidade de números:
 * só sinalizamos "sem bônus" quando a fonte diz que não há regra.
 */
export function isInertRawData(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') {
    return false;
  }
  const record = raw as Record<string, unknown>;
  const pfl = record['pfl'];
  if (pfl !== null && typeof pfl === 'object') {
    const inert = (pfl as Record<string, unknown>)['inert'];
    if (inert === true) {
      return true;
    }
  }
  return record['inert'] === true;
}

/**
 * Cria uma {@link EligibilitySource} de produção sobre a `Camada_Leitura`,
 * **memoizando por `pokemonId`** (e por id de golpe/habilidade) para que cada
 * entidade seja consultada no máximo uma vez por instância de fonte.
 *
 * Cada chamada guarda a `Promise` em cache, de modo que consultas concorrentes
 * para a mesma chave compartilham um único round-trip ao Supabase.
 */
export function createEligibilitySource(
  deps: CreateEligibilitySourceDeps = {},
): EligibilitySource {
  const eligDeps: EligibilityDeps = deps.client ? { client: deps.client } : {};
  const client = deps.client;

  let allowedCache: Promise<Set<number>> | undefined;
  const learnableCache = new Map<number, Promise<Set<number>>>();
  const abilityIdsCache = new Map<number, Promise<Set<number>>>();
  const moveCache = new Map<number, Promise<MoveRecord | null>>();
  const abilityCache = new Map<number, Promise<AbilityRecord | null>>();

  return {
    allowedSpeciesIds(): Promise<Set<number>> {
      if (allowedCache === undefined) {
        allowedCache = readAllowedSpecies(eligDeps).then(
          (species) => new Set(species.map((s) => s.pokemon_id)),
        );
      }
      return allowedCache;
    },

    learnableMoveIds(pokemonId: number): Promise<Set<number>> {
      const cached = learnableCache.get(pokemonId);
      if (cached !== undefined) {
        return cached;
      }
      const pending = readLearnableMoveIds(pokemonId, eligDeps).then((result) =>
        result.found ? new Set(result.value) : new Set<number>(),
      );
      learnableCache.set(pokemonId, pending);
      return pending;
    },

    availableAbilityIds(pokemonId: number): Promise<Set<number>> {
      const cached = abilityIdsCache.get(pokemonId);
      if (cached !== undefined) {
        return cached;
      }
      const pending = readAvailableAbilities(pokemonId, eligDeps).then((result) =>
        result.found ? new Set(result.value.map((a) => a.ability_id)) : new Set<number>(),
      );
      abilityIdsCache.set(pokemonId, pending);
      return pending;
    },

    move(moveId: number): Promise<MoveRecord | null> {
      const cached = moveCache.get(moveId);
      if (cached !== undefined) {
        return cached;
      }
      const query = client ? readMove(moveId, client) : readMove(moveId);
      const pending = query.then((result) => (result.found ? result.value : null));
      moveCache.set(moveId, pending);
      return pending;
    },

    ability(abilityId: number): Promise<AbilityRecord | null> {
      const cached = abilityCache.get(abilityId);
      if (cached !== undefined) {
        return cached;
      }
      const query = client ? readAbility(abilityId, client) : readAbility(abilityId);
      const pending = query.then((result) => (result.found ? result.value : null));
      abilityCache.set(abilityId, pending);
      return pending;
    },
  };
}

/**
 * Conjunto de entidades para as quais o snapshot deve resolver elegibilidade.
 * Normalmente derivado do `TeamDraft` em edição: as espécies do roster e os
 * golpes/habilidades referenciados pelas fichas.
 */
export interface SnapshotRequest {
  /** Espécies a resolver (aprendíveis + habilidades disponíveis). */
  readonly pokemonIds: Iterable<number>;
  /** Golpes a nomear/classificar quanto a efeito inerte. */
  readonly moveIds?: Iterable<number>;
  /** Habilidades a nomear/classificar quanto a efeito inerte. */
  readonly abilityIds?: Iterable<number>;
}

/**
 * Resolve um {@link EligibilitySnapshot} síncrono a partir de uma
 * {@link EligibilitySource}, para o conjunto de entidades solicitado.
 *
 * Faz as consultas assíncronas (memoizadas pela fonte) e materializa os
 * conjuntos/mapas resolvidos — incluindo `moveName`, `abilityName` e os ids com
 * efeito inerte (`inertEffects`) derivados do `raw_data` fiel. O resultado é
 * imutável do ponto de vista do consumidor (motor puro / seletores).
 *
 * Golpes/habilidades inexistentes na `Camada_Leitura` são silenciosamente
 * omitidos dos mapas de nome (não há nome legível para id ausente); a validação
 * posterior sinalizará o id como não aprendível/indisponível.
 */
export async function resolveEligibilitySnapshot(
  source: EligibilitySource,
  request: SnapshotRequest,
): Promise<EligibilitySnapshot> {
  const pokemonIds = dedupe(request.pokemonIds);
  const moveIds = dedupe(request.moveIds ?? []);
  const abilityIds = dedupe(request.abilityIds ?? []);

  const allowedSpecies = await source.allowedSpeciesIds();

  const learnable = new Map<number, ReadonlySet<number>>();
  const abilities = new Map<number, ReadonlySet<number>>();

  await Promise.all(
    pokemonIds.map(async (pokemonId) => {
      const [moves, abis] = await Promise.all([
        source.learnableMoveIds(pokemonId),
        source.availableAbilityIds(pokemonId),
      ]);
      learnable.set(pokemonId, moves);
      abilities.set(pokemonId, abis);
    }),
  );

  const moveName = new Map<number, string>();
  const abilityName = new Map<number, string>();
  const inertEffects = new Set<string>();

  await Promise.all([
    ...moveIds.map(async (moveId) => {
      const record = await source.move(moveId);
      if (record === null) {
        return;
      }
      moveName.set(moveId, record.name);
      if (isInertRawData(record.raw_data)) {
        inertEffects.add(moveInertKey(moveId));
      }
    }),
    ...abilityIds.map(async (abilityId) => {
      const record = await source.ability(abilityId);
      if (record === null) {
        return;
      }
      abilityName.set(abilityId, record.name);
      if (isInertRawData(record.raw_data)) {
        inertEffects.add(abilityInertKey(abilityId));
      }
    }),
  ]);

  return {
    allowedSpecies,
    learnable,
    abilities,
    moveName,
    abilityName,
    inertEffects,
  };
}

/**
 * Materializa um iterável de números em um array sem duplicatas, preservando a
 * ordem de aparição. Mantém as consultas determinísticas e evita round-trips
 * repetidos para a mesma chave.
 */
function dedupe(ids: Iterable<number>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
