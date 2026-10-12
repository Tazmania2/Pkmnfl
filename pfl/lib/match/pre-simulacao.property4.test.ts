import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import {
  orquestrarPreSimulacao,
  type PreSimulacaoDeps,
  type PreSimulacaoInput,
} from './pre-simulacao';
import type {
  TeamDraft,
  ValidationWarning,
  LineupInput,
  StrategyInput,
} from './contracts';
import type { ModoAdversario } from './types';

/**
 * Teste de propriedade: validação bloqueante preserva estado (Task 10.2).
 *
 * // Feature: pfl-gameday-result-ui, Property 4: Validação bloqueante impede a
 * // simulação e preserva o estado
 *
 * **Validates: Requirements 4.1, 4.3**
 *
 * R4.1 — "WHEN o jogador confirma a simulação com o elenco em estado inválido,
 * THE Tela_Game_Day SHALL **impedir a simulação** e exibir o(s) motivo(s)." R4.3
 * — a recusa de validação **preserva o estado** (Escalacao/Estrategia
 * intactas) e explica o motivo com base num aviso real (nada fabricado).
 *
 * `orquestrarPreSimulacao` é o ponto puro que sequencia `validateDraft` →
 * `hasBlocking` **antes** de autorizar a simulação. Esta propriedade fixa que,
 * *para toda* lista de `ValidationWarning` que contenha **ao menos um aviso
 * bloqueante**:
 *
 * - o orquestrador retorna `{ ok:false }` com `error.kind === 'VALIDATION'`;
 * - a importação de seed **nunca** é chamada (`importSeed` espionado com
 *   `vi.fn`, 0 chamadas) — a simulação não prossegue (R4.1);
 * - a `message`/`field` do erro é **rastreável** a um aviso real da lista — é o
 *   primeiro aviso bloqueante, nada inventado (R4.3);
 * - o orquestrador é **puro**: não muta os objetos de entrada (comparação de um
 *   `structuredClone` tirado antes com o estado depois) — estado preservado
 *   (R4.3).
 *
 * Conversamente, quando **nenhum** aviso é bloqueante (e fora do
 * `importar_seed`), o orquestrador retorna `{ ok:true }`.
 *
 * `hasBlocking` injetado é a predicada real-ish: `warnings.some(w => w.blocking)`.
 */

// ---------------------------------------------------------------------------
// Arbitrários — formas mínimas opacas conforme os contratos
// ---------------------------------------------------------------------------

/** `LineupInput` mínima e opaca (apenas o suficiente para compor um draft). */
const arbitraryLineup: fc.Arbitrary<LineupInput> = fc.record({
  teamSeedId: fc.option(fc.string(), { nil: undefined }),
  units: fc.record({
    offense: fc.constant([]),
    defense: fc.constant([]),
    specialTeams: fc.constant([]),
  }),
});

/** `StrategyInput` mínima. */
const arbitraryStrategy: fc.Arbitrary<StrategyInput> = fc.record({
  preset: fc.constantFrom('EQUILIBRADO', 'AGRESSIVO', 'DEFENSIVO'),
});

/** `TeamDraft` do jogador — forma mínima consumida pela validação. */
const arbitraryTeamDraft: fc.Arbitrary<TeamDraft> = fc.record({
  lineup: arbitraryLineup,
  strategy: arbitraryStrategy,
  teamSeedId: fc.option(fc.string(), { nil: undefined }),
});

/** Um `ValidationWarning` qualquer (bloqueante ou não), com `field` opcional. */
const arbitraryWarning: fc.Arbitrary<ValidationWarning> = fc.record({
  code: fc.string({ minLength: 1 }),
  message: fc.string({ minLength: 1 }),
  blocking: fc.boolean(),
  field: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

/** Um aviso garantidamente bloqueante. */
const arbitraryBlockingWarning: fc.Arbitrary<ValidationWarning> =
  arbitraryWarning.map((w) => ({ ...w, blocking: true }));

/**
 * Lista de avisos que CONTÉM ao menos um bloqueante: compõe uma lista arbitrária
 * (possivelmente com não-bloqueantes), insere um bloqueante numa posição
 * arbitrária, garantindo a presença do bloqueante independentemente da ordem.
 */
const arbitraryWarningsWithBlocking: fc.Arbitrary<ValidationWarning[]> = fc
  .tuple(
    fc.array(arbitraryWarning, { maxLength: 6 }),
    arbitraryBlockingWarning,
    fc.nat(),
  )
  .map(([base, blocking, pos]) => {
    const idx = base.length === 0 ? 0 : pos % (base.length + 1);
    const out = base.slice();
    out.splice(idx, 0, blocking);
    return out;
  });

/** Lista de avisos SEM nenhum bloqueante (todos informativos). */
const arbitraryWarningsNoBlocking: fc.Arbitrary<ValidationWarning[]> = fc.array(
  arbitraryWarning.map((w) => ({ ...w, blocking: false })),
  { maxLength: 6 },
);

/** Modos sem importação de seed (o caso `ok:true` conversivo). */
const arbitraryModoSemSeed: fc.Arbitrary<ModoAdversario> = fc.constantFrom(
  'bot_aleatorio',
  'desafiar_curti',
);

/** `hasBlocking` real-ish (predicada injetada). */
const hasBlocking = (warnings: ReadonlyArray<ValidationWarning>): boolean =>
  warnings.some((w) => w.blocking);

describe('orquestrarPreSimulacao — Property 4: validação bloqueante preserva estado', () => {
  it('com aviso bloqueante: bloqueia (ok:false, VALIDATION), nunca importa, é rastreável e não muta a entrada (R4.1, R4.3)', () => {
    fc.assert(
      fc.property(
        arbitraryTeamDraft,
        arbitraryWarningsWithBlocking,
        arbitraryModoSemSeed,
        (playerDraft, warnings, modo) => {
          const importSeed = vi.fn();
          const deps: PreSimulacaoDeps = {
            validateDraft: () => warnings,
            hasBlocking,
            importSeed,
          };
          const input: PreSimulacaoInput = { playerDraft, modo };

          // Retrato da entrada ANTES da chamada (para checar pureza).
          const inputBefore = structuredClone(input);

          const result = orquestrarPreSimulacao(input, deps);

          // (1) Bloqueia a simulação (R4.1).
          expect(result.ok).toBe(false);
          if (result.ok) return; // narrow

          expect(result.error.kind).toBe('VALIDATION');

          // (2) A importação de seed NUNCA é chamada — não prossegue (R4.1).
          expect(importSeed).toHaveBeenCalledTimes(0);

          // (3) Rastreabilidade: a mensagem/alvo deriva do PRIMEIRO aviso
          // bloqueante real — nada fabricado (R4.3).
          const primeiroBloqueante = warnings.find((w) => w.blocking);
          expect(primeiroBloqueante).toBeDefined();
          expect(result.error.message).toBe(primeiroBloqueante!.message);
          if (primeiroBloqueante!.field !== undefined) {
            expect(result.error.field).toBe(primeiroBloqueante!.field);
          } else {
            expect(result.error.field).toBeUndefined();
          }
          // A mensagem corresponde a algum aviso real da lista.
          expect(warnings.some((w) => w.message === result.error.message)).toBe(
            true,
          );

          // (4) Pureza: a entrada não foi mutada (estado preservado) (R4.3).
          expect(input).toEqual(inputBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sem aviso bloqueante (modo sem seed): autoriza a simulação (ok:true) e não muta a entrada', () => {
    fc.assert(
      fc.property(
        arbitraryTeamDraft,
        arbitraryWarningsNoBlocking,
        arbitraryModoSemSeed,
        (playerDraft, warnings, modo) => {
          const importSeed = vi.fn();
          const deps: PreSimulacaoDeps = {
            validateDraft: () => warnings,
            hasBlocking,
            importSeed,
          };
          const input: PreSimulacaoInput = { playerDraft, modo };
          const inputBefore = structuredClone(input);

          const result = orquestrarPreSimulacao(input, deps);

          // Sem bloqueio e sem importação: a simulação pode prosseguir.
          expect(result.ok).toBe(true);
          // Modos sem seed não acionam a importação.
          expect(importSeed).toHaveBeenCalledTimes(0);
          // Pureza preservada.
          expect(input).toEqual(inputBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
