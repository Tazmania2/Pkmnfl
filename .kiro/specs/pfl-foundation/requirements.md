# Requirements Document

## Introduction

A spec **pfl-foundation** estabelece a fundação técnica do projeto PFL (Pokémon Football League), um webapp que simula partidas de futebol americano com Pokémon de Kanto. Esta spec prepara exclusivamente o terreno de engenharia: a estrutura do projeto Next.js (React + TypeScript) pronta para deploy na Vercel, a conexão com o Supabase via variáveis de ambiente, a instalação do conjunto de regras anti-slop, as convenções base de projeto (pastas, lint, variáveis de ambiente) e, sobretudo, a **definição do schema do banco de dados** (DDL/migrations) que modela as entidades centrais do jogo em estado vazio.

O escopo é deliberadamente restrito à fundação. Estão **fora do escopo** desta spec e serão tratados em specs separadas: a ingestão e o seed real dos dados do catálogo, o motor de simulação de partidas e as telas de interface do usuário. O resultado desta spec é um projeto que compila, conecta ao Supabase e possui um schema de banco migrado e vazio, pronto para ser populado posteriormente.

Os contratos de dados refletidos no schema derivam do documento autoritativo `GDD_MESTRE.md` e dos artefatos do catálogo oficial v1.7. O schema deve preservar a estrutura original de dados da PokéAPI conforme enriquecida nas fichas do projeto, mantendo as relações entre Pokémon, golpes aprendíveis e habilidades.

## Glossary

- **PFL**: Pokémon Football League, o webapp alvo deste projeto.
- **Projeto_Base**: a aplicação Next.js com TypeScript, estrutura de pastas, lint e configuração de deploy que constitui a fundação do PFL.
- **Supabase**: o serviço de banco de dados PostgreSQL hospedado utilizado pelo PFL, cujo projeto existente é referenciado pela URL `https://vtrcohnmgendbdkgjzmf.supabase.co`.
- **Cliente_Supabase**: o módulo de código que estabelece conexão autenticada entre o Projeto_Base e o Supabase usando credenciais providas por variáveis de ambiente.
- **Anti_Slop**: o conjunto de regras de agente instalado via `npx antislop-ai` e configurado como regras do projeto.
- **Schema_PFL**: o conjunto de tabelas, chaves, restrições e migrations definidas no Supabase para as entidades centrais do jogo.
- **Migration**: um arquivo versionado de DDL que cria ou altera objetos do Schema_PFL de forma reproduzível.
- **Catalogo**: os dados de referência imutáveis do jogo, compostos por espécies de Pokémon, golpes (moves) e habilidades (abilities).
- **Especie_Pokemon**: um registro do catálogo que representa uma das 146 espécies permitidas, identificado por `pokemon_id` numérico e por `slug` textual.
- **Golpe**: um registro do catálogo que representa um move, identificado por `move_id` numérico; existem 591 golpes.
- **Habilidade**: um registro do catálogo que representa uma ability, identificada por `ability_id` numérico; existem 113 habilidades.
- **Golpe_Aprendivel**: uma relação entre uma Especie_Pokemon e um Golpe que a espécie pode aprender, derivada de `official.learnable_moves[]`.
- **Habilidade_Disponivel**: uma relação entre uma Especie_Pokemon e uma Habilidade que a espécie pode possuir, derivada de `official.ability_options[]`.
- **Especies_Permitidas**: o conjunto de 146 espécies admitidas no MVP, correspondente aos `pokemon_id` de 1 a 151 exceto 144, 145, 146, 150 e 151.
- **Time_Usuario**: um registro que agrupa o roster, as escalações e a estratégia pertencentes a uma conta de usuário.
- **Roster**: o conjunto de Atletas_Instancia pertencentes a um Time_Usuario, limitado por `roster_cap`.
- **Roster_Cap**: o limite máximo de 53 atletas por Roster.
- **Atleta_Instancia**: um indivíduo distinto dentro de um Roster, identificado por `instance_id`, associado a um `pokemon_id`, um `ability_id`, exatamente quatro `move_id` distintos e uma `position_designation`.
- **Escalacao**: a atribuição de Atletas_Instancia a papéis de uma unidade de jogo (ataque, defesa ou special teams).
- **Unidade_Special_Teams**: uma das seis unidades de special teams, cada uma composta por 11 papéis.
- **Estrategia**: o conjunto de identificadores de jogadas de ataque, defesa e special teams selecionados para um Time_Usuario.
- **Seed_Time**: um documento exportável no formato `.pflseed.json` que serializa um Time_Usuario de forma interoperável.
- **Checksum_Seed**: o valor SHA-256 calculado sobre o JSON do Seed_Time sem o campo de checksum, com chaves ordenadas, codificação UTF-8 e separadores `','` e `':'`.
- **Variavel_Ambiente**: um valor de configuração sensível ou dependente de ambiente, lido em tempo de execução e nunca escrito diretamente no código-fonte.

## Requirements

### Requirement 1: Estrutura do projeto Next.js para a Vercel

**User Story:** Como desenvolvedor do PFL, quero um projeto Next.js com TypeScript estruturado para deploy na Vercel, para que eu tenha uma base de aplicação pronta para evoluir e publicar.

#### Acceptance Criteria

1. THE Projeto_Base SHALL ser inicializado como uma aplicação Next.js configurada com TypeScript em modo estrito (strict mode habilitado).
2. THE Projeto_Base SHALL incluir um arquivo de configuração de build compatível com deploy na Vercel que especifique o framework Next.js e a versão de runtime do Node.js.
3. WHEN o comando de build do Projeto_Base é executado, THE Projeto_Base SHALL concluir o build com código de saída 0 e sem erros de compilação TypeScript em até 300 segundos.
4. IF o comando de build do Projeto_Base encontra ao menos um erro de compilação TypeScript, THEN THE Projeto_Base SHALL encerrar o build com código de saída diferente de 0 e apresentar mensagem indicando o arquivo e a linha de cada erro.
5. THE Projeto_Base SHALL expor um diretório dedicado para Vercel Functions destinado exclusivamente ao código de backend.
6. THE Projeto_Base SHALL definir uma estrutura de pastas, descrita em arquivo de documentação versionado no repositório, que separe em diretórios distintos os componentes de interface, o código de backend e os módulos de acesso a dados.

### Requirement 2: Conexão com o Supabase via variáveis de ambiente

**User Story:** Como desenvolvedor do PFL, quero conectar a aplicação ao projeto Supabase existente usando variáveis de ambiente, para que as credenciais permaneçam seguras e configuráveis por ambiente.

#### Acceptance Criteria

1. THE Cliente_Supabase SHALL ler a URL do Supabase e as chaves de acesso exclusivamente a partir de Variaveis_Ambiente, sem qualquer valor de credencial embutido no código-fonte.
2. THE Projeto_Base SHALL fornecer um arquivo de exemplo que liste todos os nomes de Variaveis_Ambiente obrigatórias de conexão com o Supabase, cada uma com valor em branco ou marcador que não constitua credencial real.
3. IF uma Variavel_Ambiente obrigatória de conexão com o Supabase está ausente ou vazia em tempo de execução, THEN THE Cliente_Supabase SHALL encerrar a inicialização sem estabelecer conexão e retornar uma mensagem de erro que identifique pelo nome cada Variavel_Ambiente faltante.
4. IF as Variaveis_Ambiente estão presentes mas são rejeitadas na autenticação com o Supabase, THEN THE Cliente_Supabase SHALL encerrar a inicialização sem expor o valor da credencial e retornar uma mensagem de falha de autenticação.
5. THE Projeto_Base SHALL manter os arquivos locais de variáveis de ambiente fora de qualquer commit do repositório.
6. WHEN a inicialização do Cliente_Supabase ocorre com Variaveis_Ambiente presentes e válidas, THE Cliente_Supabase SHALL estabelecer uma conexão autenticada com o projeto Supabase referenciado pela URL `https://vtrcohnmgendbdkgjzmf.supabase.co`.

### Requirement 3: Instalação e configuração do anti-slop

**User Story:** Como desenvolvedor do PFL, quero as regras do anti-slop instaladas como regras de agente do projeto, para que o trabalho assistido por agente siga as convenções estabelecidas.

#### Acceptance Criteria

1. THE Projeto_Base SHALL executar a instalação do Anti_Slop por meio do comando `npx antislop-ai`.
2. THE Projeto_Base SHALL manter os artefatos de configuração do Anti_Slop versionados no repositório.
3. WHERE o Anti_Slop produz arquivos de regras de agente, THE Projeto_Base SHALL posicionar esses arquivos no local reconhecido como regras de projeto.

### Requirement 4: Convenções base de projeto

**User Story:** Como desenvolvedor do PFL, quero convenções base de lint e organização definidas, para que o código permaneça consistente desde o início.

#### Acceptance Criteria

1. THE Projeto_Base SHALL incluir uma configuração de lint para arquivos TypeScript e React.
2. WHEN o comando de lint do Projeto_Base é executado sobre o código inicial, THE Projeto_Base SHALL concluir a verificação sem erros de lint.
3. THE Projeto_Base SHALL documentar as convenções de estrutura de pastas e de nomenclatura de Variaveis_Ambiente em um arquivo de documentação do projeto.
4. THE Projeto_Base SHALL fixar as versões das dependências instaladas em um arquivo de lock versionado no repositório.

### Requirement 5: Migrations reproduzíveis do schema

**User Story:** Como desenvolvedor do PFL, quero o schema do banco definido em migrations versionadas, para que a estrutura do Supabase seja reproduzível e rastreável.

#### Acceptance Criteria

1. THE Schema_PFL SHALL ser definido por meio de arquivos de Migration versionados no repositório.
2. WHEN as Migrations são aplicadas a um banco Supabase vazio, THE Schema_PFL SHALL criar sem falhas todas as tabelas das entidades centrais: Especie_Pokemon, Habilidade, Golpe, Golpe_Aprendivel, Habilidade_Disponivel, Time_Usuario, Atleta_Instancia, Escalacao, Estrategia e Seed_Time.
3. IF a aplicação de uma Migration falha, THEN THE Schema_PFL SHALL reverter as alterações parciais daquela Migration e sinalizar a falha.
4. WHEN as Migrations são reaplicadas a um banco que já contém o Schema_PFL, THE Schema_PFL SHALL resultar em uma estrutura de tabelas idêntica à existente antes da reaplicação.
5. WHEN as Migrations são aplicadas, THE Schema_PFL SHALL deixar as tabelas de Time_Usuario, Atleta_Instancia, Escalacao, Estrategia e Seed_Time com zero registros.

### Requirement 6: Tabela de catálogo de Pokémon

**User Story:** Como desenvolvedor do PFL, quero uma tabela de catálogo de Pokémon que preserve a estrutura original da PokéAPI, para que os dados de espécies possam ser referenciados de forma fiel.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Especie_Pokemon com chave primária `pokemon_id` numérica obrigatória.
2. THE tabela de Especie_Pokemon SHALL conter uma coluna `slug` textual obrigatória com restrição de unicidade.
3. THE tabela de Especie_Pokemon SHALL conter uma coluna de tipos que admita de um a dois tipos por espécie.
4. THE tabela de Especie_Pokemon SHALL conter colunas obrigatórias e não negativas para as seis estatísticas base (`hp`, `attack`, `defense`, `special-attack`, `special-defense`, `speed`), para a altura e para o peso.
5. THE tabela de Especie_Pokemon SHALL conter uma coluna booleana obrigatória, com padrão falso, que indique se a espécie pertence ao conjunto de Especies_Permitidas.
6. THE tabela de Especie_Pokemon SHALL preservar os metadados originais da PokéAPI em uma coluna estruturada, de modo que o conteúdo lido corresponda à ficha original do Catalogo sem perda.

### Requirement 7: Tabela de habilidades

**User Story:** Como desenvolvedor do PFL, quero uma tabela de habilidades, para que cada atleta possa referenciar uma habilidade válida do catálogo.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Habilidade com chave primária `ability_id` numérica.
2. THE tabela de Habilidade SHALL conter uma coluna de nome textual da habilidade.
3. THE tabela de Habilidade SHALL conter uma coluna estruturada que preserve os metadados originais da habilidade conforme o Catalogo.

### Requirement 8: Tabela de golpes

**User Story:** Como desenvolvedor do PFL, quero uma tabela de golpes, para que cada atleta possa referenciar quatro golpes válidos do catálogo.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Golpe com chave primária `move_id` numérica.
2. THE tabela de Golpe SHALL conter uma coluna de nome textual do golpe.
3. THE tabela de Golpe SHALL conter uma coluna estruturada que preserve os metadados originais do golpe conforme o Catalogo.

### Requirement 9: Relação Pokémon ↔ golpes aprendíveis

**User Story:** Como desenvolvedor do PFL, quero uma relação entre Pokémon e golpes aprendíveis, para que a elegibilidade de golpes por espécie seja consultável.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Golpe_Aprendivel que associe cada registro a um `pokemon_id` e a um `move_id`.
2. THE tabela de Golpe_Aprendivel SHALL referenciar a tabela de Especie_Pokemon por `pokemon_id` com restrição de chave estrangeira.
3. THE tabela de Golpe_Aprendivel SHALL referenciar a tabela de Golpe por `move_id` com restrição de chave estrangeira.
4. THE tabela de Golpe_Aprendivel SHALL impor unicidade sobre a combinação de `pokemon_id` e `move_id`.
5. THE tabela de Golpe_Aprendivel SHALL preservar os metadados de versão de aprendizado derivados de `official.learnable_moves[].version_details`.

### Requirement 10: Relação Pokémon ↔ habilidades disponíveis

**User Story:** Como desenvolvedor do PFL, quero uma relação entre Pokémon e habilidades disponíveis, para que a elegibilidade de habilidades por espécie seja consultável.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Habilidade_Disponivel que associe cada registro a um `pokemon_id` e a um `ability_id`.
2. THE tabela de Habilidade_Disponivel SHALL referenciar a tabela de Especie_Pokemon por `pokemon_id` com restrição de chave estrangeira.
3. THE tabela de Habilidade_Disponivel SHALL referenciar a tabela de Habilidade por `ability_id` com restrição de chave estrangeira.
4. THE tabela de Habilidade_Disponivel SHALL impor unicidade sobre a combinação de `pokemon_id` e `ability_id`.
5. THE tabela de Habilidade_Disponivel SHALL preservar o indicador de habilidade oculta (`is_hidden`) e o slot derivados de `official.ability_options[]`.

### Requirement 11: Tabela de times do usuário

**User Story:** Como jogador do PFL, quero que meu time seja persistido, para que eu possa recuperá-lo entre sessões.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Time_Usuario com uma chave primária própria.
2. THE tabela de Time_Usuario SHALL conter uma coluna que associe o time a uma conta de usuário.
3. THE tabela de Time_Usuario SHALL conter colunas de identificação do time que incluam um nome textual.

### Requirement 12: Tabela de atletas-instância

**User Story:** Como jogador do PFL, quero que cada atleta do meu roster seja um indivíduo distinto, para que eu possa ter duplicatas de uma mesma espécie com configurações independentes.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma tabela de Atleta_Instancia em que cada registro representa um indivíduo distinto do Roster.
2. THE tabela de Atleta_Instancia SHALL conter uma coluna `instance_id` com restrição de unicidade dentro do escopo de um Time_Usuario.
3. IF uma operação tenta inserir uma Atleta_Instancia com `instance_id` já existente no mesmo Time_Usuario, THEN THE Schema_PFL SHALL rejeitar a operação, preservar o registro existente e sinalizar o erro.
4. THE tabela de Atleta_Instancia SHALL referenciar a tabela de Especie_Pokemon por `pokemon_id` com restrição de chave estrangeira, rejeitando valores inexistentes.
5. THE tabela de Atleta_Instancia SHALL referenciar a tabela de Habilidade por `ability_id` com restrição de chave estrangeira, rejeitando valores inexistentes.
6. THE tabela de Atleta_Instancia SHALL registrar exatamente quatro referências de golpe (`move_id`) por atleta, cada uma com restrição de chave estrangeira para a tabela de Golpe, rejeitando valores inexistentes.
7. IF uma operação atribui a uma Atleta_Instancia um número de golpes diferente de quatro, THEN THE Schema_PFL SHALL rejeitar a operação e sinalizar o erro.
8. IF uma operação atribui a uma Atleta_Instancia quatro golpes que não são todos distintos entre si, THEN THE Schema_PFL SHALL rejeitar a operação e sinalizar o erro.
9. THE tabela de Atleta_Instancia SHALL conter uma coluna `position_designation` textual obrigatória de no máximo 50 caracteres.
10. WHERE um Time_Usuario contém duas Atletas_Instancia com o mesmo `pokemon_id`, THE Schema_PFL SHALL tratar cada Atleta_Instancia como registro independente que ocupa uma vaga separada do Roster.

### Requirement 13: Limite de roster

**User Story:** Como jogador do PFL, quero que o roster respeite o limite de 53 atletas, para que a composição do time siga a regra do jogo.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir o Roster_Cap com valor máximo inclusivo de 53 Atletas_Instancia por Time_Usuario.
2. IF uma operação resultaria em um Roster com mais de 53 Atletas_Instancia para um mesmo Time_Usuario, THEN THE Schema_PFL SHALL rejeitar a operação, preservar o estado anterior do Roster e sinalizar o erro.
3. WHILE um Time_Usuario possui exatamente 53 Atletas_Instancia, THE Schema_PFL SHALL rejeitar qualquer nova inserção de Atleta_Instancia nesse Time_Usuario.

### Requirement 14: Tabelas de escalação

**User Story:** Como jogador do PFL, quero escalações separadas de ataque, defesa e special teams, para que eu organize meu time por unidade de jogo.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma estrutura de Escalacao que associe Atletas_Instancia a papéis de ataque, de defesa e das seis Unidades_Special_Teams de um Time_Usuario.
2. THE estrutura de Escalacao SHALL referenciar a Atleta_Instancia escalada por chave estrangeira.
3. THE estrutura de Escalacao SHALL registrar o papel atribuído a cada Atleta_Instancia dentro de sua unidade.
4. THE estrutura de Escalacao SHALL suportar 11 papéis para a unidade de ataque, 11 papéis para a unidade de defesa e 11 papéis para cada uma das seis Unidades_Special_Teams.

### Requirement 15: Tabela de estratégia

**User Story:** Como jogador do PFL, quero que as escolhas de estratégia do meu time sejam persistidas, para que o motor de simulação possa consumi-las posteriormente.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma estrutura de Estrategia associada a um Time_Usuario por chave estrangeira.
2. THE estrutura de Estrategia SHALL armazenar os identificadores das jogadas de ataque selecionadas.
3. THE estrutura de Estrategia SHALL armazenar os identificadores das jogadas de defesa selecionadas.
4. THE estrutura de Estrategia SHALL armazenar os identificadores das rotinas de special teams selecionadas.

### Requirement 16: Persistência de seeds de time exportáveis

**User Story:** Como jogador do PFL, quero que seeds de time no formato `.pflseed.json` sejam suportados pelo schema, para que times possam ser exportados e importados de forma interoperável.

#### Acceptance Criteria

1. THE Schema_PFL SHALL definir uma estrutura de Seed_Time que armazene o documento serializado no formato `.pflseed.json` junto a um identificador de versão de schema não vazio para validação de compatibilidade.
2. THE estrutura de Seed_Time SHALL preservar, de forma não vazia, os campos `schema`, `ruleset`, `athletes`, `lineups`, `special_teams_full_units`, `strategy` e o campo de checksum do documento de seed.
3. THE estrutura de Seed_Time SHALL armazenar o Checksum_Seed calculado sobre o conteúdo serializado de modo que a recomputação determinística produza o mesmo valor.
4. WHEN um Seed_Time é persistido, THE Schema_PFL SHALL manter o documento sem incluir aleatoriedade de partida, logs, vencedores ou resultados.
5. IF um Seed_Time a ser importado contém campos de aleatoriedade de partida, logs, vencedores ou resultados, THEN THE Schema_PFL SHALL rejeitar a importação, preservar o estado anterior e sinalizar o erro.
6. IF o Checksum_Seed recomputado de um Seed_Time a ser importado não corresponde ao checksum armazenado no documento, THEN THE Schema_PFL SHALL rejeitar a importação por falha de integridade, preservar o estado anterior e sinalizar o erro.
