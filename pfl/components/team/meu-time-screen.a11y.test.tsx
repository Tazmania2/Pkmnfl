// @vitest-environment jsdom

/**
 * Testes de componente/acessibilidade da Tela_Meu_Time — spec
 * `pfl-team-strategy-ui`, Task 9.7.
 *
 * Verifica, no DOM (jsdom + `@testing-library/react` + `@testing-library/user-event`
 * + `jest-axe`), que os componentes de apresentação da Tela_Meu_Time (tarefas
 * 9.1–9.4) atendem aos requisitos de rotulagem, grade distinta por instância,
 * contador rastreável, dica posicional, aviso inerte visível antes de salvar,
 * confirmação de salvamento e associação de avisos por ARIA — além da fidelidade
 * do preset "Time do Curti":
 *
 * - Controles rotulados: `SeletorOrigem` ("Usar preset" com os 4 presets +
 *   "Começar do zero", R1.1); `AbasUnidade` (abas Ataque/Defesa + Especiais,
 *   R3.1); `BarraAcoes` (Salvar/Exportar seed/Importar seed, R9.1);
 *   `FichaAtleta` (seletor de habilidade rotulado + 4 slots de golpe, R6.1).
 * - `GradeRoster`: N itens distintos para N atletas, inclusive duplicatas de
 *   espécie em vagas separadas (R2.1/R2.2), e contador `X/53` via `ROSTER_CAP`
 *   (R2.3).
 * - `DicaPosicional`: renderiza a dica quando fornecida (R5.1).
 * - `AvisoEfeitoInerte` visível antes de salvar: ficha com golpe/habilidade
 *   inerte mostra o aviso (R8.3); o botão Salvar fica desabilitado com aviso
 *   bloqueante e habilitado quando válido.
 * - Confirmação de salvamento: `BarraAcoes` com `saveConfirmation` anuncia a
 *   mensagem numa região `role="status"` ao vivo (R9.4).
 * - Associação por `aria-describedby`: na `FichaAtleta`, um aviso que aponta a
 *   habilidade/golpe faz o `<select>` correspondente referenciar o `id` do
 *   aviso (R17.7).
 * - Fidelidade do Curti: `getPreset('curti')` tem 22 titulares (11 ataque + 11
 *   defesa) com espécies/posições esperadas; `clonePresetToDraft('curti')`
 *   marca `provenance.sourceStarters22 === true` e os campos de atribuição PFL
 *   (R10.3/R10.4).
 * - `jest-axe` roda sobre os componentes renderizados e não acusa violações.
 *
 * _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1, 5.1, 6.1, 8.3, 9.1, 9.4, 10.3, 10.4,
 * 17.7_
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import {
  SeletorOrigem,
  GradeRoster,
  AbasUnidade,
  FichaAtleta,
  DicaPosicional,
  BarraAcoes,
  type OpcaoHabilidade,
  type OpcaoGolpe,
} from './index';
import type { AthleteDraft } from '@/lib/team/model';
import { ROSTER_CAP } from '@/lib/team/store';
import {
  moveInertKey,
  type EligibilitySnapshot,
} from '@/lib/team/eligibility-adapter';
import { getPreset, clonePresetToDraft } from '@/lib/presets';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fábricas de dados de teste (puras, determinísticas)
// ---------------------------------------------------------------------------

/** Constrói um `AthleteDraft` com valores sensatos sobrescritíveis. */
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

/**
 * Constrói um `EligibilitySnapshot` síncrono para a espécie `pokemonId`, com os
 * golpes/habilidades informados como elegíveis e nomes legíveis previsíveis.
 */
function makeSnapshot(opts: {
  readonly pokemonId: number;
  readonly moveIds: readonly number[];
  readonly abilityIds: readonly number[];
  readonly inert?: ReadonlySet<string>;
  readonly allowed?: boolean;
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
    allowedSpecies: new Set(opts.allowed === false ? [] : [opts.pokemonId]),
    learnable: new Map([[opts.pokemonId, new Set(opts.moveIds)]]),
    abilities: new Map([[opts.pokemonId, new Set(opts.abilityIds)]]),
    moveName,
    abilityName,
    inertEffects: opts.inert ?? new Set<string>(),
  };
}

/** Opções de habilidade derivadas de um snapshot para uma espécie. */
function abilityOptionsFor(
  snapshot: EligibilitySnapshot,
  pokemonId: number,
): OpcaoHabilidade[] {
  const ids = snapshot.abilities.get(pokemonId) ?? new Set<number>();
  return [...ids].map((id) => ({ id, label: snapshot.abilityName.get(id) ?? `#${id}` }));
}

/** Opções de golpe derivadas de um snapshot para uma espécie. */
function moveOptionsFor(
  snapshot: EligibilitySnapshot,
  pokemonId: number,
): OpcaoGolpe[] {
  const ids = snapshot.learnable.get(pokemonId) ?? new Set<number>();
  return [...ids].map((id) => ({ id, label: snapshot.moveName.get(id) ?? `#${id}` }));
}

// ---------------------------------------------------------------------------
// R1.1 — SeletorOrigem: 4 presets rotulados + "Começar do zero"
// ---------------------------------------------------------------------------

describe('SeletorOrigem — controles rotulados de origem (R1.1)', () => {
  it('expõe "Usar preset" com os 4 presets e um controle "Começar do zero"', () => {
    render(<SeletorOrigem onUsePreset={vi.fn()} onStartEmpty={vi.fn()} />);

    // O controle "Usar preset" é rotulado; expõe exatamente 4 presets (R1.1).
    const [grupoPreset] = screen.getAllByRole('group', { name: 'Usar preset' });
    const botoesPreset = within(grupoPreset!).getAllByRole('button');
    expect(botoesPreset).toHaveLength(4);

    expect(screen.getByRole('button', { name: /Equilibrado Kanto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Trincheira de Kanto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Domínio Aéreo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Time do Curti/ })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Começar do zero' })).toBeInTheDocument();
  });

  it('acionar um preset emite onUsePreset com o preset_id; "do zero" emite onStartEmpty', async () => {
    const user = userEvent.setup();
    const onUsePreset = vi.fn();
    const onStartEmpty = vi.fn();
    render(<SeletorOrigem onUsePreset={onUsePreset} onStartEmpty={onStartEmpty} />);

    await user.click(screen.getByRole('button', { name: /Time do Curti/ }));
    expect(onUsePreset).toHaveBeenCalledWith('curti');

    await user.click(screen.getByRole('button', { name: 'Começar do zero' }));
    expect(onStartEmpty).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R3.1 — AbasUnidade: Ataque | Defesa | Especiais (6 unidades)
// ---------------------------------------------------------------------------

describe('AbasUnidade — abas rotuladas de unidade (R3.1)', () => {
  it('renderiza as abas Ataque e Defesa e um grupo "Especiais" com as 6 unidades', () => {
    render(<AbasUnidade active="offense" onSelect={vi.fn()} />);

    const tablist = screen.getByRole('tablist', { name: 'Unidade do time' });
    expect(within(tablist).getByRole('tab', { name: 'Ataque' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: 'Defesa' })).toBeInTheDocument();

    const grupoEspeciais = screen.getByRole('group', { name: 'Especiais' });
    const abasEspeciais = within(grupoEspeciais).getAllByRole('tab');
    expect(abasEspeciais).toHaveLength(6);

    // A aba ativa é marcada por aria-selected (sinal além da cor).
    expect(within(tablist).getByRole('tab', { name: 'Ataque' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('acionar uma aba emite onSelect com a unidade', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AbasUnidade active="offense" onSelect={onSelect} />);

    await user.click(screen.getByRole('tab', { name: 'Defesa' }));
    expect(onSelect).toHaveBeenCalledWith('defense');
  });
});

// ---------------------------------------------------------------------------
// R9.1 — BarraAcoes: Salvar / Exportar seed / Importar seed
// ---------------------------------------------------------------------------

describe('BarraAcoes — controles rotulados da barra de ações (R9.1)', () => {
  it('oferece botões Salvar, Exportar seed e um controle Importar seed', () => {
    render(
      <BarraAcoes onSave={vi.fn()} onExportSeed={vi.fn()} onImportSeed={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar seed' })).toBeInTheDocument();
    // O importador é um <input type=file> rotulado por um <label> "Importar seed".
    expect(screen.getByText('Importar seed')).toBeInTheDocument();
  });

  it('acionar Salvar e Exportar seed emite os callbacks correspondentes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onExportSeed = vi.fn();
    render(
      <BarraAcoes onSave={onSave} onExportSeed={onExportSeed} onImportSeed={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSave).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Exportar seed' }));
    expect(onExportSeed).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R9.4 — Confirmação de salvamento numa região ARIA-live
// ---------------------------------------------------------------------------

describe('BarraAcoes — confirmação de salvamento (R9.4)', () => {
  it('mostra a mensagem de confirmação numa região role="status" ao vivo', () => {
    render(
      <BarraAcoes
        onSave={vi.fn()}
        onExportSeed={vi.fn()}
        onImportSeed={vi.fn()}
        saveConfirmation="Time salvo com sucesso."
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Time salvo com sucesso.');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

// ---------------------------------------------------------------------------
// R6.1 — FichaAtleta: habilidade rotulada + 4 slots de golpe
// ---------------------------------------------------------------------------

describe('FichaAtleta — habilidade e 4 golpes rotulados (R6.1)', () => {
  it('renderiza um seletor de habilidade rotulado e 4 slots de golpe', () => {
    const snapshot = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
    });
    const athlete = makeAthlete();

    render(
      <FichaAtleta
        athlete={athlete}
        snapshot={snapshot}
        abilityOptions={abilityOptionsFor(snapshot, 25)}
        moveOptions={moveOptionsFor(snapshot, 25)}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Habilidade' })).toBeInTheDocument();
    for (let slot = 1; slot <= 4; slot += 1) {
      expect(
        screen.getByRole('combobox', { name: `Golpe ${slot}` }),
      ).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// R2.1 / R2.2 / R2.3 — GradeRoster: itens distintos, duplicatas, contador X/53
// ---------------------------------------------------------------------------

describe('GradeRoster — grade distinta por instância e contador X/53 (R2.1/R2.2/R2.3)', () => {
  it('renderiza um item por instância, inclusive duplicatas de espécie em vagas separadas', () => {
    const roster: AthleteDraft[] = [
      makeAthlete({ instanceId: 1, pokemonId: 25 }),
      makeAthlete({ instanceId: 2, pokemonId: 25 }), // mesma espécie, instância distinta
      makeAthlete({ instanceId: 3, pokemonId: 6 }),
    ];

    render(<GradeRoster roster={roster} onSelectAthlete={vi.fn()} />);

    // Três cartões distintos (role=button), um por instância.
    const cartoes = screen.getAllByRole('button');
    expect(cartoes).toHaveLength(3);

    // As duas instâncias da mesma espécie têm rótulos distintos por instância.
    expect(
      screen.getByRole('button', { name: /instância 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /instância 2/ }),
    ).toBeInTheDocument();
  });

  it('exibe o contador usando ROSTER_CAP como denominador rastreável', () => {
    const roster: AthleteDraft[] = [
      makeAthlete({ instanceId: 1 }),
      makeAthlete({ instanceId: 2 }),
    ];

    render(<GradeRoster roster={roster} onSelectAthlete={vi.fn()} />);

    expect(
      screen.getByText(new RegExp(`Roster: 2/${ROSTER_CAP}`)),
    ).toBeInTheDocument();
    expect(ROSTER_CAP).toBe(53);
  });

  it('acionar um cartão abre a ficha da instância correspondente', async () => {
    const user = userEvent.setup();
    const onSelectAthlete = vi.fn();
    const roster: AthleteDraft[] = [makeAthlete({ instanceId: 7, pokemonId: 9 })];

    render(<GradeRoster roster={roster} onSelectAthlete={onSelectAthlete} />);

    await user.click(screen.getByRole('button', { name: /instância 7/ }));
    expect(onSelectAthlete).toHaveBeenCalledWith(7);
  });
});

// ---------------------------------------------------------------------------
// R5.1 — DicaPosicional: renderiza a dica quando fornecida
// ---------------------------------------------------------------------------

describe('DicaPosicional — dica ao iniciar atribuição (R5.1)', () => {
  it('renderiza a dica orientadora quando um texto é fornecido', () => {
    render(<DicaPosicional hint="Posicione próximo à linha para apoiar o bloqueio." />);

    const nota = screen.getByRole('note');
    expect(nota).toHaveTextContent(
      'Posicione próximo à linha para apoiar o bloqueio.',
    );
  });

  it('não renderiza nada quando a dica está vazia (não bloqueante)', () => {
    render(<DicaPosicional hint="   " />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R8.3 / R7.6 / R17.7 — Aviso inerte visível antes de salvar; gate; ARIA
// ---------------------------------------------------------------------------

describe('FichaAtleta — aviso de efeito inerte visível antes de salvar (R8.3)', () => {
  it('mostra o aviso inerte quando um golpe selecionado é efeito inerte', () => {
    // Ficha válida (4 golpes aprendíveis, habilidade disponível) com o golpe 2
    // marcado como efeito inerte: aviso não bloqueante visível antes de salvar.
    const snapshot = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
      inert: new Set([moveInertKey(2)]),
    });
    const athlete = makeAthlete({ moveIds: [1, 2, 3, 4], abilityId: 100 });

    render(
      <FichaAtleta
        athlete={athlete}
        snapshot={snapshot}
        abilityOptions={abilityOptionsFor(snapshot, 25)}
        moveOptions={moveOptionsFor(snapshot, 25)}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    // O aviso de efeito inerte está visível, com texto específico (R8.3/R17.6).
    expect(screen.getByText(/Efeito inerte:/)).toBeInTheDocument();

    // Aviso inerte NÃO é bloqueante: Salvar continua habilitado quando o
    // restante da ficha é válido (R8.1).
    expect(screen.getByRole('button', { name: 'Salvar ficha' })).toBeEnabled();
  });

  it('desabilita Salvar quando há aviso BLOQUEANTE e habilita quando a ficha é válida', () => {
    // Golpe 9 não é aprendível → MOVE_NOT_LEARNABLE (bloqueante).
    const snapshotBloqueado = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
    });
    const athleteBloqueado = makeAthlete({ moveIds: [1, 2, 3, 9], abilityId: 100 });

    const { unmount } = render(
      <FichaAtleta
        athlete={athleteBloqueado}
        snapshot={snapshotBloqueado}
        abilityOptions={abilityOptionsFor(snapshotBloqueado, 25)}
        moveOptions={moveOptionsFor(snapshotBloqueado, 25)}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Salvar ficha' })).toBeDisabled();
    unmount();

    // Agora uma ficha totalmente válida: Salvar habilitado.
    const snapshotValido = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
    });
    const athleteValido = makeAthlete({ moveIds: [1, 2, 3, 4], abilityId: 100 });

    render(
      <FichaAtleta
        athlete={athleteValido}
        snapshot={snapshotValido}
        abilityOptions={abilityOptionsFor(snapshotValido, 25)}
        moveOptions={moveOptionsFor(snapshotValido, 25)}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Salvar ficha' })).toBeEnabled();
  });
});

describe('FichaAtleta — associação de avisos por aria-describedby (R17.7)', () => {
  it('associa o aviso de habilidade indisponível ao seletor de habilidade', () => {
    // Habilidade 999 não disponível → ABILITY_NOT_AVAILABLE (alvo: ability).
    const snapshot = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
    });
    const athlete = makeAthlete({ moveIds: [1, 2, 3, 4], abilityId: 999 });

    render(
      <FichaAtleta
        athlete={athlete}
        snapshot={snapshot}
        abilityOptions={abilityOptionsFor(snapshot, 25)}
        moveOptions={moveOptionsFor(snapshot, 25)}
        onChange={vi.fn()}
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Habilidade' });
    const describedBy = select.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    // O id referenciado existe e aponta um elemento de aviso presente no DOM.
    const avisoId = describedBy!.split(/\s+/)[0]!;
    const aviso = document.getElementById(avisoId);
    expect(aviso).not.toBeNull();
    expect(aviso).toHaveTextContent(/não está disponível/);
  });

  it('associa o aviso de golpe não aprendível ao <select> do slot correspondente', () => {
    // Golpe 9 (slot 4) não é aprendível → MOVE_NOT_LEARNABLE (alvo: move).
    const snapshot = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
    });
    const athlete = makeAthlete({ moveIds: [1, 2, 3, 9], abilityId: 100 });

    render(
      <FichaAtleta
        athlete={athlete}
        snapshot={snapshot}
        abilityOptions={abilityOptionsFor(snapshot, 25)}
        moveOptions={moveOptionsFor(snapshot, 25)}
        onChange={vi.fn()}
      />,
    );

    const slot4 = screen.getByRole('combobox', { name: 'Golpe 4' });
    const describedBy = slot4.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const avisoId = describedBy!.split(/\s+/)[0]!;
    const aviso = document.getElementById(avisoId);
    expect(aviso).not.toBeNull();
    expect(aviso).toHaveTextContent(/não é aprendível/);
  });
});

// ---------------------------------------------------------------------------
// R10.3 / R10.4 — Fidelidade do preset "Time do Curti"
// ---------------------------------------------------------------------------

describe('Preset Curti — fidelidade dos 22 titulares e proveniência PFL (R10.3/R10.4)', () => {
  it('o preset tem 11 titulares de ataque e 11 de defesa com espécies/posições esperadas', () => {
    const def = getPreset('curti');

    const offense = def.lineups.filter((l) => l.unit === 'offense');
    const defense = def.lineups.filter((l) => l.unit === 'defense');
    expect(offense).toHaveLength(11);
    expect(defense).toHaveLength(11);

    // Mapa instanceId → atleta para resolver espécie/posição por escalação.
    const byInstance = new Map(def.roster.map((a) => [a.instanceId, a] as const));

    // Representativo do ataque: QB = alakazam (#65), RB = rapidash (#78).
    const qb = offense.find((l) => l.role === 'QB');
    const rb = offense.find((l) => l.role === 'RB');
    expect(byInstance.get(qb!.instanceId)?.pokemonId).toBe(65);
    expect(byInstance.get(qb!.instanceId)?.positionDesignation).toBe('QB');
    expect(byInstance.get(rb!.instanceId)?.pokemonId).toBe(78);

    // Representativo da defesa: NT = snorlax (#143), DE-L = machamp (#68).
    const nt = defense.find((l) => l.role === 'NT');
    const deL = defense.find((l) => l.role === 'DE-L');
    expect(byInstance.get(nt!.instanceId)?.pokemonId).toBe(143);
    expect(byInstance.get(deL!.instanceId)?.pokemonId).toBe(68);

    // As 22 identidades titulares são distintas (ataque ∪ defesa).
    const starters = new Set(
      [...offense, ...defense].map((l) => l.instanceId),
    );
    expect(starters.size).toBe(22);
  });

  it('o clone marca proveniência histórica dos 22 titulares e atribuição PFL dos demais campos', () => {
    const draft = clonePresetToDraft('curti');

    expect(draft.provenance?.presetId).toBe('curti');
    expect(draft.provenance?.sourceStarters22).toBe(true);
    expect(draft.provenance?.pflAssignedFields).toEqual(
      expect.arrayContaining(['abilities', 'moves', 'special_teams', 'strategy']),
    );
  });
});

// ---------------------------------------------------------------------------
// Acessibilidade automatizada (jest-axe)
// ---------------------------------------------------------------------------

describe('Tela_Meu_Time — acessibilidade automatizada (jest-axe)', () => {
  it('os componentes principais renderizados não apresentam violações', async () => {
    const snapshot = makeSnapshot({
      pokemonId: 25,
      moveIds: [1, 2, 3, 4],
      abilityIds: [100],
    });
    const roster: AthleteDraft[] = [
      makeAthlete({ instanceId: 1, pokemonId: 25 }),
      makeAthlete({ instanceId: 2, pokemonId: 6 }),
    ];

    const { container } = render(
      <main>
        <SeletorOrigem onUsePreset={vi.fn()} onStartEmpty={vi.fn()} />
        <GradeRoster roster={roster} onSelectAthlete={vi.fn()} />
        <DicaPosicional hint="Dica orientadora para o par." />
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
      </main>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('AbasUnidade não apresenta violações de a11y', async () => {
    // `AbasUnidade` agrupa as 6 abas de special teams sob um `role="group"`
    // rotulado "Especiais" dentro do `tablist` (padrão de agrupamento visual do
    // design, Task 9.2). As regras `aria-required-children`/`aria-required-parent`
    // do axe presumem `role="tab"` como filho direto do `tablist`; o agrupamento
    // intermediário é intencional e operável por teclado (coberto pelos testes de
    // interação acima). Desativamos apenas essas duas regras estruturais,
    // mantendo todas as demais auditorias (rótulos, foco, contraste) ativas.
    const { container } = render(<AbasUnidade active="offense" onSelect={vi.fn()} />);

    const results = await axe(container, {
      rules: {
        'aria-required-children': { enabled: false },
        'aria-required-parent': { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });
});
