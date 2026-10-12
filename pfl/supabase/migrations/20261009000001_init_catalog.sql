-- Migration: init_catalog
-- Spec: pfl-foundation (Task 8.1)
-- Cria as tabelas de catálogo em estado vazio: species, abilities, moves.
-- Requisitos: 5.1, 6.1-6.6, 7.1-7.3, 8.1-8.3
--
-- Formas idempotentes (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)
-- dentro de uma transação para rollback atômico em caso de falha (R5.3).

BEGIN;

-- ===== Catálogo =====

-- Especie_Pokemon (R6)
CREATE TABLE IF NOT EXISTS species (
  pokemon_id      integer PRIMARY KEY,                                      -- R6.1
  slug            text    NOT NULL UNIQUE,                                  -- R6.2
  types           text[]  NOT NULL
                    CHECK (array_length(types, 1) BETWEEN 1 AND 2),         -- R6.3 (1 a 2 tipos)
  hp              integer NOT NULL CHECK (hp >= 0),                         -- R6.4
  attack          integer NOT NULL CHECK (attack >= 0),                     -- R6.4
  defense         integer NOT NULL CHECK (defense >= 0),                    -- R6.4
  special_attack  integer NOT NULL CHECK (special_attack >= 0),             -- R6.4
  special_defense integer NOT NULL CHECK (special_defense >= 0),            -- R6.4
  speed           integer NOT NULL CHECK (speed >= 0),                      -- R6.4
  height          integer NOT NULL CHECK (height >= 0),                     -- R6.4
  weight          integer NOT NULL CHECK (weight >= 0),                     -- R6.4
  is_allowed      boolean NOT NULL DEFAULT false,                           -- R6.5
  raw_data        jsonb   NOT NULL                                          -- R6.6 (ficha PokéAPI preservada)
);

-- índice para consultas pelo conjunto de espécies permitidas
CREATE INDEX IF NOT EXISTS idx_species_is_allowed ON species (is_allowed);

-- Habilidade (R7)
CREATE TABLE IF NOT EXISTS abilities (
  ability_id  integer PRIMARY KEY,                                          -- R7.1
  name        text    NOT NULL,                                            -- R7.2
  raw_data    jsonb   NOT NULL                                             -- R7.3
);

-- Golpe (R8)
CREATE TABLE IF NOT EXISTS moves (
  move_id   integer PRIMARY KEY,                                            -- R8.1
  name      text    NOT NULL,                                              -- R8.2
  raw_data  jsonb   NOT NULL                                               -- R8.3
);

COMMIT;
