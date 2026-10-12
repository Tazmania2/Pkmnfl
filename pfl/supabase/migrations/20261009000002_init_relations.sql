-- Migration: init_relations
-- Spec: pfl-foundation (Task 9.1)
-- Cria as tabelas de relações de elegibilidade: pokemon_learnable_moves, pokemon_abilities.
-- Requisitos: 5.1, 9.1-9.5, 10.1-10.5
--
-- Formas idempotentes (CREATE TABLE IF NOT EXISTS) dentro de uma transação
-- para rollback atômico em caso de falha (R5.3).

BEGIN;

-- ===== Relações de elegibilidade =====

-- Golpes aprendíveis por espécie (R9)
CREATE TABLE IF NOT EXISTS pokemon_learnable_moves (
  pokemon_id      integer NOT NULL REFERENCES species(pokemon_id),  -- R9.2
  move_id         integer NOT NULL REFERENCES moves(move_id),       -- R9.3
  version_details jsonb   NOT NULL,                                 -- R9.5 (official.learnable_moves[].version_details)
  UNIQUE (pokemon_id, move_id)                                      -- R9.4
);

-- Habilidades disponíveis por espécie (R10)
CREATE TABLE IF NOT EXISTS pokemon_abilities (
  pokemon_id  integer NOT NULL REFERENCES species(pokemon_id),      -- R10.2
  ability_id  integer NOT NULL REFERENCES abilities(ability_id),    -- R10.3
  is_hidden   boolean NOT NULL,                                     -- R10.5
  slot        integer NOT NULL,                                     -- R10.5
  UNIQUE (pokemon_id, ability_id)                                   -- R10.4
);

COMMIT;
