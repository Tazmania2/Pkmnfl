import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ANATOMY_CONVENTIONS,
  anatomyWarning,
  positionalHint,
} from './index';
import { assignRole, loadEmpty } from '../team/store';
import type { AthleteDraft, LineupUnit, TeamDraft } from '../team/model';

/**
 * Teste de propriedade: dica posicional específica/não bloqueante e aviso
 * anatômico consistente com a convenção (Task 3.2).
 *
 * // Feature: pfl-team-strategy-ui, Property 8: Dica posicional específica e não bloqueante; aviso anatômico consistente com a convenção
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 *
 * *Para todo* par (espécie, posição):
 * - `positionalHint` retorna um texto **não vazio** e específico ao par
 *   (R5.1/R5.2);
 * - a existência de `positionalHint`/`anatomyWarning` **jamais** altera o
 *   resultado de `assignRole` — mesmo quando `anatomyWarning` retorna um aviso,
 *   `assignRole` continua produzindo exatamente o mesmo `TeamDraft` (R5.3,
 *   não bloqueante);
 * - `anatomyWarning` retorna um aviso **se e somente se** as convenções
 *   compartilhadas (`ANATOMY_CONVENTIONS`, a fonte única derivada de
 *   `ANATOMY_DECISIONS_FINAL.md`) marcam a função esportiva essencial como
 *   fisicamente não cumprível.
 *
 * Como a tabela de convenções pode estar permissiva/vazia (nota da Task 3.1),
 * a relação "se e somente se" é verificada **contra a própria fonte de
 * convenção** (`ANATOMY_CONVENTIONS.anatomyWarning`), sem fixar findings
 * em código. Isso garante que a função livre `anatomyWarning` e a convenção
 * compartilhada permaneçam uma única regra, sem duplicação, qualquer que seja
 * o conteúdo atual ou futuro da tabela.
 *
 * Módulo puro: nenhum DOM, rede ou I/O.
 */

/**
 * Conjunto amplo de posições: abreviações canônicas reconhecidas pela
 * convenção (QB/C/RB/.../K/P), posições de contato sem exigência anatômica
 * específica (linhas de bloqueio/cobertura) e sinônimos com variação de caixa
 * e separadores, para exercitar a normalização.
 */
function positionArb(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'QB',
    'C',
    'RB',
    'HB',
    'FB',
    'WR',
    'TE',
    'CB',
    'S',
    'SS',
    'FS',
    'K',
    'P',
    // Posições de contato (sem exigência anatômica) e fora do mapa.
    'LB',
    'OT',
    'OG',
    'DT',
    'DE',
    'G',
    // Sinônimos/variações para exercitar a normalização.
    'qb',
    'Quarter Back',
    'quarter-back',
    'full_back',
    '  rb  ',
  );
}

/** Espécie: cobre o intervalo 1..151 (Gen 1) para pares (espécie, posição). */
function speciesArb(): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: 151 });
}

/** Unidade de escalação com papéis nomeados pela posição. */
function unitArb(): fc.Arbitrary<LineupUnit> {
  return fc.constantFrom<LineupUnit>('offense', 'defense');
}

/** Monta um atleta mínimo e válido-por-forma para a instância sob teste. */
function makeAthlete(instanceId: number, pokemonId: number): AthleteDraft {
  return {
    instanceId,
    pokemonId,
    abilityId: 1,
    moveIds: [1, 2, 3, 4],
    positionDesignation: '',
  };
}

/** Draft com um único atleta já no roster, pronto para `assignRole`. */
function draftWithAthlete(athlete: AthleteDraft): TeamDraft {
  return {
    ...loadEmpty('Property8'),
    roster: [athlete],
  };
}

describe('Feature: pfl-team-strategy-ui, Property 8: Dica posicional específica e não bloqueante; aviso anatômico consistente com a convenção', () => {
  it('positionalHint retorna texto não vazio e específico ao par (R5.1, R5.2)', () => {
    fc.assert(
      fc.property(speciesArb(), positionArb(), (pokemonId, position) => {
        const hint = positionalHint(pokemonId, position);

        // Não vazio (string com conteúdo real, não só espaços).
        expect(typeof hint).toBe('string');
        expect(hint.trim().length).toBeGreaterThan(0);

        // Específico ao par: a dica cita a espécie exata do par.
        expect(hint).toContain(`#${pokemonId}`);

        // Quando há aviso anatômico, a dica o reflete e deixa claro que a
        // atribuição continua permitida (orientação, nunca proibição).
        const warning = anatomyWarning(pokemonId, position);
        if (warning !== null) {
          expect(hint).toContain(warning.reason);
          expect(hint).toContain('permitida');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a dica/aviso jamais altera o resultado de assignRole (R5.3, não bloqueante)', () => {
    fc.assert(
      fc.property(
        speciesArb(),
        positionArb(),
        unitArb(),
        fc.integer({ min: 1, max: 10_000 }),
        (pokemonId, position, unit, instanceId) => {
          const athlete = makeAthlete(instanceId, pokemonId);

          // Resultado de referência: assignRole sem consultar nenhuma dica.
          const baseline = assignRole(
            draftWithAthlete(athlete),
            unit,
            position,
            instanceId,
          );

          // Mesmo cenário, agora consultando dica e aviso antes de atribuir.
          // A existência dessas consultas não pode mudar nada no resultado.
          void positionalHint(pokemonId, position);
          const warning = anatomyWarning(pokemonId, position);
          const afterHint = assignRole(
            draftWithAthlete(athlete),
            unit,
            position,
            instanceId,
          );

          // Resultado idêntico independentemente da dica/aviso.
          expect(afterHint).toEqual(baseline);

          // A atribuição sempre prossegue: a instância fica escalada no papel,
          // inclusive quando anatomyWarning retornou um finding.
          const assigned = afterHint.lineups.find(
            (l) => l.unit === unit && l.instanceId === instanceId,
          );
          expect(assigned).toBeDefined();
          expect(assigned?.role).toBe(position);

          // E a ficha reflete a designação de posição (R4.3), haja aviso ou não.
          const inRoster = afterHint.roster.find(
            (a) => a.instanceId === instanceId,
          );
          expect(inRoster?.positionDesignation).toBe(position);

          // O finding (quando existe) nunca impede a escalação acima.
          if (warning !== null) {
            expect(assigned).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('anatomyWarning retorna finding sse a convenção compartilhada marca incapacidade (R5.3)', () => {
    fc.assert(
      fc.property(speciesArb(), positionArb(), (pokemonId, position) => {
        // A fonte única de convenção é `ANATOMY_CONVENTIONS` (derivada de
        // ANATOMY_DECISIONS_FINAL.md). A função livre `anatomyWarning` deve ser
        // exatamente a mesma regra, sem duplicação: iff verificado contra a
        // fonte, sem fixar findings em código.
        const fromConvention = ANATOMY_CONVENTIONS.anatomyWarning(
          pokemonId,
          position,
        );
        const fromFunction = anatomyWarning(pokemonId, position);

        // Mesma presença/ausência de aviso (relação "se e somente se").
        expect(fromFunction === null).toBe(fromConvention === null);
        // E mesmo conteúdo quando presente (regra única, sem divergência).
        expect(fromFunction).toEqual(fromConvention);

        // Quando há aviso, ele é bem formado e consistente com a convenção:
        // identifica a posição normalizada, a função essencial e um motivo.
        if (fromConvention !== null) {
          expect(fromConvention.position.length).toBeGreaterThan(0);
          expect(fromConvention.essentialFunction.length).toBeGreaterThan(0);
          expect(fromConvention.reason.length).toBeGreaterThan(0);
          // A posição do finding é a forma normalizada do par consultado.
          expect(fromConvention.position).toBe(
            position.trim().toUpperCase().replace(/[\s_-]+/g, ''),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
