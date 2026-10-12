import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Configuração do Vitest para o PFL.
 *
 * - `environment: 'node'` (padrão): a maioria dos testes (validação de env vars,
 *   lógica pura de catálogo/seed/sim e os módulos puros de `lib/match/`) roda em
 *   contexto de servidor Node, sem DOM. Testes de componente/acessibilidade da
 *   spec `pfl-gameday-result-ui` optam por `jsdom` por arquivo, via o docblock
 *   `// @vitest-environment jsdom` no topo do arquivo de teste. Isso evita o
 *   custo do DOM nos milhares de testes puros existentes e habilita
 *   `@testing-library/react` + `jest-axe` só onde há React/DOM.
 * - `include`: testes co-localizados com o código-fonte usando o sufixo
 *   `.test.ts`/`.test.tsx` em qualquer lugar do projeto.
 * - `globals: true`: expõe `describe`/`it`/`expect` sem import explícito.
 * - `setupFiles`:
 *   - `./lib/sim/test-setup.ts` — configura o `fast-check` (seed fixo em CI,
 *     `numRuns: 100` por padrão em todas as propriedades, incluindo as 27
 *     Correctness Properties desta spec).
 *   - `./vitest.setup.dom.ts` — registra os matchers de `@testing-library/jest-dom`
 *     e estende `expect` com `toHaveNoViolations` do `jest-axe`. É seguro em
 *     ambiente `node` (os matchers só são exercidos pelos testes `jsdom`).
 * - `@vitejs/plugin-react`: habilita JSX/Fast Refresh nos testes de componente
 *   `.test.tsx`.
 */
export default defineConfig({
  plugins: [react()],
  // Espelha o alias de caminho do tsconfig (`@/* -> ./*`) para que módulos que
  // usam o prefixo `@/` (ex.: o Route Handler `app/api/simulate/route.ts` e os
  // contratos consumidos em `lib/match/contracts.ts`) sejam resolvidos sob o
  // Vitest, que não lê os `paths` do tsconfig.
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
    setupFiles: ['./lib/sim/test-setup.ts', './vitest.setup.dom.ts'],
  },
});
