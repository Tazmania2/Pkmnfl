import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { confirmarHabilitado } from './store';
import type { MatchState } from './types';
import type { TeamDraft, ValidationWarning } from './contracts';

/**
 * Teste de propriedade do gate de confirmação (`confirmarHabilitado`), Task 8.4.
 *
 * // Feature: pfl-gameday-result-ui, Property 3: Gate de confirmação habilita se e somente se validação aprovada e modo selecionado
 *
 * **Validates: Requirements 4.5, 5.1**
 *
 * *Para todo* estado da store e toda lista de avisos de validação, o controle
 * de confirmação está habilitado **se e somente se**:
 *   (1) há um `Modo_Adversario` selecionado (`state.modo !== null`); e
 *   (2) a validação do time do jogador não tem avisos bloqueantes (nenhum
 *       `ValidationWarning` com `blocking === true`); e
 *   (3) no `Modo_Importar_Seed`, a seed do adversário foi aprovada
 *       (`state.adversarioSeedDraft !== null`); nos demais modos esta condição
 *       não se aplica.
 *
 * A propriedade compara `confirmarHabilitado` contra um **oráculo independente**
 * que recomputa a bicondicional a partir das três cláusulas, cobrindo tanto a
 * direção habilitada quanto a desabilitada (modo ausente, aviso bloqueante,
 * seed de adversário faltando no `importar_seed`).
 */

/** Um `TeamDraft` mínimo e inerte, suficiente como marcador de "seed aprovada". */
const DRAFT_ADVERSARIO: TeamDraft = {
  lineup: { units: { offense: [], defense: [], specialTeams: [] } },
  strategy: { preset: 'balanced' },
};

/** Gera o modo (incluindo `null`, "nenhum modo selecionado"). */
const modoArb = fc.constantFrom<MatchState['modo']>(
  null,
  'bot_aleatorio',
  'desafiar_curti',
  'importar_seed',
);

/** Gera a presença/ausência do time de adversário aprovado. */
const adversarioSeedDraftArb = fc.constantFrom<TeamDraft | null>(
  null,
  DRAFT_ADVERSARIO,
);

/** Gera uma fase arbitrária da FSM (o gate é puro e NÃO deve depender dela). */
const phaseArb = fc.constantFrom<MatchState['phase']>(
  'Selecionando',
  'Validando',
  'Simulando',
  'Animando',
  'Resultado',
  'Erro',
);

/**
 * Gera um `MatchState` arbitrário cujos campos relevantes para o gate variam
 * livremente. Os demais campos (`seedRng`, `log`, `score`, `erro`) ficam fixos
 * — o gate não os consulta — e a `phase` varia para confirmar que o resultado
 * independe dela.
 */
const stateArb: fc.Arbitrary<MatchState> = fc.record({
  phase: phaseArb,
  modo: modoArb,
  seedRng: fc.constant(null),
  adversarioSeedDraft: adversarioSeedDraftArb,
  log: fc.constant(null),
  score: fc.constant(null),
  erro: fc.constant(null),
});

/** Gera um `ValidationWarning` com `blocking` variando (ponto crítico). */
const warningArb: fc.Arbitrary<ValidationWarning> = fc.record({
  code: fc.string({ maxLength: 12 }),
  message: fc.string({ maxLength: 24 }),
  blocking: fc.boolean(),
  field: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
});

/** Lista arbitrária de avisos (inclui a lista vazia). */
const warningsArb: fc.Arbitrary<ValidationWarning[]> = fc.array(warningArb, {
  maxLength: 6,
});

/**
 * Oráculo independente da bicondicional: habilitado sse as três cláusulas
 * valem simultaneamente. Reimplementado aqui a partir da especificação, sem
 * reusar a lógica sob teste.
 */
function oracle(
  state: MatchState,
  warnings: ReadonlyArray<ValidationWarning>,
): boolean {
  const temModo = state.modo !== null;
  const semBloqueio = !warnings.some((w) => w.blocking === true);
  const seedOk =
    state.modo !== 'importar_seed' || state.adversarioSeedDraft !== null;
  return temModo && semBloqueio && seedOk;
}

describe('Feature: pfl-gameday-result-ui, Property 3: Gate de confirmação habilita se e somente se validação aprovada e modo selecionado', () => {
  it('confirmarHabilitado equivale à bicondicional das três cláusulas (R4.5, R5.1)', () => {
    fc.assert(
      fc.property(stateArb, warningsArb, (state, warnings) => {
        expect(confirmarHabilitado(state, warnings)).toBe(
          oracle(state, warnings),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('direção DESABILITADA: ao menos uma cláusula pendente ⇒ sempre false (R4.5, R5.1)', () => {
    fc.assert(
      fc.property(stateArb, warningsArb, (state, warnings) => {
        fc.pre(!oracle(state, warnings)); // alguma condição pendente/recusada
        expect(confirmarHabilitado(state, warnings)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('direção HABILITADA: todas as cláusulas satisfeitas ⇒ sempre true (R4.5, R5.1)', () => {
    // modo não-null, sem avisos bloqueantes e (quando importar_seed) com seed.
    const enabledCaseArb = fc
      .record({
        modo: fc.constantFrom<Exclude<MatchState['modo'], null>>(
          'bot_aleatorio',
          'desafiar_curti',
          'importar_seed',
        ),
        phase: phaseArb,
        // Avisos todos não-bloqueantes (informativos).
        warnings: fc.array(
          warningArb.map((w) => ({ ...w, blocking: false })),
          { maxLength: 6 },
        ),
      })
      .map(({ modo, phase, warnings }) => {
        const state: MatchState = {
          phase,
          modo,
          seedRng: null,
          // No importar_seed a seed precisa estar aprovada; nos demais, irrelevante.
          adversarioSeedDraft: modo === 'importar_seed' ? DRAFT_ADVERSARIO : null,
          log: null,
          score: null,
          erro: null,
        };
        return { state, warnings };
      });

    fc.assert(
      fc.property(enabledCaseArb, ({ state, warnings }) => {
        expect(confirmarHabilitado(state, warnings)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('importar_seed sem seed do adversário ⇒ desabilitado mesmo sem bloqueio (R3.3, R5.1)', () => {
    fc.assert(
      fc.property(
        fc.array(
          warningArb.map((w) => ({ ...w, blocking: false })),
          { maxLength: 6 },
        ),
        (warnings) => {
          const state: MatchState = {
            phase: 'Selecionando',
            modo: 'importar_seed',
            seedRng: null,
            adversarioSeedDraft: null,
            log: null,
            score: null,
            erro: null,
          };
          expect(confirmarHabilitado(state, warnings)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
