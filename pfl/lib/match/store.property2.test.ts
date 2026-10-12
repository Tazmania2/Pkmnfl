import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createMatchStore, ESTADO_INICIAL } from './store';
import { MODOS_SUPORTADOS } from './modo';
import type { ModoAdversario } from './types';
import type { TeamDraft } from './contracts';

/**
 * Teste de propriedade da seleção de modo (Task 8.3).
 *
 * // Feature: pfl-gameday-result-ui, Property 2: Seleção de modo registra exatamente o modo escolhido
 *
 * **Validates: Requirements 1.2**
 *
 * *Para todo* `modo ∈ MODOS_SUPORTADOS`, uma store recém-criada após
 * `selecionarModo(modo)` registra **exatamente** o modo escolhido
 * (`getState().modo === modo`) e permanece na fase `Selecionando` (R1.2). A
 * seleção substitui o modo anterior por completo — nunca mescla modos — e o
 * resto do estado permanece o inicial.
 *
 * Também cobre a semântica implementada em `reduceSelecionarModo`: trocar o modo
 * substitui exatamente o escolhido; ao sair de `importar_seed` o
 * `adversarioSeedDraft` é descartado (pertence só àquele modo), enquanto manter
 * `importar_seed` preserva o draft existente.
 */

/** Qualquer modo do conjunto fechado dos três modos suportados. */
const arbitraryModo: fc.Arbitrary<ModoAdversario> = fc.constantFrom(...MODOS_SUPORTADOS);

/** `TeamDraft` mínimo e opaco para a store (ela trata a seed como dados). */
const arbitraryDraft: fc.Arbitrary<TeamDraft> = fc
  .string()
  .map((name) => ({ name } as unknown as TeamDraft));

describe('createMatchStore.selecionarModo — Property 2: registra exatamente o modo escolhido', () => {
  it('para todo modo suportado: registra o modo e permanece em Selecionando (R1.2)', () => {
    fc.assert(
      fc.property(arbitraryModo, (modo) => {
        const store = createMatchStore();
        store.selecionarModo(modo);

        const state = store.getState();
        expect(state.modo).toBe(modo);
        expect(state.phase).toBe('Selecionando');
        // O restante do estado permanece o inicial (seleção não deriva valores).
        expect(state.seedRng).toBe(ESTADO_INICIAL.seedRng);
        expect(state.log).toBe(ESTADO_INICIAL.log);
        expect(state.score).toBe(ESTADO_INICIAL.score);
        expect(state.erro).toBe(ESTADO_INICIAL.erro);
      }),
    );
  });

  it('selecionar um modo diferente substitui exatamente o escolhido (não mescla)', () => {
    fc.assert(
      fc.property(arbitraryModo, arbitraryModo, (primeiro, segundo) => {
        const store = createMatchStore();
        store.selecionarModo(primeiro);
        store.selecionarModo(segundo);

        const state = store.getState();
        expect(state.modo).toBe(segundo);
        expect(state.phase).toBe('Selecionando');
      }),
    );
  });

  it('sair de importar_seed descarta o adversarioSeedDraft (pertence só àquele modo)', () => {
    const outrosModos = MODOS_SUPORTADOS.filter((m) => m !== 'importar_seed');
    fc.assert(
      fc.property(fc.constantFrom(...outrosModos), arbitraryDraft, (outroModo, draft) => {
        const store = createMatchStore();
        store.selecionarModo('importar_seed');
        store.setAdversarioSeed(draft);
        // Pré-condição: o draft foi retido no modo importar_seed.
        expect(store.getState().adversarioSeedDraft).toBe(draft);

        store.selecionarModo(outroModo);

        const state = store.getState();
        expect(state.modo).toBe(outroModo);
        expect(state.adversarioSeedDraft).toBeNull();
      }),
    );
  });

  it('reselecionar importar_seed preserva o adversarioSeedDraft existente', () => {
    fc.assert(
      fc.property(arbitraryDraft, (draft) => {
        const store = createMatchStore();
        store.selecionarModo('importar_seed');
        store.setAdversarioSeed(draft);

        // Reselecionar o mesmo modo não descarta o draft já retido.
        store.selecionarModo('importar_seed');

        const state = store.getState();
        expect(state.modo).toBe('importar_seed');
        expect(state.adversarioSeedDraft).toBe(draft);
      }),
    );
  });
});
