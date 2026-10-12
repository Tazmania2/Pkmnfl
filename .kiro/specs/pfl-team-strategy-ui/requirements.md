# Requirements Document

## Introduction

A spec **pfl-team-strategy-ui** é a quarta das cinco specs do projeto PFL (Pokémon Football League), um webapp em Next.js (React + TypeScript) implantado na Vercel sobre Supabase. Esta spec implementa **duas das quatro telas funcionais do jogo** — **Meu Time** e **Estratégia** — mais a lógica de **exportação e importação de seed de time** no formato `.pflseed.json`.

A tela Meu Time permite montar o roster de até 53 indivíduos a partir de um preset ou do zero, atribuir posições, alternar entre as unidades de Ataque, Defesa e Especiais, e configurar a ficha de cada atleta (1 habilidade + 4 golpes) com validação inline honesta. A tela Estratégia permite escolher estilo de ataque e de defesa e priorizar seis jogadas por lado, sem desenhador de jogadas. A exportação e a importação de seed garantem a interoperabilidade de times com integridade verificável por checksum.

Esta spec **consome** o schema definido em `pfl-foundation` (tabelas `user_teams`/Time_Usuario, `athletes`/Atleta_Instancia, `athlete_moves`, `lineups`/Escalacao, `strategy`/Estrategia, `team_seeds`/Seed_Time) e a **camada de leitura** entregue em `pfl-data-catalog` (`lib/data/`: `getAllowedSpecies`, `getLearnableMoveIds`, `getAvailableAbilities`, `getMove`, `getAbility`). Nenhuma leitura de catálogo nesta spec acessa fontes externas em tempo de execução; toda elegibilidade vem da Camada_Leitura.

Estão **fora do escopo** desta spec: as telas Game Day e Resultado (spec 5) e o motor de simulação de partidas (spec 3). Esta spec não simula partidas, não gera resultados e não produz aleatoriedade de jogo.

As fontes autoritativas são o documento `GDD_MESTRE.md` (seções 3, 6, 7 e 9), os quatro presets (`PRESET_BALANCED.json`, `PRESET_GROUND.json`, `PRESET_AERIAL.json`, `PRESET_CURTI.json`), o seed de referência `SEED_CURTI_REFERENCE.pflseed.json`, o documento `ANATOMY_DECISIONS_FINAL.md` e os critérios de `CRITERIOS_ACEITE.md`. Em caso de conflito, o `GDD_MESTRE.md` prevalece.

**Resolução de inconsistência de identificadores de jogadas:** o GDD apresenta, na seção 4, uma lista de identificadores de jogadas que diverge dos identificadores usados nos arquivos de preset e no seed de referência (por exemplo, `O_PASS_INTERMEDIATE` nos presets versus `O_PASS_MEDIUM` no texto da seção 4; `D_RUN_FIT`/`D_EDGE_CONTAIN`/`D_RUSH`/`D_CONTAIN_QB` nos presets versus `D_ZONE`/`D_MAN`/`D_BLITZ`/`D_QB_SPY` no texto). Para esta spec e todas as demais, os identificadores autoritativos são os dos arquivos de preset (`PRESET_*.json`), do seed de referência (`SEED_CURTI_REFERENCE.pflseed.json`) e do catálogo de jogadas (`play_catalog_18.json`): seis jogadas de ataque (`O_RUN_INSIDE`, `O_RUN_OUTSIDE`, `O_PASS_SHORT`, `O_PASS_INTERMEDIATE`, `O_PASS_DEEP`, `O_PLAY_ACTION`) e seis de defesa (`D_RUN_FIT`, `D_EDGE_CONTAIN`, `D_ZONE`, `D_MAN`, `D_RUSH`, `D_CONTAIN_QB`).

## Glossary

- **PFL**: Pokémon Football League, o webapp alvo deste projeto.
- **App_PFL**: a aplicação Next.js (React + TypeScript) que renderiza as telas e executa a lógica desta spec.
- **Camada_Leitura**: o conjunto de funções de acesso a dados entregue em `pfl-data-catalog` (`getAllowedSpecies`, `getLearnableMoveIds`, `getAvailableAbilities`, `getMove`, `getAbility`), única fonte de catálogo e elegibilidade usada por esta spec.
- **Especies_Permitidas**: o conjunto de 146 espécies admitidas no MVP, retornado por `getAllowedSpecies`, correspondente aos `pokemon_id` de 1 a 151 exceto 144, 145, 146, 150 e 151.
- **Tela_Meu_Time**: a interface de montagem de roster, atribuição de posições e configuração de atletas.
- **Tela_Estrategia**: a interface de seleção de estilo e priorização de jogadas de ataque e de defesa.
- **Roster**: o conjunto de Atletas_Instancia pertencentes ao Time_Usuario do jogador.
- **Roster_Cap**: o limite máximo inclusivo de 53 Atletas_Instancia por Roster.
- **Atleta_Instancia**: um indivíduo distinto do Roster, identificado por `instance_id`, associado a um `pokemon_id`, um `ability_id`, exatamente quatro `move_id` distintos e uma `position_designation`.
- **Ficha_Atleta**: o painel que exibe e edita a configuração de uma Atleta_Instancia: uma habilidade e quatro golpes.
- **Unidade**: uma formação de jogo composta por 11 papéis; as unidades são Ataque, Defesa e as seis Unidades_Special_Teams.
- **Unidade_Special_Teams**: uma das seis unidades de equipes especiais, cada uma com 11 papéis, atribuídas automaticamente conforme a situação, sem interface de edição de jogadas.
- **Snap**: uma jogada individual em que uma Unidade de 11 identidades distintas está em campo.
- **Preset**: uma das quatro composições completas pré-definidas, identificada por `preset_id`: `balanced` (Equilibrado Kanto), `ground` (Trincheira de Kanto), `aerial` (Domínio Aéreo) e `curti` (Time do Curti).
- **Preset_Curti**: o Preset `curti`, cujos 22 titulares (espécies e posições) são reconstruídos da fonte histórica do vídeo e cujas habilidades, golpes, equipes especiais e estratégias são atribuições PFL.
- **Dica_Posicional**: um texto específico por par (espécie, posição) exibido na atribuição de posição, de caráter orientador e sem proibição arbitrária.
- **Aviso_Validacao**: uma mensagem inline, imediata, específica e legível que sinaliza uma seleção inválida na Ficha_Atleta ou na escalação.
- **Efeito_Inerte**: um golpe ou habilidade que pode ser equipado mas cujo efeito esportivo ainda não possui regra executável aprovada, exibido com aviso de que não produz bônus.
- **Aviso_Anatomico**: um aviso exibido quando a função esportiva essencial de uma posição não puder ser cumprida fisicamente por uma espécie, conforme as convenções de `ANATOMY_DECISIONS_FINAL.md`.
- **Jogada_Ataque**: uma das seis jogadas ofensivas disponíveis para seleção e priorização.
- **Jogada_Defesa**: uma das seis jogadas defensivas disponíveis para seleção e priorização.
- **Estilo_Ataque**: o estilo ofensivo selecionado que condiciona a priorização das Jogadas_Ataque.
- **Estilo_Defesa**: o estilo defensivo selecionado que condiciona a priorização das Jogadas_Defesa.
- **Estrategia_Time**: o conjunto persistido de Estilo_Ataque, Estilo_Defesa e prioridades de jogadas de um Time_Usuario.
- **Seed_Time**: o documento `.pflseed.json` que serializa o Time_Usuario de forma interoperável, com os campos `schema`, `ruleset`, `athletes`, `lineups`, `special_teams_full_units`, `strategy` e `checksum_sha256`.
- **Checksum_Seed**: o valor SHA-256 calculado sobre o JSON do Seed_Time sem o campo `checksum_sha256`, com chaves ordenadas, codificação UTF-8 e separadores `','` e `':'`.
- **Importacao_Seed**: o fluxo que lê um arquivo `.pflseed.json`, valida seu conteúdo e, quando aprovado, carrega o Time_Usuario correspondente.
- **Exportacao_Seed**: o fluxo que serializa o Time_Usuario corrente em um arquivo `.pflseed.json` com checksum calculado.
- **Round_Trip**: o ciclo de exportar um Time_Usuario e reimportá-lo, preservando atletas, atribuições, golpes, habilidades e estratégia.
- **Anti_Slop**: o conjunto de regras de qualidade de UI do projeto que exige interface honesta, acessível e livre de conteúdo genérico de IA ou números inventados.

## Requirements

### Requirement 1: Ponto de partida da montagem do time

**User Story:** Como jogador do PFL, quero iniciar meu time a partir de um preset ou do zero, para que eu possa escolher entre uma base pronta e uma montagem manual.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL apresentar um controle rotulado para usar um Preset e um controle rotulado para começar do zero.
2. WHEN o jogador aciona o controle de começar do zero, THE Tela_Meu_Time SHALL apresentar um Roster vazio sem Atletas_Instancia.
3. WHEN o jogador aciona o controle de usar um Preset e seleciona um dos quatro `preset_id` (`balanced`, `ground`, `aerial`, `curti`), THE Tela_Meu_Time SHALL carregar no Roster as Atletas_Instancia definidas por aquele Preset.
4. WHEN um Preset é carregado no Roster, THE Tela_Meu_Time SHALL permitir salvar o Time_Usuario sem exigir qualquer ajuste adicional ao Preset.
5. WHEN um Preset é carregado no Roster, THE Tela_Meu_Time SHALL permitir editar qualquer Atleta_Instancia, posição ou estratégia resultante sem alterar a definição original do Preset de origem.

### Requirement 2: Grade do roster até o limite de 53

**User Story:** Como jogador do PFL, quero visualizar meu roster em uma grade simples de até 53 indivíduos, para que eu acompanhe a composição do time.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL exibir o Roster como uma grade ou lista em que cada Atleta_Instancia ocupa um item distinto.
2. WHERE o Roster contém duas ou mais Atletas_Instancia com o mesmo `pokemon_id`, THE Tela_Meu_Time SHALL exibir cada Atleta_Instancia como um item distinto que ocupa uma vaga separada do Roster.
3. THE Tela_Meu_Time SHALL exibir a contagem atual de Atletas_Instancia do Roster em relação ao Roster_Cap de 53.
4. IF o jogador tenta adicionar uma Atleta_Instancia a um Roster que já contém 53 Atletas_Instancia, THEN THE Tela_Meu_Time SHALL recusar a adição, preservar o Roster existente e exibir um Aviso_Validacao de que o limite de 53 foi atingido.
5. THE Tela_Meu_Time SHALL restringir a seleção de espécies para novas Atletas_Instancia às Especies_Permitidas retornadas por `getAllowedSpecies`.
6. IF o jogador tenta adicionar uma Atleta_Instancia de uma espécie fora das Especies_Permitidas, THEN THE Tela_Meu_Time SHALL recusar a adição e exibir um Aviso_Validacao que identifique a espécie como não permitida.

### Requirement 3: Alternância entre unidades Ataque, Defesa e Especiais

**User Story:** Como jogador do PFL, quero alternar entre Ataque, Defesa e Especiais, para que eu organize o time por unidade de jogo.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL apresentar um seletor que alterna a visualização entre a unidade de Ataque, a unidade de Defesa e as Unidades_Special_Teams.
2. WHEN o jogador seleciona a unidade de Ataque, THE Tela_Meu_Time SHALL exibir os 11 papéis da unidade de Ataque e as Atletas_Instancia atribuídas a cada papel.
3. WHEN o jogador seleciona a unidade de Defesa, THE Tela_Meu_Time SHALL exibir os 11 papéis da unidade de Defesa e as Atletas_Instancia atribuídas a cada papel.
4. WHEN o jogador seleciona a visualização de Especiais, THE Tela_Meu_Time SHALL exibir as seis Unidades_Special_Teams e as Atletas_Instancia atribuídas aos papéis de cada unidade.

### Requirement 4: Atribuição de posição por arrastar ou por seletor

**User Story:** Como jogador do PFL, quero atribuir a posição de cada atleta arrastando ou escolhendo em um seletor, para que eu monte a escalação do modo que preferir.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL permitir atribuir uma Atleta_Instancia a um papel de uma Unidade por meio de arrastar o item do Roster até o papel.
2. THE Tela_Meu_Time SHALL permitir atribuir uma Atleta_Instancia a um papel de uma Unidade por meio de um seletor de posição alternativo ao arrastar.
3. WHEN o jogador conclui uma atribuição de posição válida, THE Tela_Meu_Time SHALL registrar a `position_designation` da Atleta_Instancia e refletir a atribuição na Unidade correspondente.
4. THE Tela_Meu_Time SHALL permitir atribuir qualquer Especie_Permitida a qualquer papel, sem impor proibição arbitrária de espécie por posição.

### Requirement 5: Dica posicional específica por espécie e posição

**User Story:** Como jogador do PFL, quero receber uma dica textual específica ao posicionar um atleta, para que eu entenda a adequação da espécie à posição sem ser bloqueado.

#### Acceptance Criteria

1. WHEN o jogador inicia a atribuição de uma Atleta_Instancia a um papel, THE Tela_Meu_Time SHALL exibir uma Dica_Posicional específica para o par (espécie da Atleta_Instancia, posição do papel).
2. THE Dica_Posicional SHALL ter caráter orientador e SHALL permitir que a atribuição prossiga mesmo quando a dica indica baixa adequação.
3. IF a função esportiva essencial da posição não puder ser cumprida fisicamente pela espécie conforme as convenções de `ANATOMY_DECISIONS_FINAL.md`, THEN THE Tela_Meu_Time SHALL exibir um Aviso_Anatomico que identifique a limitação e permita que o jogador decida manter ou alterar a atribuição.

### Requirement 6: Ficha do atleta com uma habilidade e quatro golpes

**User Story:** Como jogador do PFL, quero abrir a ficha de um atleta para configurar sua habilidade e seus quatro golpes, para que cada indivíduo tenha um loadout próprio.

#### Acceptance Criteria

1. WHEN o jogador seleciona uma Atleta_Instancia no Roster, THE Tela_Meu_Time SHALL abrir a Ficha_Atleta exibindo uma habilidade e quatro golpes dessa Atleta_Instancia.
2. THE Ficha_Atleta SHALL apresentar como habilidades selecionáveis apenas as retornadas por `getAvailableAbilities` para o `pokemon_id` da Atleta_Instancia.
3. THE Ficha_Atleta SHALL apresentar como golpes selecionáveis apenas os retornados por `getLearnableMoveIds` para o `pokemon_id` da Atleta_Instancia.
4. WHEN o jogador salva a Ficha_Atleta, THE Ficha_Atleta SHALL registrar exatamente uma habilidade e exatamente quatro golpes distintos para a Atleta_Instancia.

### Requirement 7: Validação inline imediata na ficha do atleta

**User Story:** Como jogador do PFL, quero avisos imediatos de seleção inválida na ficha, para que eu corrija erros de loadout antes de salvar.

#### Acceptance Criteria

1. WHEN o jogador seleciona para uma Atleta_Instancia um golpe não aprendível pela espécie segundo `getLearnableMoveIds`, THE Ficha_Atleta SHALL exibir, em até 500 ms após a seleção, um Aviso_Validacao que identifique pelo nome o golpe selecionado e informe que ele não é aprendível pela espécie.
2. WHEN o jogador seleciona para uma Atleta_Instancia uma habilidade não disponível para a espécie segundo `getAvailableAbilities`, THE Ficha_Atleta SHALL exibir, em até 500 ms após a seleção, um Aviso_Validacao que identifique pelo nome a habilidade selecionada e informe que ela não está disponível para a espécie.
3. IF a Ficha_Atleta contém um número de golpes selecionados diferente de quatro, THEN THE Ficha_Atleta SHALL exibir, em até 500 ms após a alteração, um Aviso_Validacao que informe que são exigidos exatamente quatro golpes e indique a quantidade atual de golpes selecionados.
4. IF a Ficha_Atleta contém dois ou mais golpes iguais entre os quatro selecionados, THEN THE Ficha_Atleta SHALL exibir, em até 500 ms após a alteração, um Aviso_Validacao que identifique pelo nome o golpe repetido e informe que os quatro golpes devem ser distintos.
5. WHEN o jogador corrige a seleção que originou um Aviso_Validacao de forma que a condição de invalidez correspondente deixe de ser satisfeita, THE Ficha_Atleta SHALL remover esse Aviso_Validacao em até 500 ms após a correção.
6. WHILE a Ficha_Atleta apresenta ao menos um Aviso_Validacao ativo, THE Ficha_Atleta SHALL recusar o salvamento da configuração da Atleta_Instancia, preservar o estado anterior persistido e indicar ao jogador quais itens precisam de correção.

### Requirement 8: Avisos de efeito inerte e de limitação anatômica

**User Story:** Como jogador do PFL, quero ser avisado quando um efeito fica inerte ou uma função não pode ser cumprida fisicamente, para que eu não conte com bônus inexistentes.

#### Acceptance Criteria

1. WHERE um golpe ou habilidade selecionado é um Efeito_Inerte, THE Ficha_Atleta SHALL permitir equipar o efeito e SHALL exibir um aviso de que o efeito não produz bônus esportivo.
2. THE Ficha_Atleta SHALL preservar as capacidades anatômicas, atributos e deslocamentos naturais da espécie como ativos mesmo quando um efeito está marcado como Efeito_Inerte.
3. WHEN a Ficha_Atleta exibe um aviso de Efeito_Inerte, THE Ficha_Atleta SHALL apresentar o aviso de forma visível ao jogador antes do salvamento, sem aplicar o efeito silenciosamente.

### Requirement 9: Salvar o time

**User Story:** Como jogador do PFL, quero salvar o time montado, para que a composição e as atribuições persistam entre sessões.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL apresentar um controle rotulado de salvar.
2. WHEN o jogador aciona o controle de salvar com um Roster válido, THE App_PFL SHALL persistir no Time_Usuario as Atletas_Instancia, suas habilidades, seus quatro golpes, suas posições e as escalações.
3. IF o jogador aciona o controle de salvar enquanto existe ao menos um Aviso_Validacao ativo no Roster ou na escalação, THEN THE Tela_Meu_Time SHALL recusar o salvamento, preservar o estado anterior persistido e indicar quais itens precisam de correção.
4. WHEN o salvamento é concluído com sucesso, THE Tela_Meu_Time SHALL confirmar ao jogador que o Time_Usuario foi salvo.

### Requirement 10: Presets copiáveis e fidelidade do Time do Curti

**User Story:** Como jogador do PFL, quero copiar e alterar os quatro presets, com o Time do Curti fiel à fonte, para que eu use bases competentes e reconheça o que é atribuição PFL.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL disponibilizar os quatro Presets `balanced`, `ground`, `aerial` e `curti` para carga no Roster.
2. WHEN o jogador carrega e altera um Preset, THE Tela_Meu_Time SHALL aplicar as alterações apenas ao Time_Usuario corrente, mantendo inalterada a definição original do Preset.
3. THE Preset_Curti SHALL preservar as 22 Atletas_Instancia titulares (11 de Ataque e 11 de Defesa) com as espécies e posições reconstruídas da fonte histórica do vídeo.
4. THE Tela_Meu_Time SHALL identificar que as habilidades, os golpes, as equipes especiais e as estratégias do Preset_Curti são atribuições de design PFL e não escolhas atribuídas ao Curti.

### Requirement 11: Seleção de estilo de ataque e de defesa

**User Story:** Como jogador do PFL, quero escolher um estilo de ataque e um de defesa, para que a estratégia do time reflita minha intenção tática.

#### Acceptance Criteria

1. THE Tela_Estrategia SHALL apresentar um seletor de Estilo_Ataque e um seletor de Estilo_Defesa.
2. WHEN o jogador seleciona um Estilo_Ataque, THE Tela_Estrategia SHALL registrar o estilo selecionado na Estrategia_Time.
3. WHEN o jogador seleciona um Estilo_Defesa, THE Tela_Estrategia SHALL registrar o estilo selecionado na Estrategia_Time.
4. WHEN um Preset é carregado, THE Tela_Estrategia SHALL predefinir o Estilo_Ataque e o Estilo_Defesa conforme a estratégia do Preset.

### Requirement 12: Seis jogadas por lado com priorização simples

**User Story:** Como jogador do PFL, quero priorizar seis jogadas de ataque e seis de defesa, para que o motor saiba minhas preferências táticas.

#### Acceptance Criteria

1. THE Tela_Estrategia SHALL apresentar seis Jogadas_Ataque disponíveis para o lado ofensivo.
2. THE Tela_Estrategia SHALL apresentar seis Jogadas_Defesa disponíveis para o lado defensivo.
3. THE Tela_Estrategia SHALL permitir ao jogador definir uma priorização entre as seis Jogadas_Ataque e entre as seis Jogadas_Defesa.
4. WHEN o jogador altera a priorização de jogadas, THE Tela_Estrategia SHALL registrar as prioridades resultantes na Estrategia_Time.
5. THE Tela_Estrategia SHALL excluir qualquer funcionalidade de desenhador de jogadas.
6. THE Tela_Estrategia SHALL tratar as Unidades_Special_Teams como automáticas por situação, sem expor interface de edição de jogadas de equipes especiais.

### Requirement 13: Escalação de 11 identidades por unidade e seis unidades especiais

**User Story:** Como jogador do PFL, quero que cada unidade em campo tenha 11 identidades únicas, para que a escalação respeite as regras do jogo.

#### Acceptance Criteria

1. THE App_PFL SHALL exigir 11 papéis preenchidos para a unidade de Ataque, 11 para a unidade de Defesa e 11 para cada uma das seis Unidades_Special_Teams.
2. THE App_PFL SHALL exigir que as 11 Atletas_Instancia atribuídas a uma mesma Unidade em um Snap sejam identidades distintas.
3. WHERE uma mesma Atleta_Instancia é atribuída a Unidades diferentes, THE App_PFL SHALL permitir a atribuição, desde que a Atleta_Instancia não ocupe dois papéis no mesmo Snap.
4. IF uma Unidade possui menos de 11 identidades distintas atribuídas, THEN THE App_PFL SHALL exibir um Aviso_Validacao que identifique a Unidade incompleta e os papéis pendentes.
5. IF a mesma Atleta_Instancia é atribuída a dois papéis da mesma Unidade, THEN THE App_PFL SHALL recusar a segunda atribuição e exibir um Aviso_Validacao de identidade duplicada no mesmo Snap.

### Requirement 14: Exportação de seed de time

**User Story:** Como jogador do PFL, quero exportar meu time como `.pflseed.json`, para que eu compartilhe o time de forma interoperável e verificável.

#### Acceptance Criteria

1. THE Tela_Meu_Time SHALL apresentar um controle rotulado de exportar seed.
2. WHEN o jogador aciona a Exportacao_Seed de um Time_Usuario válido, THE App_PFL SHALL gerar um documento `.pflseed.json` contendo os campos `schema`, `ruleset`, `athletes`, `lineups`, `special_teams_full_units`, `strategy` e `checksum_sha256`.
3. THE Exportacao_Seed SHALL registrar, para cada Atleta_Instancia, o `instance_id`, o `pokemon_id`, o `ability_id` e exatamente quatro `move_id` distintos.
4. THE Exportacao_Seed SHALL calcular o `checksum_sha256` como o SHA-256 do JSON do Seed_Time sem o campo `checksum_sha256`, serializado com chaves ordenadas, codificação UTF-8 e separadores `','` e `':'`.
5. THE Exportacao_Seed SHALL omitir do Seed_Time qualquer aleatoriedade de partida, log, vencedor ou resultado.

### Requirement 15: Importação e validação de seed de time

**User Story:** Como jogador do PFL, quero importar um `.pflseed.json` com validação completa, para que apenas times íntegros e compatíveis sejam carregados.

#### Acceptance Criteria

1. THE Importacao_Seed SHALL recusar um arquivo cujo tamanho exceda 5.242.880 bytes (5 MB) e exibir um Aviso_Validacao de arquivo grande demais, identificando o tamanho recebido e o limite máximo permitido.
2. THE Importacao_Seed SHALL recusar um Seed_Time cujo identificador de versão de `schema` seja incompatível com a versão suportada pelo App_PFL e exibir um Aviso_Validacao de incompatibilidade de versão, identificando a versão recebida e a versão suportada.
3. THE Importacao_Seed SHALL recusar um Seed_Time que contenha mais de 53 Atletas_Instancia e exibir um Aviso_Validacao de limite de roster excedido, identificando a contagem recebida e o limite de 53.
4. THE Importacao_Seed SHALL recusar um Seed_Time cujo `pokemon_id`, `ability_id` ou `move_id` não exista no catálogo ou não pertença às Especies_Permitidas, identificando a referência inválida.
5. THE Importacao_Seed SHALL recusar uma Atleta_Instancia cujos quatro `move_id` não sejam distintos ou não sejam todos aprendíveis pela espécie segundo `getLearnableMoveIds`, identificando o atleta e o golpe inválido.
6. THE Importacao_Seed SHALL recusar uma Atleta_Instancia cujo `ability_id` não esteja disponível para a espécie segundo `getAvailableAbilities`, identificando o atleta.
7. THE Importacao_Seed SHALL recusar um Seed_Time cuja escalação não atribua 11 identidades distintas por Unidade em cada Snap, identificando a Unidade inválida.
8. IF o Checksum_Seed recomputado de um Seed_Time importado não corresponde ao `checksum_sha256` do documento, THEN THE Importacao_Seed SHALL recusar a importação por falha de integridade e exibir um Aviso_Validacao de adulteração.
9. IF um Seed_Time importado contém aleatoriedade de partida, logs, vencedores ou resultados, THEN THE Importacao_Seed SHALL recusar a importação e exibir um Aviso_Validacao de conteúdo não permitido.
10. WHEN um Seed_Time é aprovado em todas as validações, THE Importacao_Seed SHALL carregar o Time_Usuario correspondente com todos os atletas, atribuições, golpes, habilidades e estratégia preservados sem alteração em relação ao documento importado.
11. IF a Importacao_Seed recusa um Seed_Time por qualquer motivo, THEN THE Importacao_Seed SHALL preservar o Time_Usuario corrente inalterado e apresentar uma mensagem legível identificando o motivo específico da recusa.
12. IF o arquivo importado não puder ser interpretado como JSON válido, THEN THE Importacao_Seed SHALL recusar a importação e exibir um Aviso_Validacao de arquivo ilegível, preservando o Time_Usuario corrente inalterado.
13. IF um Seed_Time importado não contém todos os campos obrigatórios definidos pelo `schema` suportado, THEN THE Importacao_Seed SHALL recusar a importação e exibir um Aviso_Validacao de estrutura incompleta, identificando o campo obrigatório ausente.

### Requirement 16: Round-trip de exportação e importação

**User Story:** Como jogador do PFL, quero que exportar e reimportar meu time preserve exatamente sua configuração, para que a interoperabilidade seja confiável.

#### Acceptance Criteria

1. WHEN um Time_Usuario válido é exportado pela Exportacao_Seed e o Seed_Time resultante é carregado pela Importacao_Seed, THE App_PFL SHALL reconstituir um Time_Usuario com as mesmas Atletas_Instancia, as mesmas habilidades, os mesmos quatro golpes por atleta e as mesmas posições do Time_Usuario de origem.
2. WHEN um Time_Usuario válido passa por Round_Trip, THE App_PFL SHALL reconstituir a mesma Estrategia_Time, incluindo Estilo_Ataque, Estilo_Defesa e prioridades de jogadas.
3. WHEN o Seed_Time exportado é reserializado sem alteração e seu Checksum_Seed é recomputado, THE App_PFL SHALL obter um valor de checksum idêntico ao `checksum_sha256` registrado no documento.

### Requirement 17: Acessibilidade e UI honesta (anti-slop)

**User Story:** Como jogador do PFL, quero uma interface simples, acessível e honesta, para que o uso seja claro, operável por teclado e livre de informação inventada.

#### Acceptance Criteria

1. THE App_PFL SHALL permitir operar todos os controles interativos das telas Meu Time e Estratégia por teclado, numa ordem de navegação que siga a sequência visual dos controles, sem nenhum controle inacessível por teclado.
2. WHILE um controle interativo está focado, THE App_PFL SHALL exibir um indicador de foco visível, distinguível dos estados de erro e de seleção.
3. WHERE a atribuição de posição usa arrastar, THE App_PFL SHALL fornecer, pelo seletor de posição, um meio acessível por teclado que produza o mesmo resultado da atribuição por arrastar.
4. THE App_PFL SHALL apresentar texto legível sobre o seu fundo e SHALL distinguir os estados de foco, erro e seleção entre si e do estado padrão por mais de um recurso visual, não apenas pela cor.
5. THE App_PFL SHALL exibir apenas valores cuja origem seja rastreável à Camada_Leitura ou à configuração do jogador, sem apresentar números ou estatísticas sem origem.
6. THE App_PFL SHALL redigir cada Aviso_Validacao, Dica_Posicional, aviso de Efeito_Inerte e Aviso_Anatomico referenciando explicitamente o item, controle ou condição associado, sem reutilizar o mesmo texto para casos distintos.
7. WHEN um Aviso_Validacao é exibido, THE App_PFL SHALL associá-lo de forma programática ao controle correspondente, de modo que um leitor de tela anuncie o aviso ao focar o controle.
