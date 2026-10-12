-- Migration: init_lineups_strategy
-- Spec: pfl-foundation (Task 11.1)
-- Cria o enum lineup_unit e as tabelas da fonte de verdade operacional de
-- escalação e estratégia: lineups e strategy.
-- Requisitos: 5.1, 14.1-14.4, 15.1-15.4
--
-- Formas idempotentes (CREATE EXTENSION/TYPE/TABLE IF NOT EXISTS) dentro de uma
-- transação para rollback atômico em caso de falha (R5.3).

BEGIN;

-- gen_random_uuid() depende da extensão pgcrypto (garantida em migration
-- anterior); reafirmada aqui de forma idempotente por segurança.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Enum de unidades de escalação (R14.1) =====

-- lineup_unit: ataque + defesa + 6 unidades de special teams (8 valores).
-- CREATE TYPE não suporta IF NOT EXISTS; guarda idempotente via bloco DO
-- capturando duplicate_object para reexecução acidental não falhar (R5.4).
DO $$
BEGIN
  CREATE TYPE lineup_unit AS ENUM (
    'offense','defense',
    'kickoff','kick_return','punt','punt_return','field_goal','field_goal_block'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ===== Escalação (R14) =====

-- Escalacao (R14): associa Atletas_Instancia a papéis de uma unidade de jogo.
CREATE TABLE IF NOT EXISTS lineups (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES user_teams(id) ON DELETE CASCADE,  -- R14.1
  unit        lineup_unit NOT NULL,                                             -- R14.1 (ataque/defesa/special teams)
  role        text        NOT NULL,                                             -- R14.3 (papel dentro da unidade)
  athlete_id  uuid        NOT NULL REFERENCES athletes(id),                     -- R14.2 (FK para a atleta escalada)
  UNIQUE (team_id, unit, role)                                                  -- R14.4 (papéis não repetidos por unidade; 11 papéis validados na aplicação)
);

-- ===== Estratégia (R15) =====

-- Estrategia (R15): jogadas selecionadas por Time_Usuario (1:1 com user_teams).
CREATE TABLE IF NOT EXISTS strategy (
  team_id          uuid      NOT NULL PRIMARY KEY REFERENCES user_teams(id) ON DELETE CASCADE,  -- R15.1
  offense_play_ids integer[] NOT NULL DEFAULT '{}',   -- R15.2
  defense_play_ids integer[] NOT NULL DEFAULT '{}',   -- R15.3
  special_team_ids integer[] NOT NULL DEFAULT '{}'    -- R15.4
);

COMMIT;
