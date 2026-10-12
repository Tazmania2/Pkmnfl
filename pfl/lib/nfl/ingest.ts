/**
 * Orquestrador do CLI de ingestão NFL (`Ingestao_NFL`, spec `pfl-data-catalog`).
 *
 * Implementa o "Fluxo de resiliência da API NFL" do design: para cada endpoint
 * do pipeline, faz {@link fetchWithRetry}; em sucesso, mapeia a resposta para
 * `NflMatchupRow[]` e chama {@link upsertNflMatchups}; em falha definitiva,
 * registra o endpoint afetado (de forma sanitizada) e **prossegue** com os
 * demais, mantendo inalterados os dados já persistidos (R9.5). Ao final, emite
 * um relatório agregado de falhas parciais (endpoints que falharam e eventuais
 * rejeições de persistência).
 *
 * O núcleo (`runNflIngestion`) recebe suas dependências por injeção
 * (`fetch`, `persist`, `logger`, `config`) para ser unitariamente testável sem
 * rede nem Supabase reais. O ponto de entrada de produção
 * (`createDefaultIngestionDeps`) liga as implementações concretas lendo a
 * configuração de ambiente.
 *
 * _Requirements: 9.5, 10.1, 10.2, 10.3_
 */

import {
  createSanitizedLogger,
  fetchWithRetry as defaultFetchWithRetry,
  loadNflClientConfig,
  type FetchOutcome,
  type NflClientConfig,
  type NflLogger,
} from './client';
import { upsertNflMatchups as defaultUpsertNflMatchups } from './persist';
import type { NflMatchupRow } from './types';
import type { UpsertResult } from '../catalog/types';

/**
 * Descreve um endpoint do pipeline de ingestão NFL.
 *
 * - `name`: rótulo estável do endpoint para relatórios e logs.
 * - `path`: caminho relativo (resolvido contra a `baseUrl`) ou URL absoluta.
 * - `map`: converte o corpo JSON retornado em `NflMatchupRow[]`. Mantém o
 *   mapeamento específico de cada recurso fora do orquestrador, que permanece
 *   genérico e testável.
 */
export interface NflEndpoint {
  /** Rótulo estável do endpoint (usado em logs e no relatório). */
  readonly name: string;
  /** Caminho relativo ou URL absoluta do recurso NFL. */
  readonly path: string;
  /** Mapeia a resposta bruta para as linhas de matchup a persistir. */
  readonly map: (data: unknown) => NflMatchupRow[];
}

/** Falha definitiva de um endpoint, registrada no relatório final (R9.5). */
export interface EndpointFailure {
  /** Rótulo do endpoint afetado. */
  readonly name: string;
  /** Caminho/URL do endpoint afetado. */
  readonly path: string;
  /** Motivo da falha reportado pelo cliente resiliente. */
  readonly reason: FetchFailureSummary;
  /** Número de tentativas realizadas antes de desistir. */
  readonly attempts: number;
}

/** Motivo resumido de falha (espelha `FetchFailureReason` do cliente). */
export type FetchFailureSummary = 'rate_limit' | 'timeout' | 'network' | 'http_error';

/** Resultado da persistência de um endpoint bem-sucedido. */
export interface EndpointPersisted {
  /** Rótulo do endpoint. */
  readonly name: string;
  /** Linhas efetivamente gravadas (semântica de "linhas afetadas"). */
  readonly inserted: number;
  /** Linhas atualizadas (0 no upsert em bloco; ver {@link upsertNflMatchups}). */
  readonly updated: number;
  /** Rejeições de persistência deste endpoint (linhas inválidas/erro de lote). */
  readonly rejected: UpsertResult['rejected'];
}

/**
 * Relatório agregado da ingestão NFL.
 *
 * `ok` é `true` somente quando nenhum endpoint falhou e nenhuma linha foi
 * rejeitada na persistência; caso contrário, descreve as falhas parciais sem
 * ter interrompido os demais endpoints.
 */
export interface NflIngestionReport {
  /** Verdadeiro se todos os endpoints persistiram sem falhas nem rejeições. */
  readonly ok: boolean;
  /** Total de endpoints processados. */
  readonly totalEndpoints: number;
  /** Endpoints persistidos com sucesso (pode conter rejeições parciais). */
  readonly persisted: EndpointPersisted[];
  /** Endpoints que falharam de forma definitiva (não interromperam o pipeline). */
  readonly failures: EndpointFailure[];
}

/**
 * Dependências injetáveis de {@link runNflIngestion}. Em produção são ligadas
 * por {@link createDefaultIngestionDeps}; nos testes, dublês evitam rede e
 * Supabase reais.
 */
export interface NflIngestionDeps {
  /** Configuração do cliente NFL (de ambiente, por padrão). */
  readonly config: NflClientConfig;
  /**
   * Busca resiliente de um endpoint (padrão: {@link fetchWithRetry}).
   *
   * O orquestrador não conhece o tipo do corpo de cada endpoint; cada
   * mapeador (`NflEndpoint.map`) o interpreta. Por isso a dependência é
   * tipada como `FetchOutcome<unknown>`.
   */
  readonly fetch: (endpoint: string, cfg: NflClientConfig) => Promise<FetchOutcome<unknown>>;
  /** Persistência idempotente dos matchups (padrão: {@link upsertNflMatchups}). */
  readonly persist: (rows: NflMatchupRow[]) => Promise<UpsertResult>;
  /** Logger sanitizado (padrão: {@link createSanitizedLogger} sobre a credencial). */
  readonly logger: NflLogger;
}

/**
 * Executa a ingestão NFL sobre o `pipeline` de endpoints fornecido.
 *
 * Para cada endpoint, na ordem:
 * 1. Chama `deps.fetch(path, config)`.
 * 2. Em sucesso (`ok:true`), mapeia a resposta via `endpoint.map` e persiste
 *    com `deps.persist`; agrega as rejeições parciais da persistência (R10.1,
 *    R10.2, R10.3).
 * 3. Em falha definitiva (`ok:false`), registra o endpoint afetado (sanitizado)
 *    e **prossegue** com os demais, sem alterar os dados já persistidos (R9.5).
 *
 * O método não relança erros de endpoint individuais: cada falha vira uma
 * entrada no relatório. Ao final, retorna o {@link NflIngestionReport}
 * agregado.
 *
 * @param pipeline Endpoints do pipeline de ingestão, com seus mapeadores.
 * @param deps Dependências injetáveis (config, fetch, persist, logger).
 * @returns Relatório agregado com persistências e falhas parciais.
 */
export async function runNflIngestion(
  pipeline: readonly NflEndpoint[],
  deps: NflIngestionDeps,
): Promise<NflIngestionReport> {
  const persisted: EndpointPersisted[] = [];
  const failures: EndpointFailure[] = [];

  for (const endpoint of pipeline) {
    const outcome = await deps.fetch(endpoint.path, deps.config);

    if (!outcome.ok) {
      // R9.5: falha definitiva — registra o endpoint e prossegue.
      failures.push({
        name: endpoint.name,
        path: endpoint.path,
        reason: outcome.reason,
        attempts: outcome.attempts,
      });
      deps.logger.error(
        `Ingestao_NFL: endpoint "${endpoint.name}" (${endpoint.path}) falhou ` +
          `definitivamente (motivo: ${outcome.reason}, tentativas: ${outcome.attempts}); ` +
          'prosseguindo com os demais endpoints.',
      );
      continue;
    }

    // Sucesso: mapeia a resposta e persiste de forma idempotente (R10.1-10.3).
    let rows: NflMatchupRow[];
    try {
      rows = endpoint.map(outcome.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        name: endpoint.name,
        path: endpoint.path,
        reason: 'http_error',
        attempts: 0,
      });
      deps.logger.error(
        `Ingestao_NFL: endpoint "${endpoint.name}" (${endpoint.path}) retornou ` +
          `dados em formato inesperado: ${message}; prosseguindo com os demais.`,
      );
      continue;
    }

    const result = await deps.persist(rows);
    persisted.push({
      name: endpoint.name,
      inserted: result.inserted,
      updated: result.updated,
      rejected: result.rejected,
    });

    if (result.rejected.length > 0) {
      deps.logger.warn(
        `Ingestao_NFL: endpoint "${endpoint.name}" persistiu ${result.inserted} ` +
          `linha(s), com ${result.rejected.length} rejeição(ões) parcial(is).`,
      );
    } else {
      deps.logger.info(
        `Ingestao_NFL: endpoint "${endpoint.name}" persistiu ${result.inserted} linha(s).`,
      );
    }
  }

  const hasRejections = persisted.some((p) => p.rejected.length > 0);
  const ok = failures.length === 0 && !hasRejections;

  return {
    ok,
    totalEndpoints: pipeline.length,
    persisted,
    failures,
  };
}

/**
 * Cria as dependências de produção para {@link runNflIngestion}, lendo a
 * configuração do ambiente e ligando o cliente resiliente, a persistência
 * idempotente e um logger sanitizado sobre a credencial.
 *
 * @throws {MissingNflApiKeyError} Se `NFL_API_KEY` estiver ausente ou vazia
 *   (propagado por {@link loadNflClientConfig}), encerrando sem requisições.
 */
export function createDefaultIngestionDeps(): NflIngestionDeps {
  const config = loadNflClientConfig();
  return {
    config,
    fetch: (endpoint, cfg) => defaultFetchWithRetry(endpoint, cfg),
    persist: (rows) => defaultUpsertNflMatchups(rows),
    logger: createSanitizedLogger(config.apiKey),
  };
}

/**
 * Formata o {@link NflIngestionReport} em um resumo legível de uma linha por
 * seção, para impressão no CLI. Não expõe credenciais (as mensagens já são
 * sanitizadas na origem).
 */
export function formatIngestionReport(report: NflIngestionReport): string {
  const lines: string[] = [];
  lines.push(
    `Ingestao_NFL — ${report.ok ? 'SUCESSO' : 'FALHAS PARCIAIS'}: ` +
      `${report.persisted.length}/${report.totalEndpoints} endpoint(s) persistido(s), ` +
      `${report.failures.length} falha(s).`,
  );
  for (const p of report.persisted) {
    lines.push(
      `  [ok] ${p.name}: ${p.inserted} gravada(s)` +
        (p.rejected.length > 0 ? `, ${p.rejected.length} rejeitada(s)` : ''),
    );
  }
  for (const f of report.failures) {
    lines.push(`  [falha] ${f.name} (${f.path}): ${f.reason} após ${f.attempts} tentativa(s)`);
  }
  return lines.join('\n');
}
