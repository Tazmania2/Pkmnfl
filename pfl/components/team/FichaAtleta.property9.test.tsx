// @vitest-environment jsdom

/**
 * Teste de propriedade dos seletores da ficha (`SeletorHabilidade` /
 * `SeletorGolpes`) — spec `pfl-team-strategy-ui`, Task 9.5.
 *
 * // Feature: pfl-team-strategy-ui, Property 9: Seletores da ficha espelham
 * // exatamente a elegibilidade
 *
 * **Validates: Requirements 6.2, 6.3**
 *
 * *Para todo* `pokemonId`, o conjunto de habilidades oferecido pela ficha é
 * **exatamente** `getAvailableAbilities(pokemonId)` e o conjunto de golpes
 * oferecido é **exatamente** `getLearnableMoveIds(pokemonId)` — nem a mais, nem
 * a menos (R6.2, R6.3).
 *
 * Os seletores são **de apresentação**: recebem `options: {id,label}[]` já
 * derivadas do {@link EligibilitySnapshot} pelo orquestrador (ver
 * {@link FichaAtleta}). Esta propriedade:
 *
 * 1. Gera um `EligibilitySnapshot` com conjuntos arbitrários de habilidades e
 *    golpes para um `pokemonId`.
 * 2. Deriva as `options` da ficha **do mesmo modo** que o orquestrador: mapeia
 *    `snapshot.abilities.get(pokemonId)` e `snapshot.learnable.get(pokemonId)`
 *    para listas `{id,label}`, com rótulo vindo de `abilityName`/`moveName`.
 * 3. Renderiza `SeletorHabilidade` e `SeletorGolpes` com essas opções e assevera
 *    que o conjunto de `value` dos `<option>` renderizados (ignorando o
 *    placeholder vazio) é **exatamente** o conjunto elegível da espécie.
 *
 * Isto amarra a propriedade à saída real do seletor (o `<option>` renderizado),
 * não apenas à derivação intermediária.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import {
  SeletorHabilidade,
  type OpcaoHabilidade,
} from './SeletorHabilidade';
import { SeletorGolpes, type OpcaoGolpe } from './SeletorGolpes';
import type { EligibilitySnapshot } from '@/lib/team/eligibility-adapter';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Derivação de opções a partir do snapshot — espelha como o orquestrador
// (FichaAtleta/island) consome o EligibilitySnapshot para alimentar os
// seletores: id-set elegível → {id, label}, rótulo da Camada_Leitura.
// ---------------------------------------------------------------------------

function abilityOptionsFromSnapshot(
  snapshot: EligibilitySnapshot,
  pokemonId: number,
): OpcaoHabilidade[] {
  const ids = snapshot.abilities.get(pokemonId) ?? new Set<number>();
  return [...ids].map((id) => ({
    id,
    label: snapshot.abilityName.get(id) ?? `#${id}`,
  }));
}

function moveOptionsFromSnapshot(
  snapshot: EligibilitySnapshot,
  pokemonId: number,
): OpcaoGolpe[] {
  const ids = snapshot.learnable.get(pokemonId) ?? new Set<number>();
  return [...ids].map((id) => ({
    id,
    label: snapshot.moveName.get(id) ?? `#${id}`,
  }));
}

/** Conjunto de `value` dos `<option>` renderizados, ignorando o placeholder. */
function renderedOptionIds(container: HTMLElement): Set<number> {
  const out = new Set<number>();
  for (const opt of container.querySelectorAll('option')) {
    const value = (opt as HTMLOptionElement).value;
    if (value !== '') {
      out.add(Number(value));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arbitrários: conjuntos de ids elegíveis para uma espécie + nomes legíveis.
// ---------------------------------------------------------------------------

const idArb = fc.integer({ min: 1, max: 100_000 });
const idSetArb = fc.uniqueArray(idArb, { minLength: 0, maxLength: 12 });

/**
 * Gera `pokemonId` + um snapshot cujos mapas `abilities`/`learnable` contêm
 * conjuntos arbitrários (possivelmente vazios) para esse `pokemonId`, com nomes
 * resolvidos para parte dos ids (o restante cai no fallback `#id`).
 */
const caseArb = fc
  .record({
    pokemonId: idArb,
    abilityIds: idSetArb,
    moveIds: idSetArb,
  })
  .map(({ pokemonId, abilityIds, moveIds }) => {
    const abilities = new Map<number, ReadonlySet<number>>([
      [pokemonId, new Set(abilityIds)],
    ]);
    const learnable = new Map<number, ReadonlySet<number>>([
      [pokemonId, new Set(moveIds)],
    ]);
    const abilityName = new Map<number, string>(
      abilityIds.map((id) => [id, `Habilidade ${id}`]),
    );
    const moveName = new Map<number, string>(
      moveIds.map((id) => [id, `Golpe ${id}`]),
    );

    const snapshot: EligibilitySnapshot = {
      allowedSpecies: new Set<number>([pokemonId]),
      learnable,
      abilities,
      moveName,
      abilityName,
      inertEffects: new Set<string>(),
    };

    return { pokemonId, snapshot, abilityIds, moveIds };
  });

describe('Property 9 — seletores da ficha espelham exatamente a elegibilidade', () => {
  it('SeletorHabilidade oferece exatamente getAvailableAbilities(pokemonId) (R6.2)', () => {
    fc.assert(
      fc.property(caseArb, ({ pokemonId, snapshot, abilityIds }) => {
        const options = abilityOptionsFromSnapshot(snapshot, pokemonId);
        const { container } = render(
          <SeletorHabilidade
            abilityId={null}
            options={options}
            onChange={() => {}}
          />,
        );

        const rendered = renderedOptionIds(container);
        const expected = new Set(abilityIds);

        // Igualdade de conjuntos: nem opção a mais, nem a menos.
        expect(rendered).toEqual(expected);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  it('SeletorGolpes oferece exatamente getLearnableMoveIds(pokemonId) por slot (R6.3)', () => {
    fc.assert(
      fc.property(caseArb, ({ pokemonId, snapshot, moveIds }) => {
        const options = moveOptionsFromSnapshot(snapshot, pokemonId);
        const { container } = render(
          <SeletorGolpes moveIds={[]} options={options} onChange={() => {}} />,
        );

        // Os 4 slots repetem a mesma lista de opções; o conjunto de ids
        // oferecido (deduplicado) deve ser exatamente o aprendível da espécie.
        const rendered = renderedOptionIds(container);
        const expected = new Set(moveIds);

        expect(rendered).toEqual(expected);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
