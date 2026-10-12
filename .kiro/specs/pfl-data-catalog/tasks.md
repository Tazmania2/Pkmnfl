# Implementation Plan: pfl-data-catalog

## Overview

Este plano converte o design da `pfl-data-catalog` em passos incrementais de código em TypeScript. A spec **popula** o schema criado pela `pfl-foundation` e **expõe uma camada de leitura** sobre o acervo. A ordem segue as dependências naturais: primeiro as migrations das duas tabelas novas e os tipos/leitores base; depois os transformadores puros (núcleo testável por PBT), a conciliação, o escritor idempotente e o validador; em seguida os CLIs de seed e validação; depois o cliente/persistência NFL e seu CLI; por fim a camada de leitura. Cada incremento termina integrado ao anterior, sem código órfão.

Convenções:
- Stack: **TypeScript** + **Supabase** (cliente service-role reutilizado da `pfl-foundation` para escrita; cliente de leitura para `lib/data/`).
- PBT com **fast-check**, mínimo de **100 iterações** por propriedade (`fc.assert(prop, { numRuns: 100 })`).
- Cada teste de propriedade carrega a tag `// Feature: pfl-data-catalog, Property {n}: {texto}`.
- Tarefas marcadas com `*` são opcionais (testes) e não são implementadas automaticamente.

## Tasks

- [x] 1. Migrations das tabelas novas de dados de regras
  - [x] 1.1 Criar migration `nfl_matchup_data`
    - Criar a migration SQL com `id bigserial PK`, `natural_key text NOT NULL UNIQUE`, `offense_scheme`, `defense_scheme`, `payload jsonb`, `captured_at timestamptz`, `source text DEFAULT 'https://nfl.balldontlie.io'`
    - Criar o índice `idx_nfl_matchup_schemes (offense_scheme, defense_scheme)`
    - Usar `CREATE TABLE IF NOT EXISTS` para ser reaplicável sem alterar o schema estrutural da foundation
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 1.2 Criar migration `design_baseline`
    - Criar a migration SQL com `version text`, `kind text` (`matchups_36` | `simulation_parameters`), `status text`, `payload jsonb`, `created_at timestamptz DEFAULT now()`
    - Usar PK composta `(version, kind)` para permitir coexistência dos dois `kind` na mesma versão
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 2. Tipos de domínio e leitores de catálogo
  - [x] 2.1 Definir tipos compartilhados do catálogo
    - Criar os tipos `FichaEspecie`, `GolpeEnriquecido`, `HabilidadeEnriquecida`, `IndiceReverso`, `ManifestEntry`, `SpeciesRow`, `MoveRow`, `AbilityRow`, `LearnableMoveRow`, `PokemonAbilityRow`, `DesignBaselineRow`, `NflMatchupRow`, `UpsertResult`, `RejectedRecord`, `Result<T>`
    - Centralizar em `lib/catalog/types.ts` (e `lib/nfl/types.ts` para os específicos de NFL) para reuso por transformadores, escritor e leitura
    - _Requirements: 1.2, 2.2, 3.2, 4.1, 5.1, 10.1, 11.1_

  - [x] 2.2 Implementar leitores de arquivo em `lib/catalog/loaders.ts`
    - Implementar `loadFichas`, `loadMoves`, `loadAbilities`, `loadReverseIndex`, `loadManifest` lendo e validando os arquivos locais do Catálogo Oficial, retornando estruturas tipadas
    - Separar o I/O de arquivo da lógica de transformação (puro vs. efeito)
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_

  - [x] 2.3 Escrever testes de exemplo para os leitores
    - Verificar leitura de subconjunto representativo (5–10 fichas) e índices reversos com estrutura esperada
    - Cobrir arquivo com ficha inválida (sem `pokemon_id`/`slug`) retornada para rejeição posterior
    - _Requirements: 1.5_

- [x] 3. Transformadores puros do catálogo
  - [x] 3.1 Implementar `ALLOWED_IDS` e `isAllowed` em `lib/catalog/transform.ts`
    - Definir `ALLOWED_IDS = {1..151} \ {144,145,146,150,151}` (cardinalidade 146)
    - Implementar `isAllowed(pokemonId)` como pertinência ao conjunto; qualquer id fora de 1..151 resulta em `false`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 3.2 Escrever property test para elegibilidade
    - **Property 9: Elegibilidade coincide com o conjunto permitido**
    - **Validates: Requirements 6.1, 6.3**

  - [x] 3.3 Implementar `toSpeciesRow`, `toMoveRow`, `toAbilityRow`
    - Mapear colunas de identidade/atributos da origem (espécie: `pokemon_id`, `slug`, `types`, seis stats, altura, peso do bloco `official`; golpe: `move_id=id`, `name`; habilidade: `ability_id=id`, `name`)
    - Gravar a estrutura original fiel em `raw_data` sem conversão; marcar `is_allowed` via `isAllowed`
    - Manter Anotações PFL fora do `raw_data` (colunas dedicadas)
    - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 6.1_

  - [x] 3.4 Escrever property test de mapeamento de colunas
    - **Property 1: Mapeamento fiel de colunas por entidade**
    - **Validates: Requirements 1.2, 2.2, 3.2, 5.2**

  - [x] 3.5 Escrever property test de round-trip de preservação
    - **Property 2: Round-trip de preservação em raw_data e metadados**
    - **Validates: Requirements 1.3, 2.3, 3.3, 4.2, 11.1, 11.3, 12.5**

  - [x] 3.6 Escrever property test de power sem conversão
    - **Property 3: Power preservado sem conversão** (incluir `power` nulo nos geradores)
    - **Validates: Requirements 2.3**

  - [x] 3.7 Escrever property test de anotações isoladas
    - **Property 4: Anotações PFL isoladas do raw_data**
    - **Validates: Requirements 1.4, 2.4, 3.4**

  - [x] 3.8 Implementar `toLearnableMoveRows` e `toPokemonAbilityRows`
    - Derivar pares de `official.learnable_moves[]` e `official.ability_options[]`, deduplicando por `(pokemon_id, move_id)` e `(pokemon_id, ability_id)`
    - Preservar `version_details` (golpe) e `is_hidden`/`slot` (habilidade) por par
    - _Requirements: 4.1, 4.2, 4.6, 5.1, 5.2, 5.5_

  - [x] 3.9 Escrever property test de contagem por deduplicação
    - **Property 5: Contagem por deduplicação de pares de relação**
    - **Validates: Requirements 4.1, 4.6, 5.1, 5.5**

- [x] 4. Conciliador de relações
  - [x] 4.1 Implementar `reconcile` em `lib/catalog/reconcile.ts`
    - Comparar, por `id`, o conjunto de `pokemon_id` derivado das fichas com o índice reverso; retornar `[]` quando todos os conjuntos coincidem
    - Em divergência, retornar `ReconDiff` com `only_in_db` e `only_in_index` exatos por id
    - _Requirements: 4.3, 4.4, 5.3_

  - [x] 4.2 Escrever property test de conciliação igual a conjuntos
    - **Property 7: Conciliação é igualdade de conjuntos**
    - **Validates: Requirements 4.3, 5.3**

  - [x] 4.3 Escrever property test de divergência exata
    - **Property 8: Divergência de conciliação produz diferença exata**
    - **Validates: Requirements 4.4**

- [x] 5. Escritor idempotente
  - [x] 5.1 Implementar escritas de entidades base em `lib/catalog/writer.ts`
    - Implementar `upsertMoves` (onConflict `move_id`), `upsertAbilities` (onConflict `ability_id`), `upsertSpecies` (onConflict `pokemon_id`) usando o cliente service-role da foundation
    - Operar em lotes transacionais; em falha de lote, rollback do lote e sinalização do erro mantendo lotes confirmados
    - Retornar `UpsertResult` com `inserted`/`updated`/`rejected`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 5.2 Implementar escritas de relações com validação de FK
    - Implementar `upsertLearnableMoves` (onConflict `(pokemon_id, move_id)`) e `upsertPokemonAbilities` (onConflict `(pokemon_id, ability_id)`)
    - Validar FK antes de gravar; rejeitar e registrar pares órfãos (`move_id`/`ability_id`/`pokemon_id` ausente) sem interromper os demais
    - _Requirements: 4.5, 5.4, 7.1, 7.2_

  - [x] 5.3 Implementar `upsertDesignBaseline`
    - Upsert por `version` (PK composta `(version, kind)`), preservando `payload` fiel e `status` legível; reexecução atualiza em vez de duplicar
    - Registrar os 36 matchups (`kind='matchups_36'`) e os parâmetros (`kind='simulation_parameters'`) sob a `version` do arquivo
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 5.4 Escrever property test de idempotência do upsert
    - **Property 6: Idempotência do upsert** (repositório em memória, N arbitrário de reaplicações)
    - **Validates: Requirements 7.2, 7.3, 10.3, 11.4**

  - [x] 5.5 Escrever testes de integração do escritor contra Supabase de teste
    - Upsert por PK atualiza em vez de duplicar (Req. 7.1); rollback de lote sob falha injetada (Req. 7.4)
    - _Requirements: 7.1, 7.4_

- [x] 6. Checkpoint — Garantir que todos os testes passem
  - Garanta que todos os testes passem; pergunte ao usuário se surgirem dúvidas.

- [x] 7. Validador pós-ingestão
  - [x] 7.1 Implementar checagens de SHA-256 e contagens/elegibilidade em `lib/catalog/validate.ts`
    - Implementar recomputação de `sha256` do JSON cru e comparação com o `manifest.json`
    - Checar contagens (146/591/113) contra `actual_counts`, 146 espécies `is_allowed = true`, e exclusões {144,145,146,150,151} = `false`
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 7.2 Escrever property test de round-trip de checksum
    - **Property 12: Round-trip de checksum SHA-256** (gerar conteúdo + mutação de byte)
    - **Validates: Requirements 8.5**

  - [x] 7.3 Escrever property test de validação de contagens e elegibilidade
    - **Property 11: Validação de contagens e elegibilidade**
    - **Validates: Requirements 8.1, 8.2**

  - [x] 7.4 Implementar checagem de integridade referencial e resultado agregado
    - Checar que toda relação de golpe/habilidade referencia `move_id`/`ability_id` e `pokemon_id` existentes; reportar órfãs com identificadores
    - Montar `ValidationOutcome`: `passed:false` + `issues[]` (nome da verificação + ids) em qualquer falha; `passed:true` com `issues` vazio quando tudo satisfeito
    - _Requirements: 8.3, 8.4, 8.6, 8.7_

  - [x] 7.5 Escrever property test de integridade referencial
    - **Property 10: Validação detecta integridade referencial**
    - **Validates: Requirements 8.3, 8.4**

  - [x] 7.6 Escrever testes de exemplo do checklist de validação
    - Estados válidos/ inválidos conhecidos retornando ids corretos (Reqs. 8.6, 8.7); exclusões de elegibilidade com os 5 ids = `false` (Req. 6.2)
    - _Requirements: 6.2, 8.6, 8.7_

- [x] 8. CLI Processo_Seed
  - [x] 8.1 Implementar o orquestrador do seed
    - Encadear: carregar arquivos → conferir checksums do manifest (abortar antes de escrever em divergência) → Fase 1 `upsertMoves` → Fase 2 `upsertAbilities` → Fase 3 `upsertSpecies` + `is_allowed` → Fase 4 `upsertLearnableMoves` → Fase 5 `upsertPokemonAbilities` → Fase 6 `upsertDesignBaseline`
    - Rejeitar e registrar fichas/relações inválidas sem interromper os demais; reexecução converge às contagens-alvo sem duplicatas
    - _Requirements: 1.1, 1.5, 2.1, 3.1, 4.1, 5.1, 6.1, 6.4, 7.3, 7.5, 11.1, 11.2_

  - [x] 8.2 Integrar a conciliação final ao seed
    - Após as relações, derivar `Map<id, Set<pokemon_id>>` e chamar `reconcile` contra os índices reversos; sinalizar falha de conciliação listando `only_in_db`/`only_in_index` por id divergente
    - _Requirements: 4.3, 4.4, 5.3_

  - [x] 8.3 Escrever teste de integração de retomada e idempotência do seed
    - Interromper após fases e reexecutar; conferir contagens-alvo (146/591/113/13564/386) e ausência de duplicatas (Reqs. 7.3, 7.5)
    - Registro do baseline sob a `version` do arquivo (Req. 11.2)
    - _Requirements: 7.3, 7.5, 11.2_

- [x] 9. CLI Processo_Validacao_Pos_Ingestao
  - [x] 9.1 Implementar o CLI de validação
    - Carregar `VALIDATION_REPORT.json` e `manifest.json`, invocar `validatePostIngestion` e imprimir o `ValidationOutcome`
    - Encerrar com código de aprovação/falha conforme `passed`; exclusões, FKs e checksums reportados com ids
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 10. Checkpoint — Garantir que todos os testes passem
  - Garanta que todos os testes passem; pergunte ao usuário se surgirem dúvidas.

- [x] 11. Cliente NFL resiliente
  - [x] 11.1 Implementar `computeBackoffDelay` e configuração por env em `lib/nfl/client.ts`
    - Ler `NFL_API_BASE_URL` e `NFL_API_KEY` exclusivamente de variáveis de ambiente (sem literal de credencial no código)
    - Implementar `computeBackoffDelay(n, cfg) = min(maxDelayMs, baseDelayMs * 2^(n-1))` com `base=1000ms`, `teto=30000ms`
    - _Requirements: 9.1, 9.3, 9.4_

  - [x] 11.2 Escrever property test de backoff exponencial
    - **Property 13: Backoff exponencial limitado** (`n` em 1..5)
    - **Validates: Requirements 9.3, 9.4**

  - [x] 11.3 Implementar `fetchWithRetry` e logger sanitizado
    - Requisição com timeout 30s e header de autorização; retry em 429/timeout/rede até 5 tentativas; ao esgotar, `FetchOutcome` com `ok:false`, `endpoint` e `reason`
    - Encerrar sem requisições quando `NFL_API_KEY` ausente/vazia, nomeando a env var faltante; sanitizar toda mensagem para nunca conter a credencial
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 11.4 Escrever property test de logs sem credencial
    - **Property 14: Logs nunca expõem a credencial**
    - **Validates: Requirements 9.6**

  - [x] 11.5 Escrever testes de exemplo de resiliência e configuração
    - Config só por env / sem literal de key (Req. 9.1); key ausente encerra sem requisição com espião de HTTP (Req. 9.2); falha persistente de endpoint não interrompe o pipeline (Req. 9.5)
    - _Requirements: 9.1, 9.2, 9.5_

- [x] 12. Persistência e ingestão NFL
  - [x] 12.1 Implementar `upsertNflMatchups` em `lib/nfl/persist.ts`
    - Upsert por `natural_key` (onConflict), gravando `captured_at` em UTC e `source = "https://nfl.balldontlie.io"`; nunca gravar como atleta/espécie/roster
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

  - [x] 12.2 Escrever property test de carimbo UTC e source
    - **Property 15: Carimbo UTC e fonte em todo matchup NFL** (repositório em memória)
    - **Validates: Requirements 10.2**

  - [x] 12.3 Implementar o CLI de ingestão NFL
    - Para cada endpoint do pipeline: `fetchWithRetry` → em sucesso `upsertNflMatchups`; falha definitiva registra endpoint e prossegue; relatório final de falhas parciais
    - _Requirements: 9.5, 10.1, 10.2, 10.3_

  - [x] 12.4 Escrever teste de integração da ingestão NFL com servidor mock
    - Exercitar 429/timeout/sucesso sem consumir a API real; verificar persistência em `nfl_matchup_data` e ausência de escrita em `species`/roster (Reqs. 10.1, 10.5)
    - _Requirements: 10.1, 10.5_

- [x] 13. Camada de leitura
  - [x] 13.1 Implementar `getAllowedSpecies` em `lib/data/species.ts`
    - Retornar exclusivamente espécies com `is_allowed = true`, cada uma com `pokemon_id`, `slug`, `types` e as seis stats base; usar o cliente de leitura (só lê do Supabase)
    - _Requirements: 12.1, 12.8_

  - [x] 13.2 Escrever property test de filtro de espécies permitidas
    - **Property 18: Consulta de espécies permitidas filtra corretamente**
    - **Validates: Requirements 12.1**

  - [x] 13.3 Implementar `getLearnableMoveIds` e `getAvailableAbilities` em `lib/data/eligibility.ts`
    - Para `pokemon_id` com `is_allowed = true`: retornar conjunto de `move_id` e conjunto de `ability_id` com `is_hidden`; espécie permitida sem relações retorna conjunto vazio sem erro
    - `pokemon_id` sem `is_allowed`/inexistente → `Result.found = false`
    - _Requirements: 12.2, 12.3, 12.4, 12.6_

  - [x] 13.4 Escrever property test de projeção de elegibilidade
    - **Property 17: Projeção de elegibilidade por espécie permitida**
    - **Validates: Requirements 12.2, 12.3**

  - [x] 13.5 Implementar `getMove` e `getAbility` em `lib/data/registry.ts`
    - Retornar o registro com `raw_data` fiel; identificador inexistente → `Result.found = false`, permanecendo disponível para novas consultas
    - _Requirements: 12.5, 12.6, 12.8_

  - [x] 13.6 Implementar `getNflMatchups` e `getDesignBaseline` em `lib/data/rules.ts`
    - Retornar `Dados_Matchup_NFL` e `Baseline_Design` persistidos, lendo exclusivamente do Supabase (sem API_NFL nem arquivos do catálogo em tempo de leitura)
    - _Requirements: 12.7, 12.8, 10.4_

  - [x] 13.7 Escrever property test de leitura sem I/O externo
    - **Property 16: Leitura não realiza I/O externo** (espiões de rede/fs sobre `lib/data/*`)
    - **Validates: Requirements 10.4, 12.8**

  - [x] 13.8 Escrever testes de exemplo das consultas de regras
    - `getNflMatchups`/`getDesignBaseline` retornam o persistido (Req. 12.7)
    - _Requirements: 12.7_

- [x] 14. Checkpoint final — Garantir que todos os testes passem
  - Garanta que todos os testes passem; pergunte ao usuário se surgirem dúvidas.

## Notes

- Tarefas marcadas com `*` são opcionais (testes de propriedade, unitários e de integração) e podem ser puladas para um MVP mais rápido.
- Cada tarefa referencia cláusulas específicas de requisitos para rastreabilidade.
- Os checkpoints asseguram validação incremental após blocos coesos (núcleo puro + escrita; CLIs de catálogo; NFL + leitura).
- Testes de propriedade validam as 18 Correctness Properties universais (mín. 100 iterações, `fast-check`); testes unitários/integração cobrem exemplos, bordas e comportamento transacional/rede/fronteira.
- Toda escrita é upsert idempotente por chave; a leitura nunca toca fontes externas.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "11.1"] },
    { "id": 2, "tasks": ["2.3", "3.2", "3.3", "3.8", "11.2", "11.3"] },
    { "id": 3, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.9", "4.1", "11.4", "11.5", "12.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.1", "5.2", "5.3", "12.2", "12.3"] },
    { "id": 5, "tasks": ["5.4", "5.5", "7.1", "7.4", "12.4"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.5", "7.6", "8.1"] },
    { "id": 7, "tasks": ["8.2", "9.1"] },
    { "id": 8, "tasks": ["8.3"] },
    { "id": 9, "tasks": ["13.1", "13.3", "13.5", "13.6"] },
    { "id": 10, "tasks": ["13.2", "13.4", "13.7", "13.8"] }
  ]
}
```
