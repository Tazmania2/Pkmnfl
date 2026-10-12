-- Migration: init_team_seeds
-- Spec: pfl-foundation (Task 12.1)
-- Cria a tabela team_seeds para persistir seeds de time exportaveis no formato
-- `.pflseed.json`, com versao de schema e checksum verificavel.
-- Requisitos: 5.1, 16.1, 16.2, 16.3, 16.4, 16.5
--
-- Formas idempotentes (CREATE EXTENSION/TABLE IF NOT EXISTS) dentro de uma
-- transacao para rollback atomico em caso de falha (R5.3).

BEGIN;

-- gen_random_uuid() depende da extensao pgcrypto (disponivel por padrao no
-- Supabase); garantida aqui de forma idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Seed de time (R16) =====

-- Seed_Time (R16): documento serializado `.pflseed.json` com versao e checksum.
CREATE TABLE IF NOT EXISTS team_seeds (
  id              uuid  NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),            -- R16.1
  team_id         uuid  NOT NULL REFERENCES user_teams(id) ON DELETE CASCADE,      -- R16.1 (vinculo com o time)
  seed_document   jsonb NOT NULL,                                                  -- R16.1 (documento serializado)
  schema_version  text  NOT NULL CHECK (char_length(schema_version) > 0),          -- R16.1 (versao de schema nao vazia)
  checksum_sha256 text  NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),       -- R16.3 (checksum deterministico SHA-256)

  -- R16.2: campos obrigatorios devem estar presentes no documento de seed.
  CONSTRAINT team_seeds_required_fields CHECK (
    seed_document ? 'schema'
    AND seed_document ? 'ruleset'
    AND seed_document ? 'athletes'
    AND seed_document ? 'lineups'
    AND seed_document ? 'special_teams_full_units'
    AND seed_document ? 'strategy'
    AND seed_document ? 'checksum'
  ),

  -- R16.4/R16.5: proibe aleatoriedade de partida, logs, vencedores ou resultados.
  CONSTRAINT team_seeds_no_runtime_fields CHECK (
    NOT (
      seed_document ? 'match_rng'
      OR seed_document ? 'logs'
      OR seed_document ? 'winners'
      OR seed_document ? 'results'
    )
  )
);

COMMIT;
