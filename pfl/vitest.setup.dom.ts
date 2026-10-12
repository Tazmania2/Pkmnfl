/**
 * Setup global de testes de DOM/acessibilidade do PFL (`vitest.setup.dom.ts`).
 *
 * Carregado pelo Vitest (`setupFiles`) antes de qualquer suíte. Registra:
 *
 * 1. Os matchers de `@testing-library/jest-dom` (ex.: `toBeInTheDocument`,
 *    `toHaveFocus`, `toHaveAccessibleName`), usados pelos testes de componente
 *    da spec `pfl-gameday-result-ui` (`@testing-library/react`).
 * 2. O matcher `toHaveNoViolations` do `jest-axe` (sobre `axe-core`), usado
 *    pelas checagens automatizadas de acessibilidade (R17).
 *
 * O arquivo é seguro de carregar mesmo no ambiente `node` padrão: apenas estende
 * o objeto `expect` do Vitest com matchers; eles só são **exercidos** pelos
 * testes que rodam em `jsdom` (declarado por `// @vitest-environment jsdom` no
 * topo do arquivo de teste). A validação completa de WCAG exige, além disso,
 * verificação manual com tecnologia assistiva — o `jest-axe` cobre o subconjunto
 * automatizável.
 *
 * _Requirements: 17.1, 17.2, 17.6, 17.7_
 */

import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { toHaveNoViolations } from 'jest-axe';

// Matchers do Testing Library (DOM assertions legíveis).
expect.extend(matchers);
// Matcher de acessibilidade do jest-axe (axe-core).
expect.extend(toHaveNoViolations);
