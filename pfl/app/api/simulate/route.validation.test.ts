/**
 * Property test da validação de entrada da `Funcao_Simulacao`
 * (`app/api/simulate/route.validation.test.ts`).
 *
 * **Property 42: Validação de entrada da função de backend.**
 * **Validates: Requirements 1.6, 15.4**
 *
 * A validação de forma e faixas acontece **antes** de qualquer acesso a dados
 * (Supabase) no handler `POST`. Logo, toda entrada inválida é rejeitada com
 * **400** `{ error, field }` **sem executar a partida** e **sem** tocar a
 * Camada_Leitura — por isso nenhum mock de Supabase é necessário aqui.
 *
 * A propriedade: partindo de um corpo-base plausivelmente válido, qualquer
 * MUTAÇÃO que o torne inválido num campo específico resulta em `status === 400`
 * e num corpo JSON `{ error: string, field }` que identifica o campo ofensor,
 * para todo o espaço de mutações amostrado (R1.6, R15.4).
 *
 * Feature: pfl-simulation-engine, Property 42
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PBT_NUM_RUNS } from '@/lib/sim/test-setup';
import { POST } from './route';

// ---------------------------------------------------------------------------
// Fixture: corpo-base plausivelmente válido (forma + faixas corretas)
// ---------------------------------------------------------------------------

/** Stats base completas (os seis campos numéricos finitos exigidos). */
function makeStats(): Record<string, number> {
  return {
    hp: 100,
    attack: 80,
    defense: 70,
    specialAttack: 90,
    specialDefense: 75,
    speed: 85,
  };
}

/** Atleta cru válido: 4 golpes, posição reconhecida, ids inteiros. */
function makeAthlete(instanceId: number): Record<string, unknown> {
  return {
    instanceId,
    pokemonId: 1,
    types: ['NORMAL'],
    stats: makeStats(),
    abilityId: 1,
    moveIds: [10, 11, 12, 13],
    positionDesignation: 'QB',
  };
}

/**
 * Escalação crua válida com `instance_id` único por time entre as três
 * unidades. Usa `base` como deslocamento para evitar colisão entre home/away.
 */
function makeLineup(base: number): Record<string, unknown> {
  return {
    units: {
      offense: [makeAthlete(base + 1), makeAthlete(base + 2)],
      defense: [makeAthlete(base + 3)],
      specialTeams: [makeAthlete(base + 4)],
    },
  };
}

/** Corpo-base `SimulateRequest` válido em forma e faixas. */
function makeBaseBody(): Record<string, unknown> {
  return {
    home: makeLineup(100),
    away: makeLineup(200),
    strategyHome: { preset: 'BALANCED' },
    strategyAway: { preset: 'GROUND' },
    seed: '12345',
    botModeHome: 'random',
    botModeAway: 'seeded',
  };
}

/**
 * Invoca o handler `POST` com o corpo serializado como JSON e devolve o status
 * e o corpo parseado — exatamente como um cliente HTTP enviaria.
 */
async function callPost(
  body: unknown,
): Promise<{ status: number; json: { error?: unknown; field?: unknown } }> {
  const request = new Request('http://localhost/api/simulate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  const response = await POST(request);
  const json = (await response.json()) as { error?: unknown; field?: unknown };
  return { status: response.status, json };
}

/** Asserção comum: 400 com `{ error: string, field }` do campo esperado. */
function expect400(
  result: { status: number; json: { error?: unknown; field?: unknown } },
  expectedField: string,
): void {
  expect(result.status).toBe(400);
  expect(typeof result.json.error).toBe('string');
  expect((result.json.error as string).length).toBeGreaterThan(0);
  expect(result.json.field).toBe(expectedField);
}

const RUNS = { numRuns: PBT_NUM_RUNS } as const;

describe('Property 42 — validação de entrada da Funcao_Simulacao (R1.6, R15.4)', () => {
  // -------------------------------------------------------------------------
  // Sanidade: o corpo-base NÃO é rejeitado por motivo de validação de forma.
  // (pode seguir para resolução de dados, mas nunca retorna 400 de validação)
  // -------------------------------------------------------------------------
  it('o corpo-base não é rejeitado por validação de forma (não é 400)', async () => {
    const result = await callPost(makeBaseBody());
    // Sem Supabase disponível a resolução falha com 500; o que importa para a
    // validação de forma é que NÃO é um 400 (a entrada é formalmente válida).
    expect(result.status).not.toBe(400);
  });

  // -------------------------------------------------------------------------
  // seed inválida → 400 field 'seed' (R1.6). seed é validada primeiro.
  // -------------------------------------------------------------------------
  it('seed ausente/não-inteira/negativa/fora de faixa/tipo errado → 400 field seed', async () => {
    const invalidSeedArb = fc.oneof(
      fc.constant(undefined), // ausente
      fc.constant(null), // nula
      fc.double({ min: 0.1, max: 1000, noInteger: true }), // não-inteira
      fc.integer({ min: -1_000_000, max: -1 }).map((n) => String(n)), // negativa
      fc.constant('-5'), // string negativa
      fc.constant('3.14'), // string não-inteira
      fc.constant('18446744073709551616'), // 2^64, fora de faixa (> 2^64-1)
      fc.constant('99999999999999999999999'), // muito acima de 2^64-1
      fc.boolean(), // tipo errado
      fc.constantFrom({}, []), // tipo errado (objeto/arranjo)
      fc.constant('abc'), // string não-decimal
    );
    await fc.assert(
      fc.asyncProperty(invalidSeedArb, async (badSeed) => {
        const body = makeBaseBody();
        body.seed = badSeed;
        const result = await callPost(body);
        expect400(result, 'seed');
      }),
      RUNS,
    );
  });

  // -------------------------------------------------------------------------
  // atleta com != 4 moveIds → 400 field referenciando moveIds (R15.4).
  // -------------------------------------------------------------------------
  it('atleta com número de golpes diferente de 4 → 400 campo moveIds', async () => {
    // Gera um arranjo de golpes cujo tamanho NUNCA é 4.
    const badMoveIdsArb = fc
      .array(fc.integer({ min: 1, max: 999 }), { minLength: 0, maxLength: 8 })
      .filter((arr) => arr.length !== 4);
    await fc.assert(
      fc.asyncProperty(badMoveIdsArb, async (moveIds) => {
        const body = makeBaseBody();
        // Muta o primeiro atleta da ofensiva do time da casa.
        const home = body.home as {
          units: { offense: Array<Record<string, unknown>> };
        };
        const athlete = home.units.offense[0] as Record<string, unknown>;
        athlete.moveIds = moveIds;
        const result = await callPost(body);
        expect400(result, 'home.units.offense[0].moveIds');
      }),
      RUNS,
    );
  });

  // -------------------------------------------------------------------------
  // instance_id duplicado dentro de um time → 400 (R15.4).
  // -------------------------------------------------------------------------
  it('instance_id duplicado dentro de um time → 400', async () => {
    // O campo apontado é a unidade onde a duplicata é detectada.
    const dupArb = fc.constantFrom<'offense' | 'defense' | 'specialTeams'>(
      'offense',
      'defense',
      'specialTeams',
    );
    await fc.assert(
      fc.asyncProperty(dupArb, async (unit) => {
        const body = makeBaseBody();
        const home = body.home as {
          units: Record<string, Array<{ instanceId: number }>>;
        };
        const offense = home.units.offense as Array<{ instanceId: number }>;
        // Força o instance_id da unidade alvo a colidir com o 1º da ofensiva.
        const first = offense[0] as { instanceId: number };
        const dupId = first.instanceId;
        if (unit === 'offense') {
          // Duplica dentro da própria ofensiva (2º atleta copia o 1º).
          const second = offense[1] as { instanceId: number };
          second.instanceId = dupId;
        } else {
          const target = (home.units[unit] as Array<{ instanceId: number }>)[0] as {
            instanceId: number;
          };
          target.instanceId = dupId;
        }
        const result = await callPost(body);
        // Detecção ocorre na unidade onde o id repetido reaparece.
        expect(result.status).toBe(400);
        expect(typeof result.json.error).toBe('string');
        expect(result.json.field).toBe(`home.units.${unit}`);
      }),
      RUNS,
    );
  });

  // -------------------------------------------------------------------------
  // preset de estratégia inválido → 400 field strategyHome/Away.preset (R15.4).
  // -------------------------------------------------------------------------
  it('preset de estratégia inválido → 400 campo <strategy>.preset', async () => {
    const validPresets = ['BALANCED', 'GROUND', 'AERIAL', 'CURTI'];
    const sideArb = fc.constantFrom<'strategyHome' | 'strategyAway'>(
      'strategyHome',
      'strategyAway',
    );
    const badPresetArb = fc.oneof(
      fc.string().filter((s) => !validPresets.includes(s)),
      fc.constantFrom('balanced', 'ground', 'INVALID', 'POWER', ''),
      fc.integer(),
      fc.constant(null),
    );
    await fc.assert(
      fc.asyncProperty(sideArb, badPresetArb, async (side, badPreset) => {
        const body = makeBaseBody();
        body[side] = { preset: badPreset };
        const result = await callPost(body);
        expect400(result, `${side}.preset`);
      }),
      RUNS,
    );
  });

  // -------------------------------------------------------------------------
  // botMode não suportado → 400 field botModeHome/Away, msg 'modo inválido'
  // (R12.6-adjacente; R15.4).
  // -------------------------------------------------------------------------
  it("botMode não suportado → 400 campo botMode<Side> com 'modo inválido'", async () => {
    const validModes = ['random', 'curti', 'seeded'];
    const sideArb = fc.constantFrom<'botModeHome' | 'botModeAway'>(
      'botModeHome',
      'botModeAway',
    );
    const badModeArb = fc.oneof(
      fc.string().filter((s) => !validModes.includes(s)),
      fc.constantFrom('cheater', 'RANDOM', 'bot', 'seed', ''),
      fc.integer(),
      fc.boolean(),
    );
    await fc.assert(
      fc.asyncProperty(sideArb, badModeArb, async (side, badMode) => {
        const body = makeBaseBody();
        body[side] = badMode;
        const result = await callPost(body);
        expect400(result, side);
        expect(result.json.error).toBe('modo inválido');
      }),
      RUNS,
    );
  });

  // -------------------------------------------------------------------------
  // corpo JSON malformado → 400 field 'body' (R1.6).
  // -------------------------------------------------------------------------
  it('corpo malformado (JSON inválido) → 400 field body', async () => {
    // Strings que não são JSON válido (parse falha em request.json()).
    const malformedArb = fc.oneof(
      fc.constantFrom('', '{', '}', '{bad', 'not json', '{"a":}', '[1,2,'),
      fc
        .string({ minLength: 1, maxLength: 20 })
        .filter((s) => {
          try {
            JSON.parse(s);
            return false; // é JSON válido → descarta
          } catch {
            return true; // não é JSON → mantém
          }
        }),
    );
    await fc.assert(
      fc.asyncProperty(malformedArb, async (raw) => {
        const request = new Request('http://localhost/api/simulate', {
          method: 'POST',
          body: raw,
          headers: { 'content-type': 'application/json' },
        });
        const response = await POST(request);
        const json = (await response.json()) as {
          error?: unknown;
          field?: unknown;
        };
        expect(response.status).toBe(400);
        expect(typeof json.error).toBe('string');
        expect(json.field).toBe('body');
      }),
      RUNS,
    );
  });
});
