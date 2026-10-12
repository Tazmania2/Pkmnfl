// @vitest-environment jsdom

/**
 * Testes de componente/acessibilidade da Tela_Estrategia — spec
 * `pfl-team-strategy-ui`, Task 10.2.
 *
 * Verifica, no DOM (jsdom + `@testing-library/react` + `jest-axe`), que os
 * componentes de apresentação da Tela_Estrategia (Task 10.1) atendem aos
 * requisitos de estilo, priorização operável por teclado e ausência de
 * desenhador/UI de special teams:
 *
 * - `SeletorEstiloAtaque` / `SeletorEstiloDefesa` renderizam opções de estilo
 *   rotuladas (role=radiogroup de role=radio) e emitem `onChange` com o valor do
 *   estilo selecionado tanto por clique quanto por acionamento de teclado (R11.1).
 * - `PrioridadeJogadasAtaque` renderiza as 6 `OFFENSE_PLAYS`; os controles de
 *   mover acima/abaixo são `<button>` reais, operáveis por teclado, e acioná-los
 *   chama `onReorder` com a permutação completa corretamente trocada
 *   (R12.1/R12.3/R12.4). Idem para `PrioridadeJogadasDefesa` com as 6
 *   `DEFENSE_PLAYS` (R12.2).
 * - Ausência de desenhador de jogadas e de UI de special teams (R12.5/R12.6):
 *   os componentes renderizados não contêm `<canvas>`/controle de desenhador
 *   nem controles de unidades de special teams (kickoff/punt/field goal etc.).
 * - `jest-axe` roda sobre cada componente renderizado e não acusa violações
 *   automatizáveis de acessibilidade.
 *
 * _Requirements: 11.1, 12.1, 12.2, 12.5, 12.6_
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import {
  SeletorEstiloAtaque,
  SeletorEstiloDefesa,
  PrioridadeJogadasAtaque,
  PrioridadeJogadasDefesa,
  LABELS_ATAQUE,
  LABELS_DEFESA,
} from './index';
import { OFFENSE_PLAYS, DEFENSE_PLAYS, type PlayId } from '@/lib/team/model';

// Os mapas de rótulos são tipados com um `Record` restrito às chaves de um
// lado; `OFFENSE_PLAYS`/`DEFENSE_PLAYS` são `readonly PlayId[]` (união completa).
// Vistas por `PlayId` para indexação uniforme nos testes (os valores existem em
// tempo de execução para todas as 6 jogadas do respectivo lado).
const ROTULOS_ATAQUE = LABELS_ATAQUE as Readonly<Record<PlayId, string>>;
const ROTULOS_DEFESA = LABELS_DEFESA as Readonly<Record<PlayId, string>>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// R11.1 — Seletores de estilo: opções rotuladas e onChange por clique/teclado
// ---------------------------------------------------------------------------

describe('SeletorEstiloAtaque — opções de estilo rotuladas e seleção (R11.1)', () => {
  it('renderiza um radiogroup rotulado com as três opções de ataque', () => {
    render(<SeletorEstiloAtaque value="" onChange={vi.fn()} />);

    const grupo = screen.getByRole('radiogroup', { name: 'Estilo de ataque' });
    const opcoes = within(grupo).getAllByRole('radio');
    expect(opcoes).toHaveLength(3);

    expect(within(grupo).getByRole('radio', { name: /Equilibrado/ })).toBeInTheDocument();
    expect(within(grupo).getByRole('radio', { name: /Terrestre/ })).toBeInTheDocument();
    expect(within(grupo).getByRole('radio', { name: /Aéreo/ })).toBeInTheDocument();
  });

  it('reflete a opção registrada via aria-checked', () => {
    render(<SeletorEstiloAtaque value="aerial" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Aéreo/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Equilibrado/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('clicar numa opção emite onChange com o valor do estilo', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeletorEstiloAtaque value="" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /Terrestre/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ground');
  });

  it('acionar a opção focada por teclado (Enter) emite onChange com o valor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeletorEstiloAtaque value="" onChange={onChange} />);

    const aereo = screen.getByRole('radio', { name: /Aéreo/ });
    aereo.focus();
    expect(aereo).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('aerial');
  });

  it('acionar a opção focada por teclado (Espaço) emite onChange com o valor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeletorEstiloAtaque value="" onChange={onChange} />);

    const equilibrado = screen.getByRole('radio', { name: /Equilibrado/ });
    equilibrado.focus();
    await user.keyboard('{ }');
    expect(onChange).toHaveBeenCalledWith('balanced');
  });
});

describe('SeletorEstiloDefesa — opções de estilo rotuladas e seleção (R11.1)', () => {
  it('renderiza um radiogroup rotulado com as quatro opções de defesa', () => {
    render(<SeletorEstiloDefesa value="" onChange={vi.fn()} />);

    const grupo = screen.getByRole('radiogroup', { name: 'Estilo de defesa' });
    const opcoes = within(grupo).getAllByRole('radio');
    expect(opcoes).toHaveLength(4);
  });

  it('clicar numa opção de defesa emite onChange com o valor do estilo', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeletorEstiloDefesa value="" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /Zona/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('zone');
  });

  it('acionar a opção de defesa focada por teclado (Enter) emite onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeletorEstiloDefesa value="" onChange={onChange} />);

    const pressao = screen.getByRole('radio', { name: /^Pressão/ });
    pressao.focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('rush');
  });
});

// ---------------------------------------------------------------------------
// R12.1 — Priorização de ataque: 6 jogadas, controles de teclado, permutação
// ---------------------------------------------------------------------------

/** Ordem canônica inicial das jogadas de ataque como array mutável. */
function ordemAtaque(): PlayId[] {
  return [...OFFENSE_PLAYS];
}

/** Ordem canônica inicial das jogadas de defesa como array mutável. */
function ordemDefesa(): PlayId[] {
  return [...DEFENSE_PLAYS];
}

describe('PrioridadeJogadasAtaque — 6 jogadas e reordenação por teclado (R12.1/R12.3/R12.4)', () => {
  it('renderiza exatamente as 6 jogadas de ataque, cada uma rotulada', () => {
    render(<PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />);

    const lista = screen.getByRole('list', {
      name: 'Prioridade das jogadas de ataque',
    });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(6);

    for (const playId of OFFENSE_PLAYS) {
      expect(screen.getByText(ROTULOS_ATAQUE[playId])).toBeInTheDocument();
    }
  });

  it('cada item expõe botões reais "mover para cima/baixo" com rótulo específico', () => {
    render(<PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />);

    const segundaLabel = ROTULOS_ATAQUE[OFFENSE_PLAYS[1]!];
    const cima = screen.getByRole('button', { name: `Mover ${segundaLabel} para cima` });
    const baixo = screen.getByRole('button', { name: `Mover ${segundaLabel} para baixo` });

    expect(cima.tagName).toBe('BUTTON');
    expect(baixo.tagName).toBe('BUTTON');
    // Alcançável por teclado (não removido da ordem de tabulação).
    expect(cima.tabIndex).not.toBe(-1);
    expect(baixo.tabIndex).not.toBe(-1);
  });

  it('o primeiro item tem "mover para cima" desabilitado; o último, "mover para baixo"', () => {
    render(<PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />);

    const primeiraLabel = ROTULOS_ATAQUE[OFFENSE_PLAYS[0]!];
    const ultimaLabel = ROTULOS_ATAQUE[OFFENSE_PLAYS[5]!];

    expect(
      screen.getByRole('button', { name: `Mover ${primeiraLabel} para cima` }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: `Mover ${ultimaLabel} para baixo` }),
    ).toBeDisabled();
  });

  it('acionar "mover para baixo" por teclado emite a permutação com a troca adjacente', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={onReorder} />);

    const primeiraLabel = ROTULOS_ATAQUE[OFFENSE_PLAYS[0]!];
    const baixo = screen.getByRole('button', { name: `Mover ${primeiraLabel} para baixo` });
    baixo.focus();
    await user.keyboard('{Enter}');

    const esperado: PlayId[] = [
      OFFENSE_PLAYS[1]!,
      OFFENSE_PLAYS[0]!,
      OFFENSE_PLAYS[2]!,
      OFFENSE_PLAYS[3]!,
      OFFENSE_PLAYS[4]!,
      OFFENSE_PLAYS[5]!,
    ];
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(esperado);
    // A saída é uma permutação completa do conjunto fixo (nada adicionado/removido).
    expect([...esperado].sort()).toEqual([...OFFENSE_PLAYS].sort());
  });

  it('acionar "mover para cima" (clique) emite a permutação com a troca adjacente', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={onReorder} />);

    const terceiraLabel = ROTULOS_ATAQUE[OFFENSE_PLAYS[2]!];
    await user.click(
      screen.getByRole('button', { name: `Mover ${terceiraLabel} para cima` }),
    );

    const esperado: PlayId[] = [
      OFFENSE_PLAYS[0]!,
      OFFENSE_PLAYS[2]!,
      OFFENSE_PLAYS[1]!,
      OFFENSE_PLAYS[3]!,
      OFFENSE_PLAYS[4]!,
      OFFENSE_PLAYS[5]!,
    ];
    expect(onReorder).toHaveBeenCalledWith(esperado);
  });
});

describe('PrioridadeJogadasDefesa — 6 jogadas e reordenação por teclado (R12.2/R12.3/R12.4)', () => {
  it('renderiza exatamente as 6 jogadas de defesa, cada uma rotulada', () => {
    render(<PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={vi.fn()} />);

    const lista = screen.getByRole('list', {
      name: 'Prioridade das jogadas de defesa',
    });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(6);

    for (const playId of DEFENSE_PLAYS) {
      expect(screen.getByText(ROTULOS_DEFESA[playId])).toBeInTheDocument();
    }
  });

  it('acionar "mover para baixo" por teclado emite a permutação com a troca adjacente', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={onReorder} />);

    const primeiraLabel = ROTULOS_DEFESA[DEFENSE_PLAYS[0]!];
    const baixo = screen.getByRole('button', { name: `Mover ${primeiraLabel} para baixo` });
    baixo.focus();
    await user.keyboard('{ }');

    const esperado: PlayId[] = [
      DEFENSE_PLAYS[1]!,
      DEFENSE_PLAYS[0]!,
      DEFENSE_PLAYS[2]!,
      DEFENSE_PLAYS[3]!,
      DEFENSE_PLAYS[4]!,
      DEFENSE_PLAYS[5]!,
    ];
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(esperado);
    expect([...esperado].sort()).toEqual([...DEFENSE_PLAYS].sort());
  });
});

// ---------------------------------------------------------------------------
// R12.5 / R12.6 — Ausência de desenhador de jogadas e de UI de special teams
// ---------------------------------------------------------------------------

describe('Tela_Estrategia — sem desenhador e sem UI de special teams (R12.5/R12.6)', () => {
  it('os componentes de estratégia não renderizam canvas nem controle de desenhador (R12.5)', () => {
    const { container } = render(
      <main>
        <SeletorEstiloAtaque value="balanced" onChange={vi.fn()} />
        <SeletorEstiloDefesa value="balanced" onChange={vi.fn()} />
        <PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />
        <PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={vi.fn()} />
      </main>,
    );

    // Nenhum <canvas> (base de um desenhador de jogadas).
    expect(container.querySelector('canvas')).toBeNull();
    // Nenhum texto de "desenhador"/"designer".
    expect(screen.queryByText(/desenhador|designer/i)).toBeNull();
    expect(
      screen.queryByRole('button', { name: /desenhador|designer|desenhar jogada/i }),
    ).toBeNull();
  });

  it('os componentes de estratégia não expõem UI de special teams (R12.6)', () => {
    render(
      <main>
        <SeletorEstiloAtaque value="balanced" onChange={vi.fn()} />
        <SeletorEstiloDefesa value="balanced" onChange={vi.fn()} />
        <PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />
        <PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={vi.fn()} />
      </main>,
    );

    // Nenhum rótulo/texto referente a unidades de special teams.
    const stPattern =
      /special teams|times especiais|unidades especiais|kickoff|kick off|kick return|punt|punt return|field goal|chute|retorno/i;
    expect(screen.queryByText(stPattern)).toBeNull();
    expect(screen.queryByRole('button', { name: stPattern })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: stPattern })).toBeNull();

    // Apenas os dois radiogroups de estilo (ataque, defesa) existem.
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    // Apenas as duas listas de prioridade (ataque, defesa) existem.
    expect(screen.getAllByRole('list')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Acessibilidade automatizada (jest-axe)
// ---------------------------------------------------------------------------

describe('Tela_Estrategia — acessibilidade automatizada (jest-axe)', () => {
  it('os componentes de estratégia renderizados não apresentam violações', async () => {
    const { container } = render(
      <main>
        <SeletorEstiloAtaque value="balanced" onChange={vi.fn()} />
        <SeletorEstiloDefesa value="balanced" onChange={vi.fn()} />
        <PrioridadeJogadasAtaque order={ordemAtaque()} onReorder={vi.fn()} />
        <PrioridadeJogadasDefesa order={ordemDefesa()} onReorder={vi.fn()} />
      </main>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
