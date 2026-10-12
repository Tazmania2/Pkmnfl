# Requirements Document

## Introduction

A spec **pfl-data-catalog** é a segunda das cinco specs do projeto PFL (Pokémon Football League) e tem a responsabilidade de **popular com dados de referência** o banco Supabase cujo schema foi criado na spec `pfl-foundation`, bem como de **expor uma camada de leitura** para o restante da aplicação consultar esse acervo. Em uma frase: a `pfl-foundation` criou as tabelas vazias; a `pfl-data-catalog` as preenche fielmente e disponibiliza consultas sobre elas.

Esta spec cobre quatro frentes:

1. **Ingestão do Catálogo Oficial v1.7**: semear as 146 fichas de Pokémon, os 591 golpes, as 113 habilidades e as relações Pokémon↔golpes-aprendíveis e Pokémon↔habilidades, preservando fielmente a estrutura original da PokéAPI em `raw_data` e mantendo as anotações PFL isoladas e rastreáveis, sem converter atributos de jogo (como `power` ou base stats) em interpretações do simulador.
2. **Elegibilidade de espécies**: marcar `is_allowed = true` exclusivamente para as 146 espécies permitidas (ids 1 a 151 exceto 144, 145, 146, 150 e 151).
3. **Camada de regras/matchups NFL**: ingerir e persistir no Supabase dados históricos de matchups de estratégias obtidos da API externa `nfl.balldontlie.io` para calibrar as heurísticas de confronto do motor, além de registrar como baseline de design versionado a tabela de 36 matchups do GDD (`matchups_36.json`) e os parâmetros de simulação (`simulation_parameters.json`).
4. **Camada de leitura (data access)**: expor funções de consulta ao catálogo, à elegibilidade de golpes/habilidades por espécie e aos dados de regras/matchups, para que o resto do app leia sem acessar fontes externas em tempo de jogo.

A ingestão deve ser **idempotente** (reexecutar o seed não duplica nem corrompe dados) e **validável** (contagens, exclusões e integridade referencial conferidas após a carga, com apoio aos artefatos `VALIDATION_REPORT.json` e `manifest.json`).

Estão **fora do escopo** desta spec: a definição do schema do banco (já entregue na `pfl-foundation`; esta spec apenas popula e lê), o motor de simulação de partidas e a interface do usuário. Os dados históricos da NFL servem para **calibrar heurísticas de confronto**, não para popular jogadores reais nas telas.

As fontes autoritativas são o documento `GDD_MESTRE.md`, os artefatos do pacote `CATALOGO_OFICIAL_v17/PFL_v17/` (`fichas_146_pfl_v16.json`, `moves_591_enriched.json`, `abilities_113_enriched.json`, `moves_to_pokemon_ids.json`, `abilities_to_pokemon_ids.json`, `VALIDATION_REPORT.json`), os JSONs crus da PokéAPI nos pacotes `PFL_292_jsons_2026-10-09/` e `PFL_704_jsons_moves_abilities_2026-10-09/`, e os arquivos de design `matchups_36.json` e `simulation_parameters.json`.

## Glossary

- **PFL**: Pokémon Football League, o webapp alvo deste projeto.
- **Supabase**: o serviço de banco de dados PostgreSQL hospedado utilizado pelo PFL, cujo schema foi criado na spec `pfl-foundation`.
- **Schema_PFL**: o conjunto de tabelas, chaves e restrições já criadas no Supabase pela spec `pfl-foundation`, consumidas (lidas e populadas) por esta spec sem alteração estrutural.
- **Catalogo_Oficial**: o conjunto de artefatos de referência v1.7 do PFL, composto pelas fichas de espécies, pelos golpes, pelas habilidades e pelos índices reversos, localizado em `CATALOGO_OFICIAL_v17/PFL_v17/`.
- **Ficha_Especie**: um registro de `fichas_146_pfl_v16.json` que descreve uma espécie permitida, contendo `pokemon_id`, `slug`, `name_display`, `source_uri`, `species_source_uri` e o bloco `official` com `types`, `stats`, `height_dm`, `weight_hg`, `ability_options[]` e `learnable_moves[]`.
- **Golpe_Enriquecido**: um registro de `moves_591_enriched.json` que descreve um golpe, identificado por `id`, com propriedades originais da PokéAPI (`type`, `damage_class`, `power`, `accuracy`, `pp`, `priority`, `meta`, descrições) e colunas de curadoria PFL ainda não classificadas.
- **Habilidade_Enriquecida**: um registro de `abilities_113_enriched.json` que descreve uma habilidade, identificada por `id`, com efeitos, histórico e colunas de curadoria PFL pendentes.
- **Indice_Reverso_Golpes**: o arquivo `moves_to_pokemon_ids.json`, que mapeia cada `move_id` à lista de `pokemon_id` que podem aprendê-lo.
- **Indice_Reverso_Habilidades**: o arquivo `abilities_to_pokemon_ids.json`, que mapeia cada `ability_id` à lista de `pokemon_id` que podem possuí-la.
- **Especies_Permitidas**: o conjunto de 146 espécies admitidas no MVP, correspondente aos `pokemon_id` de 1 a 151 exceto 144, 145, 146, 150 e 151.
- **Raw_Data**: a coluna estruturada do Schema_PFL que armazena a estrutura original de dados da PokéAPI/catálogo sem conversão, lida de volta de forma fiel ao conteúdo original.
- **Anotacao_PFL**: qualquer campo de curadoria específico do PFL (classificação de efeito, rótulos de design), mantido separado do Raw_Data e associado à sua evidência de origem.
- **Processo_Seed**: o procedimento executável que lê o Catalogo_Oficial e grava os dados correspondentes no Schema_PFL.
- **Operacao_Upsert**: a operação de inserção-ou-atualização por chave primária (`pokemon_id`, `move_id` ou `ability_id`) empregada pelo Processo_Seed para garantir idempotência.
- **Relatorio_Validacao**: o arquivo `VALIDATION_REPORT.json`, com as contagens esperadas e o indicador `validation_passed`.
- **Manifesto_PokeAPI**: um arquivo `manifest.json` dos pacotes de JSONs crus da PokéAPI que registra, por recurso, o `sha256`, o `status` e os bytes capturados.
- **Processo_Validacao_Pos_Ingestao**: o procedimento executável que verifica contagens, exclusões e integridade referencial após o Processo_Seed e emite um resultado de aprovação ou de falha.
- **API_NFL**: a fonte externa de dados históricos da NFL hospedada em `https://nfl.balldontlie.io`, acessada mediante chave de API e sujeita a limites de requisições (rate limit).
- **Chave_API_NFL**: a credencial de acesso à API_NFL, provida exclusivamente por variável de ambiente.
- **Dados_Matchup_NFL**: os dados históricos de confrontos de estratégias obtidos da API_NFL e persistidos no Supabase para calibrar heurísticas de confronto.
- **Baseline_Design**: os artefatos de design versionados `matchups_36.json` (36 matchups do GDD) e `simulation_parameters.json` (parâmetros de simulação), registrados como referência rastreável.
- **Camada_Leitura**: o conjunto de funções de acesso a dados que o restante do PFL utiliza para consultar o catálogo, a elegibilidade por espécie e os dados de regras/matchups.
- **Variavel_Ambiente**: um valor de configuração sensível ou dependente de ambiente, lido em tempo de execução e nunca escrito diretamente no código-fonte.

## Requirements

### Requirement 1: Ingestão das espécies do catálogo

**User Story:** Como desenvolvedor do PFL, quero semear as 146 fichas de espécies no Supabase preservando a estrutura original da PokéAPI, para que o catálogo de Pokémon reflita fielmente a fonte oficial.

#### Acceptance Criteria

1. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL inserir ou atualizar no Schema_PFL um registro de espécie para cada uma das 146 Fichas_Especie presentes em `fichas_146_pfl_v16.json`.
2. THE Processo_Seed SHALL gravar, para cada espécie, o `pokemon_id`, o `slug`, os tipos, as seis estatísticas base (`hp`, `attack`, `defense`, `special-attack`, `special-defense`, `speed`), a altura e o peso correspondentes ao bloco `official` da Ficha_Especie.
3. THE Processo_Seed SHALL gravar a estrutura original da Ficha_Especie na coluna Raw_Data de modo que o conteúdo lido corresponda à ficha de origem sem perda de campos.
4. THE Processo_Seed SHALL preservar as Anotacoes_PFL de cada espécie separadas do Raw_Data e associadas à Ficha_Especie de origem.
5. IF uma Ficha_Especie referenciada em `fichas_146_pfl_v16.json` não possui `pokemon_id` ou `slug`, THEN THE Processo_Seed SHALL rejeitar aquele registro, registrar o `pokemon_id` ausente ou inválido e prosseguir com os demais registros.

### Requirement 2: Ingestão dos golpes do catálogo

**User Story:** Como desenvolvedor do PFL, quero semear os 591 golpes no Supabase preservando as propriedades originais, para que o catálogo de golpes seja consultável sem perda de informação.

#### Acceptance Criteria

1. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL inserir ou atualizar no Schema_PFL um registro de golpe para cada um dos 591 Golpes_Enriquecidos presentes em `moves_591_enriched.json`.
2. THE Processo_Seed SHALL gravar, para cada golpe, o `move_id` igual ao campo `id` do Golpe_Enriquecido e o nome textual do golpe.
3. THE Processo_Seed SHALL gravar a estrutura original do Golpe_Enriquecido na coluna Raw_Data preservando as propriedades `type`, `damage_class`, `power`, `accuracy`, `pp`, `priority`, `meta` e as descrições, sem converter o `power` em qualquer interpretação de força física.
4. THE Processo_Seed SHALL preservar as Anotacoes_PFL de cada golpe separadas do Raw_Data e associadas ao Golpe_Enriquecido de origem.

### Requirement 3: Ingestão das habilidades do catálogo

**User Story:** Como desenvolvedor do PFL, quero semear as 113 habilidades no Supabase preservando efeitos e histórico, para que o catálogo de habilidades seja consultável de forma fiel.

#### Acceptance Criteria

1. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL inserir ou atualizar no Schema_PFL um registro de habilidade para cada uma das 113 Habilidades_Enriquecidas presentes em `abilities_113_enriched.json`.
2. THE Processo_Seed SHALL gravar, para cada habilidade, o `ability_id` igual ao campo `id` da Habilidade_Enriquecida e o nome textual da habilidade.
3. THE Processo_Seed SHALL gravar a estrutura original da Habilidade_Enriquecida na coluna Raw_Data preservando os efeitos, o histórico de mudanças e as descrições sem perda de campos.
4. THE Processo_Seed SHALL preservar as Anotacoes_PFL de cada habilidade separadas do Raw_Data e associadas à Habilidade_Enriquecida de origem.

### Requirement 4: Ingestão das relações Pokémon ↔ golpes aprendíveis

**User Story:** Como desenvolvedor do PFL, quero semear as relações de golpes aprendíveis por espécie, para que a elegibilidade de golpes seja consultável e consistente.

#### Acceptance Criteria

1. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL gravar uma relação de golpe aprendível para cada par (`pokemon_id`, `move_id`) distinto derivado de `official.learnable_moves[]` das Fichas_Especie, inserindo o par quando ainda não existir e atualizando a relação existente quando o par já estiver gravado, totalizando exatamente 13564 relações distintas conforme o Relatorio_Validacao.
2. WHEN o Processo_Seed grava uma relação de golpe aprendível, THE Processo_Seed SHALL preservar nessa relação os metadados de versão de aprendizado derivados de `official.learnable_moves[].version_details`, sem perda em relação à ficha de origem.
3. WHEN o Processo_Seed conclui a gravação das relações derivadas das Fichas_Especie, THE Processo_Seed SHALL verificar que, para cada `move_id`, o conjunto de `pokemon_id` gravados é igual ao conjunto declarado em `moves_to_pokemon_ids.json` do Indice_Reverso_Golpes.
4. IF, ao concluir a verificação de conciliação, o conjunto de `pokemon_id` gravados para ao menos um `move_id` difere do conjunto declarado em `moves_to_pokemon_ids.json`, THEN THE Processo_Seed SHALL sinalizar falha de conciliação e registrar, para cada `move_id` divergente, os `pokemon_id` presentes apenas na gravação e os presentes apenas no índice declarado.
5. IF uma relação de golpe aprendível referencia um `move_id` ausente da tabela de golpes ou um `pokemon_id` ausente da tabela de espécies, THEN THE Processo_Seed SHALL rejeitar aquela relação sem gravá-la e registrar o par (`pokemon_id`, `move_id`) rejeitado.
6. WHEN o mesmo par (`pokemon_id`, `move_id`) ocorre mais de uma vez nas Fichas_Especie, THE Processo_Seed SHALL gravar uma única relação para esse par, de modo que reexecuções do Processo_Seed não alterem a contagem total de relações distintas.

### Requirement 5: Ingestão das relações Pokémon ↔ habilidades disponíveis

**User Story:** Como desenvolvedor do PFL, quero semear as relações de habilidades disponíveis por espécie, para que a elegibilidade de habilidades seja consultável e consistente.

#### Acceptance Criteria

1. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL inserir ou atualizar uma relação de habilidade disponível para cada par (`pokemon_id`, `ability_id`) derivado de `official.ability_options[]` das Fichas_Especie, totalizando 386 relações conforme o Relatorio_Validacao.
2. THE Processo_Seed SHALL preservar, em cada relação de habilidade disponível, o indicador de habilidade oculta (`is_hidden`) e o `slot` derivados de `official.ability_options[]`.
3. THE Processo_Seed SHALL conciliar as relações derivadas das Fichas_Especie com o Indice_Reverso_Habilidades de modo que, para cada `ability_id`, o conjunto de `pokemon_id` gravados seja igual ao conjunto declarado em `abilities_to_pokemon_ids.json`.
4. IF uma relação de habilidade disponível referencia um `ability_id` ausente da tabela de habilidades ou um `pokemon_id` ausente da tabela de espécies, THEN THE Processo_Seed SHALL rejeitar aquela relação e registrar o par (`pokemon_id`, `ability_id`) rejeitado.
5. WHEN o mesmo par (`pokemon_id`, `ability_id`) ocorre mais de uma vez na fonte, THE Processo_Seed SHALL gravar uma única relação para esse par.

### Requirement 6: Marcação de elegibilidade das espécies permitidas

**User Story:** Como desenvolvedor do PFL, quero que apenas as 146 espécies permitidas fiquem elegíveis, para que o jogo restrinja a seleção ao conjunto definido do MVP.

#### Acceptance Criteria

1. WHEN o Processo_Seed conclui a carga das espécies, THE Processo_Seed SHALL definir `is_allowed = true` para cada espécie cujo `pokemon_id` pertença às Especies_Permitidas.
2. THE Processo_Seed SHALL definir `is_allowed = false` para toda espécie cujo `pokemon_id` esteja entre 144, 145, 146, 150 e 151.
3. WHEN o Processo_Seed conclui a marcação de elegibilidade, THE Processo_Seed SHALL deixar exatamente 146 espécies com `is_allowed = true`.
4. IF um `pokemon_id` fora do intervalo de 1 a 151 é encontrado na fonte de espécies, THEN THE Processo_Seed SHALL definir `is_allowed = false` para esse registro e registrar o `pokemon_id` fora do intervalo.

### Requirement 7: Idempotência da ingestão

**User Story:** Como desenvolvedor do PFL, quero que o seed seja idempotente, para que reexecuções não dupliquem nem corrompam os dados de referência.

#### Acceptance Criteria

1. THE Processo_Seed SHALL gravar espécies, golpes e habilidades por meio de Operacao_Upsert cuja chave de conciliação é a chave primária respectiva (`pokemon_id`, `move_id`, `ability_id`), inserindo quando a chave não existe e atualizando quando já existe.
2. WHEN o Processo_Seed é executado duas ou mais vezes sobre o mesmo Catalogo_Oficial, THE Schema_PFL SHALL conter, ao final, o mesmo conjunto de registros com valores campo a campo equivalentes aos que resultariam de uma única execução.
3. WHEN o Processo_Seed é reexecutado, THE Processo_Seed SHALL preservar as contagens de 146 espécies, 591 golpes, 113 habilidades, 13564 relações de golpe aprendível e 386 relações de habilidade disponível, sem criar registros adicionais e sem remover registros válidos previamente gravados.
4. IF uma Operacao_Upsert falha durante o Processo_Seed, THEN THE Processo_Seed SHALL reverter a transação daquela operação e sinalizar o erro, mantendo os registros previamente confirmados inalterados.
5. IF o Processo_Seed é interrompido antes de concluir, THEN uma reexecução do Processo_Seed SHALL completar a carga até alcançar exatamente as contagens-alvo de uma execução concluída, sem registros duplicados.

### Requirement 8: Validação pós-ingestão

**User Story:** Como desenvolvedor do PFL, quero validar o banco após o seed, para que eu tenha evidência de que a carga está completa, correta e íntegra.

#### Acceptance Criteria

1. WHEN o Processo_Validacao_Pos_Ingestao é executado, THE Processo_Validacao_Pos_Ingestao SHALL verificar que a contagem de espécies é 146, a de golpes é 591 e a de habilidades é 113, confrontando com `actual_counts` do Relatorio_Validacao.
2. WHEN o Processo_Validacao_Pos_Ingestao é executado, THE Processo_Validacao_Pos_Ingestao SHALL verificar que exatamente 146 espécies possuem `is_allowed = true` e que as espécies 144, 145, 146, 150 e 151 possuem `is_allowed = false`.
3. WHEN o Processo_Validacao_Pos_Ingestao é executado, THE Processo_Validacao_Pos_Ingestao SHALL verificar que toda relação de golpe aprendível referencia um `move_id` existente na tabela de golpes e um `pokemon_id` existente na tabela de espécies.
4. WHEN o Processo_Validacao_Pos_Ingestao é executado, THE Processo_Validacao_Pos_Ingestao SHALL verificar que toda relação de habilidade disponível referencia um `ability_id` existente na tabela de habilidades e um `pokemon_id` existente na tabela de espécies.
5. WHERE um Manifesto_PokeAPI está disponível para um recurso ingerido, THE Processo_Validacao_Pos_Ingestao SHALL recomputar o `sha256` do JSON cru de origem e compará-lo ao valor registrado no Manifesto_PokeAPI.
6. IF qualquer verificação do Processo_Validacao_Pos_Ingestao falha, THEN THE Processo_Validacao_Pos_Ingestao SHALL encerrar com resultado de falha e emitir a lista das verificações que falharam com os identificadores dos registros envolvidos.
7. WHEN todas as verificações do Processo_Validacao_Pos_Ingestao são satisfeitas, THE Processo_Validacao_Pos_Ingestao SHALL encerrar com resultado de aprovação.

### Requirement 9: Acesso à API NFL por variável de ambiente e resiliência

**User Story:** Como desenvolvedor do PFL, quero acessar a API NFL de forma segura e resiliente, para que a ingestão lide com credenciais sensíveis, falhas de rede e limites de requisição sem interromper o pipeline.

#### Acceptance Criteria

1. THE processo de ingestão da API_NFL SHALL ler a Chave_API_NFL e a URL base exclusivamente a partir de Variaveis_Ambiente, sem qualquer valor de credencial embutido no código-fonte.
2. IF a Chave_API_NFL está ausente ou vazia em tempo de execução, THEN THE processo de ingestão da API_NFL SHALL encerrar sem realizar requisições e retornar uma mensagem que identifique pelo nome a Variavel_Ambiente faltante.
3. IF a API_NFL retorna um status de limite de requisições excedido, THEN THE processo de ingestão da API_NFL SHALL aguardar antes de repetir a requisição, iniciando com um atraso base de 1 segundo e dobrando o atraso a cada tentativa até um teto de 30 segundos, por no máximo 5 tentativas, e, ao esgotar as 5 tentativas, SHALL sinalizar a falha com uma indicação de erro que identifique o endpoint afetado.
4. IF uma requisição à API_NFL excede o tempo limite de 30 segundos ou falha por erro de rede, THEN THE processo de ingestão da API_NFL SHALL repetir a requisição por no máximo 5 tentativas com atraso base de 1 segundo dobrando a cada tentativa até um teto de 30 segundos entre tentativas.
5. IF uma requisição à API_NFL permanece em falha após esgotar as 5 tentativas, THEN THE processo de ingestão da API_NFL SHALL registrar o endpoint afetado, sinalizar a falha e prosseguir com os demais endpoints do pipeline, mantendo inalterados os dados já persistidos.
6. THE processo de ingestão da API_NFL SHALL registrar mensagens de erro e diagnóstico sem expor o valor da Chave_API_NFL.

### Requirement 10: Persistência dos dados de matchup da NFL

**User Story:** Como desenvolvedor do PFL, quero persistir os dados históricos de matchups da NFL no Supabase, para que o motor use dados em cache local e nunca consulte a API externa durante a partida.

#### Acceptance Criteria

1. WHEN o processo de ingestão da API_NFL conclui com sucesso, THE processo de ingestão da API_NFL SHALL gravar os Dados_Matchup_NFL em tabela própria do Supabase destinada a dados de referência de regras.
2. THE processo de ingestão da API_NFL SHALL gravar, junto a cada conjunto de Dados_Matchup_NFL, a data e hora de captura em UTC e a identificação da fonte `https://nfl.balldontlie.io`.
3. THE processo de ingestão da API_NFL SHALL gravar os Dados_Matchup_NFL de forma idempotente por chave natural, de modo que uma reexecução atualize os registros existentes sem duplicá-los.
4. THE Camada_Leitura SHALL servir os Dados_Matchup_NFL a partir do Supabase, sem realizar requisições à API_NFL durante a leitura.
5. THE processo de ingestão da API_NFL SHALL destinar os Dados_Matchup_NFL exclusivamente à calibração de heurísticas de confronto, sem gravá-los como atletas, espécies ou registros de roster do jogador.

### Requirement 11: Registro do baseline de design versionado

**User Story:** Como desenvolvedor do PFL, quero registrar os 36 matchups do GDD e os parâmetros de simulação como baseline versionado, para que as heurísticas de confronto tenham uma referência de design rastreável.

#### Acceptance Criteria

1. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL registrar no Supabase os 36 matchups de `matchups_36.json`, preservando, por matchup, os campos `offense`, `defense`, `offense_probability_delta`, `stage`, `explanation` e `status`.
2. WHEN o Processo_Seed é executado, THE Processo_Seed SHALL registrar no Supabase os parâmetros de `simulation_parameters.json` associados ao identificador de versão `version` presente no próprio arquivo.
3. THE Processo_Seed SHALL preservar o indicador `status` do Baseline_Design de modo que valores como `PROPOSED_BALANCE_VALUE` e `FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED` sejam legíveis na leitura.
4. WHEN o Processo_Seed registra o Baseline_Design mais de uma vez para a mesma versão, THE Processo_Seed SHALL manter um único registro por versão, atualizando-o em vez de duplicá-lo.

### Requirement 12: Camada de leitura do catálogo e das regras

**User Story:** Como desenvolvedor do PFL, quero uma camada de leitura sobre o acervo, para que o restante do app consulte catálogo, elegibilidade e regras de forma uniforme.

#### Acceptance Criteria

1. THE Camada_Leitura SHALL expor uma consulta que retorne exclusivamente as espécies com `is_allowed = true`, incluindo, para cada espécie, o `pokemon_id`, o `slug`, os tipos e as seis estatísticas base (`hp`, `attack`, `defense`, `special-attack`, `special-defense`, `speed`).
2. WHEN a Camada_Leitura recebe um `pokemon_id` de espécie com `is_allowed = true`, THE Camada_Leitura SHALL retornar o conjunto de `move_id` elegíveis para aquela espécie com base nas relações de golpe aprendível.
3. WHEN a Camada_Leitura recebe um `pokemon_id` de espécie com `is_allowed = true`, THE Camada_Leitura SHALL retornar o conjunto de `ability_id` elegíveis para aquela espécie com base nas relações de habilidade disponível, indicando para cada `ability_id` se é `is_hidden`.
4. WHEN a Camada_Leitura recebe um `pokemon_id` com `is_allowed = true` que não possua nenhuma relação de golpe aprendível ou de habilidade disponível, THE Camada_Leitura SHALL retornar um conjunto vazio para a dimensão correspondente, sem sinalizar erro.
5. WHEN a Camada_Leitura recebe um `move_id` ou um `ability_id` existente, THE Camada_Leitura SHALL retornar o registro correspondente incluindo o Raw_Data preservado conforme a estrutura de origem.
6. IF a Camada_Leitura recebe um identificador inexistente no catálogo ou um `pokemon_id` sem `is_allowed = true`, THEN THE Camada_Leitura SHALL retornar um resultado vazio, sinalizar ao chamador que o identificador não foi encontrado e permanecer disponível para novas consultas.
7. THE Camada_Leitura SHALL expor uma consulta que retorne os Dados_Matchup_NFL e o Baseline_Design para uso das heurísticas de confronto.
8. THE Camada_Leitura SHALL ler exclusivamente do Supabase, sem acessar os arquivos do Catalogo_Oficial nem a API_NFL em tempo de execução de consulta.
