import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Testes de smoke de presença dos artefatos anti-slop (Task 14.3).
 *
 * Verificação determinística de ferramental: afirma que os artefatos de regras
 * do Anti_Slop produzidos por `npx antislop-ai` estão posicionados no local
 * reconhecido como regras de projeto do agente (`.kiro/steering/`) e versionados
 * no repositório (não ignorados pelo `.gitignore`).
 *
 * _Requirements:_
 *   - R3.2 — os artefatos de configuração do Anti_Slop ficam versionados no
 *            repositório.
 *   - R3.3 — os arquivos de regras de agente ficam no local reconhecido como
 *            regras de projeto.
 *
 * Observações:
 *   - Os caminhos são resolvidos a partir deste arquivo (`tests/smoke/` → sobe
 *     dois níveis até a raiz do Projeto_Base `pfl/`), de modo que o teste
 *     independe do `cwd` com que o Vitest é invocado.
 *   - As asserções usam `fs` do Node (sem dependências externas): leitura direta
 *     dos artefatos e do `.gitignore`.
 */

/** Raiz do Projeto_Base `pfl/` (este arquivo está em `pfl/tests/smoke/`). */
const PROJECT_ROOT = join(__dirname, '..', '..');

/** Local reconhecido como regras de projeto do agente. */
const STEERING_DIR = join(PROJECT_ROOT, '.kiro', 'steering');

/** Arquivo núcleo de regras anti-slop (front matter `inclusion: always`). */
const ANTISLOP_RULES = join(STEERING_DIR, 'antislop.md');

/** Marcador de versão do conjunto de regras instalado. */
const ANTISLOP_VERSION = join(STEERING_DIR, 'antislop.VERSION');

/**
 * Converte um padrão de `.gitignore` numa checagem de prefixo/segmento simples,
 * suficiente para afirmar que NENHUM padrão exclui os artefatos de steering.
 *
 * A verificação é propositalmente conservadora: normaliza o caminho relativo
 * para separadores POSIX e testa se algum padrão (ancorado ou não) casaria com
 * o caminho ou com um de seus diretórios ancestrais.
 */
function isIgnoredByPattern(relPosixPath: string, rawPattern: string): boolean {
  const pattern = rawPattern.trim();
  // Linhas vazias e comentários não ignoram nada.
  if (pattern === '' || pattern.startsWith('#')) {
    return false;
  }
  // Padrões de negação (`!`) re-incluem; não excluem.
  if (pattern.startsWith('!')) {
    return false;
  }

  // Normaliza o padrão: remove âncora inicial e barra final.
  const anchored = pattern.startsWith('/');
  let core = anchored ? pattern.slice(1) : pattern;
  core = core.replace(/\/$/, '');
  if (core === '') {
    return false;
  }

  const pathSegments = relPosixPath.split('/');

  // Caso 1: padrão com barra (caminho) → compara contra o prefixo do caminho.
  if (core.includes('/')) {
    const coreSegments = core.split('/');
    return coreSegments.every((seg, i) => segmentMatches(seg, pathSegments[i]));
  }

  // Caso 2: padrão simples (sem barra) → casa com qualquer segmento do caminho
  // se não ancorado; se ancorado, apenas com o primeiro segmento.
  if (anchored) {
    return segmentMatches(core, pathSegments[0]);
  }
  return pathSegments.some((seg) => segmentMatches(core, seg));
}

/** Casa um segmento de padrão de `.gitignore` (com `*`) contra um segmento. */
function segmentMatches(pattern: string, segment: string | undefined): boolean {
  if (segment === undefined) {
    return false;
  }
  if (!pattern.includes('*')) {
    return pattern === segment;
  }
  // Traduz o glob de segmento para regex (`*` = qualquer coisa, exceto `/`).
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(segment);
}

describe('smoke de presença dos artefatos anti-slop (R3.2, R3.3)', () => {
  it('R3.3 — `antislop.md` existe no local de regras e é não-vazio', () => {
    expect(
      existsSync(ANTISLOP_RULES),
      `esperado o arquivo de regras em ${ANTISLOP_RULES}`,
    ).toBe(true);

    const content = readFileSync(ANTISLOP_RULES, 'utf8');
    expect(content.trim().length, 'arquivo de regras não deve ser vazio').toBeGreaterThan(0);
  });

  it('R3.3 — `antislop.md` contém conteúdo reconhecível de regras anti-slop', () => {
    const content = readFileSync(ANTISLOP_RULES, 'utf8');

    // Identidade do conjunto de regras (título do núcleo).
    expect(content).toContain('# antislop');
    // Marcadores estáveis das regras obrigatórias (R-01..R-38).
    expect(content).toContain('Mandatory Rules');
    expect(content).toContain('R-01');
  });

  it('R3.2 — `antislop.VERSION` existe (artefato de configuração versionado)', () => {
    expect(
      existsSync(ANTISLOP_VERSION),
      `esperado o marcador de versão em ${ANTISLOP_VERSION}`,
    ).toBe(true);

    const content = readFileSync(ANTISLOP_VERSION, 'utf8');
    expect(content.trim().length, 'marcador de versão não deve ser vazio').toBeGreaterThan(0);
  });

  it('R3.2 — nenhum padrão do `.gitignore` exclui os artefatos de steering', () => {
    const gitignorePath = join(PROJECT_ROOT, '.gitignore');
    expect(existsSync(gitignorePath), `esperado ${gitignorePath}`).toBe(true);

    const patterns = readFileSync(gitignorePath, 'utf8').split(/\r?\n/);

    // Caminhos relativos (POSIX) dos artefatos que DEVEM ser versionados.
    const artifacts = [
      '.kiro/steering/antislop.md',
      '.kiro/steering/antislop.VERSION',
      '.kiro/steering/README.antislop.md',
    ];

    for (const artifact of artifacts) {
      const matching = patterns.filter((p) => isIgnoredByPattern(artifact, p));
      expect(
        matching,
        `o artefato ${artifact} seria excluído pelos padrões: ${JSON.stringify(matching)}`,
      ).toHaveLength(0);
    }
  });
});
