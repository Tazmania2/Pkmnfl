-- Migration: init_athlete_moves
-- Spec: pfl-foundation (Task 10.2)
-- Cria a tabela filha athlete_moves (D-2) e o trigger de cardinalidade que
-- impõe exatamente 4 golpes distintos por atleta.
-- Requisitos: 12.6, 12.7, 12.8
--
-- Modelagem (D-2): tabela filha athlete_moves com UNIQUE(athlete_id, move_id)
-- garantindo golpes distintos (R12.8) e FK move_id -> moves (R12.6). A
-- cardinalidade exata = 4 (R12.7) não é expressável por CHECK (um CHECK não
-- conta linhas de outra tabela), então usa-se um CONSTRAINT TRIGGER DEFERRABLE
-- INITIALLY DEFERRED que valida no commit.
--
-- Formas idempotentes dentro de uma transação para rollback atômico (R5.3).

BEGIN;

-- 4 golpes distintos por atleta (D-2) — R12.6/12.8
CREATE TABLE IF NOT EXISTS athlete_moves (
  athlete_id uuid    NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,  -- vínculo com o atleta
  move_id    integer NOT NULL REFERENCES moves(move_id),                  -- R12.6 FK para o catálogo de golpes
  slot       smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),              -- no máx. 4 slots (1..4)
  UNIQUE (athlete_id, move_id),      -- golpes distintos por atleta (R12.8)
  PRIMARY KEY (athlete_id, slot)     -- um golpe por slot; PK implica UNIQUE(athlete_id, slot)
);

-- Função do trigger de cardinalidade (R12.7): conta os golpes do atleta
-- afetado e rejeita o commit se o total for diferente de 4.
CREATE OR REPLACE FUNCTION enforce_exactly_4_moves()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_athlete uuid;
  move_count       integer;
BEGIN
  -- Em DELETE, OLD carrega o athlete_id; em INSERT/UPDATE, NEW.
  affected_athlete := COALESCE(NEW.athlete_id, OLD.athlete_id);

  -- Se o atleta foi inteiramente removido (ex.: cascade ao deletar o atleta),
  -- não há cardinalidade a impor.
  IF NOT EXISTS (SELECT 1 FROM athletes WHERE id = affected_athlete) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO move_count
  FROM athlete_moves
  WHERE athlete_id = affected_athlete;

  IF move_count <> 4 THEN
    RAISE EXCEPTION
      'Atleta % deve ter exatamente 4 golpes, mas tem % (R12.7)',
      affected_athlete, move_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;  -- AFTER trigger: valor de retorno é ignorado
END;
$$;

-- CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED (R12.7): valida no commit,
-- permitindo inserir os 4 golpes dentro da mesma transação sem rejeitar os
-- estados intermediários. Recriado de forma idempotente.
DROP TRIGGER IF EXISTS athlete_exactly_4_moves ON athlete_moves;
CREATE CONSTRAINT TRIGGER athlete_exactly_4_moves
  AFTER INSERT OR UPDATE OR DELETE ON athlete_moves
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_exactly_4_moves();

COMMIT;
