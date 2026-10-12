-- Migration: init_roster_cap
-- Spec: pfl-foundation (Task 10.3)
-- Impõe o Roster_Cap = 53 (D-3) via trigger BEFORE INSERT em athletes.
-- Requisitos: 13.1, 13.2, 13.3
--
-- Decisão D-3: um CHECK de coluna não consegue contar linhas-irmãs do mesmo
-- team_id, então a regra é obrigatoriamente imposta por trigger. O trigger
-- BEFORE INSERT conta os atletas já existentes do mesmo team_id e aborta a
-- inserção quando já há 53 (máximo inclusivo). Como o aborto ocorre antes do
-- INSERT, o estado anterior do Roster é preservado (R13.2/13.3).
--
-- Formas idempotentes (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS)
-- dentro de uma transação para rollback atômico em caso de falha.

BEGIN;

-- Conta atletas existentes do mesmo team_id e rejeita a inserção quando o teto
-- de 53 já foi atingido. A 54ª inserção (contagem já = 53) é recusada; o máximo
-- inclusivo permitido é 53 (R13.1).
CREATE OR REPLACE FUNCTION enforce_roster_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_count integer;
BEGIN
  SELECT count(*) INTO current_count
  FROM athletes
  WHERE team_id = NEW.team_id;

  IF current_count >= 53 THEN
    RAISE EXCEPTION
      'Roster_Cap excedido: o time % já possui % atletas (máximo 53).',
      NEW.team_id, current_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger BEFORE INSERT: aborta a inserção quando o time já tem 53 atletas,
-- preservando o estado anterior do Roster (R13.2/13.3).
DROP TRIGGER IF EXISTS athletes_roster_cap ON athletes;

CREATE TRIGGER athletes_roster_cap
  BEFORE INSERT ON athletes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_roster_cap();  -- rejeita se já há 53 no team_id

COMMIT;
