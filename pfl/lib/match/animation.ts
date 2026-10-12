/**
 * Planejador de cenas da animação 8-bit (`lib/match/animation.ts`) — spec
 * `pfl-gameday-result-ui`.
 *
 * `buildAnimationScenes(log)` é uma **função pura e determinística** que mapeia
 * os Snaps do `Log_Partida` para a sequência de cenas da `Animacao_8bit` (design
 * "Planejador de cenas da animação"). Ela é o coração testável de R9/R10:
 *
 * - **O log é a única verdade** (R9.1, R9.3): a sequência de cenas é uma
 *   **bijeção ordenada** dos Snaps jogados — nenhum Snap é omitido, reordenado
 *   ou repetido. A ordem segue estritamente o `seq` crescente do log (Property
 *   13); cada cena referencia o `eventIndex` de origem para rastreabilidade.
 * - **Pureza** (R10.1, R10.2): nenhum `Date`, nenhum `Math.random`, nenhum I/O.
 *   O `durationHint` é derivado **do próprio log** (tempo de relógio de jogo
 *   consumido entre Snaps), nunca do relógio real — reproduzir o mesmo log
 *   produz exatamente a mesma lista de cenas (Property 14).
 * - **Avisos fiéis** (R12.1): `warnings` por cena reúne o `powerReason` + o
 *   contexto rastreável do `detail`, pela mesma convenção dos leitores de
 *   andamento (`progress.ts`) — nenhum bônus silencioso é inventado.
 * - **Log sem Snaps → `[]`** (R9.7): a Tela_Game_Day vai direto ao resultado.
 *
 * O `player` (Task 14) apenas **reproduz** as cenas já computadas: a `Scene`
 * permanece sem DOM e sem resolução de imagem (os sprites são apenas `pokemonId`
 * via `SpriteRef`, resolvidos pelo player com `resolveSprite`).
 *
 * _Requirements: 9.1, 9.3, 9.7, 10.1, 10.2, 12.1_
 */

import type { Scene, SpriteRef } from './types';
import type { GameLog, LogEvent, LogEventType, JsonValue, Team } from './contracts';

// ---------------------------------------------------------------------------
// Constantes de cadência (ms) — DERIVADAS do log, nunca do relógio real (R10.2)
// ---------------------------------------------------------------------------

/** Piso da duração-base de uma cena, em milissegundos. */
export const MIN_MS = 600;

/** Teto da duração-base de uma cena, em milissegundos. */
export const MAX_MS = 2500;

/**
 * Fator de conversão de **décimos de segundo** de relógio de jogo consumidos
 * entre Snaps para a duração-base da cena, em ms. Puramente convencional (não é
 * tempo de parede): mantém a cadência proporcional ao andamento do próprio log,
 * de forma determinística. 1 décimo de relógio ≈ 25 ms de cena-base.
 */
const MS_PER_CLOCK_DECI = 25;

/**
 * Tipos de evento que representam um **Snap jogado** no `Log_Partida` (design:
 * "`type` em `{SNAP, PLAY_RESULT}`"). O `SNAP` é a âncora de abertura do Snap e
 * o `PLAY_RESULT` carrega o desfecho da jogada; ambos compartilham o mesmo
 * número de `snap`. Agrupamos por `snap` para produzir **uma cena por Snap**
 * (bijeção ordenada, R9.1/R9.3).
 */
const SNAP_EVENT_TYPES: ReadonlySet<LogEventType> = new Set<LogEventType>([
  'SNAP',
  'PLAY_RESULT',
]);

// ---------------------------------------------------------------------------
// Agrupamento interno: um grupo = todos os eventos de um Snap jogado
// ---------------------------------------------------------------------------

/**
 * Eventos de um único Snap, preservando a ordem de chegada (= `seq` crescente).
 * `anchorIndex` é o índice (em `log.events`) do **primeiro** evento do Snap —
 * o `eventIndex` de origem reportado pela cena (rastreabilidade, R9.1/R9.3).
 */
interface SnapGroup {
  readonly snap: number;
  readonly anchorIndex: number;
  readonly events: LogEvent[];
}

/**
 * Deriva deterministicamente a sequência completa de cenas da `Animacao_8bit` a
 * partir do `Log_Partida`. A lista resultante é uma bijeção ordenada dos Snaps
 * jogados (um Snap → uma cena), na ordem crescente de `seq` do log, com `index`
 * numerado `0..N-1`. Log sem Snaps → `[]` (R9.7).
 *
 * Pura e determinística: não consulta relógio de sistema nem entropia — o mesmo
 * `log` sempre produz a mesma saída (R10.1, R10.2).
 */
export function buildAnimationScenes(log: GameLog): Scene[] {
  const groups = groupSnaps(log.events);
  if (groups.length === 0) {
    return [];
  }

  const scenes: Scene[] = [];
  let previousClockDeci: number | null = null;

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (group === undefined) {
      // Inalcançável (iteração em índices válidos); satisfaz o acesso indexado
      // estrito (`noUncheckedIndexedAccess`) sem inventar dados.
      continue;
    }

    const anchor = group.events[0];
    if (anchor === undefined) {
      continue;
    }

    const offense: Team = anchor.state.possession;
    const clockDeci = anchor.state.gameClock;

    scenes.push({
      index: scenes.length,
      snap: group.snap,
      eventIndex: group.anchorIndex,
      offense,
      offenseSprites: collectSprites(group.events, 'offense'),
      defenseSprites: collectSprites(group.events, 'defense'),
      resultKind: deriveResultKind(group.events),
      narrative: anchor.narrative,
      warnings: deriveWarnings(group.events),
      durationHint: deriveDurationHint(clockDeci, previousClockDeci),
    });

    previousClockDeci = clockDeci;
  }

  return scenes;
}

// ---------------------------------------------------------------------------
// Agrupamento de Snaps (preservando a ordem crescente de `seq`) — R9.1, R9.3
// ---------------------------------------------------------------------------

/**
 * Filtra os eventos que representam Snaps jogados (`SNAP`/`PLAY_RESULT`),
 * preservando a ordem de `seq` crescente do log, e os agrupa por número de
 * `snap`. Produz **um grupo por Snap**, na ordem da primeira aparição de cada
 * `snap` — garantindo que nenhuma cena seja omitida, reordenada ou duplicada
 * (bijeção ordenada, Property 13).
 *
 * Eventos de Snap sem `snap` numérico são tratados como um Snap próprio,
 * agrupados por posição (o `seq` crescente é a única fonte de ordem assumida).
 */
function groupSnaps(events: ReadonlyArray<LogEvent>): SnapGroup[] {
  // Ordena por `seq` crescente sem mutar o array de origem (pureza). O log já
  // chega ordenado por `seq`; reordenar defensivamente não altera logs válidos
  // e torna a bijeção robusta a qualquer embaralhamento de entrada.
  const indexed = events.map((event, originalIndex) => ({ event, originalIndex }));
  indexed.sort((a, b) => a.event.seq - b.event.seq);

  const groups: SnapGroup[] = [];
  const bySnap = new Map<number, SnapGroup>();

  for (const { event, originalIndex } of indexed) {
    if (!SNAP_EVENT_TYPES.has(event.type)) {
      continue;
    }

    const snapNo = typeof event.snap === 'number' ? event.snap : -1;

    if (snapNo >= 0) {
      const existing = bySnap.get(snapNo);
      if (existing !== undefined) {
        existing.events.push(event);
        continue;
      }
      const group: SnapGroup = {
        snap: snapNo,
        anchorIndex: originalIndex,
        events: [event],
      };
      bySnap.set(snapNo, group);
      groups.push(group);
      continue;
    }

    // Snap sem número: cada evento é seu próprio grupo (não agrupável por `snap`).
    groups.push({ snap: snapNo, anchorIndex: originalIndex, events: [event] });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Derivação de `resultKind` a partir do `detail` dos eventos do Snap (R9.1)
// ---------------------------------------------------------------------------

/**
 * Extrai o tipo de resultado da jogada do `detail` dos eventos do Snap, sem
 * inventar categorias. Prioriza os marcadores mais específicos do
 * `PLAY_RESULT`:
 * - `turnover` (fumble/INT) → `'TURNOVER'`;
 * - `intercepted` → `'INTERCEPTION'`;
 * - passe (`completed` presente) → `'PASS_COMPLETE'`/`'PASS_INCOMPLETE'`;
 * - caso contrário, o `offense` (play id) do `detail`, quando presente, como
 *   rótulo rastreável; senão `'PLAY'`.
 */
function deriveResultKind(events: ReadonlyArray<LogEvent>): string {
  for (const event of events) {
    const detail = event.detail;

    if (readBooleanField(detail, 'turnover') === true) {
      return 'TURNOVER';
    }
    if (readBooleanField(detail, 'intercepted') === true) {
      return 'INTERCEPTION';
    }

    const completed = detail['completed'];
    if (typeof completed === 'boolean') {
      return completed ? 'PASS_COMPLETE' : 'PASS_INCOMPLETE';
    }
  }

  // Sem marcador de desfecho: usa o identificador de jogada ofensiva do detail.
  for (const event of events) {
    const offensePlay = readStringField(event.detail, 'offense');
    if (offensePlay !== null) {
      return offensePlay;
    }
  }

  return 'PLAY';
}

// ---------------------------------------------------------------------------
// Montagem de sprites por lado (R9.1) — identificados por `pokemonId` no log
// ---------------------------------------------------------------------------

/**
 * Monta `SpriteRef[]` de um lado do Snap a partir dos `pokemonId` presentes no
 * `detail`/`state` dos eventos do Snap, preservando a ordem de primeira
 * aparição e **deduplicando** por `pokemonId`. Nenhum sprite é fabricado: só
 * entram ids efetivamente registrados no log (R9.1 — o log é a única verdade).
 * Quando o log não registra pokémon para o lado, retorna `[]` (o player exibe o
 * substituto conforme R9.6, nunca uma fonte externa).
 *
 * O parâmetro `side` seleciona a chave de busca no `detail`:
 * - `'offense'` → ids ofensivos (`offensePokemonIds`, `offenseIds`...);
 * - `'defense'` → ids defensivos (`defensePokemonIds`, `defenseIds`...).
 */
function collectSprites(
  events: ReadonlyArray<LogEvent>,
  side: 'offense' | 'defense',
): SpriteRef[] {
  const keys =
    side === 'defense'
      ? ['defensePokemonIds', 'defenseIds', 'defensePokemon', 'defense']
      : ['offensePokemonIds', 'offenseIds', 'offensePokemon'];

  const seen = new Set<number>();
  const sprites: SpriteRef[] = [];

  for (const event of events) {
    for (const key of keys) {
      const ids = readPokemonIds(event.detail, key);
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          sprites.push({ pokemonId: id });
        }
      }
    }
  }

  return sprites;
}

/**
 * Lê de `detail[key]` uma lista de `pokemonId` numéricos. Aceita tanto um array
 * de números quanto um array de objetos com campo `pokemonId` numérico (duas
 * formas plausíveis de o log registrar as unidades em campo). Qualquer outro
 * formato é ignorado — sem inventar ids.
 */
function readPokemonIds(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): number[] {
  const value = detail[key];
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: number[] = [];
  for (const entry of value) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      ids.push(entry);
      continue;
    }
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const pokemonId = (entry as Record<string, JsonValue>)['pokemonId'];
      if (typeof pokemonId === 'number' && Number.isFinite(pokemonId)) {
        ids.push(pokemonId);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Derivação de avisos — mesma convenção de `progress.ts` (R12.1)
// ---------------------------------------------------------------------------

/**
 * Reúne os avisos de efeito inerte/supressão dos eventos do Snap, pela **mesma
 * convenção** dos leitores de andamento (`progress.ts`): um aviso por evento com
 * `powerReason` presente, anexando o contexto rastreável do `detail`
 * (`effectId`, `instanceId`, `outcome`). Nenhum aviso é introduzido quando o log
 * não registra motivo de poder, e nenhum bônus silencioso é inventado
 * (R12.1–R12.3). Avisos idênticos repetidos entre eventos do mesmo Snap são
 * de-duplicados para refletir uma ocorrência por mensagem.
 */
function deriveWarnings(events: ReadonlyArray<LogEvent>): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];

  for (const event of events) {
    for (const warning of warningsOf(event)) {
      if (!seen.has(warning)) {
        seen.add(warning);
        warnings.push(warning);
      }
    }
  }

  return warnings;
}

/**
 * Deriva a lista de avisos de um único evento a partir do seu `powerReason` e do
 * contexto do `detail` — espelha `deriveWarnings` de `progress.ts` para manter a
 * exibição consistente entre o HUD e a Alternativa_Textual (R12.1).
 */
function warningsOf(event: LogEvent): string[] {
  const reason = event.powerReason;
  if (reason === undefined || reason === '') {
    return [];
  }

  const parts: string[] = [reason];

  const effectId = readStringField(event.detail, 'effectId');
  if (effectId !== null) {
    parts.push(`efeito ${effectId}`);
  }

  const instanceId = readNumberField(event.detail, 'instanceId');
  if (instanceId !== null) {
    parts.push(`atleta ${instanceId}`);
  }

  const outcome = readStringField(event.detail, 'outcome');
  if (outcome !== null) {
    parts.push(outcome);
  }

  return [parts.join(' — ')];
}

// ---------------------------------------------------------------------------
// Derivação de `durationHint` — proporcional ao relógio de jogo (R10.2)
// ---------------------------------------------------------------------------

/**
 * Deriva a duração-base da cena (ms) a partir do tempo de **relógio de jogo**
 * consumido entre este Snap e o anterior — nunca do relógio real (R10.2). O
 * `gameClock` está em décimos de segundo e decresce dentro de um quarto; a
 * diferença (clamp a ≥ 0, para absorver viradas de quarto onde o relógio
 * reinicia) é escalada por `MS_PER_CLOCK_DECI` e limitada a `[MIN_MS, MAX_MS]`.
 * O primeiro Snap (sem anterior) recebe o piso `MIN_MS`. Determinístico: função
 * apenas dos relógios do log.
 */
function deriveDurationHint(
  clockDeci: number,
  previousClockDeci: number | null,
): number {
  if (previousClockDeci === null) {
    return MIN_MS;
  }

  const elapsedDeci = Math.max(0, previousClockDeci - clockDeci);
  const raw = elapsedDeci * MS_PER_CLOCK_DECI;
  return clamp(raw, MIN_MS, MAX_MS);
}

/** Limita `value` ao intervalo fechado `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Leitores defensivos de `detail` (sem inventar valores)
// ---------------------------------------------------------------------------

/** Lê um campo string de `detail`, retornando `null` quando ausente/outro tipo. */
function readStringField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): string | null {
  const value = detail[key];
  return typeof value === 'string' ? value : null;
}

/** Lê um campo numérico de `detail`, retornando `null` quando ausente/outro tipo. */
function readNumberField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): number | null {
  const value = detail[key];
  return typeof value === 'number' ? value : null;
}

/** Lê um campo booleano de `detail`, retornando `null` quando ausente/outro tipo. */
function readBooleanField(
  detail: Readonly<Record<string, JsonValue>>,
  key: string,
): boolean | null {
  const value = detail[key];
  return typeof value === 'boolean' ? value : null;
}
