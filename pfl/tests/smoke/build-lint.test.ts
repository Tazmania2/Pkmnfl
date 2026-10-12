import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Testes de smoke do ferramental de build e lint (Task 14.1).
 *
 * Cobrem as regras determinísticas de ferramental, que não variam de forma
 * significativa com input (daí smoke em vez de PBT):
 *
 * _Requirements:_
 *   - R1.3 — `next build` conclui com código de saída 0 em ≤300s.
 *   - R1.4 — um erro de compilação TypeScript aborta o build com código ≠0 e
 *            aponta o arquivo e a linha de cada erro.
 *   - R4.2 — `eslint` passa sem erros sobre o código inicial.
 *
 * Observações:
 *   - Os comandos rodam com `cwd` fixado na raiz do Projeto_Base (`pfl/`),
 *     resolvida a partir deste arquivo (`tests/smoke/` → sobe dois níveis).
 *   - `shell: true` garante que os binários `.cmd` do npm no Windows sejam
 *     resolvidos corretamente.
 *   - O caso de erro de tipo roda um `tsc --noEmit` ISOLADO sobre um único
 *     arquivo temporário (nunca dentro de `pfl/`, para não poluir o build ou
 *     outras execuções concorrentes). O arquivo vive num diretório temporário
 *     único do SO e é removido no `finally`, mesmo em caso de falha.
 */

/** Raiz do Projeto_Base `pfl/` (este arquivo está em `pfl/tests/smoke/`). */
const PROJECT_ROOT = join(__dirname, '..', '..');

/** Timeout generoso para o build (R1.3 exige ≤300s). */
const BUILD_TIMEOUT_MS = 300_000;

/**
 * Executa um comando de forma síncrona com `cwd` em `pfl/`.
 *
 * O comando completo é passado como string única com `shell: true`, para que
 * os binários `.cmd` do npm no Windows sejam resolvidos corretamente. Todos os
 * comandos abaixo são fixos (sem input do usuário), então não há risco de
 * injeção — mas qualquer argumento dinâmico (ex.: caminho do arquivo temporário)
 * é passado via `quote()` para citação segura.
 */
function run(command: string, timeoutMs: number): SpawnSyncReturns<string> {
  return spawnSync(command, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: timeoutMs,
    // Builds e lints podem emitir muita saída; dá folga ao buffer.
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Cita um caminho/argumento com aspas duplas, escapando aspas internas. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

describe('smoke de build e lint (R1.3, R1.4, R4.2)', () => {
  it(
    'R1.3 — `next build` conclui com código de saída 0 em ≤300s',
    () => {
      const started = Date.now();
      const result = run('npm run build', BUILD_TIMEOUT_MS);
      const elapsedMs = Date.now() - started;

      // Não deve ter sido morto por timeout.
      expect(result.signal, 'build não deve ser interrompido por timeout').toBeNull();
      // Código de saída 0 = build bem-sucedido (R1.3).
      expect(
        result.status,
        `esperado exit 0; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0);
      // Conclui dentro do orçamento de 300s (R1.3).
      expect(elapsedMs).toBeLessThanOrEqual(BUILD_TIMEOUT_MS);
    },
    BUILD_TIMEOUT_MS + 30_000,
  );

  it(
    'R1.4 — um erro de tipo aborta a compilação com código ≠0 e aponta arquivo:linha',
    () => {
      // Diretório temporário único do SO — NUNCA dentro de `pfl/`, para não
      // poluir o build nem interferir em execuções concorrentes.
      const tmpDir = mkdtempSync(join(tmpdir(), 'pfl-typeerror-'));
      const badFileName = `.tmp-typeerror-${Date.now()}.ts`;
      const badFilePath = join(tmpDir, badFileName);

      try {
        // Erro de tipo deliberado: atribuir `number` a `string`.
        // A anotação explícita força o erro mesmo sob checagem isolada.
        // A linha do erro é a 2 (a atribuição malformada).
        const source = [
          '// Arquivo temporário com erro de tipo deliberado (R1.4).',
          'const value: string = 123;',
          'export default value;',
          '',
        ].join('\n');
        writeFileSync(badFilePath, source, 'utf8');

        // `tsc --noEmit --strict` sobre UM único arquivo: checagem isolada,
        // sem puxar o projeto inteiro (rápido e sem efeitos colaterais).
        const result = run(
          `npx tsc --noEmit --strict --pretty false ${quote(badFilePath)}`,
          60_000,
        );

        const output = `${result.stdout}\n${result.stderr}`;

        // Saída diferente de zero (R1.4).
        expect(
          result.status,
          `esperado exit ≠0 para erro de tipo; saída:\n${output}`,
        ).not.toBe(0);
        expect(result.status).not.toBeNull();

        // A mensagem referencia o ARQUIVO do erro.
        expect(output).toContain(badFileName);
        // E a LINHA (formato `arquivo(linha,coluna)` do tsc).
        expect(output).toMatch(/\.tmp-typeerror-\d+\.ts\(\d+,\d+\)/);
        // Confirma o código de erro de tipo do TS (TS2322: tipo incompatível).
        expect(output).toContain('TS2322');
      } finally {
        // Limpeza garantida, mesmo em falha — remove o diretório temporário
        // inteiro para não deixar artefatos.
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    90_000,
  );

  it(
    'R4.2 — `eslint` passa sem erros sobre o código inicial',
    () => {
      const result = run('npm run lint', 120_000);

      expect(result.signal, 'lint não deve ser interrompido por timeout').toBeNull();
      expect(
        result.status,
        `esperado lint sem erros (exit 0); stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0);
    },
    150_000,
  );
});
