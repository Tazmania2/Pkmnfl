/**
 * Ponto de entrada executável do CLI de ingestão NFL (`Ingestao_NFL`,
 * spec `pfl-data-catalog`).
 *
 * Fina camada sobre {@link runNflIngestion}: liga as dependências de produção
 * ({@link createDefaultIngestionDeps}), executa o pipeline padrão
 * ({@link DEFAULT_NFL_PIPELINE}), imprime o relatório final de falhas parciais
 * e encerra com código de saída coerente (0 em sucesso; 1 se houver qualquer
 * falha parcial). Se `NFL_API_KEY` estiver ausente/vazia, encerra sem
 * requisições com mensagem nomeando a variável faltante (R9.2).
 *
 * Uso: `npm run nfl:ingest`.
 *
 * _Requirements: 9.5, 10.1, 10.2, 10.3_
 */

import {
  createDefaultIngestionDeps,
  formatIngestionReport,
  runNflIngestion,
} from './ingest';
import { MissingNflApiKeyError } from './client';
import { DEFAULT_NFL_PIPELINE } from './pipeline';

/**
 * Executa a ingestão NFL e retorna o código de processo apropriado, sem
 * chamar `process.exit` diretamente (facilita teste do fluxo principal).
 *
 * @returns `0` em sucesso total; `1` em falhas parciais ou credencial ausente.
 */
export async function main(): Promise<number> {
  try {
    const deps = createDefaultIngestionDeps();
    const report = await runNflIngestion(DEFAULT_NFL_PIPELINE, deps);
    console.info(formatIngestionReport(report));
    return report.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof MissingNflApiKeyError) {
      console.error(err.message);
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Ingestao_NFL: erro inesperado: ${message}`);
    return 1;
  }
}

// Executa apenas quando chamado diretamente como script (não ao ser importado).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('ingest-cli')) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
