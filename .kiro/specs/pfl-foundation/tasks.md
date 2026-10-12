# Implementation Plan: pfl-foundation

## Overview

Este plano converte o design da fundação do PFL em uma sequência de tarefas de codificação incrementais. A ordem é: inicializar o Projeto_Base (Next.js + TypeScript strict), fixar a configuração de deploy/Vercel e o ferramental (ESLint, lock, anti-slop), construir o Módulo Cliente_Supabase com validação de env vars, escrever as migrations versionadas que criam todo o Schema_PFL em estado vazio (catálogo, relações, time, atletas, escalação, estratégia e seed, com constraints e triggers), documentar as convenções e, por fim, cobrir as 7 Correctness Properties com testes de propriedade (`fast-check`, mín. 100 iterações) e as regras de ferramental/integração com testes de smoke/integração.

A pilha de implementação é **TypeScript** (Next.js App Router, Vitest + fast-check para testes, SQL/PostgreSQL para o schema), conforme definido no design — nenhuma seleção de linguagem adicional é necessária.

Convenção de testes de propriedade: cada teste é marcado com `Feature: pfl-foundation, Property {n}: {texto}` e executa no mínimo 100 iterações.

## Tasks

- [x] 1. Inicializar o Projeto_Base Next.js com TypeScript strict
  - Criar a aplicação Next.js (App Router) com TypeScript na raiz do projeto `pfl/`
  - Configurar `tsconfig.json` com `"strict": true` e flags correlatas de modo estrito
  - Criar a estrutura de pastas base: `app/(ui)/`, `app/api/`, `functions/`, `components/`, `lib/supabase/`, `lib/data/`, `lib/seed/`, `supabase/migrations/`, `docs/`
  - Garantir que `next build` conclua com código de saída 0 sobre o esqueleto inicial
  - _Requirements: 1.1, 1.3, 1.5, 1.6_

- [x] 2. Fixar configuração de deploy Vercel e runtime Node
  - [x] 2.1 Criar `vercel.json` e fixar engines do Node
    - Criar `vercel.json` definindo `framework: "nextjs"` e runtime Node.js
    - Fixar a versão de Node em `package.json#engines`
    - _Requirements: 1.2_

- [x] 3. Configurar lint TypeScript/React e lock de dependências
  - [x] 3.1 Configurar ESLint para TypeScript e React
    - Adicionar `eslint.config.*` com presets de TypeScript e React
    - Garantir que `eslint .` / `next lint` passe sem erros sobre o código inicial
    - _Requirements: 4.1, 4.2_

  - [x] 3.2 Fixar e versionar o lock de dependências
    - Pinar versões das dependências e versionar `package-lock.json` no repositório
    - _Requirements: 4.4_

- [x] 4. Instalar e versionar o Anti_Slop
  - Executar a instalação do anti-slop via `npx antislop-ai`
  - Posicionar os artefatos de regras no local reconhecido como regras de projeto do agente
  - Versionar os artefatos de configuração gerados no repositório
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Implementar o Módulo Cliente_Supabase
  - [x] 5.1 Implementar `lib/supabase/env.ts` com validação de variáveis de ambiente
    - Ler exclusivamente de variáveis de ambiente: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (sem nenhum valor de credencial no código)
    - Coletar todas as variáveis ausentes ou vazias (após `trim`) e lançar erro cuja mensagem identifique pelo nome cada variável faltante, abortando antes de qualquer conexão
    - Retornar objeto de configuração tipado quando todas estiverem presentes e válidas
    - _Requirements: 2.1, 2.3_

  - [x] 5.2 Escrever testes de exemplo/edge para validação de env vars
    - Casos: uma variável faltante, várias faltantes, e valor vazio-após-trim; afirmar que a mensagem lista cada nome faltante
    - _Requirements: 2.3_

  - [x] 5.3 Implementar `lib/supabase/public-client.ts` (cliente anon)
    - Criar o cliente Supabase com `URL + ANON_KEY`, seguro para browser e servidor, sujeito a RLS
    - _Requirements: 2.1, 2.6_

  - [x] 5.4 Implementar `lib/supabase/server-client.ts` (cliente service-role)
    - Criar o cliente com `URL + SERVICE_ROLE_KEY`, guardado contra importação no bundle de cliente (`import 'server-only'`)
    - Propagar falha de autenticação sem incluir o valor da credencial em mensagens/logs
    - _Requirements: 2.1, 2.4, 2.6_

  - [x] 5.5 Escrever teste de exemplo para falha de autenticação sem vazamento
    - Afirmar que a mensagem de falha de autenticação nunca contém o valor da credencial
    - _Requirements: 2.4_

- [x] 6. Criar `.env.example` e `.gitignore` de credenciais
  - Criar `.env.example` listando os nomes de todas as env vars obrigatórias com valores em branco/marcadores (sem credenciais reais)
  - Configurar `.gitignore` para ignorar `.env`, `.env.local` e `.env.*.local`
  - _Requirements: 2.2, 2.5_

- [x] 7. Checkpoint — garantir build, lint e cliente
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Migration do catálogo (species, abilities, moves)
  - [x] 8.1 Escrever migration `supabase/migrations/*_init_catalog.sql`
    - Criar `species` com PK `pokemon_id`, `slug` único, coluna de tipos com CHECK de 1 a 2 tipos, as seis stats base + altura + peso NOT NULL e não negativas, `is_allowed boolean NOT NULL DEFAULT false` e `raw_data jsonb NOT NULL`
    - Criar `abilities` (PK `ability_id`, `name`, `raw_data jsonb`) e `moves` (PK `move_id`, `name`, `raw_data jsonb`)
    - Usar formas idempotentes (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) dentro de transação
    - _Requirements: 5.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3_

  - [x] 8.2 Escrever teste de propriedade para o predicado de Especies_Permitidas
    - **Property 1: Equivalência do conjunto de espécies permitidas**
    - **Validates: Requirements 6.5**
    - Testar `isAllowed(pokemon_id) ⇔ 1 ≤ pokemon_id ≤ 151 ∧ pokemon_id ∉ {144,145,146,150,151}` (lógica pura, in-memory)

  - [x] 8.3 Escrever testes de exemplo para stats base não negativos
    - Afirmar que valores negativos de stats/altura/peso são rejeitados pelos CHECKs
    - _Requirements: 6.4_

- [x] 9. Migration das relações de elegibilidade
  - [-] 9.1 Escrever migration `supabase/migrations/*_init_relations.sql`
    - Criar `pokemon_learnable_moves` com FK `pokemon_id`→`species`, FK `move_id`→`moves`, `version_details jsonb NOT NULL` e UNIQUE `(pokemon_id, move_id)`
    - Criar `pokemon_abilities` com FK `pokemon_id`→`species`, FK `ability_id`→`abilities`, `is_hidden boolean NOT NULL`, `slot integer NOT NULL` e UNIQUE `(pokemon_id, ability_id)`
    - _Requirements: 5.1, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 10. Migration de times e atletas (com triggers de regra)
  - [x] 10.1 Escrever migration `supabase/migrations/*_init_teams.sql` para `user_teams` e `athletes`
    - Criar `user_teams` (PK própria `uuid`, `user_id uuid NOT NULL`, `name text NOT NULL`)
    - Criar `athletes` com FK `team_id`→`user_teams` (ON DELETE CASCADE), `instance_id`, FK `pokemon_id`→`species`, FK `ability_id`→`abilities`, `position_designation text NOT NULL CHECK (char_length ≤ 50)` e UNIQUE `(team_id, instance_id)`
    - _Requirements: 5.1, 11.1, 11.2, 11.3, 12.1, 12.2, 12.4, 12.5, 12.9, 12.10_

  - [x] 10.2 Criar `athlete_moves` e o trigger de cardinalidade de 4 golpes distintos
    - Criar `athlete_moves(athlete_id, move_id, slot)` com FK `move_id`→`moves`, `slot smallint CHECK BETWEEN 1 AND 4`, UNIQUE `(athlete_id, move_id)`, UNIQUE `(athlete_id, slot)` e PK `(athlete_id, slot)`
    - Criar `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED` que rejeita no commit quando a contagem de golpes por atleta ≠ 4
    - _Requirements: 12.6, 12.7, 12.8_

  - [x] 10.3 Criar o trigger de Roster_Cap = 53
    - Criar trigger `BEFORE INSERT` em `athletes` que conta atletas do mesmo `team_id` e rejeita a inserção quando já existem 53, preservando o estado anterior
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 10.4 Escrever teste de propriedade para integridade referencial de FKs
    - **Property 2: Integridade referencial — toda FK resolve**
    - **Validates: Requirements 9.2, 9.3, 10.2, 10.3, 12.4, 12.5, 12.6**

  - [x] 10.5 Escrever teste de propriedade para o teto do roster
    - **Property 3: Teto do roster nunca excedido**
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [x] 10.6 Escrever teste de propriedade para exatamente quatro golpes distintos
    - **Property 4: Atleta tem exatamente quatro golpes distintos**
    - **Validates: Requirements 12.6, 12.7, 12.8**

  - [x] 10.7 Escrever teste de propriedade para unicidade de `instance_id` por time
    - **Property 7: Unicidade de instance_id por time**
    - **Validates: Requirements 12.2, 12.3**

- [x] 11. Migration de escalação e estratégia
  - [x] 11.1 Escrever migration `supabase/migrations/*_init_lineups_strategy.sql`
    - Criar o enum `lineup_unit` (`offense`, `defense` + 6 unidades de special teams) de forma idempotente (bloco `DO $$ ... EXCEPTION WHEN duplicate_object`)
    - Criar `lineups` com FK `team_id`→`user_teams`, `unit lineup_unit NOT NULL`, `role text NOT NULL`, FK `athlete_id`→`athletes` e UNIQUE `(team_id, unit, role)` (11 papéis distintos por unidade)
    - Criar `strategy` com PK/FK `team_id`→`user_teams` e colunas `offense_play_ids`, `defense_play_ids`, `special_team_ids` (`integer[] NOT NULL DEFAULT '{}'`)
    - _Requirements: 5.1, 14.1, 14.2, 14.3, 14.4, 15.1, 15.2, 15.3, 15.4_

- [x] 12. Migration de seeds de time
  - [x] 12.1 Escrever migration `supabase/migrations/*_init_team_seeds.sql`
    - Criar `team_seeds` com PK `uuid`, FK `team_id`→`user_teams`, `seed_document jsonb NOT NULL`, `schema_version text NOT NULL CHECK (char_length > 0)` e `checksum_sha256 text NOT NULL CHECK (~ '^[0-9a-f]{64}$')`
    - Adicionar CHECK de campos obrigatórios presentes (`schema`, `ruleset`, `athletes`, `lineups`, `special_teams_full_units`, `strategy`, `checksum`)
    - Adicionar CHECK que proíbe campos de aleatoriedade/resultado (`match_rng`, `logs`, `winners`, `results`)
    - _Requirements: 5.1, 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 12.2 Implementar o cálculo canônico do Checksum_Seed e a validação estrutural em `lib/seed/`
    - Implementar SHA-256 sobre a forma canônica (sem campo `checksum`, chaves ordenadas, UTF-8, separadores `','`/`':'`) e a função de validação estrutural do seed
    - _Requirements: 16.3, 16.6, 16.2, 16.4, 16.5_

  - [x] 12.3 Escrever teste de propriedade para o checksum do seed
    - **Property 5: Checksum do seed é determinístico e recomputável**
    - **Validates: Requirements 16.3, 16.6**

  - [x] 12.4 Escrever teste de propriedade para validade estrutural do seed
    - **Property 6: Validade estrutural do seed**
    - **Validates: Requirements 16.2, 16.4, 16.5**

- [x] 13. Documentar convenções de projeto
  - Criar `docs/project-conventions.md` descrevendo a estrutura de pastas (UI, backend, acesso a dados) e a nomenclatura das variáveis de ambiente
  - _Requirements: 1.6, 4.3_

- [x] 14. Testes de integração e smoke do ferramental e serviços
  - [x] 14.1 Escrever smoke de build e lint
    - Afirmar que `next build` conclui com código 0 em ≤300s; introduzir erro de tipo em caso controlado e afirmar saída ≠0 com arquivo:linha; afirmar que `eslint` passa sem erros
    - _Requirements: 1.3, 1.4, 4.2_

  - [x] 14.2 Escrever integração de migrations em banco vazio
    - Aplicar as migrations a um banco vazio e afirmar que todas as tabelas centrais existem com zero registros; reaplicar e afirmar estrutura idêntica (idempotência)
    - _Requirements: 5.2, 5.4, 5.5_

  - [x] 14.3 Escrever smoke de presença dos artefatos anti-slop
    - Afirmar presença dos artefatos de regras versionados no local de regras do projeto
    - _Requirements: 3.2, 3.3_

  - [x] 14.4 Escrever smoke de conexão ao Supabase
    - Inicializar o cliente com credenciais válidas e confirmar conexão ao projeto `https://vtrcohnmgendbdkgjzmf.supabase.co`
    - _Requirements: 2.6_

- [x] 15. Checkpoint final — garantir todos os testes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; as tarefas de implementação principais nunca são opcionais.
- Cada tarefa referencia os requisitos específicos que atende, para rastreabilidade.
- Os testes de propriedade (`fast-check`, mín. 100 iterações) validam as 7 Correctness Properties universais; P-1, P-5 e P-6 testam lógica pura in-memory, enquanto P-2, P-3, P-4 e P-7 validam invariantes do banco (FK, triggers, unicidade).
- Os testes de smoke/integração validam ferramental determinístico (build, lint, anti-slop, migrations) e conexão com serviços externos, que não se beneficiam de PBT.
- Todas as migrations usam formas defensivas/idempotentes e rodam em transação (ROLLBACK atômico em caso de falha).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4", "6", "13"] },
    { "id": 2, "tasks": ["3.2", "5.1", "8.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4", "8.2", "8.3", "9.1"] },
    { "id": 4, "tasks": ["5.5", "10.1"] },
    { "id": 5, "tasks": ["10.2", "10.3", "11.1", "12.1"] },
    { "id": 6, "tasks": ["10.4", "10.5", "10.6", "10.7", "12.2"] },
    { "id": 7, "tasks": ["12.3", "12.4", "14.1", "14.2", "14.3", "14.4"] }
  ]
}
```
