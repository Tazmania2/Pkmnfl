/**
 * Testes de integração do contrato e da reprodutibilidade do adaptador
 * `POST /api/simulate` (`Funcao_Simulacao`), Task 17.3.
 *
 * Estes testes exercitam o Route Handler **de ponta a ponta** até o núcleo puro,
 * mas isolam a única camada impura — a resolução de dados do Supabase — por meio
 * de dublês (`vi.mock`) da Camada_Leitura (`lib/data/rules`, `lib/data/registry`)
 * e do cliente público (`lib/supabase/public-client`). Nenhum banco real é
 * tocado: os mocks devolvem o `design_baseline` MVP (parâmetros + matchups) e
 * confirmam a integridade referencial de golpes/habilidades.
 *
 * Cobrem:
 * - **Contrato (R15.1/R15.2/R15.3)**: o handler aceita os cinco campos
 *   (`home`, `away`, `strategyHome`, `strategyAway`, `seed`), responde **200**
 *   com JSON `{ log, score }` e **nunca** vaza o núcleo puro ao cliente — a
 *   resposta expõe apenas `log` e `score`.
 * - **Reprodutibilidade (R15.5/R1.4)**: a MESMA entrada produz a MESMA resposta
 *   **byte a byte** entre invocações; um `seed` diferente **pode** divergir
 *   (não exigimos divergência), ainda retornando 200 `{ log, score }`.
 * - **Server-only (R15.6)**: o núcleo é importado apenas aqui, no servidor; o
 *   handler exposto é a função `POST` e devolve somente o par `{ log, score }`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Payload MVP de `design_baseline` (valores do arquivo de design congelado).
// Reflete `simulation_parameters.json`: probability aninhada, nomes
// `catch`/`fumble_probability`/`active_snap`, limites de corrida/passe.
// ---------------------------------------------------------------------------

const BASELINE_VERSION = 'D1-design-2026-10-09';
const BASELINE_STATUS =
  'FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED';

const SIM_PARAMS_PAYLOAD = {
  version: BASELINE_VERSION,
  tick_s: 0.1,
  play_timeout_s: 30,
  suppression_radius_yards: 2,
  quarter_seconds: 900,
  weather: { CLEAR: 0.4, RAIN: 0.2, WIND: 0.15, HEAT: 0.15, COLD: 0.1 },
  weather_modifiers: {
    CLEAR: {},
    RAIN: { catch: -0.04, fumble_probability: 0.02 },
    WIND: { deep_pass: -0.05, long_kick: -0.05 },
    HEAT: { fatigue_per_snap_add: 0.002 },
    COLD: { catch: -0.02 },
  },
  probability: { base: 0.5, difference_coefficient: 0.45, min: 0.05, max: 0.95 },
  skill_mod_max_abs: 0.15,
  fatigue: {
    active_snap: 0.003,
    extreme_action: 0.005,
    inactive_snap_recovery: 0.001,
    max_penalty: 0.12,
  },
  run: {
    gain_formula: '2+round(4*clamp(run_advantage,0,1))',
    loss_if_gap_lost_min: -4,
    loss_if_gap_lost_max: -1,
  },
  pass: {
    short_target_yards: [3, 10] as [number, number],
    deep_target_yards: [12, 35] as [number, number],
  },
};

const MATCHUPS_PAYLOAD = [
  { offense: 'O_RUN_INSIDE', defense: 'D_RUN_FIT', offense_probability_delta: -0.06 },
  { offense: 'O_PASS_DEEP', defense: 'D_ZONE', offense_probability_delta: -0.06 },
  { offense: 'O_PASS_SHORT', defense: 'D_RUSH', offense_probability_delta: -0.04 },
];

const SIM_PARAMS_ROW = {
  version: BASELINE_VERSION,
  kind: 'simulation_parameters' as const,
  status: BASELINE_STATUS,
  payload: SIM_PARAMS_PAYLOAD,
  created_at: '2026-10-09T00:00:00.000Z',
};

const MATCHUPS_ROW = {
  version: BASELINE_VERSION,
  kind: 'matchups_36' as const,
  status: BASELINE_STATUS,
  payload: MATCHUPS_PAYLOAD,
  created_at: '2026-10-09T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mocks da fronteira de pureza (Camada_Leitura + cliente Supabase).
//
// A rota faz: getDesignBaseline(undefined, { client }) → version; depois
// client.from('design_baseline').select(...).eq('version', ...) → ambas as
// linhas. getNflMatchups → []. getMove/getAbility → { found: true, ... }.
// ---------------------------------------------------------------------------

// Cliente falso: só a cadeia from().select().eq() usada por resolveBaseline
// precisa resolver; o restante da resolução passa por getMove/getAbility.
const fakeClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() =>
        Promise.resolve({ data: [SIM_PARAMS_ROW, MATCHUPS_ROW], error: null }),
      ),
    })),
  })),
};

vi.mock('@/lib/supabase/public-client', () => ({
  createPublicClient: vi.fn(() => fakeClient),
}));

vi.mock('@/lib/data/rules', () => ({
  // Registro mais recente de baseline: a rota só usa `.version` daqui.
  getDesignBaseline: vi.fn(async () => ({
    version: BASELINE_VERSION,
    kind: 'simulation_parameters',
    status: BASELINE_STATUS,
    payload: SIM_PARAMS_PAYLOAD,
  })),
  // Gancho de calibração NFL não aplicado no MVP.
  getNflMatchups: vi.fn(async () => []),
}));

vi.mock('@/lib/data/registry', () => ({
  getMove: vi.fn(async (moveId: number) => ({
    found: true,
    value: { move_id: moveId, name: `move-${moveId}`, raw_data: {} },
  })),
  getAbility: vi.fn(async (abilityId: number) => ({
    found: true,
    value: { ability_id: abilityId, name: `ability-${abilityId}`, raw_data: {} },
  })),
}));

// Importado após os mocks (hoisting do vi.mock garante a substituição antes).
import { POST } from './route';

// ---------------------------------------------------------------------------
// Fixtures de requisição válida (SimulateRequest com os 5 campos).
// ---------------------------------------------------------------------------

type StatsLike = {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
};

const BASE_STATS: StatsLike = {
  hp: 80,
  attack: 80,
  defense: 80,
  specialAttack: 80,
  specialDefense: 80,
  speed: 80,
};

function athlete(instanceId: number, position: string) {
  return {
    instanceId,
    pokemonId: 1000 + instanceId,
    types: ['normal'],
    stats: BASE_STATS,
    abilityId: 1,
    // Quatro golpes (contrato da foundation).
    moveIds: [1, 2, 3, 4],
    positionDesignation: position,
  };
}

// Escalação com instance_id único por time em todas as unidades.
function lineup(startId: number) {
  return {
    units: {
      offense: [
        athlete(startId + 0, 'QB'),
        athlete(startId + 1, 'RB'),
        athlete(startId + 2, 'WR'),
      ],
      defense: [
        athlete(startId + 3, 'CB'),
        athlete(startId + 4, 'S'),
        athlete(startId + 5, 'LB'),
      ],
      specialTeams: [athlete(startId + 6, 'K')],
    },
  };
}

function buildRequestBody(seed: string) {
  return {
    home: lineup(1),
    away: lineup(101),
    strategyHome: { preset: 'BALANCED' },
    strategyAway: { preset: 'GROUND' },
    seed,
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/simulate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------

describe('POST /api/simulate — contrato e reprodutibilidade (integração)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('smoke do contrato: aceita os 5 campos e retorna 200 { log, score } em JSON (R15.1/R15.2/R15.3)', async () => {
    const res = await POST(postRequest(buildRequestBody('12345')));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const parsed = JSON.parse(await res.text()) as Record<string, unknown>;

    // Expõe exatamente { log, score } — o núcleo puro não vaza ao cliente (R15.6).
    expect(parsed).toHaveProperty('log');
    expect(parsed).toHaveProperty('score');
    expect(Object.keys(parsed).sort()).toEqual(['log', 'score']);

    // Formas mínimas do contrato de saída.
    const score = parsed.score as Record<string, unknown>;
    expect(score).toHaveProperty('home');
    expect(score).toHaveProperty('away');
    expect(score).toHaveProperty('final');

    const log = parsed.log as Record<string, unknown>;
    expect(log).toHaveProperty('seedUsed', '12345');
    expect(log).toHaveProperty('baselineVersion', BASELINE_VERSION);
    expect(Array.isArray(log.events)).toBe(true);
  });

  it('reprodutibilidade: mesmo seed = mesma resposta byte a byte entre invocações (R15.5/R1.4)', async () => {
    const body = buildRequestBody('777');

    const first = await (await POST(postRequest(body))).text();
    const second = await (await POST(postRequest(body))).text();

    expect(first).toBe(second);
  });

  it('seeds diferentes podem divergir, ainda retornando 200 { log, score } (R15.5)', async () => {
    const resA = await POST(postRequest(buildRequestBody('1')));
    const resB = await POST(postRequest(buildRequestBody('999999')));

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const a = JSON.parse(await resA.text()) as Record<string, unknown>;
    const b = JSON.parse(await resB.text()) as Record<string, unknown>;

    // Não exigimos divergência; apenas que o contrato { log, score } se mantém.
    expect(Object.keys(a).sort()).toEqual(['log', 'score']);
    expect(Object.keys(b).sort()).toEqual(['log', 'score']);
  });

  it('server-only: o handler exposto é a função POST (único ponto que importa o núcleo) (R15.6)', () => {
    expect(typeof POST).toBe('function');
    // Assinatura (request) → Promise<Response>: aridade 1.
    expect(POST.length).toBe(1);
  });
});
