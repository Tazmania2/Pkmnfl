/**
 * Adaptador de chamada ao motor (`lib/match/simulate-client.ts`) — spec
 * `pfl-gameday-result-ui`.
 *
 * É a **única borda de rede** desta spec: monta o `SimulateRequest` a partir do
 * `SimulateInput` (as duas escalações, as duas estratégias, o `Seed_RNG` e o
 * `botModeAway` já mapeado por `modoParaBot(modo)`), faz **`POST /api/simulate`
 * uma única vez** (R5.2) e **normaliza** a resposta do motor num
 * `SimulateOutcome` discriminado (design → "Adaptador de chamada ao motor").
 *
 * Princípios refletidos (design "Princípios de design"):
 * - **O log é a única verdade** (R6.3, R6.4): em sucesso, `log` e `score` do
 *   corpo 200 são retidos **verbatim**; nada é recalculado aqui.
 * - **Seed de RNG separado do seed de time** (R6.2): o `seed` enviado é
 *   `input.seedRng`, **nunca** derivado de qualquer seed de time.
 * - **Contratos reusados, nunca redefinidos**: `SimulateInput`/`SimulateOutcome`
 *   vêm de `./types`; `SimulateRequest`/`SimulateResponse`/`SimulateError` de
 *   `./contracts` (reexport da fonte autoritativa da spec 3). Nada é copiado.
 *
 * ## Normalização da resposta
 *
 * | Resposta do motor                                   | `SimulateOutcome`                               |
 * |-----------------------------------------------------|-------------------------------------------------|
 * | **200** `{ log, score }`                            | `{ ok:true, log, score }` (R6.3)                |
 * | **400** `{ error, field? }`                         | `{ ok:false, kind:'INPUT', message, field? }` (R6.5) |
 * | outro status não-2xx com corpo `{ error, field? }`  | `{ ok:false, kind:'INPUT', message, field? }`   |
 * | exceção de rede/`fetch` lançando/timeout            | `{ ok:false, kind:'NETWORK', message }` (R7.4)  |
 * | 2xx/corpo ilegível ou fora do contrato              | `{ ok:false, kind:'NETWORK', message }`         |
 *
 * Escolha de classificação para status não-200 que **não** sejam 400: um corpo
 * no formato de erro de entrada (`{ error }`) é tratado como `INPUT` (o motor
 * recusou a entrada e não anima/navega, R6.5); qualquer outra condição — 5xx,
 * corpo ausente/ilegível, resposta fora do contrato — é tratada como `NETWORK`,
 * pois representa uma falha de comunicação/execução que **permite nova
 * tentativa** sem corrigir a entrada (R7.4).
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.5, 7.4, 2.3_
 */

import type { SimulateInput, SimulateOutcome } from './types';
import type {
  SimulateRequest,
  SimulateResponse,
  SimulateError,
} from './contracts';

/** Endpoint da `Funcao_Simulacao` (Route Handler da spec 3). */
const SIMULATE_ENDPOINT = '/api/simulate';

/** `true` para objetos simples (não-nulos, não-arranjos). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Interpreta um corpo cru como `SimulateError` (`{ error, field? }`), ou
 * `null` se não casar com a forma. Usado para classificar respostas não-200.
 */
function asSimulateError(body: unknown): SimulateError | null {
  if (!isObject(body) || typeof body.error !== 'string') {
    return null;
  }
  return typeof body.field === 'string'
    ? { error: body.error, field: body.field }
    : { error: body.error };
}

/**
 * Interpreta um corpo cru como `SimulateResponse` (`{ log, score }`) de forma
 * mínima: exige a presença dos dois campos como objetos. O conteúdo é retido
 * **verbatim** (nenhum valor é recalculado, R6.4); a validação do formato
 * interno do log/placar é responsabilidade do motor.
 */
function asSimulateResponse(body: unknown): SimulateResponse | null {
  if (!isObject(body) || !isObject(body.log) || !isObject(body.score)) {
    return null;
  }
  return body as unknown as SimulateResponse;
}

/**
 * Monta o corpo `SimulateRequest` a partir do `SimulateInput` (R6.1):
 * `home` = escalação do jogador, `away` = escalação do adversário,
 * `strategyHome`/`strategyAway` = as duas estratégias, `seed` = `Seed_RNG`
 * (R6.2 — **nunca** derivado de seed de time) e `botModeAway` já mapeado por
 * `modoParaBot(modo)` (R2.*). O jogador não é bot: `botModeHome` é omitido.
 */
function buildRequest(input: SimulateInput): SimulateRequest {
  return {
    home: input.playerLineup,
    away: input.adversaryLineup,
    strategyHome: input.playerStrategy,
    strategyAway: input.adversaryStrategy,
    seed: input.seedRng,
    botModeAway: input.botModeAway,
  };
}

/**
 * Invoca a `Funcao_Simulacao` uma única vez e normaliza a resposta.
 *
 * Faz `POST /api/simulate` com o `SimulateRequest` serializado em JSON (uma só
 * chamada, R5.2). Mapeia a resposta num `SimulateOutcome` discriminado, sem
 * recalcular nenhum valor (R6.3, R6.4). Falhas de rede/`fetch`/timeout e
 * respostas fora do contrato tornam-se `NETWORK` (R7.4); o erro de entrada do
 * motor (400) torna-se `INPUT` (R6.5).
 *
 * @param input As duas escalações, as duas estratégias, o `Seed_RNG` e o
 *   `botModeAway` (= `modoParaBot(modo)`).
 * @returns O `SimulateOutcome` normalizado.
 */
export async function runSimulation(
  input: SimulateInput,
): Promise<SimulateOutcome> {
  const body = buildRequest(input);

  let response: Response;
  try {
    // POST único (R5.2). Exceção de rede/timeout cai no catch → NETWORK (R7.4).
    response = await fetch(SIMULATE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'falha de comunicação com o motor';
    return { ok: false, kind: 'NETWORK', message };
  }

  // Lê o corpo como JSON. Corpo ilegível/não-JSON → falha de comunicação (R7.4).
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      kind: 'NETWORK',
      message: 'resposta do motor ilegível',
    };
  }

  // Sucesso (200): retém log/placar verbatim, sem recalcular (R6.3, R6.4).
  if (response.ok) {
    const success = asSimulateResponse(payload);
    if (success !== null) {
      return { ok: true, log: success.log, score: success.score };
    }
    // 2xx fora do contrato: trata como falha de comunicação (R7.4).
    return {
      ok: false,
      kind: 'NETWORK',
      message: 'resposta do motor fora do contrato esperado',
    };
  }

  // Não-2xx: um corpo `{ error, field? }` é erro de entrada do motor (R6.5).
  const errorBody = asSimulateError(payload);
  if (response.status === 400 && errorBody !== null) {
    return errorBody.field !== undefined
      ? { ok: false, kind: 'INPUT', message: errorBody.error, field: errorBody.field }
      : { ok: false, kind: 'INPUT', message: errorBody.error };
  }
  if (errorBody !== null) {
    // Outro status não-2xx com forma de erro de entrada → INPUT (ver cabeçalho).
    return errorBody.field !== undefined
      ? { ok: false, kind: 'INPUT', message: errorBody.error, field: errorBody.field }
      : { ok: false, kind: 'INPUT', message: errorBody.error };
  }

  // 5xx / corpo sem forma de erro → falha de comunicação, permite retry (R7.4).
  return {
    ok: false,
    kind: 'NETWORK',
    message: `simulação não concluída (status ${response.status})`,
  };
}
