/**
 * Setup global de testes do `pfl-simulation-engine` (`lib/sim/test-setup.ts`).
 *
 * Carregado pelo Vitest (`setupFiles`) antes de qualquer suíte. Seu único papel
 * é tornar os testes baseados em propriedades (`fast-check`) **reprodutíveis em
 * CI**: quando a variável de ambiente `CI` está definida, fixamos o `seed`
 * global do `fast-check` para que uma falha em CI possa ser reproduzida
 * localmente passando o mesmo seed. Fora de CI, deixamos o seed livre para
 * explorar o espaço de entradas a cada execução local.
 *
 * Este arquivo é o único ponto do pacote `lib/sim/` autorizado a ler ambiente
 * (`process.env`), e o faz **apenas no contexto de testes** — jamais no caminho
 * do núcleo puro (`simulate`), que não lê ambiente, relógio nem entropia
 * externa (fronteira de pureza — R1.5).
 *
 * _Requirements: 1.5, 15.6_
 */

import fc from 'fast-check';

/**
 * Seed fixo usado em CI para reprodutibilidade dos property tests. O valor é
 * arbitrário mas estável; o que importa é que seja o mesmo entre execuções de
 * CI, de modo que um contraexemplo encontrado em CI seja reproduzível.
 */
export const CI_FAST_CHECK_SEED = 0x50464c; // "PFL" em hexadecimal

/**
 * Número mínimo de iterações por propriedade exigido pelo plano de testes do
 * design. Property tests do `lib/sim/` devem usar `{ numRuns: PBT_NUM_RUNS }`.
 */
export const PBT_NUM_RUNS = 100;

const isCi = Boolean(process.env.CI);

fc.configureGlobal({
  numRuns: PBT_NUM_RUNS,
  // Em CI, seed determinístico; localmente, seed aleatório por execução.
  ...(isCi ? { seed: CI_FAST_CHECK_SEED } : {}),
});
