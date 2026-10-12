/**
 * Presets copiáveis (`lib/presets/index.ts`).
 *
 * Carrega as quatro definições de preset dos arquivos `PRESET_*.json` em
 * `./data/` e expõe duas operações puras do design (seção "Presets"):
 * - {@link getPreset}: devolve a definição **somente-leitura** e profundamente
 *   congelada de um preset. Nunca é mutada — serve de molde canônico.
 * - {@link clonePresetToDraft}: produz um {@link TeamDraft} **editável**, com
 *   cópia profunda e **sem referências compartilhadas** com a definição
 *   congelada, anexando a proveniência adequada (R1.5/R10.2/R10.4).
 *
 * Os JSON de origem usam `instance_id` em string (ex.: `"balanced-o-01"`),
 * enquanto o modelo (`lib/team/model.ts`) usa `instanceId` numérico. Este
 * módulo mapeia cada `instance_id` para um número estável e determinístico
 * (índice do atleta no roster + 1) e reescreve as referências de escalação com
 * o **mesmo mapa**, garantindo consistência interna do draft (R2.1/R2.2).
 *
 * _Requirements: 1.3, 1.5, 10.1, 10.2, 10.3, 10.4, 11.4_
 */

import type {
  AthleteDraft,
  LineupAssignment,
  LineupUnit,
  PlayId,
  PresetId,
  PresetProvenance,
  StrategyDraft,
  TeamDraft,
} from '../team/model';

import balancedJson from './data/PRESET_BALANCED.json';
import groundJson from './data/PRESET_GROUND.json';
import aerialJson from './data/PRESET_AERIAL.json';
import curtiJson from './data/PRESET_CURTI.json';

/**
 * Definição somente-leitura de um preset, carregada dos `PRESET_*.json`.
 * (design · "Presets").
 */
export interface PresetDefinition {
  presetId: PresetId;
  name: string;
  roster: ReadonlyArray<Readonly<AthleteDraft>>;
  lineups: ReadonlyArray<Readonly<LineupAssignment>>;
  strategy: Readonly<StrategyDraft>;
}

/** Forma de um atleta no JSON de preset (campos relevantes ao modelo). */
interface RawAthlete {
  instance_id: string;
  pokemon_id: number;
  ability_id: number;
  move_ids: number[];
  position_designation: string;
}

/** Entrada de escalação no JSON de preset. */
interface RawLineupEntry {
  role: string;
  instance_id: string;
}

/** Forma relevante do JSON de preset (demais campos são ignorados aqui). */
interface RawPreset {
  preset_id: string;
  name: string;
  athletes: RawAthlete[];
  lineups: {
    offense: RawLineupEntry[];
    defense: RawLineupEntry[];
  };
  special_teams_lineups: {
    kickoff: RawLineupEntry[];
    kickoff_return: RawLineupEntry[];
    punt: RawLineupEntry[];
    punt_return: RawLineupEntry[];
    field_goal_pat: RawLineupEntry[];
    field_goal_block: RawLineupEntry[];
  };
  offense_style: string;
  defense_style: string;
  offense_plays: PlayId[];
  defense_plays: PlayId[];
}

/**
 * Mapeia as chaves de `special_teams_lineups` do JSON para as unidades do
 * modelo ({@link LineupUnit}).
 */
const SPECIAL_TEAMS_UNIT_MAP: ReadonlyArray<
  readonly [keyof RawPreset['special_teams_lineups'], LineupUnit]
> = [
  ['kickoff', 'kickoff'],
  ['kickoff_return', 'kick_return'],
  ['punt', 'punt'],
  ['punt_return', 'punt_return'],
  ['field_goal_pat', 'field_goal'],
  ['field_goal_block', 'field_goal_block'],
];

const RAW_PRESETS: Readonly<Record<PresetId, RawPreset>> = {
  balanced: balancedJson as unknown as RawPreset,
  ground: groundJson as unknown as RawPreset,
  aerial: aerialJson as unknown as RawPreset,
  curti: curtiJson as unknown as RawPreset,
};

/**
 * Congela profundamente um valor (objetos e arrays aninhados), tornando a
 * definição de preset imutável em runtime. Retorna o próprio valor para
 * encadeamento conveniente.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Converte um {@link RawPreset} em {@link PresetDefinition}, construindo um mapa
 * determinístico `instance_id` (string) → `instanceId` (número) a partir da
 * ordem do roster e reescrevendo todas as referências de escalação com ele.
 */
function buildDefinition(raw: RawPreset): PresetDefinition {
  // Mapa estável string→número: índice do atleta no roster + 1.
  const idMap = new Map<string, number>();
  raw.athletes.forEach((athlete, index) => {
    idMap.set(athlete.instance_id, index + 1);
  });

  const resolve = (instanceId: string): number => {
    const mapped = idMap.get(instanceId);
    if (mapped === undefined) {
      throw new Error(
        `Preset "${raw.preset_id}": instance_id "${instanceId}" referenciado em escalação não existe no roster.`,
      );
    }
    return mapped;
  };

  const roster: AthleteDraft[] = raw.athletes.map((a) => ({
    instanceId: resolve(a.instance_id),
    pokemonId: a.pokemon_id,
    abilityId: a.ability_id,
    moveIds: [...a.move_ids],
    positionDesignation: a.position_designation,
  }));

  const lineups: LineupAssignment[] = [];
  for (const entry of raw.lineups.offense) {
    lineups.push({ unit: 'offense', role: entry.role, instanceId: resolve(entry.instance_id) });
  }
  for (const entry of raw.lineups.defense) {
    lineups.push({ unit: 'defense', role: entry.role, instanceId: resolve(entry.instance_id) });
  }
  for (const [rawKey, unit] of SPECIAL_TEAMS_UNIT_MAP) {
    for (const entry of raw.special_teams_lineups[rawKey]) {
      lineups.push({ unit, role: entry.role, instanceId: resolve(entry.instance_id) });
    }
  }

  const strategy: StrategyDraft = {
    offenseStyle: raw.offense_style,
    defenseStyle: raw.defense_style,
    offensePlayPriority: [...raw.offense_plays],
    defensePlayPriority: [...raw.defense_plays],
  };

  return {
    presetId: raw.preset_id as PresetId,
    name: raw.name,
    roster,
    lineups,
    strategy,
  };
}

/**
 * Definições de preset carregadas e profundamente congeladas uma única vez.
 * Reutilizadas por {@link getPreset}; {@link clonePresetToDraft} nunca as muta.
 */
const DEFINITIONS: Readonly<Record<PresetId, PresetDefinition>> = deepFreeze({
  balanced: buildDefinition(RAW_PRESETS.balanced),
  ground: buildDefinition(RAW_PRESETS.ground),
  aerial: buildDefinition(RAW_PRESETS.aerial),
  curti: buildDefinition(RAW_PRESETS.curti),
});

/**
 * Devolve a definição somente-leitura e profundamente congelada do preset `id`.
 * Nunca é mutável — é o molde canônico compartilhado (design · "Presets").
 */
export function getPreset(id: PresetId): PresetDefinition {
  return DEFINITIONS[id];
}

/**
 * Produz a proveniência de um draft clonado do preset `id`. Para `curti`,
 * marca que as 22 titulares vêm da fonte histórica e que loadouts/ST/estratégia
 * são atribuição PFL (R10.3/R10.4).
 */
function buildProvenance(id: PresetId): PresetProvenance {
  if (id === 'curti') {
    return {
      presetId: 'curti',
      sourceStarters22: true,
      pflAssignedFields: ['abilities', 'moves', 'special_teams', 'strategy'],
    };
  }
  return { presetId: id };
}

/**
 * Clona o preset `id` num {@link TeamDraft} **editável**, com cópia profunda e
 * sem referências compartilhadas com a definição congelada. Copia estilos e
 * prioridades de jogada do preset (R11.4) e anexa a proveniência adequada
 * (R1.5/R10.2/R10.4).
 */
export function clonePresetToDraft(id: PresetId): TeamDraft {
  const def = getPreset(id);

  const roster: AthleteDraft[] = def.roster.map((a) => ({
    instanceId: a.instanceId,
    pokemonId: a.pokemonId,
    abilityId: a.abilityId,
    moveIds: [...a.moveIds],
    positionDesignation: a.positionDesignation,
  }));

  const lineups: LineupAssignment[] = def.lineups.map((l) => ({
    unit: l.unit,
    role: l.role,
    instanceId: l.instanceId,
  }));

  const strategy: StrategyDraft = {
    offenseStyle: def.strategy.offenseStyle,
    defenseStyle: def.strategy.defenseStyle,
    offensePlayPriority: [...def.strategy.offensePlayPriority],
    defensePlayPriority: [...def.strategy.defensePlayPriority],
  };

  return {
    name: def.name,
    roster,
    lineups,
    strategy,
    provenance: buildProvenance(id),
  };
}
