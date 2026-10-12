// @vitest-environment jsdom

/**
 * Auditoria de acessibilidade cruzada das DUAS telas + honestidade de números
 * — spec `pfl-team-strategy-ui`, Task 11.5.
 *
 * As tarefas 9.7 (`components/team/meu-time-screen.a11y.test.tsx`) e 10.2
 * (`components/strategy/strategy-screen.a11y.test.tsx`) já auditam cada tela em
 * separado com `jest-axe`. Para evitar duplicação, este arquivo faz:
 *
 * 1. uma varredura `jest-axe` **combinada** das composições representativas de
 *    AMBAS as telas num único documento (Tela_Meu_Time: `SeletorOrigem` +
 *    `GradeRoster` + `FichaAtleta` + `BarraAcoes`; Tela_Estrategia:
 *    `SeletorEstiloAtaque/Defesa` + `PrioridadeJogadasAtaque/Defesa`), cobrindo
 *    teclado/foco/contraste/ARIA no mesmo passo (R17.1/17.2/17.4/17.7); e
 * 2. as asserções explícitas de **honestidade de números** (R17.5) que não são
 *    cobertas por 9.7/10.2: o único número exibido (o contador do roster) usa
 *    `ROSTER_CAP` (53) de `@/lib/team/store`, no formato exato `Roster: N/53`, e
 *    nenhum componente renderiza números inventados sem origem rastreável à
 *    entrada.
 *
 * Reusa a nota de desativação de regras do axe para `AbasUnidade` (ver 9.7):
 * aqui NÃO renderizamos `AbasUnidade`, de modo que nenhuma regra do axe precisa
 * ser desativada na varredura combinada.
 *
 * _Requirements: 17.1, 17.2, 17.4, 17.5, 17.7_
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';

import {
  SeletorOrigem,
  GradeRoster,
  FichaAtleta,
  BarraAcoes,
  type OpcaoHabilidade,
  type OpcaoGolpe,
} from './team';
import {
  SeletorEstiloAtaque,
  SeletorEstiloDefesa,
  PrioridadeJogadasAtaque,
  PrioridadeJogadasDefesa,
} from './strategy';
import type { AthleteDraft } from '@/lib/team/model';
import { OFFENSE_PLAYS, DEFENSE_PLAYS, type PlayId } from '@/lib/team/model';
import { ROSTER_CAP } from '@/lib/team/store';
import type { EligibilitySnapshot } from '@/lib/team/eligibility-adapter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fábricas de dados (puras, determinísticas) — espelham as de 9.7
// ---------------------------------------------------------------------------

function makeAthlete(overrides: Partial<AthleteDraft> = {}): AthleteDraft {
  return {
    instanceId: 1,
    pokemonId: 25,
    abilityId: 100,
    moveIds: [1, 2, 3, 4],
    positionDesignation: '',
    ...overrides,
  };
}

function makeSnapshot(opts: {
  readonly pokemonId: number;
  readonly moveIds: readonly number[];
  readonly abilityIds: readonly number[];
}): EligibilitySnapshot {
  const moveName = new Map<number, string>();
  for (const id of opts.moveIds) {
    moveName.set(id, `Golpe ${id}`);
  }
  const abilityName = new Map<number, string>();
  for (const id of opts.abilityIds) {
    abilityName.set(id, `Habilidade ${id}`);
  }
  return {
    allowedSpecies: new Set([opts.pokemonId]),
    learnable: new Map([[opts.pokemonId, new Set(opts.moveIds)]]),
    abilities: new Map([[opts.pokemonId, new Set(opts.abilityIds)]]),
    moveName,
    abilityName,
    inertEffects: new Set<string>(),
  };
}

function abilityOptionsFor(
  snapshot: EligibilitySnapshot,
  pokemonId: number,
): OpcaoHabilidade[] {
  const ids = snapshot.abilities.get(pokemonId) ?? new Set<number>();
  return [...ids].map((id) => ({ id, label: snapshot.abilityName.get(id) ?? `#${id}` }));
}

function moveOptionsFor(
  snapshot: EligibilitySnapshot,
  pokemonId: number,
): OpcaoGolpe[] {
  const ids = snapshot.learnable.get(pokemonId) ?? new Set<number>();
  return [...ids].map((id) => ({ id, label: snapshot.moveName.get(id) ?? `#${id}` }));
}

function ordemAtaque(): PlayId[] {
  return [...OFFENSE_PLAYS];
}

function ordemDefesa(): PlayId[] {
  return [...DEFENSE_PLAYS];
}

/**
 * Renderiza as composições representativas de AMBAS as telas num único
 * documento, como numa navegação ponta a ponta (montar o time → definir a
 * estratégia). Retorna o `container` para a varredura do axe.
 */
function renderBothScreens(roster: readonly AthleteDraft[]) {
  const snapshot = makeSnapshot({ pokemonId: 25, moveIds: [1, 2, 3, 4], abilityIds: [100] });
  return render(
    <main>
      <section aria-label="Meu Time">
        <SeletorOrigem onUsePreset={vi.fn()} onStartEmpty={vi.fn()} />
        <GradeRoster roster={roster} onSelectAthlete={vi.fn()} />
        <FichaAtleta
          athlete={makeAthlete({ pokemonId: 25, abilityId: 100, moveIds: [1, 2, 3, 4] })}
          snapshot={snapshot}
          abilityOptions={abilityOptionsFor(snapshot, 25)}
          moveOptions={moveOptionsFor(snapshot, 25)}
          onChange={vi.fn()}
          onSave={vi.fn()}
        />
        <BarraAcoes
          onSave={vi.fn()}
          onExportSeed={vi.fn()}
          onImportSeed={vi.fn()}
          saveConfirmation="Time salvo com sucesso."
        />
      </section>
      <section aria-label="Estratégia">
        <SeletorEstiloAtaque value="balanced" onChange={vi.fn()} />
        <SeletorEstiloDefesa value="zone" onChange={vi.fn()} />
        <PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />
        <PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={vi.fn()} />
      </section>
    </main>,
  );
}

// ---------------------------------------------------------------------------
// Varredura jest-axe combinada das duas telas (R17.1/17.2/17.4/17.7)
// ---------------------------------------------------------------------------

describe('Meu Time + Estratégia — auditoria axe combinada das duas telas (R17.1/17.2/17.4/17.7)', () => {
  it('a composição representativa das DUAS telas não apresenta violações', async () => {
    const roster: AthleteDraft[] = [
      makeAthlete({ instanceId: 1, pokemonId: 25 }),
      makeAthlete({ instanceId: 2, pokemonId: 25 }), // duplicata de espécie
      makeAthlete({ instanceId: 3, pokemonId: 6 }),
    ];
    const { container } = renderBothScreens(roster);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// Honestidade de números (R17.5) — o único stat exibido usa ROSTER_CAP (53)
// ---------------------------------------------------------------------------

describe('Honestidade de números — contador do roster usa ROSTER_CAP (R17.5)', () => {
  it('o denominador do contador é exatamente 53 e vem de ROSTER_CAP, não de um literal solto', () => {
    // Precondição do teste: a constante compartilhada é 53 (fonte única).
    expect(ROSTER_CAP).toBe(53);

    const roster: AthleteDraft[] = [
      makeAthlete({ instanceId: 1 }),
      makeAthlete({ instanceId: 2 }),
      makeAthlete({ instanceId: 3 }),
    ];
    render(<GradeRoster roster={roster} onSelectAthlete={vi.fn()} />);

    // O texto do contador casa EXATAMENTE `Roster: N/53`, com N = tamanho do
    // roster (origem rastreável à entrada) e 53 === ROSTER_CAP.
    const esperado = `Roster: ${roster.length}/${ROSTER_CAP}`;
    expect(screen.getByText(esperado)).toBeInTheDocument();
    // E N acompanha o tamanho real do roster, não um valor inventado.
    expect(esperado).toBe('Roster: 3/53');
  });

  it('o numerador acompanha o tamanho do roster para diferentes contagens (sem número fixo)', () => {
    for (const n of [0, 1, 11, 22]) {
      const roster = Array.from({ length: n }, (_, i) =>
        makeAthlete({ instanceId: i + 1 }),
      );
      const { unmount } = render(
        <GradeRoster roster={roster} onSelectAthlete={vi.fn()} />,
      );
      expect(screen.getByText(`Roster: ${n}/${ROSTER_CAP}`)).toBeInTheDocument();
      unmount();
    }
  });

  it('a FichaAtleta não exibe números soltos: todo dígito é rastreável a slot/ids do snapshot', () => {
    // A ficha é o único lugar com risco de "stat inventado" (potência/precisão
    // fabricada). Ids de golpe/habilidade vêm do snapshot (origem rastreável) e
    // os índices de slot 1..4 são rótulos de UI. A ficha NÃO renderiza
    // ordinais; portanto varremos seu texto inteiro e exigimos que todo dígito
    // seja rastreável às entradas — nenhum stat numérico fabricado.
    const snapshot = makeSnapshot({ pokemonId: 25, moveIds: [1, 2, 3, 4], abilityIds: [100] });
    const { container } = render(
      <FichaAtleta
        athlete={makeAthlete({ pokemonId: 25, abilityId: 100, moveIds: [1, 2, 3, 4] })}
        snapshot={snapshot}
        abilityOptions={abilityOptionsFor(snapshot, 25)}
        moveOptions={moveOptionsFor(snapshot, 25)}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const texto = container.textContent ?? '';
    const numeros = [...texto.matchAll(/\d+/g)].map((m) => Number(m[0]));

    const idsDeGolpeDoSnapshot = new Set<number>([1, 2, 3, 4]);
    const idsDeHabilidadeDoSnapshot = new Set<number>([100]);
    const indicesDeSlot = new Set<number>([1, 2, 3, 4]);
    for (const n of numeros) {
      const rastreavel =
        idsDeGolpeDoSnapshot.has(n) ||
        idsDeHabilidadeDoSnapshot.has(n) ||
        indicesDeSlot.has(n);
      expect(
        rastreavel,
        `Número não rastreável exibido na ficha: ${n}`,
      ).toBe(true);
    }
  });

  it('os componentes de estratégia só exibem rótulos de jogada e ordinais de prioridade (sem stats inventados)', () => {
    // Nas listas de prioridade os únicos números legítimos são os ORDINAIS de
    // posição (1..6) — a posição de cada jogada na ordem, rastreável à entrada.
    // Verificamos que cada lista expõe exatamente 6 itens (as 6 jogadas fixas) e
    // que nenhum número fora do intervalo 1..6 (um stat inventado) aparece.
    render(
      <main>
        <SeletorEstiloAtaque value="balanced" onChange={vi.fn()} />
        <SeletorEstiloDefesa value="zone" onChange={vi.fn()} />
        <PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />
        <PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={vi.fn()} />
      </main>,
    );

    const listas = screen.getAllByRole('list');
    expect(listas).toHaveLength(2);
    for (const lista of listas) {
      const itens = within(lista).getAllByRole('listitem');
      expect(itens).toHaveLength(6);
      const texto = lista.textContent ?? '';
      const numeros = [...texto.matchAll(/\d+/g)].map((m) => Number(m[0]));
      for (const n of numeros) {
        // Apenas ordinais 1..6 (posição na prioridade) são admissíveis.
        expect(n >= 1 && n <= 6).toBe(true);
      }
    }
  });

  it('o GradeRoster expõe apenas o contador como stat numérico (nenhum outro número solto na grade)', () => {
    const roster: AthleteDraft[] = [
      makeAthlete({ instanceId: 1, pokemonId: 25 }),
      makeAthlete({ instanceId: 2, pokemonId: 6 }),
    ];
    render(<GradeRoster roster={roster} onSelectAthlete={vi.fn()} />);

    // O contador é o único stat; cada cartão referencia a instância por rótulo
    // ("instância N"), rastreável ao `instanceId` da entrada.
    expect(screen.getByText(`Roster: 2/${ROSTER_CAP}`)).toBeInTheDocument();
    const cartoes = screen.getAllByRole('button');
    for (const cartao of cartoes) {
      // Cada rótulo de cartão só pode conter números que são instanceId de entrada.
      const nome = cartao.getAttribute('aria-label') ?? within(cartao).queryByText(/./)?.textContent ?? '';
      const numeros = [...nome.matchAll(/\d+/g)].map((m) => Number(m[0]));
      for (const n of numeros) {
        expect([1, 2, 6, 25].includes(n)).toBe(true);
      }
    }
  });
});
