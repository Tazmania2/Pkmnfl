/**
 * Property test da Property 41 — "Lacuna de regra vira pendência rastreável"
 * (`lib/sim/fsm.rulegap.test.ts`).
 *
 * Valida R14.4: para **qualquer** situação de regra que o contrato autoritativo
 * não decide, `pendingDecisionForRuleGap(situation)` produz um `PendingDecision`
 * com motivo `RULE_GAP_NOT_IN_CONTRACT` e uma `note` não vazia e **rastreável**
 * (que referencia a situação informada). A função apenas **descreve** a lacuna —
 * ela não inventa mecânica nem fabrica estado de jogo: seu único efeito é o
 * descritor retornado (par `reason`/`note`), sem placar, posse, down/distância,
 * relógio ou fase.
 *
 * _Requirements: 14.4_
 */

// Feature: pfl-simulation-engine, Property 41

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { pendingDecisionForRuleGap } from './fsm';
import { PBT_NUM_RUNS } from './test-setup';

describe('Property 41 — lacuna de regra vira pendência rastreável (R14.4)', () => {
  it('retorna PendingDecision com motivo RULE_GAP_NOT_IN_CONTRACT e note rastreável', () => {
    fc.assert(
      fc.property(fc.string(), (situation) => {
        const decision = pendingDecisionForRuleGap(situation);

        // Motivo canônico de lacuna de regra (R14.4).
        expect(decision.reason).toBe('RULE_GAP_NOT_IN_CONTRACT');

        // Note é string não vazia e estável.
        expect(typeof decision.note).toBe('string');
        expect(decision.note.length).toBeGreaterThan(0);

        // Rastreável: a situação informada aparece na narrativa do log.
        expect(decision.note).toContain(situation);

        // Descritor puro: apenas `reason` e `note`, sem fabricar estado de jogo
        // (nenhuma mecânica — placar/posse/down/relógio/fase — é inventada).
        expect(Object.keys(decision).sort()).toEqual(['note', 'reason']);
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });

  it('é determinística: a mesma situação sempre gera o mesmo descritor', () => {
    fc.assert(
      fc.property(fc.string(), (situation) => {
        expect(pendingDecisionForRuleGap(situation)).toEqual(
          pendingDecisionForRuleGap(situation),
        );
      }),
      { numRuns: PBT_NUM_RUNS },
    );
  });
});
