-- Migration: init_teams
-- Spec: pfl-foundation (Task 10.1)
-- Cria as tabelas da fonte de verdade operacional de time: user_teams e athletes.
-- Requisitos: 5.1, 11.1-11.3, 12.1, 12.2, 12.4, 12.5, 12.9, 12.10
--
-- Formas idempotentes (CREATE EXTENSION/TABLE IF NOT EXISTS) dentro de uma
-- transação para rollback atômico em caso de falha (R5.3).

BEGIN;

-- gen_random_uuid() depende da extensão pgcrypto (disponível por padrão no
-- Supabase); garantida aqui de forma idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Time do usuário =====

-- Time_Usuario (R11)
CREATE TABLE IF NOT EXISTS user_teams (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- R11.1
  user_id  uuid NOT NULL,                               -- R11.2
  name     text NOT NULL                                -- R11.3
);

-- Atleta_Instancia (R12): indivíduo distinto do Roster
CREATE TABLE IF NOT EXISTS athletes (
  id                   uuid    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),           -- R12.1
  team_id              uuid    NOT NULL REFERENCES user_teams(id) ON DELETE CASCADE,     -- R12.1 (vínculo com o time)
  instance_id          integer NOT NULL,                                                -- R12.2
  pokemon_id           integer NOT NULL REFERENCES species(pokemon_id),                 -- R12.4
  ability_id           integer NOT NULL REFERENCES abilities(ability_id),               -- R12.5
  position_designation text    NOT NULL CHECK (char_length(position_designation) <= 50),-- R12.9
  UNIQUE (team_id, instance_id)                                                         -- R12.2/12.3 (unicidade por time); duplicatas de pokemon_id são registros independentes (R12.10)
);

COMMIT;
