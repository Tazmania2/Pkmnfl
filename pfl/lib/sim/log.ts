/**
 * Construção e serialização estável do `Log_Partida` (`lib/sim/log.ts`).
 *
 * Este módulo converte o fluxo de eventos **sem `seq`** produzido pelas camadas
 * superiores (pipeline de jogada, sorteio de clima, kickoff, pontuação, FSM,
 * pendências) em um `Log_Partida` **ordenado e determinístico**, e serializa o
 * `GameLog` resultante com um serializador JSON **canônico** para comparação
 * byte a byte entre execuções (R1.1, R13.6).
 *
 * ## Responsabilidades (Task 13.1)
 *
 * - **Atribuição de `seq`**: o construtor recebe os eventos na ordem de emissão
 *   e carimba `seq = 0, 1, 2, …` sequencial, produzindo um
 *   `ReadonlyArray<LogEvent>`. A ordem de entrada é a única fonte de ordenação;
 *   o `seq` apenas a reifica para que o log seja estável e reconstruível (R13.6).
 *
 * - **Completude por snap** (R13.1, R13.3, R13.4): cada evento já carrega o
 *   `StateSnapshot` vigente (posição da bola, posse, placar, quarto, relógio em
 *   décimos **inteiros**, down, distância, clima) e uma `narrative` não vazia;
 *   o construtor **valida** que nenhuma narrativa é vazia (garantia defensiva do
 *   contrato de completude) e preserva o `detail` por fase (decisão de jogada,
 *   clima e fadiga vigentes etc.).
 *
 * - **Motivo de (não) ativação de poder** (R13.2): `powerReason` é propagado dos
 *   eventos de origem (`POWER_SUPPRESSED`, `POWER_INERT`, `TELEKINESIS_NOTE`).
 *   O módulo expõe os motivos canônicos (`PowerReason`) e um utilitário de
 *   **aviso único por ocorrência** (`InertWarningLedger`) que garante que um
 *   efeito inerte relevante gere **exatamente um** aviso por ocorrência
 *   `(effectId, instanceId, snap)` (R9.4) — ocorrências repetidas no mesmo snap
 *   são de-duplicadas, enquanto um novo snap conta como nova ocorrência.
 *
 * - **Cabeçalho de auditoria** (R1.7, R5.5, R6.10, R7.6): monta o `GameLog` com
 *   `seedUsed` (o `Seed_RNG` em **decimal**, derivado do `bigint`),
 *   `baselineVersion`, `baselineStatus`, a lista de eventos e as `GameStats`.
 *   O clima sorteado e seus modificadores são registrados como eventos no fluxo
 *   (`WEATHER_ROLL`), aqui apenas ordenados e preservados.
 *
 * - **Serialização estável** (`stableStringify`, R1.1/R13.6): JSON canônico com
 *   chaves ordenadas lexicograficamente em todos os níveis, sem espaços
 *   variáveis, e com o relógio em **inteiros** (décimos de segundo) — o
 *   `StateSnapshot.gameClock` já é inteiro, e o serializador força a
 *   representação inteira de qualquer número que seja inteiro de valor,
 *   evitando divergência de ponto flutuante na saída.
 *
 * ## Fronteira (o que este módulo NÃO faz)
 *
 * - Não calcula `GameStats`: isso é da Task 13.2 (`stats.ts`). Aqui o `GameStats`
 *   é **recebido** e costurado ao `GameLog`; `EMPTY_STATS` é o ponto de
 *   integração/placeholder enquanto 13.2 não existe.
 * - Não decide fluxo de jogo nem consome RNG: recebe eventos já resolvidos.
 *
 * Puro: sem `Date`, sem leitura de ambiente, sem rede, sem relógio de sistema. A
 * mesma sequência de eventos de entrada sempre produz o mesmo `GameLog` e a
 * mesma string de `stableStringify`.
 *
 * _Requirements: 1.7, 5.5, 6.10, 7.6, 9.4, 13.1, 13.2, 13.3, 13.4, 13.6_
 */

import type { PipelineLogEvent } from './play/pipeline';
import type {
  Baseline,
  GameLog,
  GameStats,
  JsonValue,
  LogEvent,
} from './types';

// ---------------------------------------------------------------------------
// Motivos canônicos de (não) ativação de poder (R13.2)
// ---------------------------------------------------------------------------

/**
 * Motivos canônicos de (não) ativação de poder registrados em
 * `LogEvent.powerReason` (R13.2). A união admite `string` para motivos
 * versionados adicionais do baseline (ex.: `INERT_WITH_WARNING`,
 * `ANATOMY_BLOCKED`), mantendo os três motivos obrigatórios explícitos:
 *
 * - `POWER_SUPPRESSED` — poder neutralizado dentro da `Esfera_Supressao` (R8).
 * - `POWER_INERT` — efeito adicional resolvido como inerte-com-motivo (R9).
 * - `TELEKINESIS_NOT_POSSESSION` — manipulação remota não é posse/INT/TD (R8.8/R10.5).
 */
export type PowerReason =
  | 'POWER_SUPPRESSED'
  | 'POWER_INERT'
  | 'TELEKINESIS_NOT_POSSESSION'
  | (string & {});

// ---------------------------------------------------------------------------
// Aviso único por ocorrência de efeito inerte relevante (R9.4)
// ---------------------------------------------------------------------------

/**
 * Identidade de uma ocorrência de efeito inerte relevante para fins de aviso
 * único (R9.4). Uma "ocorrência" é a tripla `(effectId, instanceId, snap)`: o
 * mesmo efeito do mesmo indivíduo pode voltar a avisar em um **novo** snap, mas
 * nunca mais de uma vez no **mesmo** snap.
 */
export interface InertWarningKey {
  readonly effectId: string;
  readonly instanceId: number;
  readonly snap: number;
}

/**
 * Serializa a identidade de ocorrência numa chave estável para de-duplicação.
 * O separador `\u0000` (NUL) não aparece em `effectId` legítimos, evitando
 * colisões entre, por exemplo, `("a", 1)` e `("a1", undefined)`.
 */
function inertWarningKeyOf(key: InertWarningKey): string {
  return `${key.effectId}\u0000${key.instanceId}\u0000${key.snap}`;
}

/**
 * Livro-razão de avisos de efeito inerte: garante **exatamente um** aviso por
 * ocorrência `(effectId, instanceId, snap)` (R9.4). É um utilitário puro (sem
 * I/O) e explícito — o chamador consulta `shouldWarn` ao decidir emitir o evento
 * de aviso de um efeito inerte; chamadas subsequentes para a mesma ocorrência
 * retornam `false`.
 *
 * Mantido como classe (estado local mutável encapsulado) para que o acúmulo de
 * ocorrências ao longo da partida seja barato e local; a pureza do módulo é
 * preservada porque o ledger é instanciado e consumido inteiramente dentro de
 * uma mesma simulação determinística, sem depender de nada externo.
 */
export class InertWarningLedger {
  private readonly seen = new Set<string>();

  /**
   * Registra a ocorrência e informa se ela deve gerar aviso **agora**.
   *
   * @param key Identidade da ocorrência `(effectId, instanceId, snap)`.
   * @returns `true` na primeira vez que a ocorrência é vista; `false` depois.
   */
  shouldWarn(key: InertWarningKey): boolean {
    const k = inertWarningKeyOf(key);
    if (this.seen.has(k)) {
      return false;
    }
    this.seen.add(k);
    return true;
  }

  /** `true` se a ocorrência já gerou aviso (sem registrá-la). */
  hasWarned(key: InertWarningKey): boolean {
    return this.seen.has(inertWarningKeyOf(key));
  }

  /** Número de ocorrências distintas já avistadas (para auditoria/teste). */
  get size(): number {
    return this.seen.size;
  }
}

/**
 * Filtra, de um fluxo de eventos **sem `seq`**, as emissões de aviso de efeito
 * inerte relevante de modo que cada ocorrência `(effectId, instanceId, snap)`
 * sobreviva **uma única vez** (R9.4). Eventos que não são avisos de efeito
 * inerte relevante passam intactos.
 *
 * Um evento é considerado "aviso de efeito inerte relevante" quando seu
 * `powerReason` indica inércia (`POWER_INERT` ou `INERT_WITH_WARNING`) e seu
 * `detail` carrega um `effectId` string e um `instanceId` numérico; o `snap` do
 * evento (quando ausente) é tratado como `-1`, de forma que avisos sem snap
 * ainda sejam de-duplicados consistentemente por efeito+indivíduo.
 *
 * Esta função é a aplicação do `InertWarningLedger` ao nível do fluxo; o
 * `buildGameLog` a utiliza por padrão antes de atribuir `seq`.
 *
 * @param events Eventos em ordem de emissão (sem `seq`).
 * @param ledger Ledger a usar (default: um ledger novo e vazio).
 * @returns Novo arranjo com os avisos inertes repetidos removidos.
 */
export function dedupeInertWarnings(
  events: ReadonlyArray<PipelineLogEvent>,
  ledger: InertWarningLedger = new InertWarningLedger(),
): ReadonlyArray<PipelineLogEvent> {
  const out: PipelineLogEvent[] = [];
  for (const event of events) {
    if (!isRelevantInertWarning(event)) {
      out.push(event);
      continue;
    }
    const effectId = event.detail.effectId;
    const instanceId = event.detail.instanceId;
    const key: InertWarningKey = {
      effectId: typeof effectId === 'string' ? effectId : String(effectId),
      instanceId: typeof instanceId === 'number' ? instanceId : -1,
      snap: event.snap ?? -1,
    };
    if (ledger.shouldWarn(key)) {
      out.push(event);
    }
  }
  return out;
}

/**
 * `true` quando o evento é um aviso de efeito inerte **relevante** passível de
 * de-duplicação (R9.4): motivo de inércia + `effectId`/`instanceId` presentes no
 * `detail`.
 */
function isRelevantInertWarning(event: PipelineLogEvent): boolean {
  const reason = event.powerReason;
  const isInert =
    reason === 'POWER_INERT' || reason === 'INERT_WITH_WARNING';
  if (!isInert) {
    return false;
  }
  return (
    typeof event.detail.effectId === 'string' ||
    typeof event.detail.effectId === 'number' ||
    typeof event.detail.instanceId === 'number'
  );
}

// ---------------------------------------------------------------------------
// Atribuição de `seq` e construção da lista ordenada de eventos (R13.6)
// ---------------------------------------------------------------------------

/**
 * Carimba um fluxo de eventos **sem `seq`** com índices sequenciais
 * determinísticos (`0, 1, 2, …`), na própria ordem de entrada, produzindo a
 * lista ordenada de `LogEvent` do `Log_Partida` (R13.6).
 *
 * Também **valida a completude mínima** de cada evento (R13.4): a `narrative`
 * não pode ser vazia (apenas espaços conta como vazia). Uma narrativa vazia é um
 * defeito de contrato da camada emissora e falha cedo com erro determinado, em
 * vez de produzir um log silenciosamente incompleto.
 *
 * O `StateSnapshot` já vem completo dos emissores (posse, placar, quarto,
 * relógio inteiro, down, distância, posição da bola, clima — R13.1/R13.3); este
 * construtor o preserva sem reescrever.
 *
 * @param events Eventos em ordem de emissão (sem `seq`).
 * @returns `ReadonlyArray<LogEvent>` com `seq` sequencial atribuído.
 */
export function assignSeq(
  events: ReadonlyArray<PipelineLogEvent>,
): ReadonlyArray<LogEvent> {
  const out: LogEvent[] = [];
  let seq = 0;
  for (const e of events) {
    if (e.narrative.trim().length === 0) {
      throw new Error(
        `LogEvent #${seq} (type=${e.type}) tem narrativa vazia; ` +
          'todo evento do Log_Partida exige narrativa não vazia (R13.4).',
      );
    }
    out.push({
      seq,
      type: e.type,
      ...(e.snap !== undefined ? { snap: e.snap } : {}),
      ...(e.tick !== undefined ? { tick: e.tick } : {}),
      state: e.state,
      narrative: e.narrative,
      detail: e.detail,
      ...(e.powerReason !== undefined ? { powerReason: e.powerReason } : {}),
    });
    seq++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cabeçalho de auditoria e montagem do GameLog (R1.7, R5.5, R6.10)
// ---------------------------------------------------------------------------

/**
 * `GameStats` vazio — ponto de integração/placeholder enquanto a Task 13.2
 * (`stats.ts`) não deriva as estatísticas reais dos eventos. Permite montar um
 * `GameLog` bem-formado (R13.5 é tratado por 13.2).
 */
export const EMPTY_STATS: GameStats = {
  rushes: { attempts: 0, yards: 0 },
  passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
  turnovers: 0,
  fouls: 0,
  scoringSummary: [],
};

/**
 * Converte o `Seed_RNG` (`bigint`, em `[0, 2^64 - 1]`) para a **representação
 * decimal** registrada em `GameLog.seedUsed` (R1.7). Usar `bigint.toString(10)`
 * é determinístico e preserva o valor exato do uint64 sem perda de precisão.
 *
 * @param seed `Seed_RNG` como `bigint`.
 * @returns Decimal do seed (ex.: `42n → "42"`).
 */
export function seedToDecimal(seed: bigint): string {
  return seed.toString(10);
}

/** Entrada para montar o `GameLog` final. */
export interface BuildGameLogInput {
  /** Eventos em ordem de emissão, sem `seq` (de pipeline, FSM, clima etc.). */
  readonly events: ReadonlyArray<PipelineLogEvent>;
  /** `Seed_RNG` efetivamente usado (registrado em decimal — R1.7). */
  readonly seed: bigint;
  /** Baseline versionado (origem e status não-calibrado — R5.5, R6.10). */
  readonly baseline: Baseline;
  /** Estatísticas agregadas (Task 13.2); default: `EMPTY_STATS`. */
  readonly stats?: GameStats;
  /**
   * Quando `true` (default), de-duplica avisos de efeito inerte relevante por
   * ocorrência `(effectId, instanceId, snap)` antes de atribuir `seq` (R9.4).
   */
  readonly dedupeInert?: boolean;
}

/**
 * Monta o `Log_Partida` completo a partir do fluxo de eventos e do cabeçalho de
 * auditoria.
 *
 * Passos (todos puros e determinísticos):
 * 1. (opcional, default) de-duplica avisos de efeito inerte relevante (R9.4);
 * 2. atribui `seq` sequencial e valida completude de narrativa (R13.4/R13.6);
 * 3. costura o cabeçalho: `seedUsed` em decimal (R1.7), `baselineVersion` e
 *    `baselineStatus` do baseline (R5.5/R6.10), eventos ordenados e `stats`.
 *
 * O clima sorteado e seus modificadores (R7.6) são registrados pelos emissores
 * como eventos `WEATHER_ROLL`/`MATCH_INIT` no próprio fluxo; aqui são apenas
 * ordenados e preservados.
 *
 * @param input Eventos, seed, baseline e (opcional) estatísticas.
 * @returns `GameLog` imutável, pronto para `stableStringify`.
 */
export function buildGameLog(input: BuildGameLogInput): GameLog {
  const dedupe = input.dedupeInert ?? true;
  const ordered = dedupe
    ? dedupeInertWarnings(input.events)
    : input.events;
  const events = assignSeq(ordered);

  return {
    seedUsed: seedToDecimal(input.seed),
    baselineVersion: input.baseline.version,
    baselineStatus: input.baseline.status,
    events,
    stats: input.stats ?? EMPTY_STATS,
  };
}

// ---------------------------------------------------------------------------
// Serialização estável (JSON canônico, comparação byte a byte — R1.1, R13.6)
// ---------------------------------------------------------------------------

/**
 * Qualquer valor serializável pelo `stableStringify`: o `JsonValue` canônico, o
 * `GameLog`, um `LogEvent`, ou coleções desses. Em runtime o serializador aceita
 * qualquer estrutura composta de objetos, arranjos e primitivos JSON; o tipo
 * amplo apenas documenta os usos previstos pelo núcleo.
 */
export type StableSerializable = JsonValue | GameLog | LogEvent | unknown;

/**
 * **Contrato de `stableStringify`** (serializador JSON canônico — R1.1/R13.6):
 *
 * 1. **Chaves ordenadas lexicograficamente** em todos os níveis de todo objeto
 *    (ordenação por code unit UTF-16 via comparação padrão de strings), de modo
 *    que a ordem de inserção das chaves nunca afete a saída.
 * 2. **Sem espaços variáveis**: nenhuma indentação, nenhum espaço após `:` ou
 *    `,` — formato compacto e único.
 * 3. **Relógio/inteiros estáveis**: qualquer `number` de valor inteiro é emitido
 *    sem casa decimal nem notação exponencial para valores no alcance seguro
 *    (`Number.isSafeInteger`), evitando que `9000` e `9000.0` divirjam; o
 *    `gameClock` do `StateSnapshot` já é inteiro por contrato.
 * 4. **Primitivos**: strings são escapadas como no JSON padrão; `boolean` e
 *    `null` como no JSON. Valores não finitos (`NaN`, `±Infinity`) são rejeitados
 *    com erro — o núcleo nunca deve produzi-los; emiti-los como `null`
 *    silenciosamente mascararia um defeito.
 * 5. **`undefined` e funções**: chaves cujo valor é `undefined` (ou função) são
 *    **omitidas** do objeto, como no `JSON.stringify`, mantendo a saída canônica.
 * 6. **`bigint`**: serializado como sua representação decimal **string** (o
 *    `seedUsed` já chega como string; esta regra protege usos diretos).
 *
 * A saída é determinística: a mesma estrutura (a menos da ordem de chaves)
 * sempre produz exatamente a mesma string, habilitando a comparação byte a byte
 * do log entre execuções com a mesma entrada.
 *
 * @param value Estrutura a serializar (log, evento, ou `JsonValue`).
 * @returns String JSON canônica e estável.
 */
export function stableStringify(value: StableSerializable): string {
  return serialize(value);
}

/** Serializa recursivamente um valor em JSON canônico (ver contrato acima). */
function serialize(value: unknown): string {
  // null
  if (value === null) {
    return 'null';
  }

  const t = typeof value;

  if (t === 'string') {
    return JSON.stringify(value as string);
  }

  if (t === 'number') {
    return serializeNumber(value as number);
  }

  if (t === 'boolean') {
    return (value as boolean) ? 'true' : 'false';
  }

  if (t === 'bigint') {
    // Representação decimal estável (string) — nunca notação de ponto flutuante.
    return JSON.stringify((value as bigint).toString(10));
  }

  if (Array.isArray(value)) {
    return serializeArray(value);
  }

  if (t === 'object') {
    return serializeObject(value as Record<string, unknown>);
  }

  // `undefined`, `function`, `symbol` não são serializáveis isoladamente; no
  // nível de objeto/arranjo são tratados pelos respectivos serializadores. Se
  // chegarem aqui como raiz, representam ausência de valor.
  throw new Error(
    `stableStringify: valor não serializável no topo (typeof=${t}).`,
  );
}

/**
 * Serializa um `number` de forma estável: rejeita não finitos; inteiros seguros
 * saem sem casa decimal nem expoente; os demais usam a conversão padrão de
 * `String(number)` (determinística para um dado valor em V8/Node).
 */
function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(
      `stableStringify: número não finito (${n}) não é serializável de forma estável.`,
    );
  }
  if (Number.isInteger(n)) {
    // Inteiro de valor: emite sem ".0" nem expoente quando seguro; caso extremo
    // (fora do alcance seguro mas ainda inteiro) usa a conversão padrão, que
    // para inteiros nunca introduz casa decimal.
    if (Number.isSafeInteger(n)) {
      // Evita o "-0": normaliza para "0".
      return Object.is(n, -0) ? '0' : String(n);
    }
    return String(n);
  }
  return String(n);
}

/** Serializa um arranjo: elementos em ordem; `undefined`/função viram `null`. */
function serializeArray(arr: ReadonlyArray<unknown>): string {
  const parts: string[] = [];
  for (const el of arr) {
    const tt = typeof el;
    // Em arranjos, posições não serializáveis viram `null` (como JSON.stringify).
    if (el === undefined || tt === 'function' || tt === 'symbol') {
      parts.push('null');
    } else {
      parts.push(serialize(el));
    }
  }
  return `[${parts.join(',')}]`;
}

/**
 * Serializa um objeto com **chaves ordenadas lexicograficamente** e omitindo
 * chaves de valor `undefined`/função/símbolo (como `JSON.stringify`). Suporta
 * `toJSON()` (ex.: datas não ocorrem no núcleo, mas o contrato é respeitado).
 */
function serializeObject(obj: Record<string, unknown>): string {
  // Respeita `toJSON` se presente (paridade com JSON.stringify), reaplicando a
  // serialização estável ao resultado.
  const maybeToJson = (obj as { toJSON?: () => unknown }).toJSON;
  if (typeof maybeToJson === 'function') {
    return serialize(maybeToJson.call(obj));
  }

  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    const tt = typeof v;
    if (v === undefined || tt === 'function' || tt === 'symbol') {
      // Omitida da saída canônica.
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${serialize(v)}`);
  }
  return `{${parts.join(',')}}`;
}
