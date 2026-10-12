/**
 * `Funcao_Simulacao` — adaptador de backend server-only (`app/api/simulate/route.ts`).
 *
 * Esta é a **única camada impura** do `Motor_Simulacao` (a "fronteira de pureza"
 * do design): o Route Handler do Next.js que recebe a requisição HTTP, **valida
 * forma e faixas**, **resolve dados** via a Camada_Leitura (`lib/data/`), monta
 * um `ResolvedInput` **imutável**, invoca o **núcleo puro** `simulate` e devolve
 * `{ log, score }` serializado de forma **estável** (`stableStringify`). O núcleo
 * (`lib/sim/*`) nunca é exposto ao cliente — ele só é importado aqui, no
 * servidor (R15.1, R15.6).
 *
 * ## Contrato HTTP
 *
 * `POST /api/simulate` com corpo JSON `SimulateRequest`:
 *
 * ```jsonc
 * {
 *   "home":  { "units": { "offense": [...], "defense": [...], "specialTeams": [...] }, "teamSeedId"?: "..." },
 *   "away":  { ... },
 *   "strategyHome": { "preset": "BALANCED" | "GROUND" | "AERIAL" | "CURTI", ... },
 *   "strategyAway": { ... },
 *   "seed": "12345",          // decimal (string ou number), 0 .. 2^64-1
 *   "botModeHome"?: "random" | "curti" | "seeded",
 *   "botModeAway"?: "random" | "curti" | "seeded"
 * }
 * ```
 *
 * - **200** `{ log, score }` em caso de sucesso (R15.3).
 * - **400** `{ error, field? }` para qualquer entrada inválida/incompleta,
 *   **sem executar a partida** (R1.6, R12.5, R12.6, R15.4). O `field` identifica
 *   o campo inválido (ex.: `"seed"`, `"home.units.offense[0].moveIds"`,
 *   `"botModeHome"`).
 * - **500** `{ error }` para falha de resolução de dados (ex.: Supabase
 *   indisponível) ou erro inesperado do núcleo.
 *
 * ## Fronteira de pureza
 *
 * Toda a entropia e toda a I/O vivem **aqui**: parse do corpo, validação,
 * leitura do Supabase (`getDesignBaseline`, `getMove`, `getAbility`,
 * `getNflMatchups`). O núcleo recebe uma `ResolvedInput` autossuficiente e
 * devolve um `SimulationResult` determinístico — mesma entrada ⇒ mesmo
 * `{ log, score }` byte a byte (R15.5), herdado do determinismo do núcleo.
 *
 * _Requirements: 1.6, 12.5, 12.6, 15.1, 15.2, 15.3, 15.4, 15.6_
 */

import { simulate } from '@/lib/sim/simulate';
import { stableStringify } from '@/lib/sim/log';
import { SUPPORTED_BOT_MODES } from '@/lib/sim/bots';
import type {
  AthleteStats,
  Baseline,
  BotMode,
  EffectStatus,
  FatigueParameters,
  PassParameters,
  Position,
  Preset,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  RunParameters,
  SimulationParameters,
  Strategy,
  Weather,
  WeatherModifiers,
} from '@/lib/sim/types';
import { getDesignBaseline, getNflMatchups } from '@/lib/data/rules';
import { getMove, getAbility } from '@/lib/data/registry';
import { createPublicClient } from '@/lib/supabase/public-client';
import type { DesignBaselineRow } from '@/lib/catalog/types';

// Executa exclusivamente no runtime Node do servidor; o núcleo nunca vai ao
// cliente (R15.1, R15.6).
export const runtime = 'nodejs';
// Rota puramente dinâmica (nunca pré-renderizada em build).
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Constantes de validação de faixa
// ---------------------------------------------------------------------------

/** Limite inferior do `Seed_RNG` (inclusive). */
const SEED_MIN = 0n;
/** Limite superior do `Seed_RNG`: 2^64 - 1 (inclusive). */
const SEED_MAX = 2n ** 64n - 1n;

/** Presets de estratégia reconhecidos (os quatro estilos do catálogo). */
const SUPPORTED_PRESETS: readonly Preset[] = [
  'BALANCED',
  'GROUND',
  'AERIAL',
  'CURTI',
] as const;

/** Posições funcionais reconhecidas pelo `Validador_Funcoes`. */
const SUPPORTED_POSITIONS: readonly Position[] = [
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
] as const;

/** Unidades de escalação exigidas em toda `LineupInput`. */
const REQUIRED_UNITS = ['offense', 'defense', 'specialTeams'] as const;
type RequiredUnit = (typeof REQUIRED_UNITS)[number];

// ---------------------------------------------------------------------------
// Tipos de entrada (contrato de requisição)
// ---------------------------------------------------------------------------

/** Atleta de entrada (forma crua recebida no corpo da requisição). */
interface AthleteInput {
  readonly instanceId: number;
  readonly pokemonId: number;
  readonly types: ReadonlyArray<string>;
  readonly stats: AthleteStats;
  readonly abilityId: number;
  readonly moveIds: readonly number[];
  readonly additionalEffectIds?: ReadonlyArray<string>;
  readonly positionDesignation: string;
}

/** Escalação de entrada: atletas por unidade de jogo. */
interface LineupInput {
  readonly teamSeedId?: string;
  readonly units: Readonly<Record<RequiredUnit, ReadonlyArray<AthleteInput>>>;
}

/** Estratégia de entrada: preset de estilo + prioridades opcionais. */
interface StrategyInput {
  readonly preset: string;
  readonly playWeights?: Readonly<Record<string, number>>;
  readonly priorities?: Readonly<Record<string, number>>;
}

/**
 * Corpo da requisição `POST /api/simulate` (`SimulateRequest`). O `seed` aceita
 * `string` (decimal) **ou** `number` para preservar a precisão do uint64 — a
 * forma preferida é string decimal, pois `number` só representa inteiros com
 * segurança até 2^53-1.
 */
interface SimulateRequest {
  readonly home: LineupInput;
  readonly away: LineupInput;
  readonly strategyHome: StrategyInput;
  readonly strategyAway: StrategyInput;
  readonly seed: string | number;
  readonly botModeHome?: string;
  readonly botModeAway?: string;
}

// ---------------------------------------------------------------------------
// Erro de validação (campo + mensagem) — nunca executa a partida
// ---------------------------------------------------------------------------

/**
 * Erro de validação de entrada do adaptador. Carrega o `field` inválido (R15.4)
 * e, opcionalmente, um `status` HTTP (default 400). Lançar este erro **antes**
 * de invocar o núcleo garante que nenhuma partida inicia com entrada inválida.
 */
class ValidationError extends Error {
  readonly field?: string;
  readonly httpStatus: number;

  constructor(message: string, field?: string, httpStatus = 400) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Helpers de validação de forma
// ---------------------------------------------------------------------------

/** `true` para objetos simples (não-nulos, não-arranjos). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Exige que `v` seja um número finito; caso contrário, lança com o campo. */
function requireFiniteNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(`campo '${field}' deve ser um número finito`, field);
  }
  return v;
}

/** Exige que `v` seja um inteiro finito; caso contrário, lança com o campo. */
function requireInteger(v: unknown, field: string): number {
  const n = requireFiniteNumber(v, field);
  if (!Number.isInteger(n)) {
    throw new ValidationError(`campo '${field}' deve ser um inteiro`, field);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Validação e parse do Seed_RNG (R1.6, R15.4, R12.5)
// ---------------------------------------------------------------------------

/**
 * Valida e parseia o `Seed_RNG` para `bigint`, verificando presença, forma e
 * faixa `[0, 2^64 - 1]`. Aceita `string` decimal (preferida, preserva uint64)
 * ou `number` inteiro seguro. Rejeita ausência, forma inválida, valor não
 * inteiro, negativo ou fora de faixa — **sem** executar a partida (R1.6).
 *
 * @param raw Valor cru do campo `seed`.
 * @param field Nome do campo (para a mensagem de erro; default `"seed"`).
 * @returns O seed como `bigint` em `[0n, 2^64 - 1n]`.
 * @throws {ValidationError} Para seed ausente/inválida/fora de faixa.
 */
function parseSeed(raw: unknown, field = 'seed'): bigint {
  if (raw === undefined || raw === null) {
    throw new ValidationError("campo 'seed' é obrigatório", field);
  }

  let seed: bigint;
  if (typeof raw === 'bigint') {
    seed = raw;
  } else if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new ValidationError(
        "campo 'seed' numérico deve ser um inteiro",
        field,
      );
    }
    if (!Number.isSafeInteger(raw)) {
      // Fora do alcance seguro de number: exija string decimal p/ preservar uint64.
      throw new ValidationError(
        "campo 'seed' excede o inteiro seguro; envie-o como string decimal",
        field,
      );
    }
    seed = BigInt(raw);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // Apenas dígitos decimais (uint): sem sinal, sem ponto, sem notação exp.
    if (!/^\d+$/.test(trimmed)) {
      throw new ValidationError(
        "campo 'seed' deve ser um inteiro decimal não negativo",
        field,
      );
    }
    try {
      seed = BigInt(trimmed);
    } catch {
      throw new ValidationError("campo 'seed' não é interpretável", field);
    }
  } else {
    throw new ValidationError(
      "campo 'seed' deve ser string decimal ou number inteiro",
      field,
    );
  }

  if (seed < SEED_MIN || seed > SEED_MAX) {
    throw new ValidationError(
      "campo 'seed' fora da faixa [0, 2^64 - 1]",
      field,
    );
  }
  return seed;
}

// ---------------------------------------------------------------------------
// Validação de estratégia e modo de bot
// ---------------------------------------------------------------------------

/**
 * Valida uma `StrategyInput` e a projeta na `Strategy` do núcleo. Exige o
 * `preset` entre os quatro estilos suportados; preset desconhecido → 400 (R15.4).
 */
function validateStrategy(raw: unknown, field: string): Strategy {
  if (!isObject(raw)) {
    throw new ValidationError(`campo '${field}' é obrigatório`, field);
  }
  const preset = raw.preset;
  if (typeof preset !== 'string' || !SUPPORTED_PRESETS.includes(preset as Preset)) {
    throw new ValidationError(
      `campo '${field}.preset' inválido (esperado um de ${SUPPORTED_PRESETS.join(', ')})`,
      `${field}.preset`,
    );
  }
  const strategy: Strategy = {
    preset: preset as Preset,
    ...(isObject(raw.playWeights)
      ? { playWeights: raw.playWeights as Record<string, number> }
      : {}),
    ...(isObject(raw.priorities)
      ? { priorities: raw.priorities as Record<string, number> }
      : {}),
  };
  return strategy;
}

/**
 * Valida o modo de bot opcional. Ausente ⇒ `undefined` (controlador não é bot).
 * Valor presente deve ser um dos três suportados; caso contrário → 400 com
 * `field` = o nome do campo e mensagem "modo inválido" (R12.6).
 */
function validateBotMode(raw: unknown, field: string): BotMode | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (
    typeof raw !== 'string' ||
    !SUPPORTED_BOT_MODES.includes(raw as BotMode)
  ) {
    throw new ValidationError('modo inválido', field);
  }
  return raw as BotMode;
}

// ---------------------------------------------------------------------------
// Validação de atleta e escalação (R15.4)
// ---------------------------------------------------------------------------

/** As seis estatísticas base exigidas em `AthleteInput.stats`. */
const STAT_KEYS: readonly (keyof AthleteStats)[] = [
  'hp',
  'attack',
  'defense',
  'specialAttack',
  'specialDefense',
  'speed',
] as const;

/** Valida as stats de um atleta, exigindo os seis campos numéricos finitos. */
function validateStats(raw: unknown, field: string): AthleteStats {
  if (!isObject(raw)) {
    throw new ValidationError(`campo '${field}' é obrigatório`, field);
  }
  const out = {} as { -readonly [K in keyof AthleteStats]: number };
  for (const key of STAT_KEYS) {
    out[key] = requireFiniteNumber(raw[key], `${field}.${key}`);
  }
  return out;
}

/**
 * Valida um `AthleteInput` e o projeta num `ResolvedAthlete` imutável. Exige
 * `instanceId`/`pokemonId`/`abilityId` inteiros, exatamente **4 golpes**
 * (`moveIds`), `types` como arranjo de strings, posição reconhecida e stats
 * completas. Falha com `field` apontando o atleta inválido (R15.4).
 */
function validateAthlete(raw: unknown, field: string): ResolvedAthlete {
  if (!isObject(raw)) {
    throw new ValidationError(`campo '${field}' é obrigatório`, field);
  }

  const instanceId = requireInteger(raw.instanceId, `${field}.instanceId`);
  const pokemonId = requireInteger(raw.pokemonId, `${field}.pokemonId`);
  const abilityId = requireInteger(raw.abilityId, `${field}.abilityId`);

  if (
    !Array.isArray(raw.types) ||
    !raw.types.every((t): t is string => typeof t === 'string')
  ) {
    throw new ValidationError(
      `campo '${field}.types' deve ser um arranjo de strings`,
      `${field}.types`,
    );
  }

  if (!Array.isArray(raw.moveIds) || raw.moveIds.length !== 4) {
    throw new ValidationError(
      `campo '${field}.moveIds' deve conter exatamente 4 golpes`,
      `${field}.moveIds`,
    );
  }
  const moveIds = raw.moveIds.map((m, i) =>
    requireInteger(m, `${field}.moveIds[${i}]`),
  ) as [number, number, number, number];

  const posRaw = raw.positionDesignation;
  if (
    typeof posRaw !== 'string' ||
    !SUPPORTED_POSITIONS.includes(posRaw as Position)
  ) {
    throw new ValidationError(
      `campo '${field}.positionDesignation' inválido`,
      `${field}.positionDesignation`,
    );
  }

  let additionalEffectIds: ReadonlyArray<string> = [];
  if (raw.additionalEffectIds !== undefined) {
    if (
      !Array.isArray(raw.additionalEffectIds) ||
      !raw.additionalEffectIds.every((e): e is string => typeof e === 'string')
    ) {
      throw new ValidationError(
        `campo '${field}.additionalEffectIds' deve ser um arranjo de strings`,
        `${field}.additionalEffectIds`,
      );
    }
    additionalEffectIds = raw.additionalEffectIds;
  }

  return Object.freeze<ResolvedAthlete>({
    instanceId,
    pokemonId,
    types: Object.freeze([...raw.types]),
    stats: validateStats(raw.stats, `${field}.stats`),
    abilityId,
    moveIds,
    additionalEffectIds: Object.freeze([...additionalEffectIds]),
    positionDesignation: posRaw as Position,
  });
}

/**
 * Valida uma `LineupInput` e a projeta numa `ResolvedLineup` imutável. Exige as
 * três unidades (`offense`/`defense`/`specialTeams`) como arranjos de atletas, e
 * garante `instance_id` **único por time** entre todas as unidades (R15.4).
 */
function validateLineup(raw: unknown, field: string): ResolvedLineup {
  if (!isObject(raw)) {
    throw new ValidationError(`campo '${field}' é obrigatório`, field);
  }
  const unitsRaw = raw.units;
  if (!isObject(unitsRaw)) {
    throw new ValidationError(`campo '${field}.units' é obrigatório`, `${field}.units`);
  }

  const units = {} as {
    -readonly [K in RequiredUnit]: ReadonlyArray<ResolvedAthlete>;
  };
  const seenInstanceIds = new Set<number>();

  for (const unit of REQUIRED_UNITS) {
    const arr = unitsRaw[unit];
    if (!Array.isArray(arr)) {
      throw new ValidationError(
        `campo '${field}.units.${unit}' deve ser um arranjo de atletas`,
        `${field}.units.${unit}`,
      );
    }
    const athletes = arr.map((a, i) =>
      validateAthlete(a, `${field}.units.${unit}[${i}]`),
    );
    for (const athlete of athletes) {
      if (seenInstanceIds.has(athlete.instanceId)) {
        throw new ValidationError(
          `instance_id duplicado (${athlete.instanceId}) em '${field}'; deve ser único por time`,
          `${field}.units.${unit}`,
        );
      }
      seenInstanceIds.add(athlete.instanceId);
    }
    units[unit] = Object.freeze(athletes);
  }

  const teamSeedId = raw.teamSeedId;
  if (teamSeedId !== undefined && typeof teamSeedId !== 'string') {
    throw new ValidationError(
      `campo '${field}.teamSeedId' deve ser uma string`,
      `${field}.teamSeedId`,
    );
  }

  return Object.freeze<ResolvedLineup>({
    ...(typeof teamSeedId === 'string' ? { teamSeedId } : {}),
    units: Object.freeze(units),
  });
}

// ---------------------------------------------------------------------------
// Mapeamento do design_baseline (payload do Supabase) → Baseline do núcleo
// ---------------------------------------------------------------------------

/**
 * `payload` cru de `design_baseline` com `kind='simulation_parameters'`. Reflete
 * o arquivo `simulation_parameters.json` do Catálogo (campos aninhados em
 * `probability`, nomes `catch`/`fumble_probability`/`active_snap` etc.).
 */
interface SimParamsPayload {
  readonly tick_s: number;
  readonly play_timeout_s: number;
  readonly suppression_radius_yards: number;
  readonly quarter_seconds: number;
  readonly weather: Record<string, number>;
  readonly weather_modifiers: Record<string, Record<string, number>>;
  readonly probability: { base: number; difference_coefficient: number; min: number; max: number };
  readonly skill_mod_max_abs: number;
  readonly fatigue: {
    active_snap: number;
    extreme_action: number;
    inactive_snap_recovery: number;
    max_penalty: number;
  };
  readonly run: {
    gain_formula?: string;
    loss_if_gap_lost_min: number;
    loss_if_gap_lost_max: number;
  };
  readonly pass: {
    short_target_yards: [number, number];
    deep_target_yards: [number, number];
  };
}

/** Uma entrada do `payload` de `design_baseline` com `kind='matchups_36'`. */
interface MatchupPayloadEntry {
  readonly offense: string;
  readonly defense: string;
  readonly offense_probability_delta: number;
}

/**
 * Mapeia o payload de `simulation_parameters` para o `SimulationParameters` do
 * núcleo, reconciliando as diferenças de nome entre o arquivo de design e os
 * contratos imutáveis do núcleo:
 *
 * - `probability.{base,difference_coefficient,min,max}` → campos de topo;
 * - `weather_modifiers.RAIN.catch` → `.RAIN.reception`; `.fumble_probability` → `.fumble`;
 *   `.COLD.catch` → `.COLD.reception`; `HEAT.fatigue_per_snap_add` → `.HEAT.fatigue_per_snap`;
 * - `fatigue.active_snap` → `fatigue.active`; o `inactive_snap_recovery` do núcleo
 *   é a variação assinada (recuperação negativa), então **negamos** o valor
 *   positivo do arquivo;
 * - `run`: `base=2`, `coef=4` (constantes da fórmula `2+round(4*clamp(...))`),
 *   e os limites de perda vêm de `loss_if_gap_lost_min/max`;
 * - `pass.{short,deep}` ← `short_target_yards`/`deep_target_yards`.
 */
function mapSimulationParameters(payload: SimParamsPayload): SimulationParameters {
  const wm = payload.weather_modifiers;
  const weatherModifiers: WeatherModifiers = {
    RAIN: {
      reception: wm.RAIN?.catch ?? 0,
      fumble: wm.RAIN?.fumble_probability ?? 0,
    },
    WIND: {
      deep_pass: wm.WIND?.deep_pass ?? 0,
      long_kick: wm.WIND?.long_kick ?? 0,
    },
    HEAT: {
      fatigue_per_snap: wm.HEAT?.fatigue_per_snap_add ?? 0,
    },
    COLD: {
      reception: wm.COLD?.catch ?? 0,
    },
  };

  const fatigue: FatigueParameters = {
    active: payload.fatigue.active_snap,
    extreme_action: payload.fatigue.extreme_action,
    // O núcleo trata a recuperação como variação assinada (negativa). O arquivo
    // guarda a magnitude positiva; negamos para obter a variação aplicada.
    inactive_snap_recovery: -Math.abs(payload.fatigue.inactive_snap_recovery),
    max_penalty: payload.fatigue.max_penalty,
  };

  const run: RunParameters = {
    base: 2,
    coef: 4,
    loss_min: payload.run.loss_if_gap_lost_min,
    loss_max: payload.run.loss_if_gap_lost_max,
  };

  const pass: PassParameters = {
    short: [payload.pass.short_target_yards[0], payload.pass.short_target_yards[1]],
    deep: [payload.pass.deep_target_yards[0], payload.pass.deep_target_yards[1]],
  };

  const weather = payload.weather as Record<Weather, number>;

  return {
    base: payload.probability.base,
    difference_coefficient: payload.probability.difference_coefficient,
    min: payload.probability.min,
    max: payload.probability.max,
    skill_mod_max_abs: payload.skill_mod_max_abs,
    tick_s: payload.tick_s,
    quarter_seconds: payload.quarter_seconds,
    play_timeout_s: payload.play_timeout_s,
    suppression_radius_yards: payload.suppression_radius_yards,
    weather,
    weather_modifiers: weatherModifiers,
    fatigue,
    run,
    pass,
  };
}

/**
 * Converte o payload de `matchups_36` no mapa `${offense}|${defense}` →
 * `offense_probability_delta` esperado pelo núcleo (`Baseline.matchups`).
 */
function mapMatchups(entries: ReadonlyArray<MatchupPayloadEntry>): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (
      typeof e.offense !== 'string' ||
      typeof e.defense !== 'string' ||
      typeof e.offense_probability_delta !== 'number'
    ) {
      continue; // ignora entradas malformadas de forma defensiva
    }
    const key: `${string}|${string}` = `${e.offense}|${e.defense}`;
    map.set(key, e.offense_probability_delta);
  }
  return map;
}

/**
 * Resolve o `Baseline` do núcleo a partir do Supabase. Lê, sob a mesma `version`
 * de design, os dois artefatos de `design_baseline` (`simulation_parameters` e
 * `matchups_36`) e os mapeia nos contratos imutáveis do núcleo.
 *
 * O `getDesignBaseline` da Camada_Leitura devolve o registro de baseline mais
 * recente (origem versionada); a partir da sua `version`, buscamos ambos os
 * `kind` dessa versão para montar o `Baseline` completo. A leitura é read-only e
 * só toca o Supabase.
 */
async function resolveBaseline(client: ReturnType<typeof createPublicClient>): Promise<Baseline> {
  // Descobre a versão corrente do baseline (registro mais recente).
  const latest = await getDesignBaseline(undefined, { client });
  if (latest === null) {
    throw new ValidationError(
      'design_baseline ausente: nenhum baseline de design persistido',
      undefined,
      500,
    );
  }
  const version = latest.version;

  // Busca ambos os artefatos (simulation_parameters + matchups_36) da versão.
  const { data, error } = await client
    .from('design_baseline')
    .select('version, kind, status, payload, created_at')
    .eq('version', version);

  if (error !== null) {
    throw new ValidationError(
      `falha ao ler design_baseline: ${error.message}`,
      undefined,
      500,
    );
  }

  const rows = (data ?? []) as unknown as DesignBaselineRow[];
  const paramsRow = rows.find((r) => r.kind === 'simulation_parameters');
  const matchupsRow = rows.find((r) => r.kind === 'matchups_36');

  if (paramsRow === undefined) {
    throw new ValidationError(
      `design_baseline da versão '${version}' sem simulation_parameters`,
      undefined,
      500,
    );
  }
  if (matchupsRow === undefined) {
    throw new ValidationError(
      `design_baseline da versão '${version}' sem matchups_36`,
      undefined,
      500,
    );
  }

  const simParams = mapSimulationParameters(paramsRow.payload as SimParamsPayload);
  const matchups = mapMatchups(matchupsRow.payload as ReadonlyArray<MatchupPayloadEntry>);

  // `status` do baseline: usa o do artefato de parâmetros (congelado no MVP).
  return Object.freeze<Baseline>({
    version,
    status: paramsRow.status,
    simulationParameters: simParams,
    matchups,
  });
}

/**
 * Resolve a tabela de disposição de efeitos adicionais. No MVP, todo efeito
 * adicional declarado nas escalações é tratado como **inerte-com-aviso**: cada
 * `additionalEffectId` presente recebe o status `INERT_WITH_WARNING`, de modo
 * que a política de inércia do núcleo aplique zero bônus e registre o motivo.
 */
function resolveEffectDisposition(
  home: ResolvedLineup,
  away: ResolvedLineup,
): ReadonlyMap<string, EffectStatus> {
  const map = new Map<string, EffectStatus>();
  for (const lineup of [home, away]) {
    for (const unit of REQUIRED_UNITS) {
      for (const athlete of lineup.units[unit]) {
        for (const effectId of athlete.additionalEffectIds) {
          if (!map.has(effectId)) {
            map.set(effectId, 'INERT_WITH_WARNING');
          }
        }
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Resolução de dados do catálogo (verifica existência de golpes/habilidades)
// ---------------------------------------------------------------------------

/**
 * Verifica, via a Camada_Leitura (`getMove`/`getAbility`), que todo golpe e toda
 * habilidade referenciados nas escalações existem no catálogo persistido. Um id
 * inexistente é um dado de entrada inválido → 400 com o campo (R15.4). A leitura
 * é read-only e só toca o Supabase; o `{found}` do contrato nunca lança.
 */
async function assertCatalogReferences(
  home: ResolvedLineup,
  away: ResolvedLineup,
  client: ReturnType<typeof createPublicClient>,
): Promise<void> {
  const moveIds = new Set<number>();
  const abilityIds = new Set<number>();
  for (const lineup of [home, away]) {
    for (const unit of REQUIRED_UNITS) {
      for (const athlete of lineup.units[unit]) {
        for (const m of athlete.moveIds) moveIds.add(m);
        abilityIds.add(athlete.abilityId);
      }
    }
  }

  for (const moveId of moveIds) {
    const result = await getMove(moveId, client);
    if (!result.found) {
      throw new ValidationError(
        `golpe inexistente no catálogo: move_id ${moveId}`,
        'moveIds',
      );
    }
  }
  for (const abilityId of abilityIds) {
    const result = await getAbility(abilityId, client);
    if (!result.found) {
      throw new ValidationError(
        `habilidade inexistente no catálogo: ability_id ${abilityId}`,
        'abilityId',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Validação total da requisição → ResolvedInput imutável
// ---------------------------------------------------------------------------

/** Resultado da validação de forma: as partes já projetadas nos tipos do núcleo. */
interface ValidatedRequest {
  readonly home: ResolvedLineup;
  readonly away: ResolvedLineup;
  readonly strategyHome: Strategy;
  readonly strategyAway: Strategy;
  readonly botModeHome?: BotMode;
  readonly botModeAway?: BotMode;
  readonly seed: bigint;
}

/**
 * Validação **total** da forma e das faixas do corpo da requisição (R15.4). Não
 * toca o Supabase nem o núcleo: apenas valida e projeta nos tipos do núcleo. Em
 * qualquer campo inválido, lança `ValidationError` com o campo — a partida não
 * inicia e nenhum valor é substituído silenciosamente.
 */
function validateRequest(body: unknown): ValidatedRequest {
  if (!isObject(body)) {
    throw new ValidationError('corpo da requisição deve ser um objeto JSON');
  }

  const seed = parseSeed((body as Partial<SimulateRequest>).seed, 'seed');
  const home = validateLineup(body.home, 'home');
  const away = validateLineup(body.away, 'away');
  const strategyHome = validateStrategy(body.strategyHome, 'strategyHome');
  const strategyAway = validateStrategy(body.strategyAway, 'strategyAway');
  const botModeHome = validateBotMode(body.botModeHome, 'botModeHome');
  const botModeAway = validateBotMode(body.botModeAway, 'botModeAway');

  return {
    home,
    away,
    strategyHome,
    strategyAway,
    ...(botModeHome !== undefined ? { botModeHome } : {}),
    ...(botModeAway !== undefined ? { botModeAway } : {}),
    seed,
  };
}

// ---------------------------------------------------------------------------
// Respostas JSON canônicas
// ---------------------------------------------------------------------------

/** Monta uma resposta de erro `{ error, field? }` com o status informado. */
function errorResponse(message: string, status: number, field?: string): Response {
  const body: Record<string, string> = { error: message };
  if (field !== undefined) {
    body.field = field;
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ---------------------------------------------------------------------------
// Route Handler: POST /api/simulate
// ---------------------------------------------------------------------------

/**
 * Handler `POST /api/simulate` da `Funcao_Simulacao`.
 *
 * Fluxo (espelha o `flowchart` do design):
 * 1. **Parse** do corpo JSON (corpo malformado → 400).
 * 2. **Validação total** de forma e faixas (`validateRequest`): seed, escalações
 *    (4 golpes, instance_id único), estratégias e modo de bot. Qualquer invalidez
 *    → 400 `{ error, field }`, **sem executar a partida** (R1.6, R12.5, R12.6, R15.4).
 * 3. **Resolução de dados** via `lib/data/` (`getDesignBaseline` + leitura dos
 *    dois artefatos de baseline, `getMove`/`getAbility` para integridade, gancho
 *    `getNflMatchups`); montagem do `ResolvedInput` **imutável**.
 * 4. **Núcleo puro** `simulate(resolvedInput)`; serialização estável do log.
 * 5. **200** `{ log, score }` (R15.3). Determinismo ⇒ mesma entrada = mesma saída (R15.5).
 *
 * @param request Requisição HTTP POST com corpo `SimulateRequest`.
 * @returns `Response` JSON: 200 em sucesso, 400 em entrada inválida, 500 em falha de resolução.
 */
export async function POST(request: Request): Promise<Response> {
  // (1) Parse do corpo. Corpo não-JSON/ausente → 400 sem executar a partida.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('corpo da requisição não é JSON válido', 400, 'body');
  }

  // (2) Validação total (forma + faixas). Falhas → 400 { error, field }.
  let validated: ValidatedRequest;
  try {
    validated = validateRequest(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.httpStatus, err.field);
    }
    throw err;
  }

  // (3) Resolução de dados (impura) + montagem do ResolvedInput imutável.
  let resolvedInput: ResolvedInput;
  try {
    const client = createPublicClient();
    const [baseline, nflMatchups] = await Promise.all([
      resolveBaseline(client),
      // Gancho de calibração NFL (não aplicado no MVP) — resolvido e anexado,
      // mas o núcleo o trata como identidade.
      getNflMatchups({ client }),
    ]);

    // Integridade referencial: golpes/habilidades devem existir no catálogo.
    await assertCatalogReferences(validated.home, validated.away, client);

    const effectDisposition = resolveEffectDisposition(
      validated.home,
      validated.away,
    );

    resolvedInput = Object.freeze<ResolvedInput>({
      home: validated.home,
      away: validated.away,
      strategyHome: validated.strategyHome,
      strategyAway: validated.strategyAway,
      ...(validated.botModeHome !== undefined
        ? { botModeHome: validated.botModeHome }
        : {}),
      ...(validated.botModeAway !== undefined
        ? { botModeAway: validated.botModeAway }
        : {}),
      baseline,
      effectDisposition,
      nflMatchups: Object.freeze([...nflMatchups]),
      seed: validated.seed,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      // Erros de resolução (ex.: baseline ausente) carregam o status embutido.
      return errorResponse(err.message, err.httpStatus, err.field);
    }
    const message = err instanceof Error ? err.message : 'erro ao resolver dados';
    return errorResponse(`falha ao resolver dados: ${message}`, 500);
  }

  // (4) Núcleo puro + (5) resposta estável { log, score }.
  try {
    const result = simulate(resolvedInput);
    // Serialização estável do payload { log, score } (JSON canônico, byte a byte).
    const payload = stableStringify({
      log: result.log as unknown,
      score: result.score as unknown,
    } as unknown);
    return new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro inesperado na simulação';
    return errorResponse(`falha na simulação: ${message}`, 500);
  }
}
