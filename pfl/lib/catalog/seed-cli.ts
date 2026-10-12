/**
 * Ponto de entrada executável do `Processo_Seed` do catálogo
 * (spec `pfl-data-catalog`).
 *
 * Fina camada sobre {@link runSeed}: resolve os caminhos dos arquivos locais do
 * Catálogo Oficial (de variáveis de ambiente, com padrões), carrega as fontes
 * em memória ({@link loadSeedSources}), liga os escritores de produção
 * ({@link createDefaultSeedWriters}) e imprime o relatório final, encerrando com
 * código de saída coerente: `0` quando o seed conclui sem rejeições; `1` quando
 * aborta por divergência de checksum ou conclui com rejeições parciais.
 *
 * Uso: `npm run seed`.
 *
 * _Requirements: 1.1, 1.5, 2.1, 3.1, 4.1, 5.1, 6.1, 6.4, 7.3, 7.5, 11.1, 11.2_
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createDefaultSeedWriters,
  formatSeedReport,
  loadSeedSources,
  runSeed,
  type RawResourceReader,
  type SeedPaths,
} from './seed';
import type { RawResource } from './validate';
import type { DesignBaselineKind, DesignBaselineRow, ManifestEntry } from './types';

/** Diretório raiz do acervo do Catálogo Oficial (configurável por ambiente). */
const DEFAULT_CATALOG_ROOT = resolve(process.cwd(), 'lib', 'data', 'catalog');

/**
 * Resolve os caminhos dos arquivos do catálogo. `PFL_CATALOG_ROOT` sobrescreve
 * o diretório raiz; os nomes dos arquivos seguem o acervo v1.7.
 */
export function resolveSeedPaths(root = process.env.PFL_CATALOG_ROOT ?? DEFAULT_CATALOG_ROOT): SeedPaths {
  const at = (file: string): string => resolve(root, file);
  return {
    fichas: at('fichas_146_pfl_v16.json'),
    moves: at('moves_591_enriched.json'),
    abilities: at('abilities_113_enriched.json'),
    movesReverseIndex: at('moves_to_pokemon_ids.json'),
    abilitiesReverseIndex: at('abilities_to_pokemon_ids.json'),
    manifest: at('manifest.json'),
    matchups36: at('matchups_36.json'),
    simulationParameters: at('simulation_parameters.json'),
  };
}

/** `true` sse `value` é um objeto não nulo e não um array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lê a `version` legível de um artefato de baseline, com padrão estável. */
function readVersion(payload: unknown): string {
  if (isRecord(payload) && typeof payload['version'] === 'string' && payload['version'].trim() !== '') {
    return payload['version'];
  }
  return 'unversioned';
}

/** Lê o `status` legível de um artefato de baseline, com padrão vazio. */
function readStatus(payload: unknown): string {
  if (isRecord(payload) && typeof payload['status'] === 'string') {
    return payload['status'];
  }
  return '';
}

/**
 * Lê os artefatos de baseline (`matchups_36.json`, `simulation_parameters.json`)
 * em linhas `design_baseline`, preservando o `payload` fiel do arquivo e
 * registrando ambos sob a `version` declarada no próprio arquivo (Reqs. 11.1,
 * 11.2). Arquivo ausente é ignorado (não é fatal para o seed do catálogo).
 */
export function loadBaselineRows(paths: SeedPaths): DesignBaselineRow[] {
  const rows: DesignBaselineRow[] = [];

  const artifacts: ReadonlyArray<{ path: string; kind: DesignBaselineKind }> = [
    { path: paths.matchups36, kind: 'matchups_36' },
    { path: paths.simulationParameters, kind: 'simulation_parameters' },
  ];

  for (const { path, kind } of artifacts) {
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      // Artefato de baseline ausente/ilegível: pulado (opcional para o catálogo).
      continue;
    }
    rows.push({
      version: readVersion(payload),
      kind,
      status: readStatus(payload),
      payload,
    });
  }

  return rows;
}

/**
 * Lê os bytes crus dos recursos declarados no manifest, para a conferência de
 * checksums da pré-escrita. Recursos ilegíveis geram uma entrada com bytes
 * vazios, que o verificador tratará como divergência (abortando o seed).
 */
export function createRawResourceReader(root: string): RawResourceReader {
  return (manifest: readonly ManifestEntry[]): RawResource[] => {
    const resources: RawResource[] = [];
    for (const entry of manifest) {
      try {
        resources.push({ path: entry.path, bytes: readFileSync(resolve(root, entry.path)) });
      } catch {
        resources.push({ path: entry.path, bytes: new Uint8Array() });
      }
    }
    return resources;
  };
}

/**
 * Executa o seed e retorna o código de processo apropriado, sem chamar
 * `process.exit` diretamente (facilita o teste do fluxo principal).
 *
 * @returns `0` em sucesso total; `1` em abortagem por checksum ou rejeições.
 */
export async function main(): Promise<number> {
  const root = process.env.PFL_CATALOG_ROOT ?? DEFAULT_CATALOG_ROOT;
  const paths = resolveSeedPaths(root);

  try {
    const sources = loadSeedSources(paths, createRawResourceReader(root), loadBaselineRows);
    const report = await runSeed({ sources, writers: createDefaultSeedWriters() });
    console.info(formatSeedReport(report));
    return report.ok ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Processo_Seed: erro inesperado: ${message}`);
    return 1;
  }
}

// Executa apenas quando chamado diretamente como script (não ao ser importado).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('seed-cli')) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
