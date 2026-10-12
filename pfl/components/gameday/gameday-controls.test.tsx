// @vitest-environment jsdom

/**
 * Testes de componente e acessibilidade dos controles da Tela_Game_Day — spec
 * `pfl-gameday-result-ui`, Task 13.5.
 *
 * Cobre os componentes de apresentação (burros) que compõem os controles de
 * seleção/confirmação da partida:
 *
 * - `SeletorModo`: três botões grandes rotulados, seleção comunicada por mais de
 *   um recurso (não só cor) e seleção corrente exibida antes de confirmar
 *   (R1.1, R1.3, R17.6).
 * - `BotaoConfirmar`: controle único de confirmação, desabilitado sob validação
 *   pendente (`habilitado=false`) e idempotente durante `Simulando`
 *   (R5.1 gating; R5.3 idempotência).
 * - `EstadoCarregamento`: indicador de carregamento honesto (`role="status"`),
 *   sem placar/estatística fabricados (R7.1, R7.2).
 * - `AvisoErro`: mensagem de erro associada por ARIA ao controle de origem
 *   (`id = errorMessageId(controlId)`, `role="alert"`), com retry opcional
 *   (R17.7).
 * - Teclado/foco: ordem de `Tab` segue a ordem visual; botões reais são
 *   focáveis com foco visível (R17.1, R17.2).
 * - `jest-axe`: cada componente renderizado não acusa violações automatizáveis
 *   de acessibilidade (R17.1, R17.2).
 *
 * _Requirements: 1.1, 1.3, 5.1, 7.1, 7.2, 17.1, 17.2, 17.6, 17.7_
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import { SeletorModo } from './SeletorModo';
import { BotaoConfirmar } from './BotaoConfirmar';
import { EstadoCarregamento } from './EstadoCarregamento';
import { AvisoErro, errorMessageId } from './AvisoErro';
import type { MatchError } from '@/lib/match';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Rótulos exatos dos três modos, na ordem de apresentação exigida por R1.1.
const ROTULOS_MODO = ['Bot aleatório', 'Desafiar Curti', 'Importar seed'] as const;

// ===========================================================================
// SeletorModo
// ===========================================================================

describe('SeletorModo — três botões grandes rotulados (R1.1)', () => {
  it('renderiza exatamente três botões com os rótulos esperados', () => {
    const onSelect = vi.fn();
    render(<SeletorModo selected={null} onSelect={onSelect} />);

    const grupo = screen.getByRole('group', { name: 'Modo de adversário' });
    const botoes = within(grupo).getAllByRole('button');

    expect(botoes).toHaveLength(3);
    expect(botoes.map((b) => b.textContent)).toEqual([
      // Cada botão contém o rótulo + o indicador textual "● Selecionado".
      expect.stringContaining(ROTULOS_MODO[0]),
      expect.stringContaining(ROTULOS_MODO[1]),
      expect.stringContaining(ROTULOS_MODO[2]),
    ]);

    // Cada rótulo é um nome acessível válido (alvo rotulado — R17.3).
    for (const rotulo of ROTULOS_MODO) {
      expect(
        screen.getByRole('button', { name: new RegExp(rotulo) }),
      ).toBeInTheDocument();
    }
  });

  it('clicar em um botão chama onSelect com o modo correspondente (R1.2)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SeletorModo selected={null} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /Bot aleatório/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('bot_aleatorio');

    await user.click(screen.getByRole('button', { name: /Desafiar Curti/ }));
    expect(onSelect).toHaveBeenNthCalledWith(2, 'desafiar_curti');

    await user.click(screen.getByRole('button', { name: /Importar seed/ }));
    expect(onSelect).toHaveBeenNthCalledWith(3, 'importar_seed');
  });

  it('marca o botão selecionado por mais de um recurso: aria-pressed + indicador textual (R1.3, R17.6)', () => {
    render(<SeletorModo selected="desafiar_curti" onSelect={vi.fn()} />);

    const selecionado = screen.getByRole('button', { name: /Desafiar Curti/ });
    const naoSelecionado = screen.getByRole('button', { name: /Bot aleatório/ });

    // Recurso 1 — semântica para leitor de tela: aria-pressed="true" só no selecionado.
    expect(selecionado).toHaveAttribute('aria-pressed', 'true');
    expect(naoSelecionado).toHaveAttribute('aria-pressed', 'false');

    // Recurso 2 — pista textual independente de cor ("● Selecionado") visível no selecionado.
    const marcador = within(selecionado).getByText('● Selecionado');
    expect(marcador).toBeInTheDocument();
    expect(marcador.style.visibility).toBe('visible');
    // O marcador existe no DOM dos não-selecionados mas fica oculto.
    expect(within(naoSelecionado).getByText('● Selecionado').style.visibility).toBe(
      'hidden',
    );
  });

  it('exibe a seleção corrente antes da confirmação, de forma textual (R1.3)', () => {
    const { rerender } = render(<SeletorModo selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Nenhum adversário selecionado.')).toBeInTheDocument();

    rerender(<SeletorModo selected="importar_seed" onSelect={vi.fn()} />);
    expect(
      screen.getByText('Adversário selecionado: Importar seed.'),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// BotaoConfirmar
// ===========================================================================

describe('BotaoConfirmar — gating e idempotência (R5.1, R5.3)', () => {
  it('desabilitado sob validação pendente (habilitado=false): não chama onConfirmar (R5.1)', async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    render(
      <BotaoConfirmar habilitado={false} simulando={false} onConfirmar={onConfirmar} />,
    );

    const botao = screen.getByRole('button', { name: /Confirmar e simular/ });
    expect(botao).toBeDisabled();

    await user.click(botao);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('habilitado e não simulando: clique chama onConfirmar exatamente uma vez', async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    render(
      <BotaoConfirmar habilitado={true} simulando={false} onConfirmar={onConfirmar} />,
    );

    const botao = screen.getByRole('button', { name: /Confirmar e simular/ });
    expect(botao).toBeEnabled();

    await user.click(botao);
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('durante Simulando: desabilitado, idempotente e com estado ocupado (R5.3)', async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    render(
      <BotaoConfirmar habilitado={true} simulando={true} onConfirmar={onConfirmar} />,
    );

    // Estado ocupado comunicado por rótulo + aria-busy (não só cor — R17.6).
    const botao = screen.getByRole('button', { name: /Simulando/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');

    // Cliques repetidos durante a simulação não reenviam (idempotência R5.3).
    await user.click(botao);
    await user.click(botao);
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EstadoCarregamento
// ===========================================================================

describe('EstadoCarregamento — carregamento honesto, sem números fabricados (R7.1, R7.2)', () => {
  it('renderiza a mensagem honesta de progresso em uma região role="status"', () => {
    render(<EstadoCarregamento />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('Simulando a partida…');
  });

  it('aceita uma mensagem customizada ainda honesta', () => {
    render(<EstadoCarregamento mensagem="Processando a jogada…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Processando a jogada…');
  });

  it('não exibe placar, estatística ou qualquer número fabricado (R7.2)', () => {
    render(<EstadoCarregamento />);
    // Considera apenas o texto efetivamente apresentado dentro da região de
    // status, ignorando o <style> decorativo (que carrega timings de animação,
    // não valores de jogo). Nenhum dígito deve aparecer no conteúdo renderizado:
    // nada de placar/porcentagem/progresso falso.
    const status = screen.getByRole('status');
    const textoVisivel = Array.from(status.querySelectorAll('span'))
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(textoVisivel).toContain('Simulando a partida…');
    expect(textoVisivel).not.toMatch(/\d/);
  });
});

// ===========================================================================
// AvisoErro
// ===========================================================================

function matchError(overrides: Partial<MatchError> = {}): MatchError {
  return {
    kind: 'NETWORK',
    message: 'não foi possível contatar o motor.',
    ...overrides,
  };
}

describe('AvisoErro — mensagem associada por ARIA ao controle (R17.7)', () => {
  it('publica a mensagem com id = errorMessageId(controlId) e role="alert"', () => {
    const controlId = 'campo-seed';
    render(<AvisoErro error={matchError()} controlId={controlId} />);

    const alerta = screen.getByRole('alert');
    // Associação programática: o controle referencia este id via
    // aria-describedby/aria-errormessage, anunciando o erro ao focar (R17.7).
    expect(alerta).toHaveAttribute('id', errorMessageId(controlId));
    expect(alerta.id).toBe('campo-seed-error');
    expect(alerta).toHaveTextContent('não foi possível contatar o motor.');
  });

  it('não renderiza nada quando error é null', () => {
    const { container } = render(<AvisoErro error={null} controlId="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sem onRetry: nenhum botão de retry é exibido', () => {
    render(<AvisoErro error={matchError()} controlId="x" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('com onRetry: exibe o botão de nova tentativa e o aciona (R7.4)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<AvisoErro error={matchError()} controlId="x" onRetry={onRetry} />);

    const retry = screen.getByRole('button', { name: 'Tentar novamente' });
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Teclado / foco — ordem de Tab e foco visível (R17.1, R17.2)
// ===========================================================================

describe('Teclado e foco — ordem de Tab segue a ordem visual (R17.1, R17.2)', () => {
  it('botões reais são focáveis (tabIndex !== -1) e a ordem de Tab acompanha a ordem do DOM', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <SeletorModo selected="bot_aleatorio" onSelect={vi.fn()} />
        <BotaoConfirmar habilitado={true} simulando={false} onConfirmar={vi.fn()} />
      </main>,
    );

    const botaoAleatorio = screen.getByRole('button', { name: /Bot aleatório/ });
    const botaoCurti = screen.getByRole('button', { name: /Desafiar Curti/ });
    const botaoSeed = screen.getByRole('button', { name: /Importar seed/ });
    const botaoConfirmar = screen.getByRole('button', { name: /Confirmar e simular/ });

    // Botões nativos são focáveis por teclado — nenhum removido da ordem de Tab.
    for (const b of [botaoAleatorio, botaoCurti, botaoSeed, botaoConfirmar]) {
      expect(b.tabIndex).not.toBe(-1);
    }

    // Tabulação sequencial segue a ordem visual/DOM dos controles.
    await user.tab();
    expect(botaoAleatorio).toHaveFocus();
    await user.tab();
    expect(botaoCurti).toHaveFocus();
    await user.tab();
    expect(botaoSeed).toHaveFocus();
    await user.tab();
    expect(botaoConfirmar).toHaveFocus();
  });

  it('o botão de retry do AvisoErro é alcançável por teclado (foco visível R17.2)', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <AvisoErro error={matchError()} controlId="x" onRetry={vi.fn()} />
      </main>,
    );
    const retry = screen.getByRole('button', { name: 'Tentar novamente' });
    expect(retry.tabIndex).not.toBe(-1);

    await user.tab();
    expect(retry).toHaveFocus();
  });
});

// ===========================================================================
// jest-axe — sem violações automatizáveis (R17.1, R17.2)
// ===========================================================================

describe('Acessibilidade (jest-axe) — sem violações automatizáveis (R17.1, R17.2)', () => {
  it('SeletorModo não acusa violações', async () => {
    const { container } = render(
      <main>
        <SeletorModo selected="bot_aleatorio" onSelect={vi.fn()} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BotaoConfirmar (habilitado) não acusa violações', async () => {
    const { container } = render(
      <main>
        <BotaoConfirmar habilitado={true} simulando={false} onConfirmar={vi.fn()} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BotaoConfirmar (simulando) não acusa violações', async () => {
    const { container } = render(
      <main>
        <BotaoConfirmar habilitado={true} simulando={true} onConfirmar={vi.fn()} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('EstadoCarregamento não acusa violações', async () => {
    const { container } = render(
      <main>
        <EstadoCarregamento />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AvisoErro (com retry) não acusa violações', async () => {
    const { container } = render(
      <main>
        <AvisoErro error={matchError()} controlId="campo-seed" onRetry={vi.fn()} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
