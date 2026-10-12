/**
 * Política de efeitos inertes com aviso (`lib/sim/play/inert.ts`).
 *
 * No MVP, **todo** efeito esportivo adicional de golpe ou habilidade é
 * inerte-com-aviso: permanece equipável, mas aplica **zero** bônus a qualquer
 * atributo de desempenho e **não altera** nenhum atributo nem o resultado da
 * jogada (R9.1–R9.3, R9.6). O resultado é idêntico ao que ocorreria sem o
 * efeito equipado. As `Propriedades_Naturais` (stats oficiais, tipo/resistências,
 * locomoção, anatomia) continuam valendo sem qualquer modificação decorrente
 * desta política (R9.5).
 *
 * Este módulo é **puro**: resolve a disposição de um efeito a partir da tabela
 * imutável de disposição (`effects_52_mvp_disposition`, lida como parte do
 * `ResolvedInput`), sem I/O, sem relógio de sistema e sem entropia. Cada decisão
 * retorna uma estrutura **com motivo** (`reason`), para que o módulo de log
 * (`log.ts`, Task 13.x) registre honestamente — nunca aplica bônus silencioso.
 *
 * Fronteira de responsabilidade: aqui produzimos apenas a **decisão + motivo**.
 * A contagem de "exatamente um aviso por ocorrência" (R9.4) é feita na camada de
 * log (Task 13.5), e as regras universais fixas que de fato são modeladas
 * ativamente (Esfera_Supressao e telecinese) vivem em `sphere.ts` (R9.7). Este
 * módulo **não inventa bônus**: bônus de clima/contato/proteção só se aplicam
 * quando a regra específica estiver parametrizada no baseline, o que acontece
 * fora daqui.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.7_
 */

import type { EffectStatus, InertDecision } from '../types';

// ---------------------------------------------------------------------------
// Motivos canônicos da decisão de disposição (registrados no Log_Partida)
// ---------------------------------------------------------------------------

/**
 * Motivo para um efeito cujo status na tabela é `INERT_WITH_WARNING` (R9.1):
 * disposição conhecida e aprovada como inerte-com-aviso.
 */
export const REASON_INERT_WITH_WARNING = 'INERT_WITH_WARNING';

/**
 * Motivo para um efeito **sem registro** na tabela de disposição (R9.2): tratado
 * como inerte, com aviso de ausência de disposição aprovada. Mesmo valor exibido
 * no design (`SEM_DISPOSICAO_APROVADA`).
 */
export const REASON_NO_APPROVED_DISPOSITION = 'SEM_DISPOSICAO_APROVADA';

// ---------------------------------------------------------------------------
// Resolução da disposição de um efeito (R9.1, R9.2)
// ---------------------------------------------------------------------------

/**
 * Resolve a disposição de um efeito adicional de golpe/habilidade como
 * **inerte + motivo**, consultando a tabela imutável de disposição.
 *
 * No MVP, `inert` é **sempre `true`** para qualquer efeito adicional — nenhum
 * efeito produz bônus. O que varia é apenas o `reason`:
 *
 * - Efeito **com registro** na tabela: o motivo é o próprio status registrado.
 *   O valor canônico do MVP é `INERT_WITH_WARNING` (R9.1); qualquer outro status
 *   versionado presente na tabela é propagado como motivo, mas ainda tratado
 *   como inerte (nenhum status ativa bônus no MVP).
 * - Efeito **sem registro** na tabela: tratado como inerte, com motivo de
 *   ausência de disposição aprovada (`SEM_DISPOSICAO_APROVADA`), para que o log
 *   sinalize explicitamente a lacuna de disposição (R9.2).
 *
 * A função nunca aplica bônus silenciosamente: a saída é puramente informativa
 * (decisão + motivo + identificação de efeito/atleta) e não altera atributo nem
 * resultado algum (R9.3, R9.6).
 *
 * @param effectId Identificador do efeito adicional consultado.
 * @param dispositionTable Tabela imutável `effectId → status` do baseline.
 * @param athleteInstanceId `instance_id` do atleta que porta o efeito.
 * @returns Decisão `inert = true` com o motivo canônico e a identificação.
 */
export function resolveEffectDisposition(
  effectId: string,
  dispositionTable: ReadonlyMap<string, EffectStatus>,
  athleteInstanceId: number,
): InertDecision {
  const status = dispositionTable.get(effectId);

  // Sem registro na tabela (R9.2): inerte, com aviso de ausência de disposição.
  // `undefined` é o único caso de ausência; strings vazias ou outros status são
  // tratados como "com registro" e propagados como motivo.
  if (status === undefined) {
    return {
      inert: true,
      reason: REASON_NO_APPROVED_DISPOSITION,
      effectId,
      athleteInstanceId,
    };
  }

  // Com registro (R9.1): inerte, motivo = status registrado. No MVP o valor
  // canônico é `INERT_WITH_WARNING`; qualquer outro status é igualmente inerte.
  return {
    inert: true,
    reason: status,
    effectId,
    athleteInstanceId,
  };
}

// ---------------------------------------------------------------------------
// Aplicação de "zero bônus" (R9.3, R9.6)
// ---------------------------------------------------------------------------

/**
 * Bônus que um efeito inerte aplica a qualquer atributo afetado: **zero**
 * (R9.3). Constante nomeada para que o pipeline e os testes afirmem, de forma
 * rastreável, que a contribuição de qualquer efeito é nula.
 */
export const INERT_EFFECT_BONUS = 0;

/**
 * Retorna o bônus que um efeito inerte contribui a qualquer atributo de
 * desempenho: sempre `0` (R9.3). O retorno é constante e independe do atributo —
 * **nenhum** atributo afetado recebe bônus.
 *
 * Esta é a tradução direta de "zero bônus a todos os atributos afetados": o
 * pipeline soma esta contribuição a cada atributo e o total permanece inalterado.
 *
 * @returns `0`, invariavelmente.
 */
export function inertEffectBonus(): number {
  return INERT_EFFECT_BONUS;
}

/**
 * Aplica a política de efeito inerte a um conjunto de atributos de desempenho,
 * devolvendo-os **sem qualquer modificação** (R9.3, R9.6): o resultado é idêntico
 * ao que ocorreria sem o efeito equipado. Produz um **novo** objeto (sem mutar a
 * entrada) para preservar a imutabilidade da `ResolvedInput`, mas cada valor é
 * copiado verbatim — zero bônus somado.
 *
 * Serve como ponto único e auditável onde o pipeline "aplica" um efeito inerte:
 * por construção, a aplicação é a identidade.
 *
 * @param attributes Mapa `atributo → valor` dos atributos potencialmente afetados.
 * @returns Novo mapa com exatamente os mesmos valores (nenhum bônus aplicado).
 */
export function applyInertEffect<K extends string>(
  attributes: Readonly<Record<K, number>>,
): Record<K, number> {
  const result = {} as Record<K, number>;
  for (const key of Object.keys(attributes) as K[]) {
    // Valor + INERT_EFFECT_BONUS (0) = valor. Cópia verbatim, sem bônus.
    result[key] = attributes[key] + INERT_EFFECT_BONUS;
  }
  return result;
}

/**
 * Afirma, de forma explícita e rastreável, que a política de efeito inerte
 * **preserva** as `Propriedades_Naturais` (stats oficiais, tipo/resistências,
 * locomoção, anatomia) sem modificação (R9.5). Como a política não toca essas
 * propriedades, a preservação é incondicional — este predicado existe para que
 * o pipeline e o log possam declarar o invariante em vez de apenas assumi-lo.
 *
 * @returns `true` sempre: nenhuma `Propriedade_Natural` é alterada pela inércia.
 */
export function preservesNaturalProperties(): true {
  return true;
}
