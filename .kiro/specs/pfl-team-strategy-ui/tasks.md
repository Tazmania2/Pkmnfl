# Implementation Plan: pfl-team-strategy-ui

## Overview

Este plano converte o design de `pfl-team-strategy-ui` em uma sequência de tarefas de código incrementais, em **TypeScript (Next.js App Router, React + TS)**, construídas sobre a `pfl-foundation` (schema Supabase, cliente, regras anti-slop, `lib/seed/` com checksum canônico) e a `pfl-data-catalog` (`lib/data/`).

A ordem segue a filosofia do design: primeiro os **módulos puros** (modelo, store, elegibilidade, validação, anatomia, presets, seed), que são o coração testável por PBT; depois as **rotas e Server Actions** que reusam esses módulos no servidor; por fim os **componentes de apresentação** e a camada de acessibilidade/anti-slop. Cada etapa integra o que a anterior produziu, sem código órfão.

Testes de propriedade usam **fast-check** com **mínimo de 100 iterações** (`fc.assert(..., { numRuns: 100 })`), um teste por Correctness Property (P1–P20), cada um anotado com `Feature: pfl-team-strategy-ui, Property {n}`. Testes de componente/acessibilidade usam Testing Library + axe. Testes de integração cobrem salvar com revalidação server-side e round-trip export→import.

Convenções anti-slop: operação por teclado, foco visível distinto de erro/seleção, estados sinalizados por mais de um recurso visual, avisos associados por ARIA, nenhum número sem origem rastreável à `Camada_Leitura` ou à configuração do jogador.

## Tasks

- [x] 1. Modelo e store do time em edição
  - [x] 1.1 Definir o modelo do time (`lib/team/model.ts`)
    - Definir `PlayId` com os IDs autoritativos de ataque (`O_RUN_INSIDE`, `O_RUN_OUTSIDE`, `O_PASS_SHORT`, `O_PASS_INTERMEDIATE`, `O_PASS_DEEP`, `O_PLAY_ACTION`) e de defesa (`D_RUN_FIT`, `D_EDGE_CONTAIN`, `D_ZONE`, `D_MAN`, `D_RUSH`, `D_CONTAIN_QB`)
    - Exportar as constantes `OFFENSE_PLAYS` e `DEFENSE_PLAYS` (readonly)
    - Definir `LineupUnit` (`offense`, `defense` e as 6 unidades de special teams), `Role`, `PresetId`
    - Definir `AthleteDraft`, `StrategyDraft`, `LineupAssignment`, `TeamDraft`, `PresetProvenance`
    - _Requirements: 2.1, 2.2, 3.1, 11.1, 12.1, 12.2, 13.1_

  - [x] 1.2 Implementar a store imutável (`lib/team/store.ts`)
    - Implementar `getDraft`, `addAthlete` (recusa a 54ª adição), `removeAthlete`, `updateAthlete`
    - Implementar `assignRole`/`clearRole` (recusa duplicar identidade no mesmo snap), `setOffenseStyle`/`setDefenseStyle`, `reorderOffensePlays`/`reorderDefensePlays`
    - Implementar `loadEmpty`; cada operação retorna um novo `TeamDraft` sem mutar o anterior
    - _Requirements: 1.2, 2.3, 2.4, 4.3, 11.2, 11.3, 12.3, 12.4, 13.3, 13.5_

  - [x] 1.3 Teste de propriedade: instâncias distintas e duplicatas de espécie
    - **Property 3: Instâncias distintas, inclusive duplicatas de espécie**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 1.4 Teste de propriedade: teto do roster nunca excedido
    - **Property 4: Teto do roster nunca excedido**
    - **Validates: Requirements 2.3, 2.4**

  - [x] 1.5 Teste de propriedade: priorização de jogadas é permutação do conjunto fixo
    - **Property 13: Priorização de jogadas é uma permutação do conjunto fixo**
    - **Validates: Requirements 12.3, 12.4**

  - [x] 1.6 Teste de propriedade: estilos registrados na estratégia
    - **Property 14: Estilos registrados na estratégia**
    - **Validates: Requirements 11.2, 11.3**

- [x] 2. Adaptador de elegibilidade (consumo de `lib/data/`)
  - [x] 2.1 Implementar o adaptador memoizado (`lib/team/eligibility-adapter.ts`)
    - Definir `EligibilitySource` e `EligibilitySnapshot` conforme o design
    - Consumir `getAllowedSpecies`, `getLearnableMoveIds`, `getAvailableAbilities`, `getMove`, `getAbility` da `Camada_Leitura`, memoizando por `pokemonId`
    - Produzir um `EligibilitySnapshot` síncrono (conjuntos/mapas já resolvidos, incluindo `moveName`, `abilityName`, `inertEffects`) para alimentar seletores e o motor puro
    - _Requirements: 2.5, 6.2, 6.3, 17.5_

  - [x] 2.2 Teste de propriedade: seleção de espécies restrita ao conjunto permitido
    - **Property 5: Seleção de espécies restrita ao conjunto permitido**
    - **Validates: Requirements 2.5, 2.6**

- [x] 3. Anatomia e dicas posicionais (`lib/anatomy/`)
  - [x] 3.1 Implementar dicas e aviso anatômico (`lib/anatomy/index.ts`)
    - Implementar `positionalHint(pokemonId, position)` com texto específico e orientador por par, nunca bloqueante
    - Implementar `anatomyWarning(pokemonId, position)` derivando das convenções de `ANATOMY_DECISIONS_FINAL.md`, retornando `AnatomyFinding | null`; definir `AnatomyConventions`
    - Expor a lógica de forma compartilhável com o motor de validação, sem duplicação de regras
    - _Requirements: 5.1, 5.2, 5.3, 8.2_

  - [x] 3.2 Teste de propriedade: dica específica/não bloqueante e aviso anatômico consistente
    - **Property 8: Dica posicional específica e não bloqueante; aviso anatômico consistente com a convenção**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 4. Motor de validação puro (`lib/validation/`)
  - [x] 4.1 Implementar validação de atleta e tipos de aviso (`lib/validation/index.ts`)
    - Definir `WarningCode`, `ValidationWarning` (com `target` para associação ARIA) e `hasBlocking`
    - Implementar `validateAthlete`: `MOVE_NOT_LEARNABLE`, `ABILITY_NOT_AVAILABLE`, `MOVE_COUNT_NOT_FOUR` (com contagem atual), `MOVE_DUPLICATE` (nomeando golpe), `INERT_EFFECT` (não bloqueante), `ANATOMY_LIMIT` (não bloqueante via `lib/anatomy/`)
    - Mensagens específicas e legíveis; classificar bloqueante vs não-bloqueante
    - _Requirements: 5.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.3, 17.6_

  - [x] 4.2 Implementar validação de escalação e roster, e agregação (`lib/validation/index.ts`)
    - Implementar `validateLineups`: `UNIT_INCOMPLETE` (nomeando unidade e papéis pendentes) e `DUPLICATE_IDENTITY_SNAP` (11 identidades distintas por unidade/snap)
    - Implementar `validateRoster`: `SPECIES_NOT_ALLOWED` e `ROSTER_CAP_EXCEEDED`
    - Implementar `validateDraft` combinando atleta + escalação + roster
    - _Requirements: 2.4, 2.6, 13.1, 13.2, 13.4, 13.5_

  - [x] 4.3 Teste de propriedade: validação da ficha detecta exatamente os casos inválidos
    - **Property 10: Validação da ficha é função pura do estado e detecta exatamente os casos inválidos**
    - **Validates: Requirements 6.4, 7.1, 7.2, 7.3, 7.4, 7.5**

  - [x] 4.4 Teste de propriedade: efeito inerte equipável, não bloqueante e sinalizado
    - **Property 11: Efeito inerte é equipável, não bloqueante e sinalizado**
    - **Validates: Requirements 8.1, 8.3**

  - [x] 4.5 Teste de propriedade: gate de persistência por avisos bloqueantes
    - **Property 12: Gate de persistência por avisos bloqueantes**
    - **Validates: Requirements 7.6, 9.2, 9.3**

  - [x] 4.6 Teste de propriedade: unidade válida tem exatamente 11 identidades distintas por snap
    - **Property 15: Unidade válida tem exatamente 11 identidades distintas por snap**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**

- [x] 5. Presets copiáveis (`lib/presets/`)
  - [x] 5.1 Implementar carga e clone de presets (`lib/presets/index.ts`)
    - Carregar `PRESET_BALANCED/GROUND/AERIAL/CURTI.json` como `PresetDefinition` somente-leitura
    - Implementar `getPreset(id)` (nunca mutável) e `clonePresetToDraft(id)` (deep clone + `provenance`)
    - Marcar proveniência do Curti: 22 titulares da fonte histórica; habilidades/golpes/special teams/estratégia como atribuição PFL
    - Integrar `clonePresetToDraft` à store (`loadFromPreset`) e predefinir estilos de estratégia do preset
    - _Requirements: 1.3, 1.5, 10.1, 10.2, 10.3, 10.4, 11.4_

  - [x] 5.2 Teste de propriedade: preset clonado é fiel e nunca muta a definição original
    - **Property 1: Preset clonado é fiel e nunca muta a definição original**
    - **Validates: Requirements 1.3, 1.5, 10.2**

  - [x] 5.3 Teste de propriedade: preset carregado é salvável sem ajuste
    - **Property 2: Preset carregado é salvável sem ajuste**
    - **Validates: Requirements 1.4**

- [x] 6. Checkpoint — módulos puros de modelo, validação, anatomia e presets
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Exportação e importação de seed (`lib/seed/`)
  - [x] 7.1 Implementar exportação de seed (`lib/seed/export.ts`)
    - Definir `SeedDocument`, `SeedAthlete`, `SeedLineup`
    - Implementar `exportSeed(draft)` gerando os campos `schema`, `ruleset`, `athletes`, `lineups`, `special_teams_full_units`, `strategy` e `checksum_sha256`, reusando a canonicalização + checksum da foundation (`lib/seed/`)
    - Omitir qualquer aleatoriedade de partida, log, vencedor ou resultado
    - _Requirements: 14.2, 14.3, 14.4, 14.5_

  - [x] 7.2 Implementar pipeline de importação (`lib/seed/import.ts`)
    - Definir `ImportResult`, `ImportRejection`, `ImportStep`
    - Implementar `importSeed(rawBytes, elig)` executando as etapas em ordem: `SIZE` → `PARSE` → `STRUCTURE` → `SCHEMA_VERSION` → `ROSTER_CAP` → `ALLOWED_IDS` → `MOVES` → `ABILITY` → `LINEUP_IDENTITIES` → `FORBIDDEN_CONTENT` → `CHECKSUM`
    - Reusar `validateDraft`/motor nas etapas de regra; recusa legível identificando a causa; sucesso carrega `TeamDraft` via `loadFromSeed`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 15.13_

  - [x] 7.3 Teste de propriedade: documento de seed exportado é bem formado e sem conteúdo de partida
    - **Property 16: Documento de seed exportado é bem formado e sem conteúdo de partida**
    - **Validates: Requirements 14.2, 14.3, 14.5**

  - [x] 7.4 Teste de propriedade: checksum do seed é determinístico e recomputável
    - **Property 17: Checksum do seed é determinístico e recomputável**
    - **Validates: Requirements 14.4, 16.3**

  - [x] 7.5 Teste de propriedade: importação aceita só documentos íntegros e identifica cada violação
    - **Property 18: Importação aceita apenas documentos íntegros e rejeita cada violação identificando a causa**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.12, 15.13**

  - [x] 7.6 Teste de propriedade: importação recusada preserva estado; aprovada reconstitui fielmente
    - **Property 19: Importação recusada preserva o estado e importação aprovada reconstitui fielmente**
    - **Validates: Requirements 15.10, 15.11, 16.1, 16.2**

- [x] 8. Rotas App Router e Server Actions
  - [x] 8.1 Implementar proxy de elegibilidade (`app/api/eligibility/route.ts`)
    - GET que expõe espécies permitidas, golpes aprendíveis e habilidades a partir de `lib/data/` (proxy fino, sem lógica de catálogo própria)
    - _Requirements: 2.5, 6.2, 6.3, 17.5_

  - [x] 8.2 Implementar salvamento com revalidação server-side (`app/api/team/route.ts`)
    - POST que reexecuta `validateDraft` no servidor antes de persistir; recusa salvar se `hasBlocking`
    - Persistir `TeamDraft` nas tabelas da foundation: `user_teams`, `athletes`, `athlete_moves`, `lineups`, `strategy`; confirmar sucesso ao cliente
    - Mapear `PlayId` autoritativos para os ids do `play_catalog_18.json`; preservar a ordem das prioridades
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 8.3 Implementar rotas de seed (`app/api/seed/export/route.ts`, `app/api/seed/import/route.ts`)
    - Export: POST que devolve o `.pflseed.json` de um time válido via `exportSeed`
    - Import: POST que executa o pipeline `importSeed` server-side; em sucesso persiste `team_seeds` e o time; em recusa preserva o estado e retorna o motivo
    - _Requirements: 14.1, 14.2, 15.1, 15.11_

  - [x] 8.4 Criar shells das páginas App Router (`app/time/page.tsx`, `app/estrategia/page.tsx`)
    - Server Component shell que hidrata elegibilidade e monta o island cliente com a store compartilhada
    - Garantir que navegar entre `/time` e `/estrategia` não descarta o `TeamDraft` em edição
    - _Requirements: 3.1, 11.1, 12.1, 12.2_

  - [x] 8.5 Teste de integração: salvar com revalidação server-side e recarregar
    - Salvar time válido e recarregar reproduz atletas, habilidades, 4 golpes, posições e escalações; servidor reexecuta `validateDraft` e respeita triggers da foundation
    - _Requirements: 9.2, 9.3_

- [x] 9. Componentes da Tela Meu Time (`components/team/`)
  - [x] 9.1 Implementar origem e grade do roster
    - `SeletorOrigem` (botão "Usar preset" com os 4 `preset_id` + botão "Começar do zero"), `GradeRoster` (contador `X/53`, item distinto por instância, recusa da 54ª com aviso) e `ItemRoster` (cartão arrastável que abre a ficha)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

  - [x] 9.2 Implementar abas de unidade e campo de atribuição
    - `AbasUnidade` (Ataque | Defesa | Especiais com as 6 unidades), `CampoAtribuicao` (11 papéis, drop por drag + seletor de posição equivalente por teclado), `DicaPosicional` e `AvisoAnatomico`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_

  - [x] 9.3 Implementar ficha do atleta e seletores
    - `FichaAtleta` (1 habilidade + 4 golpes, avisos inline com debounce ≤500ms, recusa salvar com aviso bloqueante), `SeletorHabilidade` (`getAvailableAbilities`), `SeletorGolpes` (`getLearnableMoveIds`, 4 slots), `AvisoEfeitoInerte`
    - Fiar os avisos ao motor `validateAthlete`/`validateDraft`; associar cada aviso por ARIA ao controle
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.3_

  - [x] 9.4 Implementar barra de ações
    - `BarraAcoes` com botões rotulados Salvar / Exportar seed / Importar seed; confirmação de salvamento; aciona as rotas da seção 8
    - _Requirements: 9.1, 9.4, 14.1, 15.1_

  - [x] 9.5 Teste de propriedade: seletores da ficha espelham exatamente a elegibilidade
    - **Property 9: Seletores da ficha espelham exatamente a elegibilidade**
    - **Validates: Requirements 6.2, 6.3**

  - [x] 9.6 Teste de propriedade: atribuição de posição registra e reflete, sem proibição por espécie
    - **Property 6: Atribuição de posição registra e reflete, sem proibição por espécie**
    - **Validates: Requirements 4.3, 4.4**

  - [x] 9.7 Testes de componente/acessibilidade da Tela Meu Time
    - Controles rotulados (origem, abas, ficha, barra de ações); grade com N itens, duplicatas distintas e contador `X/53`; dica ao iniciar atribuição; aviso inerte visível antes de salvar; confirmação após salvar; `aria-describedby` associando avisos
    - Fidelidade do Curti: 11 titulares de ataque + 11 de defesa com espécies/posições esperadas e proveniência de atribuição PFL
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1, 5.1, 6.1, 8.3, 9.1, 9.4, 10.3, 10.4, 17.7_

- [x] 10. Componentes da Tela Estratégia (`components/strategy/`)
  - [x] 10.1 Implementar seletores e priorização de jogadas
    - `SeletorEstiloAtaque`, `SeletorEstiloDefesa`, `PrioridadeJogadasAtaque` (6 `O_*`, operável por teclado) e `PrioridadeJogadasDefesa` (6 `D_*`)
    - Registrar estilos e prioridades na `StrategyDraft`; sem desenhador de jogadas e sem UI de special teams
    - _Requirements: 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 10.2 Testes de componente/acessibilidade da Tela Estratégia
    - Seletores de estilo presentes; priorização operável por teclado (mover acima/abaixo); ausência de desenhador e de UI de special teams
    - _Requirements: 11.1, 12.1, 12.2, 12.5, 12.6_

- [x] 11. Persistência store→Supabase e acessibilidade/anti-slop transversal
  - [x] 11.1 Fiar a store à persistência via Server Actions
    - Conectar `BarraAcoes` e as páginas às rotas `team`/`seed` com revalidação server-side; mapear store → `user_teams`, `athletes`, `athlete_moves`, `lineups`, `strategy`, `team_seeds`
    - Garantir que recusas de salvar/importar são atômicas e preservam o estado anterior
    - _Requirements: 9.2, 9.3, 14.2, 15.10, 15.11_

  - [x] 11.2 Aplicar acessibilidade e anti-slop em ambas as telas
    - Ordem de tabulação seguindo a sequência visual; foco visível distinto de erro/seleção; estados por mais de um recurso visual; alternativa por teclado ao drag; ARIA em todos os avisos; nenhum número sem origem rastreável
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x] 11.3 Teste de propriedade: equivalência entre atribuição por teclado e por arrastar
    - **Property 7: Equivalência entre atribuição por teclado e por arrastar**
    - **Validates: Requirements 4.2, 17.3**

  - [x] 11.4 Teste de propriedade: avisos específicos, únicos por caso e associados ao alvo
    - **Property 20: Avisos são específicos, únicos por caso e associados ao alvo**
    - **Validates: Requirements 17.6**

  - [x] 11.5 Testes de acessibilidade e de integração de round-trip
    - Auditoria axe de ambas as telas (teclado, foco, contraste, ARIA); honestidade de números (R17.5)
    - Round-trip ponta a ponta: montar → exportar `.pflseed.json` → importar em estado limpo → igualdade com o original
    - _Requirements: 16.1, 16.2, 17.1, 17.2, 17.4, 17.5, 17.7_

- [x] 12. Checkpoint final — garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; as de implementação central nunca são opcionais.
- Cada tarefa referencia cláusulas específicas de requisito para rastreabilidade.
- Os testes de propriedade usam **fast-check** com no mínimo **100 iterações** e um teste por Correctness Property (P1–P20), anotados com `Feature: pfl-team-strategy-ui, Property {n}`.
- O motor de validação puro recebe um `EligibilitySnapshot` síncrono; a `Camada_Leitura` é mockada nos PBT (sem rede).
- A persistência reusa o schema e o `lib/seed/` da foundation; nada é reimplementado nesta spec.
- Checkpoints garantem validação incremental antes de avançar para a camada seguinte.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.2", "3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.4", "5.1"] },
    { "id": 4, "tasks": ["4.3", "4.5", "4.6", "5.2", "5.3", "7.1", "7.2"] },
    { "id": 5, "tasks": ["7.3", "7.4", "7.5", "7.6", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "8.5", "9.1", "10.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "10.2"] },
    { "id": 8, "tasks": ["9.5", "9.6", "9.7", "11.1", "11.2"] },
    { "id": 9, "tasks": ["11.3", "11.4", "11.5"] }
  ]
}
```
