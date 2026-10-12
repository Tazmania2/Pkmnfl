/**
 * Augmentação de tipos dos matchers de teste de DOM/acessibilidade do PFL
 * (`types/testing-matchers.d.ts`).
 *
 * Os matchers registrados em runtime por `vitest.setup.dom.ts` precisam de
 * declarações de tipo para que o `tsc` reconheça as asserções usadas nos testes
 * de componente (`@testing-library/react` + `jest-axe`) da spec
 * `pfl-gameday-result-ui`:
 *
 * 1. `@testing-library/jest-dom/vitest` estende a interface `Assertion` do
 *    Vitest com os matchers de DOM (`toBeInTheDocument`, `toHaveFocus`,
 *    `toHaveAccessibleName`, ...).
 * 2. `jest-axe` não publica tipos para o Vitest, então declaramos aqui o único
 *    matcher que consumimos: `toHaveNoViolations` (checagem automatizada de
 *    acessibilidade, R17.1/R17.2).
 *
 * Arquivo somente de tipos — não emite código e não altera o comportamento em
 * runtime.
 */

/// <reference types="@testing-library/jest-dom/vitest" />

import 'vitest';

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
