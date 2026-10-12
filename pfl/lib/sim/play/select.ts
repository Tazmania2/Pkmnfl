/**
 * Seleção de jogada por situação + estilo (`lib/sim/play/select.ts`).
 *
 * Núcleo **puro** da fase (a) do pipeline de resolução (ver design, "(a) Seleção
 * de jogada" e "Bots"). Escolhe uma `Jogada_Ofensiva` e uma `Jogada_Defensiva`
 * do `Catalogo_Jogadas` (18 jogadas) considerando Down, Distancia, posição no
 * campo, Relogio_Jogo, Clima, Fadiga e o estilo da `Estrategia` (R4.1, R4.2).
 * Nenhuma jogada fora do catálogo é jamais produzida (R4.3, R12.2).
 *
 * Contrato do sorteio (design, "Bots"):
 * - A escolha é um sorteio ponderado por pesos situacionais.
 * - Consome **exatamente um** `rng.nextFloat()` quando há **mais de uma** opção
 *   com peso positivo; com uma única opção positiva, **não** consome RNG.
 * - A ordem de consumo é fixa: **ataque primeiro, defesa depois** (O→D). Este
 *   módulo expõe `choosePlay`/`chooseOffense`/`chooseDefense`; a orquestração
 *   (`pipeline.ts`) é quem garante a ordem de chamada O→D.
 *
 * Pureza (fronteira de arquitetura): sem I/O, rede, relógio de sistema ou
 * entropia externa. Toda aleatoriedade vem do `Rng` injetado; a mesma entrada
 * (contexto + estado do RNG) sempre produz a mesma escolha.
 *
 * _Requirements: 4.1, 4.2, 4.3, 12.2_
 */

import type { Rng } from '../rng';
import type {
  DefensivePlayId,
  OffensivePlayId,
  PlayId,
  Preset,
  SpecialTeamsPlayId,
  Strategy,
  Weather,
} from '../types';

// ---------------------------------------------------------------------------
// Catalogo_Jogadas (18 jogadas) — representação canônica e imutável
// ---------------------------------------------------------------------------

/** As seis `Jogada_Ofensiva` do catálogo, em ordem canônica. */
export const OFFENSIVE_PLAYS: readonly OffensivePlayId[] = [
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
] as const;

/** As seis `Jogada_Defensiva` do catálogo, em ordem canônica. */
export const DEFENSIVE_PLAYS: readonly DefensivePlayId[] = [
  'D_RUN_FIT',
  'D_EDGE_CONTAIN',
  'D_ZONE',
  'D_MAN',
  'D_RUSH',
  'D_CONTAIN_QB',
] as const;

/** As seis `Jogada_Special_Teams` do catálogo, em ordem canônica. */
export const SPECIAL_TEAMS_PLAYS: readonly SpecialTeamsPlayId[] = [
  'ST_O_KICKOFF',
  'ST_O_PUNT',
  'ST_O_FIELD_GOAL',
  'ST_D_KICK_RETURN',
  'ST_D_PUNT_RETURN',
  'ST_D_KICK_BLOCK',
] as const;

/**
 * `Catalogo_Jogadas` completo: as 18 jogadas organizadas por grupo. Esta é a
 * ÚNICA fonte das jogadas permitidas; a seleção nunca produz nada fora dela
 * (R4.3, R12.2). O catálogo é imutável e injetado em `choosePlay` para que a
 * política e o pipeline compartilhem exatamente o mesmo conjunto.
 */
export interface PlayCatalog {
  readonly offense: readonly OffensivePlayId[];
  readonly defense: readonly DefensivePlayId[];
  readonly specialTeams: readonly SpecialTeamsPlayId[];
}

/** Instância canônica (congelada) do `Catalogo_Jogadas` do MVP. */
export const PLAY_CATALOG: PlayCatalog = Object.freeze({
  offense: OFFENSIVE_PLAYS,
  defense: DEFENSIVE_PLAYS,
  specialTeams: SPECIAL_TEAMS_PLAYS,
});

/** Conjunto de todas as 18 jogadas, para validação de pertencimento ao catálogo. */
const CATALOG_MEMBERSHIP: ReadonlySet<PlayId> = new Set<PlayId>([
  ...OFFENSIVE_PLAYS,
  ...DEFENSIVE_PLAYS,
  ...SPECIAL_TEAMS_PLAYS,
]);

/** Verdadeiro sse `play` é uma das 18 jogadas do `Catalogo_Jogadas` (R4.3). */
export function isInCatalog(play: PlayId): boolean {
  return CATALOG_MEMBERSHIP.has(play);
}

// ---------------------------------------------------------------------------
// Contexto de seleção e contrato da política (design: "Bots")
// ---------------------------------------------------------------------------

/**
 * Fatores de situação considerados na escolha (R4.2). Imutável: a política é
 * pura em relação a `(contexto, estado do RNG)`.
 */
export interface PlaySelectionContext {
  /** Down corrente (1..4). */
  readonly down: number;
  /** Jardas restantes para o 1º down. */
  readonly distance: number;
  /** Posição da bola no campo (jardas relativas à própria goal line, 0..100). */
  readonly fieldPosition: number;
  /** Relógio do quarto em décimos de segundo (inteiro), para estabilidade. */
  readonly gameClock: number;
  /** Clima vigente, sorteado na inicialização. */
  readonly weather: Weather;
  /** Fadiga compartilhada por `instance_id` (penalidade em [0, 0.12]). */
  readonly fatigueByInstance: ReadonlyMap<number, number>;
  /** `true` para o time em posse (escolha ofensiva); `false` para a defesa. */
  readonly hasPossession: boolean;
}

/**
 * Contrato da `PlayPolicy`: escolhe uma jogada do `Catalogo_Jogadas`. Recebe o
 * `Rng` compartilhado e o consome (quando necessário) na ordem fixa O→D imposta
 * pelo pipeline. Pura em relação a `(contexto, catálogo, estado do RNG)`.
 */
export interface PlayPolicy {
  choosePlay(ctx: PlaySelectionContext, catalog: PlayCatalog, rng: Rng): PlayId;
}

// ---------------------------------------------------------------------------
// Sorteio ponderado — consome 1 nextFloat() só com >1 opção de peso positivo
// ---------------------------------------------------------------------------

/** Um candidato do sorteio: a jogada e seu peso situacional (>= 0). */
export interface WeightedCandidate<T extends PlayId> {
  readonly play: T;
  readonly weight: number;
}

/**
 * Sorteio ponderado determinístico sobre candidatos do catálogo.
 *
 * Regras de consumo de RNG (design, "Bots"):
 * - Considera apenas candidatos com **peso estritamente positivo** (`weight > 0`).
 * - Com **exatamente uma** opção positiva, retorna-a **sem consumir** o RNG.
 * - Com **mais de uma** opção positiva, consome **exatamente um** `rng.nextFloat()`
 *   e seleciona por faixas cumulativas na ordem dada (determinística).
 * - Sem nenhuma opção positiva (todos os pesos <= 0), cai no fallback: o
 *   primeiro candidato da lista, **sem consumir** o RNG (mantém a totalidade da
 *   seleção e nunca inventa jogada fora da lista).
 *
 * O resultado pertence sempre à lista de `candidates` (todos do catálogo), de
 * modo que a jogada selecionada está sempre no `Catalogo_Jogadas` (R4.3, R12.2).
 *
 * @param candidates Candidatos (jogada + peso) na ordem canônica do catálogo.
 * @param rng        Gerador_RNG determinístico (única fonte de entropia).
 * @returns A jogada escolhida.
 */
export function weightedChoice<T extends PlayId>(
  candidates: readonly WeightedCandidate<T>[],
  rng: Rng,
): T {
  if (candidates.length === 0) {
    throw new RangeError('weightedChoice requires at least one candidate');
  }

  // Filtra para pesos estritamente positivos, preservando a ordem canônica.
  const positive = candidates.filter((c) => c.weight > 0);

  // Nenhuma opção com peso positivo → fallback determinístico sem consumir RNG:
  // o primeiro candidato da lista. Garante totalidade sem entropia espúria.
  if (positive.length === 0) {
    return candidates[0]!.play;
  }

  // Exatamente uma opção positiva → escolha forçada, NÃO consome RNG.
  if (positive.length === 1) {
    return positive[0]!.play;
  }

  // Mais de uma opção positiva → um único nextFloat() mapeado por faixas
  // cumulativas sobre a soma dos pesos positivos.
  const total = positive.reduce((sum, c) => sum + c.weight, 0);

  // RNG consume #k: sorteio ponderado de jogada (um único nextFloat quando há
  // mais de uma opção com peso positivo). Ordem fixa O→D garantida pelo pipeline.
  const r = rng.nextFloat() * total;

  let cumulative = 0;
  for (let i = 0; i < positive.length; i++) {
    cumulative += positive[i]!.weight;
    if (r < cumulative) {
      return positive[i]!.play;
    }
  }

  // Fallback de borda por imprecisão de ponto flutuante (r muito próximo de
  // `total`): fecha o intervalo na última opção positiva. Nenhum RNG extra.
  return positive[positive.length - 1]!.play;
}

// ---------------------------------------------------------------------------
// Pesos situacionais por estilo (preset) — considera down/distância/posição/
// relógio/clima/fadiga (R4.2)
// ---------------------------------------------------------------------------

/**
 * Média da penalidade de fadiga do contexto, em [0, 0.12]. Usada para pender
 * levemente contra jogadas de alto esforço (passe profundo / play action)
 * quando o time está desgastado. Puro: só lê o mapa de fadiga.
 */
function averageFatigue(fatigueByInstance: ReadonlyMap<number, number>): number {
  if (fatigueByInstance.size === 0) {
    return 0;
  }
  let sum = 0;
  for (const penalty of fatigueByInstance.values()) {
    sum += penalty;
  }
  return sum / fatigueByInstance.size;
}

/**
 * `true` quando a situação favorece o passe: 3º/4º down com jardas longas, ou
 * relógio curto no fim do quarto (hurry-up). Deriva somente do contexto.
 */
function favorsPass(ctx: PlaySelectionContext): boolean {
  const lateAndLong = ctx.down >= 3 && ctx.distance >= 7;
  const hurryUp = ctx.gameClock <= 600; // <= 60s (em décimos) → tende ao passe
  return lateAndLong || hurryUp;
}

/**
 * `true` quando a situação favorece a corrida: 1º/2º down com jardas curtas, ou
 * situação de "short yardage" (distância <= 2).
 */
function favorsRun(ctx: PlaySelectionContext): boolean {
  const earlyAndShort = ctx.down <= 2 && ctx.distance <= 4;
  const shortYardage = ctx.distance <= 2;
  return earlyAndShort || shortYardage;
}

/**
 * Multiplicadores de viés de estilo por preset para corrida vs. passe.
 *
 * Fonte única da verdade do viés tático de cada preset. Exportado para que
 * `bots/policy.ts` monte seus perfis situacionais sobre o MESMO viés usado por
 * `offensiveWeight`/`defensiveWeight`, evitando divergência entre a seleção e a
 * documentação dos presets (R12.1).
 */
export const PRESET_RUN_PASS_BIAS: Readonly<
  Record<Preset, { readonly run: number; readonly pass: number }>
> = {
  BALANCED: { run: 1, pass: 1 },
  GROUND: { run: 1.8, pass: 0.6 },
  AERIAL: { run: 0.6, pass: 1.8 },
  // CURTI: perfil tático agressivo, levemente inclinado ao passe/jogadas de risco.
  CURTI: { run: 0.9, pass: 1.3 },
};

/** Jogadas ofensivas classificadas como "passe". */
const PASS_PLAYS: ReadonlySet<OffensivePlayId> = new Set<OffensivePlayId>([
  'O_PASS_SHORT',
  'O_PASS_INTERMEDIATE',
  'O_PASS_DEEP',
  'O_PLAY_ACTION',
]);

/** Jogadas ofensivas classificadas como "passe profundo" (sensíveis ao vento). */
const DEEP_PASS_PLAYS: ReadonlySet<OffensivePlayId> = new Set<OffensivePlayId>([
  'O_PASS_DEEP',
]);

/** Jogadas ofensivas classificadas como "corrida". */
const RUN_PLAYS: ReadonlySet<OffensivePlayId> = new Set<OffensivePlayId>([
  'O_RUN_INSIDE',
  'O_RUN_OUTSIDE',
]);

/**
 * Peso situacional de uma `Jogada_Ofensiva` dado o contexto e a estratégia.
 * Combina: viés de estilo do preset (corrida/passe), ajuste por situação de
 * down/distância/relógio, penalização de passe profundo sob WIND/COLD/RAIN e
 * leve desincentivo a esforço alto sob fadiga elevada. Nunca negativo (clamp 0).
 *
 * Pesos explícitos da estratégia (`strategy.playWeights[play]`) multiplicam o
 * peso situacional quando presentes, permitindo que a `Estrategia` ajuste o
 * perfil sem sair do catálogo.
 */
function offensiveWeight(
  play: OffensivePlayId,
  ctx: PlaySelectionContext,
  strategy: Strategy,
): number {
  const bias = PRESET_RUN_PASS_BIAS[strategy.preset];
  let weight = 1;

  if (RUN_PLAYS.has(play)) {
    weight *= bias.run;
    if (favorsRun(ctx)) weight *= 1.6;
    if (favorsPass(ctx)) weight *= 0.5;
  } else if (PASS_PLAYS.has(play)) {
    weight *= bias.pass;
    if (favorsPass(ctx)) weight *= 1.6;
    if (favorsRun(ctx)) weight *= 0.5;

    // Clima penaliza o passe profundo: WIND (chute/passe longo), e em menor grau
    // RAIN/COLD (recepção) tornam o passe profundo menos atraente (R4.2, R7).
    if (DEEP_PASS_PLAYS.has(play)) {
      if (ctx.weather === 'WIND') weight *= 0.4;
      else if (ctx.weather === 'RAIN' || ctx.weather === 'COLD') weight *= 0.7;

      // Fadiga alta desincentiva o esforço máximo do passe profundo.
      const avgFatigue = averageFatigue(ctx.fatigueByInstance);
      if (avgFatigue > 0.06) weight *= 0.7;
    }
  }

  // Ajuste explícito da estratégia por jogada (opcional). Multiplica o peso
  // situacional; valores <= 0 zeram a opção (fica fora do sorteio positivo).
  const explicit = strategy.playWeights?.[play];
  if (typeof explicit === 'number') {
    weight *= explicit;
  }

  return weight > 0 ? weight : 0;
}

/** Jogadas defensivas orientadas à corrida. */
const RUN_DEFENSE_PLAYS: ReadonlySet<DefensivePlayId> = new Set<DefensivePlayId>(
  ['D_RUN_FIT', 'D_EDGE_CONTAIN'],
);

/** Jogadas defensivas orientadas ao passe. */
const PASS_DEFENSE_PLAYS: ReadonlySet<DefensivePlayId> =
  new Set<DefensivePlayId>(['D_ZONE', 'D_MAN', 'D_RUSH', 'D_CONTAIN_QB']);

/**
 * Peso situacional de uma `Jogada_Defensiva`. A defesa espelha a leitura de
 * situação do ataque: favorece defesas de corrida quando a situação favorece a
 * corrida, e defesas de passe quando favorece o passe. Mantém o viés de estilo
 * do próprio preset defensivo e respeita pesos explícitos da estratégia.
 */
function defensiveWeight(
  play: DefensivePlayId,
  ctx: PlaySelectionContext,
  strategy: Strategy,
): number {
  const bias = PRESET_RUN_PASS_BIAS[strategy.preset];
  let weight = 1;

  if (RUN_DEFENSE_PLAYS.has(play)) {
    // Defesa de corrida reflete o viés de "ground" do preset.
    weight *= bias.run;
    if (favorsRun(ctx)) weight *= 1.6;
    if (favorsPass(ctx)) weight *= 0.6;
  } else if (PASS_DEFENSE_PLAYS.has(play)) {
    // Defesa de passe reflete o viés de "aerial" do preset.
    weight *= bias.pass;
    if (favorsPass(ctx)) weight *= 1.6;
    if (favorsRun(ctx)) weight *= 0.6;
  }

  const explicit = strategy.playWeights?.[play];
  if (typeof explicit === 'number') {
    weight *= explicit;
  }

  return weight > 0 ? weight : 0;
}

// ---------------------------------------------------------------------------
// Seleção pública: ataque e defesa (ordem fixa O→D no pipeline)
// ---------------------------------------------------------------------------

/**
 * Escolhe a `Jogada_Ofensiva` do catálogo pela situação e estilo. Consome um
 * único `rng.nextFloat()` apenas quando houver mais de uma opção com peso
 * positivo; com uma única opção positiva, não consome RNG.
 *
 * @param ctx      Contexto de seleção (deve ter `hasPossession === true`).
 * @param catalog  Catálogo das 18 jogadas (restringe a saída, R4.3).
 * @param strategy Estratégia do time em posse (preset + pesos).
 * @param rng      Gerador_RNG determinístico.
 * @returns A `OffensivePlayId` escolhida (sempre no catálogo).
 */
export function chooseOffense(
  ctx: PlaySelectionContext,
  catalog: PlayCatalog,
  strategy: Strategy,
  rng: Rng,
): OffensivePlayId {
  const candidates: WeightedCandidate<OffensivePlayId>[] = catalog.offense.map(
    (play) => ({ play, weight: offensiveWeight(play, ctx, strategy) }),
  );
  return weightedChoice(candidates, rng);
}

/**
 * Escolhe a `Jogada_Defensiva` do catálogo pela situação e estilo. Mesmas
 * regras de consumo de RNG de `chooseOffense`.
 *
 * @param ctx      Contexto de seleção (deve ter `hasPossession === false`).
 * @param catalog  Catálogo das 18 jogadas (restringe a saída, R4.3).
 * @param strategy Estratégia do time sem posse (preset + pesos).
 * @param rng      Gerador_RNG determinístico.
 * @returns A `DefensivePlayId` escolhida (sempre no catálogo).
 */
export function chooseDefense(
  ctx: PlaySelectionContext,
  catalog: PlayCatalog,
  strategy: Strategy,
  rng: Rng,
): DefensivePlayId {
  const candidates: WeightedCandidate<DefensivePlayId>[] = catalog.defense.map(
    (play) => ({ play, weight: defensiveWeight(play, ctx, strategy) }),
  );
  return weightedChoice(candidates, rng);
}

/**
 * Fábrica da `PlayPolicy` por situação + estilo para uma dada `Estrategia`.
 *
 * `choosePlay` encaminha para `chooseOffense` quando `ctx.hasPossession` é
 * verdadeiro e para `chooseDefense` caso contrário — nunca produz jogada fora
 * do `Catalogo_Jogadas` (R4.3, R12.2). A ordem fixa O→D de consumo do RNG é
 * garantida pelo pipeline, que invoca a política primeiro para o ataque e
 * depois para a defesa.
 *
 * @param strategy Estratégia (preset + pesos) do time ao qual a política serve.
 * @returns Uma `PlayPolicy` pura e determinística.
 */
export function createSituationalPolicy(strategy: Strategy): PlayPolicy {
  return {
    choosePlay(
      ctx: PlaySelectionContext,
      catalog: PlayCatalog,
      rng: Rng,
    ): PlayId {
      return ctx.hasPossession
        ? chooseOffense(ctx, catalog, strategy, rng)
        : chooseDefense(ctx, catalog, strategy, rng);
    },
  };
}
