import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Testes de integração das migrations em banco vazio (Task 14.2).
 *
 * Verificação de integração determinística da aplicação do Schema_PFL:
 *   - R5.2 — ao aplicar as migrations a um banco vazio, todas as tabelas das
 *            entidades centrais são criadas sem falhas.
 *   - R5.4 — reaplicar as migrations a um banco já migrado resulta em estrutura
 *            de tabelas idêntica (idempotência).
 *   - R5.5 — após aplicar as migrations, as tabelas operacionais ficam com zero
 *            registros (estado vazio).
 *
 * Estratégia (ver design · Testing Strategy · Migrations):
 *
 *   1. **Camada estática (sempre executa)** — lê os arquivos `.sql` versionados
 *      em `supabase/migrations/` e afirma, sem precisar de um banco:
 *        - cada tabela central possui um `CREATE TABLE IF NOT EXISTS` no conjunto;
 *        - o DDL usa formas idempotentes (`IF NOT EXISTS`, guarda `DO $$ ...
 *          EXCEPTION WHEN duplicate_object` para o enum) — base da idempotência
 *          de R5.4;
 *        - nenhuma migration contém `INSERT` — garante o estado vazio de R5.5.
 *      Essa camada dá cobertura significativa em qualquer ambiente (CI sem DB).
 *
 *   2. **Camada de banco real (condicional)** — executa somente quando a env
 *      var `DATABASE_URL` aponta para um PostgreSQL de teste alcançável. Aplica
 *      as migrations duas vezes num schema isolado e descartável e afirma que
 *      todas as tabelas centrais existem com zero registros (R5.2/R5.5) e que a
 *      estrutura é idêntica após a reaplicação (R5.4). Sem `DATABASE_URL`, esse
 *      bloco é pulado (`describe.skipIf`), deixando o caminho pronto para quando
 *      um banco estiver disponível.
 *
 * Observações:
 *   - Os caminhos são resolvidos a partir deste arquivo (`tests/integration/` →
 *     sobe dois níveis até a raiz do Projeto_Base `pfl/`), independente do `cwd`.
 *   - O driver `pg` é importado dinamicamente apenas no caminho de banco real,
 *     de modo que a ausência da dependência não quebra a camada estática.
 */

/** Raiz do Projeto_Base `pfl/` (este arquivo está em `pfl/tests/integration/`). */
const PROJECT_ROOT = join(__dirname, '..', '..');

/** Diretório das migrations versionadas. */
const MIGRATIONS_DIR = join(PROJECT_ROOT, 'supabase', 'migrations');

/**
 * Tabelas das entidades centrais do Schema_PFL (R5.2). Mapeia o nome lógico do
 * glossário para o nome físico da tabela criada pelas migrations.
 */
const CORE_TABLES = [
  'species', // Especie_Pokemon (R6)
  'abilities', // Habilidade (R7)
  'moves', // Golpe (R8)
  'pokemon_learnable_moves', // Golpe_Aprendivel (R9)
  'pokemon_abilities', // Habilidade_Disponivel (R10)
  'user_teams', // Time_Usuario (R11)
  'athletes', // Atleta_Instancia (R12)
  'athlete_moves', // golpes do atleta (R12.6-12.8)
  'lineups', // Escalacao (R14)
  'strategy', // Estrategia (R15)
  'team_seeds', // Seed_Time (R16)
] as const;

/**
 * Subconjunto de tabelas operacionais que DEVEM nascer com zero registros
 * (R5.5). O catálogo também nasce vazio nesta spec, mas R5.5 cita explicitamente
 * estas cinco entidades de time.
 */
const EMPTY_STATE_TABLES = [
  'user_teams',
  'athletes',
  'lineups',
  'strategy',
  'team_seeds',
] as const;

/** Lê os arquivos de migration em ordem lexicográfica (ordem de aplicação). */
function readMigrationFiles(): { name: string; sql: string }[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((name) => ({
    name,
    sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
  }));
}

/** Remove comentários de linha (`-- ...`) do SQL para análise de statements. */
function stripSqlLineComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const MIGRATIONS = readMigrationFiles();
const ALL_SQL_NO_COMMENTS = MIGRATIONS.map((m) => stripSqlLineComments(m.sql)).join('\n');

// ===========================================================================
// Camada estática — sempre executa, sem necessidade de banco.
// ===========================================================================

describe('migrations · análise estática do DDL (R5.2, R5.4, R5.5)', () => {
  it('há arquivos de migration versionados em supabase/migrations (R5.1)', () => {
    expect(MIGRATIONS.length, 'esperado ao menos uma migration .sql').toBeGreaterThan(0);
  });

  it('R5.2 — toda tabela central tem um CREATE TABLE IF NOT EXISTS no conjunto', () => {
    for (const table of CORE_TABLES) {
      const re = new RegExp(
        `create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`,
        'i',
      );
      expect(
        re.test(ALL_SQL_NO_COMMENTS),
        `esperado "CREATE TABLE IF NOT EXISTS ${table}" nas migrations`,
      ).toBe(true);
    }
  });

  it('R5.4 — DDL de tabelas usa forma idempotente (IF NOT EXISTS)', () => {
    // Todo CREATE TABLE deve ser IF NOT EXISTS para reexecução acidental não falhar.
    const createTableMatches = ALL_SQL_NO_COMMENTS.match(/create\s+table\s+(if\s+not\s+exists\s+)?/gi) ?? [];
    expect(createTableMatches.length, 'esperado ao menos um CREATE TABLE').toBeGreaterThan(0);
    for (const m of createTableMatches) {
      expect(
        /if\s+not\s+exists/i.test(m),
        `CREATE TABLE sem IF NOT EXISTS encontrado: "${m.trim()}"`,
      ).toBe(true);
    }
  });

  it('R5.4 — índices usam CREATE INDEX IF NOT EXISTS', () => {
    const createIndexMatches = ALL_SQL_NO_COMMENTS.match(/create\s+index\s+(if\s+not\s+exists\s+)?/gi) ?? [];
    for (const m of createIndexMatches) {
      expect(
        /if\s+not\s+exists/i.test(m),
        `CREATE INDEX sem IF NOT EXISTS encontrado: "${m.trim()}"`,
      ).toBe(true);
    }
  });

  it('R5.4 — o enum lineup_unit é criado com guarda idempotente (DO/duplicate_object)', () => {
    // CREATE TYPE não aceita IF NOT EXISTS; a idempotência vem do bloco DO que
    // captura duplicate_object.
    expect(
      /create\s+type\s+lineup_unit\s+as\s+enum/i.test(ALL_SQL_NO_COMMENTS),
      'esperado CREATE TYPE lineup_unit AS ENUM',
    ).toBe(true);
    expect(
      /exception\s+when\s+duplicate_object/i.test(ALL_SQL_NO_COMMENTS),
      'esperado guarda EXCEPTION WHEN duplicate_object para o enum',
    ).toBe(true);
  });

  it('R5.4 — triggers são recriados de forma idempotente (DROP TRIGGER IF EXISTS)', () => {
    const createTriggerCount =
      (ALL_SQL_NO_COMMENTS.match(/create\s+(constraint\s+)?trigger\s+/gi) ?? []).length;
    const dropTriggerCount =
      (ALL_SQL_NO_COMMENTS.match(/drop\s+trigger\s+if\s+exists\s+/gi) ?? []).length;
    // Cada trigger criado deve ter um DROP TRIGGER IF EXISTS correspondente.
    expect(
      dropTriggerCount,
      'cada CREATE TRIGGER deve ser precedido de DROP TRIGGER IF EXISTS',
    ).toBeGreaterThanOrEqual(createTriggerCount);
  });

  it('R5.3 — cada migration roda dentro de uma transação (BEGIN/COMMIT)', () => {
    for (const { name, sql } of MIGRATIONS) {
      const clean = stripSqlLineComments(sql);
      expect(/\bbegin\b/i.test(clean), `${name}: esperado BEGIN`).toBe(true);
      expect(/\bcommit\b/i.test(clean), `${name}: esperado COMMIT`).toBe(true);
    }
  });

  it('R5.5 — nenhuma migration insere linhas (estado vazio garantido)', () => {
    // Procura por INSERT INTO em qualquer migration. O catálogo e as tabelas
    // operacionais devem nascer vazios; o seed real é outra spec.
    const insertMatches = ALL_SQL_NO_COMMENTS.match(/\binsert\s+into\b/gi) ?? [];
    expect(
      insertMatches,
      `nenhum INSERT INTO esperado nas migrations, encontrados: ${insertMatches.length}`,
    ).toHaveLength(0);
  });

  it('R5.5 — tabelas operacionais são apenas criadas, nunca populadas', () => {
    // Reforço explícito: para cada tabela operacional, não deve existir INSERT.
    for (const table of EMPTY_STATE_TABLES) {
      const re = new RegExp(`insert\\s+into\\s+${table}\\b`, 'i');
      expect(
        re.test(ALL_SQL_NO_COMMENTS),
        `não deve haver INSERT INTO ${table} (estado vazio R5.5)`,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// Camada de banco real — executa somente com DATABASE_URL definido.
// ===========================================================================

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  'migrations · aplicação em banco real vazio (R5.2, R5.4, R5.5)',
  () => {
    // Schema descartável e isolado para não tocar objetos existentes.
    const TEST_SCHEMA = `pfl_migrations_test_${Date.now()}`;

    // Tipagem mínima do subconjunto de `pg` que usamos, para evitar depender
    // dos @types no caminho estático.
    interface QueryResult {
      rows: Array<Record<string, unknown>>;
    }
    interface PgClient {
      connect(): Promise<void>;
      query(sql: string): Promise<QueryResult>;
      end(): Promise<void>;
    }

    let client: PgClient;

    /** Aplica todas as migrations na ordem lexicográfica. */
    async function applyAllMigrations(): Promise<void> {
      for (const { sql } of MIGRATIONS) {
        await client.query(sql);
      }
    }

    /** Captura a estrutura (colunas) das tabelas centrais no schema de teste. */
    async function snapshotStructure(): Promise<string> {
      const res = await client.query(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        ORDER BY table_name, ordinal_position
      `);
      return JSON.stringify(res.rows);
    }

    beforeAll(async () => {
      // Import dinâmico do driver `pg`: só carrega quando há banco real. O
      // especificador passa por uma variável para que o type-check não exija a
      // dependência `pg` no caminho estático (ela só é necessária quando
      // DATABASE_URL está definido). Instale `pg` (pinado) para habilitar.
      const pgModule = 'pg';
      const pg = (await import(/* @vite-ignore */ pgModule)) as unknown as {
        Client: new (config: { connectionString: string }) => PgClient;
      };
      client = new pg.Client({ connectionString: DATABASE_URL as string });
      await client.connect();
      await client.query(`CREATE SCHEMA "${TEST_SCHEMA}"`);
      await client.query(`SET search_path TO "${TEST_SCHEMA}"`);
    }, 60_000);

    afterAll(async () => {
      if (client) {
        await client.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
        await client.end();
      }
    });

    it('R5.2 — aplica as migrations a um banco vazio criando todas as tabelas centrais', async () => {
      await applyAllMigrations();

      const res = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      `);
      const present = new Set(res.rows.map((r) => String(r.table_name)));
      for (const table of CORE_TABLES) {
        expect(present.has(table), `tabela central ausente: ${table}`).toBe(true);
      }
    });

    it('R5.5 — tabelas operacionais nascem com zero registros', async () => {
      for (const table of EMPTY_STATE_TABLES) {
        const res = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
        const n = Number(res.rows[0]?.n ?? -1);
        expect(n, `tabela ${table} deveria estar vazia`).toBe(0);
      }
    });

    it('R5.4 — reaplicar as migrations resulta em estrutura idêntica (idempotência)', async () => {
      const before = await snapshotStructure();
      // Reaplica o conjunto completo; as formas idempotentes evitam falha.
      await applyAllMigrations();
      const after = await snapshotStructure();
      expect(after).toEqual(before);
    });
  },
);
