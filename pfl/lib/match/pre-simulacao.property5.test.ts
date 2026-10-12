import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { orquestrarPreSimulacao } from './pre-simulacao';
import type {
  PreSimulacaoDeps,
  PreSimulacaoInput,
} from './pre-simulacao';
import type { ImportResult, TeamDraft } from './contracts';

/**
 * Teste de propriedade: recusa de seed/validação do adversário preserva o
 * estado e explica o motivo (Task 10.3).
 *
 * // Feature: pfl-gameday-result-ui, Property 5: Recusa de seed/validação do
 * // adversário preserva o estado e explica o motivo
 *
 * **Validates: Requirements 3.2, 4.2, 4.4**
 *
 * *Para todo* fluxo em `Modo_Importar_Seed` em que a validação do time do
 * jogador NÃO produz avisos bloqueantes (o gate do jogador passa, R4.1/R4.5) e a
 * `Importacao_Seed` do adversário **recusa** o arquivo com um motivo específico
 * `{ ok:false, reason:{ step, message } }` (R4.2), o orquestrador:
 *
 * 1. retorna `{ ok:false }` com `error.kind === 'IMPORT'` — a simulação fica
 *    **bloqueada** (R4.2): nunca retorna `ok:true`;
 * 2. propaga o motivo específico: `error.message === reason.message` — o motivo
 *    da recusa é **explicado** ao jogador (R3.2, R4.4);
 * 3. é **puro**: a entrada (`input`) não é mutada (comparação `structuredClone`
 *    antes/depois), preservando o estado corrente da tela (R3.2, R4.4);
 * 4. trata a seed **como dados** (R3.4): `importSeed` é chamada exatamente uma
 *    vez com os mesmos `seedBytes` fornecidos (repassados verbatim, sem
 *    interpretar/executar conteúdo).
 *
 * Também cobre, para contraste, o **caminho de aprovação** (`importSeed`
 * devolve `{ ok:true, draft }` → `{ ok:true, adversarioDraft: draft }`) e as
 * **bordas de bloqueio** do modo importar_seed (dep `importSeed` ausente e
 * `seedBytes` ausente → erro `IMPORT`), que também bloqueiam preservando o
 * estado.
 */

// ---------------------------------------------------------------------------
// Arbitrários
// ---------------------------------------------------------------------------

/** `TeamDraft` mínimo e bem-formado (apenas a forma consumida pela orquestração). */
const PLAYER_DRAFT: TeamDraft = {
  lineup: { units: { offense: [], defense: [], specialTeams: [] } },
  strategy: { preset: 'EQUILIBRADO' },
};

/** `TeamDraft` do adversário, devolvido por uma importação aprovada. */
const ADVERSARY_DRAFT: TeamDraft = {
  lineup: { units: { offense: [], defense: [], specialTeams: [] } },
  strategy: { preset: 'AGRESSIVO' },
  teamSeedId: 'seed-adversario-1',
};

/** Bytes crus de seed arbitrários (tratados como dados, R3.4). */
const arbitrarySeedBytes: fc.Arbitrary<Uint8Array> = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 0, maxLength: 64 })
  .map((xs) => Uint8Array.from(xs));

/** Passo e mensagem de recusa arbitrários (motivo específico da `ImportRejection`). */
const arbitraryStep: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 40 });
const arbitraryMessage: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 120 });

/**
 * `validateDraft` injetada que NÃO produz avisos (gate do jogador passa), com
 * `hasBlocking` fixo em `false` — isola a propriedade na importação da seed.
 */
const validateDraftNoWarnings: PreSimulacaoDeps['validateDraft'] = () => [];
const hasBlockingFalse: PreSimulacaoDeps['hasBlocking'] = () => false;

/** Clona a entrada de forma estrutural para comparação de pureza antes/depois. */
function snapshotInput(input: PreSimulacaoInput): PreSimulacaoInput {
  return structuredClone(input);
}

describe('orquestrarPreSimulacao — Property 5: recusa de seed preserva estado e explica o motivo', () => {
  it('recusa da importação → IMPORT com reason.message, bloqueia (nunca ok:true), seed como dados e estado preservado (R3.2, R4.2, R4.4)', () => {
    fc.assert(
      fc.property(
        arbitrarySeedBytes,
        arbitraryStep,
        arbitraryMessage,
        (seedBytes, step, message) => {
          const rejection: ImportResult = {
            ok: false,
            reason: { step, message },
          };
          const importSeed = vi.fn((_bytes: Uint8Array): ImportResult => rejection);

          const input: PreSimulacaoInput = {
            playerDraft: PLAYER_DRAFT,
            modo: 'importar_seed',
            seedBytes,
          };
          const deps: PreSimulacaoDeps = {
            validateDraft: validateDraftNoWarnings,
            hasBlocking: hasBlockingFalse,
            importSeed,
          };

          const before = snapshotInput(input);
          const result = orquestrarPreSimulacao(input, deps);

          // (1) Bloqueia: nunca ok:true; erro é da família IMPORT (R4.2).
          expect(result.ok).toBe(false);
          if (result.ok) return; // narrowing
          expect(result.error.kind).toBe('IMPORT');

          // (2) Explica o motivo específico da recusa (R3.2, R4.4).
          expect(result.error.message).toBe(message);

          // (4) Seed tratada como dados: importSeed chamada 1x com os mesmos bytes.
          expect(importSeed).toHaveBeenCalledTimes(1);
          expect(importSeed).toHaveBeenCalledWith(seedBytes);
          // Repassada verbatim (mesma referência; nenhuma transformação/execução).
          expect(importSeed.mock.calls[0]![0]).toBe(seedBytes);

          // (3) Pureza: a entrada não foi mutada (estado preservado, R3.2/R4.4).
          expect(input).toEqual(before);
        },
      ),
    );
  });

  it('aprovação da importação → ok:true com adversarioDraft = draft aprovado (contraste, R3.3) e estado preservado', () => {
    fc.assert(
      fc.property(arbitrarySeedBytes, (seedBytes) => {
        const approval: ImportResult = { ok: true, draft: ADVERSARY_DRAFT };
        const importSeed = vi.fn((_bytes: Uint8Array): ImportResult => approval);

        const input: PreSimulacaoInput = {
          playerDraft: PLAYER_DRAFT,
          modo: 'importar_seed',
          seedBytes,
        };
        const deps: PreSimulacaoDeps = {
          validateDraft: validateDraftNoWarnings,
          hasBlocking: hasBlockingFalse,
          importSeed,
        };

        const before = snapshotInput(input);
        const result = orquestrarPreSimulacao(input, deps);

        expect(result.ok).toBe(true);
        if (!result.ok) return; // narrowing
        expect(result.adversarioDraft).toEqual(ADVERSARY_DRAFT);

        // Seed tratada como dados: chamada 1x com os mesmos bytes.
        expect(importSeed).toHaveBeenCalledTimes(1);
        expect(importSeed).toHaveBeenCalledWith(seedBytes);

        // Pureza preservada.
        expect(input).toEqual(before);
      }),
    );
  });

  it('borda: dep importSeed ausente no modo importar_seed → bloqueio IMPORT, estado preservado (R4.2)', () => {
    fc.assert(
      fc.property(arbitrarySeedBytes, (seedBytes) => {
        const input: PreSimulacaoInput = {
          playerDraft: PLAYER_DRAFT,
          modo: 'importar_seed',
          seedBytes,
        };
        // Sem importSeed na injeção: o modo exige, logo bloqueia.
        const deps: PreSimulacaoDeps = {
          validateDraft: validateDraftNoWarnings,
          hasBlocking: hasBlockingFalse,
        };

        const before = snapshotInput(input);
        const result = orquestrarPreSimulacao(input, deps);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('IMPORT');
        expect(result.error.message.length).toBeGreaterThan(0);

        expect(input).toEqual(before);
      }),
    );
  });

  it('borda: seedBytes ausente no modo importar_seed → bloqueio IMPORT, importSeed nunca chamada, estado preservado (R4.2)', () => {
    const importSeed = vi.fn((_bytes: Uint8Array): ImportResult => ({
      ok: true,
      draft: ADVERSARY_DRAFT,
    }));

    const input: PreSimulacaoInput = {
      playerDraft: PLAYER_DRAFT,
      modo: 'importar_seed',
      // seedBytes omitido de propósito.
    };
    const deps: PreSimulacaoDeps = {
      validateDraft: validateDraftNoWarnings,
      hasBlocking: hasBlockingFalse,
      importSeed,
    };

    const before = snapshotInput(input);
    const result = orquestrarPreSimulacao(input, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('IMPORT');
    expect(result.error.message.length).toBeGreaterThan(0);
    // Sem bytes submetidos: nada a importar — importSeed nunca é acionada.
    expect(importSeed).not.toHaveBeenCalled();
    expect(input).toEqual(before);
  });
});
