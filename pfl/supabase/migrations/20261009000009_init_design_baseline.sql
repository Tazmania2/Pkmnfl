-- Migration: init_design_baseline
-- Spec: pfl-data-catalog (Task 1.2)
-- Cria a tabela design_baseline para registrar, de forma versionada, os
-- artefatos de design do GDD: os 36 matchups (matchups_36.json) e os
-- parametros de simulacao (simulation_parameters.json).
-- Requisitos: 11.1, 11.2, 11.3, 11.4
--
-- Modelagem (ver design · Data Models · Migration design_baseline):
--   - `version` identifica a versao de design corrente (ex.: "D1-design-2026-10-09").
--   - `kind` distingue os dois artefatos: 'matchups_36' | 'simulation_parameters'.
--   - PK composta (version, kind) permite que ambos os `kind` coexistam na mesma
--     `version`, mantendo um unico registro por par (idempotencia por upsert — R11.4).
--   - `status` guarda o indicador agregado legivel do artefato (ex.:
--     PROPOSED_BALANCE_VALUE, FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED — R11.3).
--   - `payload` preserva o conteudo fiel do arquivo em jsonb (R11.1, R11.2).
--
-- Forma idempotente (CREATE TABLE IF NOT EXISTS) dentro de uma transacao para
-- rollback atomico em caso de falha, sem alterar o schema estrutural da foundation.

BEGIN;

-- Baseline_Design (R11): artefatos de design versionados.
CREATE TABLE IF NOT EXISTS design_baseline (
  version     text        NOT NULL,                                          -- R11.2 (identificador de versao)
  kind        text        NOT NULL
                CHECK (kind IN ('matchups_36', 'simulation_parameters')),    -- R11.1/11.2 (tipo de artefato)
  status      text        NOT NULL,                                          -- R11.3 (indicador legivel)
  payload     jsonb       NOT NULL,                                          -- R11.1 (conteudo fiel do arquivo)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version, kind)                                                -- R11.4 (coexistencia por kind + upsert idempotente)
);

COMMIT;
