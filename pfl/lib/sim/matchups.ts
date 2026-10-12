/**
 * Lookup de matchups_36 + delta simétrico + gancho de calibração NFL
 * (`lib/sim/matchups.ts`).
 *
 * Funções **puras** do núcleo que resolvem o delta de confronto de um par
 * `(ofensiva, defensiva)` dos `matchups_36`, expõem a simetria do delta como
 * contrato explícito e fornecem o gancho (não aplicado no MVP) de calibração
 * contra dados históricos da NFL.
 *
 * Modelo (ver design, seção "Matchups e baseline"):
 *
 * ```
 * p_ofensivo = ... + matchupDelta(baseline, O, D) + ...
 * ```
 *
 * O delta é **simétrico por construção**: ele é somado à probabilidade de
 * sucesso ofensiva ANTES da disputa (R5.2); a desvantagem defensiva é
 * exatamente `-delta` do MESMO confronto — não há uma segunda entrada na
 * tabela para o lado da defesa. Como a disputa resolve um único evento (o
 * sucesso ofensivo), somar `+delta` ao ataque já implica `-delta` para a
 * defesa; não existe dupla contagem. `probability.compute()` recebe esse valor
 * em `matchupDelta` e o aplica antes do clamp final — este módulo apenas o
 * localiza e documenta a simetria.
 *
 * Matchup neutro (delta `0`, ou par ausente da tabela) deixa a resolução por
 * conta dos atributos, posições, condições e ações (R5.4).
 *
 * Os valores vêm **exclusivamente do baseline** de design não calibrado
 * (`FROZEN_MVP_...`); a calibração NFL é um gancho documentado, identidade
 * enquanto desligada (R5.5, R6.10). Puro: sem I/O, rede, relógio ou entropia
 * externa; a mesma entrada sempre produz a mesma saída.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.10_
 */

import type { Baseline, NflMatchupRow, PlayId } from './types';

// ---------------------------------------------------------------------------
// Chave do mapa de matchups
// ---------------------------------------------------------------------------

/**
 * Monta a chave canônica `${offense}|${defense}` usada para indexar o mapa
 * `baseline.matchups`. Centralizar a convenção aqui garante que o lookup e
 * qualquer construção do baseline usem exatamente o mesmo formato.
 */
export function matchupKey(offense: PlayId, defense: PlayId): string {
  return `${offense}|${defense}`;
}

// ---------------------------------------------------------------------------
// Lookup do delta (R5.1, R5.4)
// ---------------------------------------------------------------------------

/**
 * Localiza o par `(offense, defense)` em `baseline.matchups` e devolve o
 * `offense_probability_delta` associado (R5.1).
 *
 * Quando o par não existe na tabela — ou está registrado com delta `0` — o
 * confronto é **neutro**: a função devolve `0` e a resolução fica por conta dos
 * atributos, posições, condições e ações (R5.4). Em ambos os casos o valor
 * retornado é o do baseline, nunca inventado.
 *
 * O valor deve ser somado à probabilidade de sucesso **ofensiva** antes da
 * disputa (R5.2); ver `defenseDelta` para o lado espelhado.
 *
 * @param baseline Baseline de design imutável recebido no `ResolvedInput`.
 * @param offense  Identificador da `Jogada_Ofensiva` confrontada.
 * @param defense  Identificador da `Jogada_Defensiva` confrontada.
 * @returns `offense_probability_delta` do par, ou `0` se neutro/ausente.
 */
export function matchupDelta(
  baseline: Baseline,
  offense: PlayId,
  defense: PlayId,
): number {
  return baseline.matchups.get(matchupKey(offense, defense)) ?? 0;
}

/**
 * Lado espelhado do delta de matchup: a desvantagem imposta à defesa é
 * exatamente o oposto da vantagem ofensiva do mesmo confronto (R5.3).
 *
 * Esta é a formalização da simetria: `defenseDelta == -matchupDelta` para todo
 * par. No pipeline do MVP a disputa resolve um único evento (o sucesso
 * ofensivo), então apenas `matchupDelta` é somado — mas expor o espelho torna a
 * simetria verificável e reutilizável caso a resolução passe a modelar o lado
 * defensivo explicitamente.
 */
export function defenseDelta(
  baseline: Baseline,
  offense: PlayId,
  defense: PlayId,
): number {
  return -matchupDelta(baseline, offense, defense);
}

// ---------------------------------------------------------------------------
// Origem versionada e status não-calibrado (R5.5, R6.10)
// ---------------------------------------------------------------------------

/**
 * Carimbo de proveniência do baseline para registro no log. O motor marca a
 * **origem versionada** e o **status não-calibrado** a cada aplicação de
 * matchup e nos parâmetros do modelo (R5.5, R6.10), de modo que todo resultado
 * seja rastreável à edição exata do baseline de design que o produziu.
 */
export interface BaselineProvenance {
  /** `baseline.version`, ex.: `"D1-design-2026-10-09"`. */
  readonly version: string;
  /** `baseline.status`, ex.: `FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED`. */
  readonly status: string;
}

/**
 * Extrai a proveniência versionada e não-calibrada do baseline para o log
 * (`baselineVersion`/`baselineStatus` do `GameLog`), sem acoplar o chamador ao
 * resto do baseline (R5.5, R6.10). Pura: apenas projeta dois campos imutáveis.
 */
export function baselineProvenance(baseline: Baseline): BaselineProvenance {
  return { version: baseline.version, status: baseline.status };
}

// ---------------------------------------------------------------------------
// Gancho de calibração NFL (não aplicado no MVP)
// ---------------------------------------------------------------------------

/**
 * Gancho **puro e explícito** de calibração dos deltas contra dados históricos
 * da NFL (`Dados_Matchup_NFL`). No MVP ele é identidade:
 *
 * - `enabled === false` (default do MVP) → devolve o `baseline` **inalterado**,
 *   referência inclusive. Os deltas usados permanecem exclusivamente os do
 *   baseline de design; o pipeline nunca chama este gancho automaticamente.
 * - `enabled === true` sem decisão de produto → ainda identidade: ajustar
 *   deltas empiricamente exige uma decisão de produto explícita (fora do MVP) e
 *   será registrada no log. Deixar como identidade preserva o determinismo — o
 *   resultado só muda se a entrada mudar por decisão de produto.
 *
 * `nfl` é aceito (e ignorado no MVP) para fixar a assinatura futura sem alterar
 * os chamadores quando a calibração for ligada.
 *
 * @param baseline Baseline de design a (eventualmente) calibrar.
 * @param nfl      Dados históricos da NFL (insumo de calibração; ignorado no MVP).
 * @param enabled  Liga a calibração; `false` no MVP → identidade.
 * @returns O `baseline` inalterado enquanto a calibração não for aplicada.
 */
export function calibrateDeltas(
  baseline: Baseline,
  nfl: ReadonlyArray<NflMatchupRow> = [],
  enabled = false,
): Baseline {
  // MVP: identidade sobre os deltas. `nfl` é referenciado para documentar o
  // insumo futuro sem acoplar o pipeline; `void` evita o aviso de parâmetro
  // não utilizado mantendo a assinatura estável.
  void nfl;
  if (!enabled) {
    return baseline;
  }
  // Enquanto não houver decisão de produto, calibração ligada ainda é
  // identidade — qualquer ajuste empírico será implementado aqui no futuro.
  return baseline;
}
