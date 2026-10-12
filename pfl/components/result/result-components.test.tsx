// @vitest-environment jsdom

/**
 * Testes de componente/acessibilidade da Tela_Resultado — spec
 * `pfl-gameday-result-ui`, Task 15.3.
 *
 * Verifica que os componentes de apresentação da Tela_Resultado renderizam
 * **exatamente** os valores derivados do `Placar`/`Log_Partida`, sem recalcular
 * nem fabricar dados:
 * - `PlacarFinal` exibe `score.home`/`score.away` verbatim (R13.1).
 * - `EstatisticasPartida` exibe os valores de `GameStats` verbatim (R14.1).
 * - `Highlights` renderiza um item por entrada de `selectHighlights(log)` com
 *   quarter/clock/kind/text; log sem eventos relevantes → estado vazio honesto
 *   (R14.2, R14.3).
 * - `NavegacaoResultado` dispara `router.push('/game-day')` e `router.push('/time')`
 *   via `useRouter` mockado; ambos os controles são botões reais, alcançáveis por
 *   teclado (ordem de `Tab` = ordem visual) e com foco visível (R15.1–R15.3,
 *   R17.1, R17.2).
 * - `jest-axe` roda sobre cada componente renderizado e não acusa violações
 *   automatizáveis de acessibilidade (R17.1, R17.2).
 *
 * _Requirements: 13.1, 14.1, 14.2, 14.3, 15.1, 15.2, 15.3, 17.1, 17.2_
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import { PlacarFinal } from './PlacarFinal';
import { EstatisticasPartida } from './EstatisticasPartida';
import { Highlights } from './Highlights';
import { NavegacaoResultado } from './NavegacaoResultado';
import type { GameLog, GameStats, LogEvent, Score, StateSnapshot } from '@/lib/match';

// ---------------------------------------------------------------------------
// Mock de `next/navigation` — `useRouter().push` é observável por teste.
// `pushMock` é reatribuído por teste em `beforeEach` para isolamento.
// ---------------------------------------------------------------------------

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures mínimas, construídas à mão (nenhum dado fabricado pelo componente).
// ---------------------------------------------------------------------------

/** `StateSnapshot` mínimo com o `quarter`/`gameClock` que os highlights leem. */
function snapshot(quarter: number, gameClock: number, home: number, away: number): StateSnapshot {
  return {
    quarter,
    gameClock,
    down: 1,
    distance: 10,
    ballOn: 50,
    possession: 'home',
    score: { home, away },
    weather: 'CLEAR',
  };
}

/** Monta um `LogEvent` com `seq` = `eventIndex` para rastreabilidade clara. */
function logEvent(
  seq: number,
  type: LogEvent['type'],
  state: StateSnapshot,
  narrative: string,
  detail: Record<string, unknown>,
): LogEvent {
  return {
    seq,
    type,
    state,
    narrative,
    detail: detail as LogEvent['detail'],
  };
}

/**
 * `GameLog` com dois eventos relevantes para highlights — um `SCORE` (TD) e um
 * `POSSESSION_CHANGE` com turnover — intercalados por um evento irrelevante
 * (`PLAY_RESULT`) que NÃO deve virar highlight.
 */
function logComHighlights(): GameLog {
  const events: LogEvent[] = [
    logEvent(0, 'SCORE', snapshot(1, 3000, 7, 0), 'Touchdown da casa!', { type: 'TD', team: 'home' }),
    logEvent(1, 'PLAY_RESULT', snapshot(2, 2400, 7, 0), 'Corrida de 3 jardas.', { kind: 'rush' }),
    logEvent(2, 'POSSESSION_CHANGE', snapshot(3, 1200, 7, 0), 'Interceptação! Troca de posse.', {
      turnover: true,
    }),
  ];
  return {
    seedUsed: '42',
    baselineVersion: 'FROZEN_MVP_1',
    baselineStatus: 'FROZEN_MVP_UNCALIBRATED',
    events,
    stats: emptyStats(),
  };
}

/** `GameLog` sem nenhum evento relevante → `selectHighlights` retorna []. */
function logSemHighlights(): GameLog {
  const events: LogEvent[] = [
    logEvent(0, 'PLAY_RESULT', snapshot(1, 3000, 0, 0), 'Passe incompleto.', { kind: 'pass' }),
  ];
  return {
    seedUsed: '7',
    baselineVersion: 'FROZEN_MVP_1',
    baselineStatus: 'FROZEN_MVP_UNCALIBRATED',
    events,
    stats: emptyStats(),
  };
}

function emptyStats(): GameStats {
  return {
    rushes: { attempts: 0, yards: 0 },
    passes: { attempts: 0, completions: 0, yards: 0, interceptions: 0 },
    turnovers: 0,
    fouls: 0,
    scoringSummary: [],
  };
}

/** `GameStats` com valores distintos e não triviais para asserções verbatim. */
const STATS: GameStats = {
  rushes: { attempts: 23, yards: 118 },
  passes: { attempts: 31, completions: 19, yards: 247, interceptions: 2 },
  turnovers: 3,
  fouls: 5,
  scoringSummary: [{ type: 'TD', team: 'home', quarter: 1 }],
};

/**
 * Renderiza um componente dentro de um `<main>` para fornecer o landmark que o
 * `jest-axe` espera numa página; evita falso positivo de "região" sem alterar o
 * componente sob teste.
 */
function renderInMain(ui: ReactElement) {
  return render(<main>{ui}</main>);
}

// ---------------------------------------------------------------------------
// PlacarFinal — R13.1
// ---------------------------------------------------------------------------

describe('PlacarFinal', () => {
  const score: Score = { home: 24, away: 17, final: true, tie: false };

  it('renderiza os valores exatos de score.home e score.away', () => {
    renderInMain(<PlacarFinal score={score} />);

    const casa = screen.getByText('Casa').closest('.placar-final__time') as HTMLElement;
    const visitante = screen.getByText('Visitante').closest('.placar-final__time') as HTMLElement;

    expect(within(casa).getByText('24')).toBeInTheDocument();
    expect(within(visitante).getByText('17')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade (jest-axe)', async () => {
    const { container } = renderInMain(<PlacarFinal score={score} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// EstatisticasPartida — R14.1
// ---------------------------------------------------------------------------

describe('EstatisticasPartida', () => {
  it('renderiza os valores exatos de GameStats', () => {
    renderInMain(<EstatisticasPartida stats={STATS} />);

    const item = (label: string) =>
      screen.getByText(label).closest('.estatisticas__item') as HTMLElement;

    expect(within(item('Corridas (tentativas)')).getByText('23')).toBeInTheDocument();
    expect(within(item('Corridas (jardas)')).getByText('118')).toBeInTheDocument();
    expect(within(item('Passes (completos / tentativas)')).getByText('19 / 31')).toBeInTheDocument();
    expect(within(item('Passes (jardas)')).getByText('247')).toBeInTheDocument();
    expect(within(item('Interceptações')).getByText('2')).toBeInTheDocument();
    expect(within(item('Turnovers')).getByText('3')).toBeInTheDocument();
    expect(within(item('Faltas')).getByText('5')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade (jest-axe)', async () => {
    const { container } = renderInMain(<EstatisticasPartida stats={STATS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// Highlights — R14.2, R14.3
// ---------------------------------------------------------------------------

describe('Highlights', () => {
  it('renderiza um item por entrada de selectHighlights com quarter/clock/kind/text', () => {
    renderInMain(<Highlights log={logComHighlights()} />);

    const itens = screen.getAllByRole('listitem');
    // Dois eventos relevantes (SCORE + POSSESSION_CHANGE turnover); o PLAY_RESULT
    // intercalado NÃO vira highlight.
    expect(itens).toHaveLength(2);

    // Item 1: TD da casa — Q1, relógio 05:00 (3000 décimos = 300 s).
    const [primeiro, segundo] = itens;
    expect(within(primeiro!).getByText('Q1 05:00')).toBeInTheDocument();
    expect(within(primeiro!).getByText('TD')).toBeInTheDocument();
    expect(within(primeiro!).getByText('Touchdown da casa!')).toBeInTheDocument();

    // Item 2: turnover — Q3, relógio 02:00 (1200 décimos = 120 s).
    expect(within(segundo!).getByText('Q3 02:00')).toBeInTheDocument();
    expect(within(segundo!).getByText('TURNOVER')).toBeInTheDocument();
    expect(within(segundo!).getByText('Interceptação! Troca de posse.')).toBeInTheDocument();
  });

  it('mostra estado vazio honesto quando não há eventos relevantes', () => {
    renderInMain(<Highlights log={logSemHighlights()} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(
      screen.getByText('Nenhum evento relevante registrado nesta partida.'),
    ).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade com lista preenchida (jest-axe)', async () => {
    const { container } = renderInMain(<Highlights log={logComHighlights()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('não tem violações de acessibilidade no estado vazio (jest-axe)', async () => {
    const { container } = renderInMain(<Highlights log={logSemHighlights()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// NavegacaoResultado — R15.1, R15.2, R15.3 + R17.1, R17.2
// ---------------------------------------------------------------------------

describe('NavegacaoResultado', () => {
  it('aciona router.push("/game-day") ao clicar em "Voltar ao Game Day"', async () => {
    const user = userEvent.setup();
    renderInMain(<NavegacaoResultado />);

    await user.click(screen.getByRole('button', { name: 'Voltar ao Game Day' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/game-day');
  });

  it('aciona router.push("/time") ao clicar em "Editar time"', async () => {
    const user = userEvent.setup();
    renderInMain(<NavegacaoResultado />);

    await user.click(screen.getByRole('button', { name: 'Editar time' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/time');
  });

  it('expõe dois botões reais alcançáveis por teclado na ordem visual', async () => {
    const user = userEvent.setup();
    renderInMain(<NavegacaoResultado />);

    const voltar = screen.getByRole('button', { name: 'Voltar ao Game Day' });
    const editar = screen.getByRole('button', { name: 'Editar time' });

    // Botões reais, não suprimidos do fluxo de tabulação.
    expect(voltar.tabIndex).not.toBe(-1);
    expect(editar.tabIndex).not.toBe(-1);

    // Ordem de Tab segue a ordem visual (primeiro "Voltar", depois "Editar").
    await user.tab();
    expect(voltar).toHaveFocus();
    await user.tab();
    expect(editar).toHaveFocus();
  });

  it('ativa o botão focado por teclado (Enter dispara a navegação)', async () => {
    const user = userEvent.setup();
    renderInMain(<NavegacaoResultado />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Voltar ao Game Day' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(pushMock).toHaveBeenCalledWith('/game-day');
  });

  it('não tem violações de acessibilidade (jest-axe)', async () => {
    const { container } = renderInMain(<NavegacaoResultado />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
