/**
 * Teste de fronteira de pureza do núcleo de simulação
 * (`lib/sim/purity-boundary.test.ts`).
 *
 * Esta suíte estabelece e protege, desde o esqueleto (Task 1.1), o invariante
 * de arquitetura central do `pfl-simulation-engine`: o **núcleo puro** não pode
 * depender de rede, banco de dados, relógio de sistema ou leitura de ambiente.
 * Toda variação entra pela assinatura (`ResolvedInput` + `Seed_RNG`) e sai no
 * resultado (`SimulationResult`), o que torna o determinismo verificável.
 *
 * A suíte também serve de smoke test do ambiente de testes: confirma que o
 * runner (Vitest) e o `fast-check` (com seed fixo em CI) estão operacionais.
 *
 * _Requirements: 1.5, 15.6_
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { CI_FAST_CHECK_SEED, PBT_NUM_RUNS } from './test-setup';

const SIM_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Padrões proibidos no caminho do núcleo puro. Qualquer `import` ou uso de
 * entropia/relógio/ambiente/rede/banco quebra o determinismo auditável (R1.5).
 * O `test-setup.ts` é o único ponto autorizado a ler `process.env`, e só no
 * contexto de testes — por isso ele é excluído da varredura.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  { label: 'Math.random()', regex: /\bMath\s*\.\s*random\b/ },
  { label: 'Date / Date.now()', regex: /\bDate\s*\.\s*now\b|\bnew\s+Date\b/ },
  { label: 'performance.now()', regex: /\bperformance\s*\.\s*now\b/ },
  { label: 'process.env', regex: /\bprocess\s*\.\s*env\b/ },
  { label: 'import de crypto', regex: /from\s+['"]node:crypto['"]|require\(\s*['"]crypto['"]\s*\)/ },
  { label: 'import de rede (fetch/http)', regex: /from\s+['"]node:https?['"]|\bfetch\s*\(/ },
  { label: 'acesso a filesystem', regex: /from\s+['"]node:fs['"]/ },
  { label: 'cliente Supabase (banco)', regex: /from\s+['"][^'"]*supabase[^'"]*['"]/ },
  { label: 'camada de dados lib/data', regex: /from\s+['"][^'"]*lib\/data[^'"]*['"]/ },
];

/** Arquivos do pacote `lib/sim/` que NÃO fazem parte do núcleo puro. */
const NON_CORE_FILES = new Set(['test-setup.ts']);

/** Coleta recursivamente os `.ts` de produção do núcleo (exclui testes). */
function collectCoreFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectCoreFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts')) continue;
    if (NON_CORE_FILES.has(entry)) continue;
    out.push(full);
  }
  return out;
}

describe('Fronteira de pureza do núcleo (lib/sim)', () => {
  const coreFiles = collectCoreFiles(SIM_ROOT);

  it('o esqueleto de módulos do núcleo existe', () => {
    const relative = coreFiles.map((f) => path.relative(SIM_ROOT, f).replace(/\\/g, '/')).sort();

    // Módulos de topo e subpastas conforme a organização de módulos do design.
    expect(relative).toContain('rng.ts');
    expect(relative).toContain('state.ts');
    expect(relative).toContain('clock.ts');
    expect(relative).toContain('fsm.ts');
    expect(relative).toContain('matchups.ts');
    expect(relative).toContain('log.ts');
    expect(relative).toContain('stats.ts');
    expect(relative).toContain('simulate.ts');
    expect(relative).toContain('types.ts');
    expect(relative).toContain('play/select.ts');
    expect(relative).toContain('play/pipeline.ts');
    expect(relative).toContain('play/probability.ts');
    expect(relative).toContain('play/fatigue.ts');
    expect(relative).toContain('play/weather.ts');
    expect(relative).toContain('play/sphere.ts');
    expect(relative).toContain('play/inert.ts');
    expect(relative).toContain('play/anatomy.ts');
    expect(relative).toContain('bots/policy.ts');
    expect(relative).toContain('bots/randomBot.ts');
    expect(relative).toContain('bots/curtiBot.ts');
    expect(relative).toContain('bots/seededBot.ts');
  });

  it('nenhum módulo do núcleo importa rede, banco, relógio ou ambiente (R1.5, R15.6)', () => {
    const violations: string[] = [];

    for (const file of coreFiles) {
      const source = readFileSync(file, 'utf8');
      // Ignora linhas de comentário para não acusar menções em docstrings.
      const code = source
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          return !(
            trimmed.startsWith('*') ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*')
          );
        })
        .join('\n');

      for (const { label, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(code)) {
          violations.push(`${path.relative(SIM_ROOT, file)}: ${label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('Smoke test do ambiente de property-based testing (fast-check)', () => {
  it('configuração global aplica numRuns e seed fixo em CI', () => {
    expect(PBT_NUM_RUNS).toBe(100);
    expect(CI_FAST_CHECK_SEED).toBe(0x50464c);
  });

  it('fast-check executa uma propriedade trivial determinística', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        // Comutatividade da soma: propriedade pura, sem fontes de entropia.
        expect(a + b).toBe(b + a);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
