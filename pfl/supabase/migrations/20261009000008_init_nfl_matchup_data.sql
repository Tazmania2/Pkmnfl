-- Migration: init_nfl_matchup_data
-- Spec: pfl-data-catalog (Task 1.1)
-- Cria a tabela nfl_matchup_data para persistir os dados historicos de matchups
-- de estrategias obtidos da API externa `https://nfl.balldontlie.io`, usados
-- exclusivamente para calibrar heuristicas de confronto do motor.
-- Requisitos: 10.1, 10.2, 10.3
--
-- A idempotencia da ingestao vem do `UNIQUE(natural_key)` combinado com
-- `ON CONFLICT (natural_key) DO UPDATE` no escritor (R10.3). `captured_at` e
-- sempre gravado em UTC e `source` identifica a origem (R10.2). A tabela e nova
-- e nao altera o schema estrutural da foundation.
--
-- Formas idempotentes (CREATE TABLE/INDEX IF NOT EXISTS) dentro de uma
-- transacao para rollback atomico em caso de falha.

BEGIN;

-- Dados_Matchup_NFL (R10.1): tabela propria de dados de referencia de regras.
CREATE TABLE IF NOT EXISTS nfl_matchup_data (
  id              bigserial    NOT NULL PRIMARY KEY,                               -- identidade sintetica
  natural_key     text         NOT NULL UNIQUE,                                    -- R10.3 (chave natural idempotente)
  offense_scheme  text         NOT NULL,
  defense_scheme  text         NOT NULL,
  payload         jsonb        NOT NULL,                                           -- dados historicos brutos
  captured_at     timestamptz  NOT NULL,                                           -- R10.2 (data/hora de captura em UTC)
  source          text         NOT NULL DEFAULT 'https://nfl.balldontlie.io'       -- R10.2 (identificacao da fonte)
);

-- Indice para consultas por par (ofensiva, defensiva) nas heuristicas de confronto.
CREATE INDEX IF NOT EXISTS idx_nfl_matchup_schemes
  ON nfl_matchup_data (offense_scheme, defense_scheme);

COMMIT;
