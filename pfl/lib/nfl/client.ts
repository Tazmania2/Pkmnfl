/**
 * Cliente resiliente da API_NFL (spec `pfl-data-catalog`).
 *
 * Este módulo concentra a configuração e a política de retry/backoff do
 * acesso à API externa `nfl.balldontlie.io`. Nesta etapa (Task 11.1) são
 * implementados:
 *
 * - A configuração (`NflClientConfig`) lida **exclusivamente** de variáveis
 *   de ambiente (`NFL_API_BASE_URL`, `NFL_API_KEY`), sem qualquer valor de
 *   credencial embutido no código-fonte (R9.1).
 * - O cálculo de backoff exponencial limitado
 *   `computeBackoffDelay(n, cfg) = min(maxDelayMs, baseDelayMs * 2^(n-1))`,
 *   com base de 1000ms e teto de 30000ms (R9.3, R9.4).
 *
 * A requisição com retry (`fetchWithRetry`) e o logger sanitizado são
 * implementados na Task 11.3.
 *
 * _Requirements: 9.1, 9.3, 9.4_
 */

/** Nomes das variáveis de ambiente lidas pela configuração do cliente NFL. */
export const NFL_ENV_VARS = {
  /** URL base da API_NFL. */
  BASE_URL: 'NFL_API_BASE_URL',
  /** Credencial de acesso à API_NFL. Nunca embutida no código nem logada. */
  API_KEY: 'NFL_API_KEY',
} as const;

/** URL base padrão da API_NFL quando `NFL_API_BASE_URL` não é definida. */
export const NFL_DEFAULT_BASE_URL = 'https://nfl.balldontlie.io';

/** Tempo limite padrão de requisição, em milissegundos (R9.4). */
export const NFL_DEFAULT_TIMEOUT_MS = 30_000;
/** Número máximo de tentativas por endpoint (R9.3, R9.4). */
export const NFL_DEFAULT_MAX_RETRIES = 5;
/** Atraso base do backoff, em milissegundos (R9.3). */
export const NFL_DEFAULT_BASE_DELAY_MS = 1_000;
/** Teto do backoff, em milissegundos (R9.3, R9.4). */
export const NFL_DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Configuração do cliente NFL.
 *
 * `baseUrl` e `apiKey` vêm de variáveis de ambiente; os demais campos
 * controlam a resiliência (timeout, número de tentativas e política de
 * backoff exponencial).
 */
export interface NflClientConfig {
  /** URL base da API_NFL (de `NFL_API_BASE_URL`). */
  readonly baseUrl: string;
  /** Credencial da API_NFL (de `NFL_API_KEY`). Nunca é logada. */
  readonly apiKey: string;
  /** Tempo limite por requisição, em milissegundos. */
  readonly timeoutMs: number;
  /** Número máximo de tentativas por endpoint. */
  readonly maxRetries: number;
  /** Atraso base do backoff, em milissegundos. */
  readonly baseDelayMs: number;
  /** Teto do backoff, em milissegundos. */
  readonly maxDelayMs: number;
}

/**
 * Motivo de uma falha de requisição à API_NFL.
 *
 * - `rate_limit`: a API respondeu com status de limite de requisições (429).
 * - `timeout`: a requisição excedeu `timeoutMs`.
 * - `network`: erro de rede sem resposta HTTP.
 * - `http_error`: erro HTTP definitivo (4xx/5xx não repetível).
 */
export type FetchFailureReason = 'rate_limit' | 'timeout' | 'network' | 'http_error';

/**
 * Resultado de uma tentativa de busca contra a API_NFL.
 *
 * Em sucesso, carrega os dados tipados; em falha, identifica o endpoint
 * afetado, o motivo e o número de tentativas realizadas — sem jamais
 * conter o valor da credencial.
 */
export type FetchOutcome<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly endpoint: string;
      readonly reason: FetchFailureReason;
      readonly attempts: number;
    };

/**
 * Erro lançado quando a credencial da API_NFL (`NFL_API_KEY`) está ausente
 * ou vazia. Expõe o nome da variável faltante para diagnóstico, sem jamais
 * conter o valor de qualquer credencial.
 */
export class MissingNflApiKeyError extends Error {
  /** Nome da variável de ambiente faltante. */
  public readonly missing: string;

  constructor(missing: string = NFL_ENV_VARS.API_KEY) {
    super(
      'Configuração da API_NFL incompleta: ' +
        `variável de ambiente obrigatória ausente ou vazia: ${missing}. ` +
        'Defina-a no ambiente (ex.: .env.local) antes de iniciar a ingestão.',
    );
    this.name = 'MissingNflApiKeyError';
    this.missing = missing;
  }
}

/**
 * Lê e valida a configuração do cliente NFL a partir de variáveis de
 * ambiente.
 *
 * - `apiKey` é lida exclusivamente de `NFL_API_KEY` (R9.1); se ausente ou
 *   vazia após `trim`, lança {@link MissingNflApiKeyError} nomeando a
 *   variável, sem realizar requisições (R9.2).
 * - `baseUrl` é lida de `NFL_API_BASE_URL`; na ausência, usa
 *   {@link NFL_DEFAULT_BASE_URL}.
 * - Os demais campos usam os padrões de resiliência (timeout 30s,
 *   5 tentativas, base 1000ms, teto 30000ms).
 *
 * @returns Configuração tipada e imutável do cliente NFL.
 * @throws {MissingNflApiKeyError} Se `NFL_API_KEY` estiver ausente ou vazia.
 */
export function loadNflClientConfig(): NflClientConfig {
  const apiKey = process.env[NFL_ENV_VARS.API_KEY]?.trim() ?? '';
  if (apiKey === '') {
    throw new MissingNflApiKeyError(NFL_ENV_VARS.API_KEY);
  }

  const baseUrlRaw = process.env[NFL_ENV_VARS.BASE_URL]?.trim() ?? '';
  const baseUrl = baseUrlRaw === '' ? NFL_DEFAULT_BASE_URL : baseUrlRaw;

  return {
    baseUrl,
    apiKey,
    timeoutMs: NFL_DEFAULT_TIMEOUT_MS,
    maxRetries: NFL_DEFAULT_MAX_RETRIES,
    baseDelayMs: NFL_DEFAULT_BASE_DELAY_MS,
    maxDelayMs: NFL_DEFAULT_MAX_DELAY_MS,
  };
}

/**
 * Calcula o atraso de backoff exponencial para a tentativa `attempt`.
 *
 * Fórmula: `min(maxDelayMs, baseDelayMs * 2^(attempt - 1))`.
 *
 * Com `baseDelayMs = 1000` e `maxDelayMs = 30000`, a sequência de atrasos
 * para `attempt = 1..5` é 1s, 2s, 4s, 8s, 16s (R9.3, R9.4). A mesma política
 * vale para rate limit, timeout e erro de rede.
 *
 * @param attempt Número da tentativa (base 1). Valores menores que 1 são
 *   tratados como 1 para evitar expoente negativo.
 * @param cfg Configuração do cliente, com `baseDelayMs` e `maxDelayMs`.
 * @returns O atraso em milissegundos, nunca superior a `cfg.maxDelayMs`.
 */
export function computeBackoffDelay(attempt: number, cfg: NflClientConfig): number {
  const n = attempt < 1 ? 1 : Math.floor(attempt);
  const exponential = cfg.baseDelayMs * 2 ** (n - 1);
  return Math.min(cfg.maxDelayMs, exponential);
}

/* -------------------------------------------------------------------------- *
 * Task 11.3 — `fetchWithRetry` e logger sanitizado
 *
 * Implementa a requisição resiliente à API_NFL com:
 * - timeout de `cfg.timeoutMs` (30s por padrão) via `AbortController` e header
 *   de autorização `Authorization: Bearer <apiKey>` (R9.4);
 * - retry em 429 (rate limit), timeout e erro de rede até `cfg.maxRetries`
 *   (5) tentativas, aguardando `computeBackoffDelay` entre tentativas
 *   (R9.3, R9.4);
 * - ao esgotar as tentativas, retorna `FetchOutcome` com `ok:false`,
 *   `endpoint`, `reason` e `attempts` (R9.3, R9.5);
 * - guarda contra `NFL_API_KEY` ausente/vazia, encerrando sem requisições e
 *   nomeando a variável de ambiente faltante (R9.2);
 * - logger sanitizado que remove o valor da credencial de qualquer mensagem
 *   (R9.6).
 *
 * _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_
 * -------------------------------------------------------------------------- */

/**
 * Função de busca compatível com a `fetch` global, injetável para testes.
 * Mantém a assinatura mínima utilizada por {@link fetchWithRetry}.
 */
export type FetchFn = (
  input: string,
  init: {
    readonly headers: Record<string, string>;
    readonly signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/**
 * Subconjunto da resposta HTTP consumido por {@link fetchWithRetry}. Mantido
 * mínimo para permitir dublês de teste sem depender da implementação completa
 * de `Response`.
 */
export interface FetchResponseLike {
  /** Indica status 2xx. */
  readonly ok: boolean;
  /** Código de status HTTP (ex.: 200, 429, 503). */
  readonly status: number;
  /** Corpo decodificado como JSON. */
  json(): Promise<unknown>;
}

/**
 * Logger mínimo usado pelo cliente NFL. Toda mensagem passa por sanitização
 * antes de ser emitida (R9.6).
 */
export interface NflLogger {
  /** Registra uma mensagem informativa já sanitizada. */
  info(message: string): void;
  /** Registra uma mensagem de aviso já sanitizada. */
  warn(message: string): void;
  /** Registra uma mensagem de erro já sanitizada. */
  error(message: string): void;
}

/** Texto que substitui o valor da credencial nas mensagens sanitizadas. */
export const NFL_REDACTED_PLACEHOLDER = '***REDACTED***';

/**
 * Remove toda ocorrência do valor da credencial de uma mensagem de log,
 * substituindo-a por {@link NFL_REDACTED_PLACEHOLDER} (R9.6).
 *
 * A substituição é literal (não interpreta regex) e cobre todas as
 * ocorrências. Quando `apiKey` é vazia, a mensagem é retornada sem alteração.
 *
 * @param message Mensagem potencialmente contendo a credencial.
 * @param apiKey Valor da credencial a ser removido.
 * @returns Mensagem sem qualquer ocorrência do valor da credencial.
 */
export function sanitizeLogMessage(message: string, apiKey: string): string {
  if (apiKey === '') {
    return message;
  }
  return message.split(apiKey).join(NFL_REDACTED_PLACEHOLDER);
}

/**
 * Cria um {@link NflLogger} que sanitiza toda mensagem removendo o valor de
 * `apiKey` antes de delegar ao `sink` (por padrão, `console`).
 *
 * Garante que o valor da credencial jamais seja emitido em logs de
 * informação, aviso ou erro (R9.6).
 *
 * @param apiKey Credencial a ser removida de todas as mensagens.
 * @param sink Destino das mensagens já sanitizadas (injetável para testes).
 * @returns Um logger que sempre sanitiza suas mensagens.
 */
export function createSanitizedLogger(
  apiKey: string,
  sink: NflLogger = {
    info: (m) => console.info(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  },
): NflLogger {
  return {
    info: (m) => sink.info(sanitizeLogMessage(m, apiKey)),
    warn: (m) => sink.warn(sanitizeLogMessage(m, apiKey)),
    error: (m) => sink.error(sanitizeLogMessage(m, apiKey)),
  };
}

/**
 * Dependências injetáveis de {@link fetchWithRetry}. Todas possuem padrões
 * de produção; os testes podem sobrescrevê-las para evitar I/O real e esperas
 * de tempo reais.
 */
export interface FetchWithRetryDeps {
  /** Implementação de busca HTTP (padrão: `fetch` global). */
  readonly fetchFn?: FetchFn;
  /** Função de espera entre tentativas, em ms (padrão: `setTimeout`). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Logger sanitizado (padrão: {@link createSanitizedLogger} sobre `cfg.apiKey`). */
  readonly logger?: NflLogger;
}

/** Espera `ms` milissegundos resolvendo uma Promise (padrão de produção). */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Status HTTP de limite de requisições (rate limit). */
const HTTP_STATUS_RATE_LIMIT = 429;

/**
 * Monta a URL absoluta de um endpoint a partir da `baseUrl` da configuração,
 * tolerando barras sobrepostas entre base e caminho.
 */
function resolveEndpointUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  const base = baseUrl.replace(/\/+$/, '');
  const path = endpoint.replace(/^\/+/, '');
  return `${base}/${path}`;
}

/**
 * Realiza uma requisição GET resiliente à API_NFL.
 *
 * Comportamento (R9.2–R9.6):
 * - Se `cfg.apiKey` estiver ausente/vazia (após `trim`), encerra **sem**
 *   realizar qualquer requisição e lança {@link MissingNflApiKeyError}
 *   nomeando `NFL_API_KEY` (R9.2).
 * - Cada tentativa aplica timeout de `cfg.timeoutMs` via `AbortController` e
 *   envia o header `Authorization: Bearer <apiKey>` (R9.4).
 * - Em status 429, timeout ou erro de rede, aguarda
 *   `computeBackoffDelay(tentativa, cfg)` e repete, até `cfg.maxRetries`
 *   tentativas (R9.3, R9.4).
 * - Em erro HTTP definitivo (4xx/5xx que não seja 429), não repete.
 * - Ao esgotar as tentativas (ou em falha definitiva), retorna um
 *   `FetchOutcome` com `ok:false`, `endpoint`, `reason` e `attempts`, sem
 *   jamais conter o valor da credencial (R9.3, R9.5, R9.6).
 *
 * @typeParam T Tipo esperado do corpo JSON em caso de sucesso.
 * @param endpoint Caminho relativo (resolvido contra `cfg.baseUrl`) ou URL
 *   absoluta do recurso NFL.
 * @param cfg Configuração do cliente (ver {@link loadNflClientConfig}).
 * @param deps Dependências injetáveis (fetch, sleep, logger) para teste.
 * @returns Promise de {@link FetchOutcome} com os dados ou a falha descrita.
 * @throws {MissingNflApiKeyError} Se `cfg.apiKey` estiver ausente/vazia.
 */
export async function fetchWithRetry<T>(
  endpoint: string,
  cfg: NflClientConfig,
  deps: FetchWithRetryDeps = {},
): Promise<FetchOutcome<T>> {
  const apiKey = cfg.apiKey?.trim() ?? '';
  if (apiKey === '') {
    // R9.2: encerra sem requisições, nomeando a env var faltante.
    throw new MissingNflApiKeyError(NFL_ENV_VARS.API_KEY);
  }

  const fetchFn = deps.fetchFn ?? defaultFetchFn;
  const sleep = deps.sleep ?? defaultSleep;
  const logger = deps.logger ?? createSanitizedLogger(cfg.apiKey);

  const url = resolveEndpointUrl(cfg.baseUrl, endpoint);
  const maxRetries = cfg.maxRetries < 1 ? 1 : Math.floor(cfg.maxRetries);

  let lastReason: FetchFailureReason = 'network';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const response = await fetchFn(url, {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (response.ok) {
        const data = (await response.json()) as T;
        return { ok: true, data };
      }

      if (response.status === HTTP_STATUS_RATE_LIMIT) {
        // R9.3: rate limit é repetível com backoff.
        lastReason = 'rate_limit';
        logger.warn(
          `API_NFL rate limit (429) no endpoint ${endpoint} ` +
            `(tentativa ${attempt}/${maxRetries}).`,
        );
      } else {
        // R9.5: erro HTTP definitivo (não 429) não é repetível.
        logger.error(
          `API_NFL erro HTTP ${response.status} no endpoint ${endpoint} ` +
            `(tentativa ${attempt}/${maxRetries}); falha definitiva.`,
        );
        return { ok: false, endpoint, reason: 'http_error', attempts: attempt };
      }
    } catch (err) {
      // Timeout (abort) e erro de rede são repetíveis (R9.4).
      lastReason = classifyError(err, controller.signal.aborted);
      logger.warn(
        `API_NFL falha de ${lastReason} no endpoint ${endpoint} ` +
          `(tentativa ${attempt}/${maxRetries}).`,
      );
    } finally {
      clearTimeout(timer);
    }

    // Aguarda o backoff entre tentativas, exceto após a última.
    if (attempt < maxRetries) {
      await sleep(computeBackoffDelay(attempt, cfg));
    }
  }

  // R9.3/R9.5: tentativas esgotadas — sinaliza falha identificando o endpoint.
  logger.error(
    `API_NFL falha definitiva no endpoint ${endpoint} após ${maxRetries} ` +
      `tentativas (motivo: ${lastReason}).`,
  );
  return { ok: false, endpoint, reason: lastReason, attempts: maxRetries };
}

/**
 * Classifica um erro capturado durante a requisição em um
 * {@link FetchFailureReason} repetível (`timeout` ou `network`).
 *
 * @param err Erro capturado (geralmente de `fetch`/abort).
 * @param aborted Se o `AbortController` foi acionado por timeout.
 */
function classifyError(err: unknown, aborted: boolean): FetchFailureReason {
  if (aborted) {
    return 'timeout';
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return 'timeout';
  }
  return 'network';
}

/**
 * Implementação padrão de {@link FetchFn} sobre a `fetch` global do runtime
 * (Node 22 / Next.js). Adapta a assinatura ao subconjunto utilizado.
 */
const defaultFetchFn: FetchFn = async (input, init) => {
  const response = await fetch(input, {
    method: 'GET',
    headers: init.headers,
    signal: init.signal,
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  };
};
