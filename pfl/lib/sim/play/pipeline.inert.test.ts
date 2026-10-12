/**
 * Property 30 — Efeito inerte não altera o resultado da jogada
 * (`lib/sim/play/pipeline.inert.test.ts`).
 *
 * Arquivo DEDICADO a Property 30 (Task 10.5). Verifica que equipar efeitos
 * adicionais inertes (todos inertes no MVP) nos atletas da unidade ofensiva
 * **não altera o resultado** da jogada: para a mesma `(estado, entrada,
 * políticas, seed)`, a resolução (`resolution`), as jogadas escolhidas
 * (`offensePlay`/`defensePlay`) e o eventual aborto (`aborted`) são
 * byte-idênticos entre a versão COM efeitos equipados e a versão SEM efeitos
 * (`additionalEffectIds` vazio). A única diferença permitida no log é a
 * presença de eventos extra `POWER_INERT` na versão com efeitos — e esses
 * eventos devem ser exatamente `POWER_INERT` carregando `inert = true`.
 *
 * Valida R9.3 (zero bônus a qualquer atributo), R9.5 (`Propriedades_Naturais`
 * preservadas: os stats não são tocados, logo o resultado não muda), R9.6
 * (nenhuma mecânica/bônus/penalidade aplicada) e R9.7 (regras universais fixas:
 * a inércia não injeta efeito ativo). O efeito é equipável, mas inócuo.
 *
 * Pureza: toda a aleatoriedade vem do `Rng` injetado (`createRng(seed)`);
 * efeitos inertes **não consomem RNG** (o laço de disposição apenas registra),
 * de modo que a ordem fixa de consumo do RNG (Property 5) é preservada e as
 * duas execuções caminham sobre a mesma trajetória de entropia.
 */

// Feature: pfl-simulation-engine, Property 30

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { resolvePlay, type PlayPolicies, type PipelineLogEvent } from './pipeline';
import { PLAY_CATALOG, createSituationalPolicy } from './select';
import { createRng } from '../rng';
import { createInitialState } from '../state';
import type {
  AthleteStats,
  Baseline,
  EffectStatus,
  Position,
  Preset,
  ResolvedAthlete,
  ResolvedInput,
  ResolvedLineup,
  SimulationParameters,
  Strategy,
  Team,
  Weather,
} from '../types';
import { PBT_NUM_RUNS } from '../test-setup';

// ---------------------------------------------------------------------------
// Baseline congelado do MVP (mesmos valores de design usados nas demais suítes)
// ---------------------------------------------------------------------------

const BASELINE_PARAMS: SimulationParameters = {
  base: 0.5,
  difference_coefficient: 0.45,
  min: 0.05,
  max: 0.95,
  skill_mod_max_abs: 0.15,
  tick_s: 0.1,
  quarter_seconds: 900,
  play_timeout_s: 30,
  suppression_radius_yards: 2,
  weather: { CLEAR: 0.4, RAIN: 0.2, WIND: 0.15, HEAT: 0.15, COLD: 0.1 },
  weather_modifiers: {
    RAIN: { reception: -0.04, fumble: 0.02 },
    WIND: { deep_pass: -0.05, long_kick: -0.05 },
    HEAT: { fatigue_per_snap: 0.002 },
    COLD: { reception: -0.02 },
  },
  fatigue: {
    active: 0.003,
    extreme_action: 0.005,
    inactive_snap_recovery: 0.001,
    max_penalty: 0.12,
  },
  run: { base: 2, coef: 4, loss_min: -4, loss_max: -1 },
  pass: { short: [3, 10], deep: [12, 35] },
};

/** Baseline sem deltas de matchup (todos neutros) — foca a prova na inércia. */
const BASELINE: Baseline = {
  version: 'D1-design-2026-10-09',
  status: 'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED',
  simulationParameters: BASELINE_PARAMS,
  matchups: new Map<string, number>(),
};

// ---------------------------------------------------------------------------
// Construção de atletas, lineups e entrada resolvida
// ---------------------------------------------------------------------------

/** Posições das unidades padrão de ataque e defesa (QB/RB garantem ação-chave). */
const OFFENSE_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'C'];
const DEFENSE_POSITIONS: readonly Position[] = ['DL', 'LB', 'CB', 'S'];

/**
 * Monta um `ResolvedAthlete` bem-formado. `pokemonId = 1` (sem exceção
 * anatômica aprovada) garante que a validação anatômica trate QB/RB/C de forma
 * padrão. `additionalEffectIds` é injetado pelo chamador.
 */
function makeAthlete(
  instanceId: number,
  position: Position,
  stats: AthleteStats,
  additionalEffectIds: ReadonlyArray<string>,
): ResolvedAthlete {
  return {
    instanceId,
    pokemonId: 1,
    types: ['NORMAL'],
    stats,
    abilityId: 1,
    moveIds: [1, 2, 3, 4],
    additionalEffectIds,
    positionDesignation: position,
  };
}

/**
 * Constrói o `ResolvedLineup` de um time. `effectsByOffenseIndex` fornece os
 * efeitos adicionais de cada atleta da unidade ofensiva (vazio = sem efeito).
 * A defesa nunca recebe efeitos (o pipeline só resolve inércia da ofensiva).
 */
function makeLineup(
  teamOffset: number,
  stats: AthleteStats,
  effectsByOffenseIndex: ReadonlyArray<ReadonlyArray<string>>,
): ResolvedLineup {
  const offense = OFFENSE_POSITIONS.map((position, i) =>
    makeAthlete(
      teamOffset + i,
      position,
      stats,
      effectsByOffenseIndex[i] ?? [],
    ),
  );
  const defense = DEFENSE_POSITIONS.map((position, i) =>
    makeAthlete(teamOffset + 10 + i, position, stats, []),
  );
  return {
    units: {
      offense,
      defense,
      specialTeams: [],
    },
  };
}

/**
 * Monta uma `ResolvedInput` completa. `offenseEffects` são os efeitos
 * adicionais do time em posse (`home`), por índice de atleta ofensivo;
 * `dispositionTable` é a tabela de disposição consultada pela inércia.
 */
function makeInput(
  seed: bigint,
  preset: Preset,
  stats: AthleteStats,
  offenseEffects: ReadonlyArray<ReadonlyArray<string>>,
  dispositionTable: ReadonlyMap<string, EffectStatus>,
): ResolvedInput {
  const strategy: Strategy = { preset };
  return {
    home: makeLineup(0, stats, offenseEffects),
    away: makeLineup(100, stats, []),
    strategyHome: strategy,
    strategyAway: strategy,
    baseline: BASELINE,
    effectDisposition: dispositionTable,
    seed,
  };
}

/** Políticas situacionais iguais para os dois times (determinísticas). */
function makePolicies(preset: Preset): PlayPolicies {
  const policy = createSituationalPolicy({ preset });
  return { home: policy, away: policy };
}

// ---------------------------------------------------------------------------
// Normalização para comparação byte a byte do resultado (sem os logs)
// ---------------------------------------------------------------------------

/** Serializa o `fatigueDelta` (Map) de forma estável para comparação. */
function fatigueEntries(
  delta: ReadonlyMap<number, number> | undefined,
): ReadonlyArray<readonly [number, number]> {
  if (delta === undefined) return [];
  return [...delta.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Projeta o `PlayOutcome` no seu RESULTADO comparável (tudo exceto os logs):
 * jogadas escolhidas + resolução completa + eventual aborto. É este objeto que
 * deve ser idêntico entre a versão com e sem efeitos (R9.3/R9.6).
 */
function resultProjection(outcome: ReturnType<typeof resolvePlay>) {
  const r = outcome.resolution;
  return {
    offensePlay: outcome.offensePlay,
    defensePlay: outcome.defensePlay,
    resolution: {
      yardsGained: r.yardsGained ?? null,
      clockDeci: r.clockDeci ?? null,
      pointsScored: r.pointsScored ?? null,
      scoringTeam: r.scoringTeam ?? null,
      possessionChanges: r.possessionChanges ?? null,
      nextPhase: r.nextPhase ?? null,
      ballPos: r.ballPos ?? null,
      fatigueDelta: fatigueEntries(r.fatigueDelta),
    },
    aborted: outcome.aborted ?? null,
  };
}

/** Eventos de log que NÃO são `POWER_INERT` (os únicos que podem diferir). */
function nonInertEvents(
  events: ReadonlyArray<PipelineLogEvent>,
): ReadonlyArray<PipelineLogEvent> {
  return events.filter((e) => e.type !== 'POWER_INERT');
}

// ---------------------------------------------------------------------------
// Geradores (fast-check)
// ---------------------------------------------------------------------------

/** `Seed_RNG` em todo o domínio uint64. */
const seedArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: (1n << 64n) - 1n,
});

/** Presets de estratégia disponíveis. */
const presetArb = fc.constantFrom<Preset>(
  'BALANCED',
  'GROUND',
  'AERIAL',
  'CURTI',
);

const weatherArb = fc.constantFrom<Weather>(
  'CLEAR',
  'RAIN',
  'WIND',
  'HEAT',
  'COLD',
);

const possessionArb = fc.constantFrom<Team>('home', 'away');

/** Stats base dentro de faixas plausíveis (iguais entre as duas execuções). */
const statsArb: fc.Arbitrary<AthleteStats> = fc.record({
  hp: fc.integer({ min: 20, max: 150 }),
  attack: fc.integer({ min: 20, max: 150 }),
  defense: fc.integer({ min: 20, max: 150 }),
  specialAttack: fc.integer({ min: 20, max: 150 }),
  specialDefense: fc.integer({ min: 20, max: 150 }),
  speed: fc.integer({ min: 20, max: 150 }),
});

/** Identificador de efeito adicional arbitrário (não vazio). */
const effectIdArb = fc.string({ minLength: 1, maxLength: 8 });

/**
 * Efeitos adicionais por atleta ofensivo (um array por posição ofensiva). Cada
 * atleta pode portar de 0 a 3 efeitos arbitrários. Pelo menos um atleta
 * portará pelo menos um efeito (filtrado no corpo da propriedade quando vazio).
 */
const offenseEffectsArb: fc.Arbitrary<ReadonlyArray<ReadonlyArray<string>>> =
  fc.array(fc.array(effectIdArb, { minLength: 0, maxLength: 3 }), {
    minLength: OFFENSE_POSITIONS.length,
    maxLength: OFFENSE_POSITIONS.length,
  });

/**
 * Tabela de disposição arbitrária: alguns efeitos registrados como
 * `INERT_WITH_WARNING`, outros com status versionado arbitrário, outros
 * ausentes (sem disposição aprovada). Em todos os casos o pipeline os trata
 * como inertes — o que varia é apenas o `powerReason` logado.
 */
const dispositionArb: fc.Arbitrary<ReadonlyMap<string, EffectStatus>> = fc
  .array(
    fc.tuple(
      effectIdArb,
      fc.constantFrom<EffectStatus>('INERT_WITH_WARNING', 'SOME_OTHER_STATUS'),
    ),
    { maxLength: 8 },
  )
  .map((entries) => new Map<string, EffectStatus>(entries));

// ---------------------------------------------------------------------------
// Property 30
// ---------------------------------------------------------------------------

describe('Property 30 — efeito inerte não altera o resultado da jogada', () => {
  it('o RESULTADO (jogadas + resolução + aborto) é idêntico com e sem efeitos equipados', () => {
    fc.assert(
      fc.property(
        seedArb,
        presetArb,
        weatherArb,
        possessionArb,
        statsArb,
        offenseEffectsArb,
        dispositionArb,
        (seed, preset, weather, possession, stats, offenseEffects, disposition) => {
          const state = { ...createInitialState({ weather }), possession };
          const policies = makePolicies(preset);
          const options = { catalog: PLAY_CATALOG } as const;

          // COM efeitos: unidade ofensiva do time em posse carrega os efeitos.
          const inputWith = makeInput(
            seed,
            preset,
            stats,
            offenseEffects,
            disposition,
          );
          // SEM efeitos: tudo idêntico, mas `additionalEffectIds` vazio.
          const inputWithout = makeInput(seed, preset, stats, [], disposition);

          // Mesmo seed ⇒ mesma trajetória de RNG em ambas as execuções.
          const outcomeWith = resolvePlay(
            state,
            inputWith,
            policies,
            createRng(seed),
            options,
          );
          const outcomeWithout = resolvePlay(
            state,
            inputWithout,
            policies,
            createRng(seed),
            options,
          );

          // (R9.3/R9.5/R9.6/R9.7) O resultado é byte-idêntico: zero bônus,
          // nenhuma mecânica/penalidade, Propriedades_Naturais intactas.
          expect(resultProjection(outcomeWith)).toEqual(
            resultProjection(outcomeWithout),
          );

          // A única diferença permitida no log é a presença de POWER_INERT na
          // versão com efeitos: os demais eventos coincidem exatamente.
          expect(nonInertEvents(outcomeWith.logEvents)).toEqual(
            nonInertEvents(outcomeWithout.logEvents),
          );
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('os eventos extra são exatamente POWER_INERT e carregam inert=true', () => {
    fc.assert(
      fc.property(
        seedArb,
        presetArb,
        weatherArb,
        possessionArb,
        statsArb,
        offenseEffectsArb,
        dispositionArb,
        (seed, preset, weather, possession, stats, offenseEffects, disposition) => {
          const state = { ...createInitialState({ weather }), possession };
          const policies = makePolicies(preset);
          const options = { catalog: PLAY_CATALOG } as const;

          const inputWith = makeInput(
            seed,
            preset,
            stats,
            offenseEffects,
            disposition,
          );
          const outcome = resolvePlay(
            state,
            inputWith,
            policies,
            createRng(seed),
            options,
          );

          // Se a jogada abortou na validação anatômica (fase b), o laço de
          // inércia não executa — nenhum POWER_INERT é esperado.
          const inertEvents = outcome.logEvents.filter(
            (e) => e.type === 'POWER_INERT',
          );

          if (outcome.aborted !== undefined) {
            expect(inertEvents.length).toBe(0);
            return;
          }

          // Quantidade esperada: soma dos efeitos de todos os atletas da unidade
          // ofensiva do time EM POSSE (a inércia só processa a ofensiva).
          const offenseUnit =
            possession === 'home'
              ? inputWith.home.units.offense
              : inputWith.away.units.offense;
          const expectedCount = offenseUnit.reduce(
            (acc, a) => acc + a.additionalEffectIds.length,
            0,
          );
          expect(inertEvents.length).toBe(expectedCount);

          // Cada evento extra é exatamente POWER_INERT com inert=true e carrega
          // o identificador do efeito/atleta e um motivo (powerReason).
          for (const e of inertEvents) {
            expect(e.type).toBe('POWER_INERT');
            expect(e.detail.inert).toBe(true);
            expect(typeof e.detail.effectId).toBe('string');
            expect(typeof e.detail.instanceId).toBe('number');
            expect(typeof e.powerReason).toBe('string');
          }
        },
      ),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
