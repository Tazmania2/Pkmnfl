// @vitest-environment jsdom

/**
 * Property 25 — spec `pfl-gameday-result-ui`, Task 17.2.
 *
 * **Seed_RNG exibido é o seed da partida corrente.** Para todo `Seed_RNG`
 * decimal uint64, o valor que `SeedRngDisplay` apresenta ao jogador é **igual,
 * verbatim**, ao `seedRng` recebido — nunca transformado, truncado ou derivado.
 * Esse valor é exatamente o que a store retém como seed da partida corrente:
 * acionando a FSM real (`createMatchStore → selecionarModo → iniciarSimulacao`),
 * o `seedRng` em `getState()` é o próprio seed informado, e o que o componente
 * desenha é esse mesmo seed — ligando "o que é exibido" ao seed da partida de
 * forma rastreável (R16.3). No caso `null` (nenhuma partida iniciada), nenhum
 * número é fabricado: só o placeholder honesto aparece.
 *
 * **Validates: Requirements 16.3**
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import { SeedRngDisplay } from './SeedRngDisplay';
import { createMatchStore } from '@/lib/match';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Arbitrário de Seed_RNG: decimal uint64 (0 .. 2^64 - 1) como string, mais
// constantes de fronteira (mínimo, máximo, potências de dois e vizinhos) que
// exercitam exatamente as bordas onde um erro de transformação apareceria.
// ---------------------------------------------------------------------------

const UINT64_MAX = (1n << 64n) - 1n;

const BOUNDARY_SEEDS: ReadonlyArray<string> = [
  '0',
  '1',
  '9',
  '10',
  '255',
  '9007199254740991', // Number.MAX_SAFE_INTEGER — além da precisão de number
  '9007199254740992', // MAX_SAFE_INTEGER + 1
  '18446744073709551614', // 2^64 - 2
  UINT64_MAX.toString(), // 2^64 - 1 (máximo)
];

const seedRngArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...BOUNDARY_SEEDS),
  fc.bigInt({ min: 0n, max: UINT64_MAX }).map(String),
);

// ---------------------------------------------------------------------------
// Extração: lê o seed exibido do DOM. O componente mostra o valor dentro do
// <code id="pfl-seed-rng-value">. Qualquer transformação (vírgula de milhar,
// truncamento, notação científica) divergiria do seed informado.
// ---------------------------------------------------------------------------

function displayedSeed(container: HTMLElement): string | null {
  const code = container.querySelector<HTMLElement>('code#pfl-seed-rng-value');
  return code === null ? null : (code.textContent ?? '');
}

describe('SeedRngDisplay — Property 25 (seed exibido é o seed da partida corrente)', () => {
  it('exibe o Seed_RNG verbatim, sem transformar o valor informado (R16.3)', () => {
    fc.assert(
      fc.property(seedRngArb, (seed) => {
        const { container, unmount } = render(<SeedRngDisplay seedRng={seed} />);
        try {
          // Rastreabilidade verbatim: o texto exibido é exatamente o seed.
          expect(displayedSeed(container)).toBe(seed);
        } finally {
          unmount();
        }
        return true;
      }),
    );
  });

  it('o seed exibido é o seedRng retido pela store da partida corrente', () => {
    fc.assert(
      fc.property(seedRngArb, (seed) => {
        // Conduz a FSM real: seleciona um modo e confirma a simulação com o seed.
        const store = createMatchStore();
        store.selecionarModo('bot_aleatorio');
        store.iniciarSimulacao(seed);

        // A store retém exatamente o seed informado como seed da partida corrente.
        const retido = store.getState().seedRng;
        expect(retido).toBe(seed);

        // O componente, alimentado pelo estado da store, desenha esse mesmo seed:
        // "o que é exibido" = seed da partida corrente, byte a byte.
        const { container, unmount } = render(<SeedRngDisplay seedRng={retido} />);
        try {
          expect(displayedSeed(container)).toBe(seed);
        } finally {
          unmount();
        }
        return true;
      }),
    );
  });

  it('no caso null não fabrica número algum — só o placeholder honesto', () => {
    const { container } = render(<SeedRngDisplay seedRng={null} />);

    // Sem partida: não há <code> de valor; nenhum dígito inventado é exibido.
    expect(displayedSeed(container)).toBeNull();
    expect(container.querySelector('code#pfl-seed-rng-value')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
});
