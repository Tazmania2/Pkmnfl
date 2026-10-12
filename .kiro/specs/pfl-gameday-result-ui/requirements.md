# Requirements Document

## Introduction

A spec **pfl-gameday-result-ui** é a quinta e última das cinco specs do projeto PFL (Pokémon Football League), um webapp em Next.js (React + TypeScript) implantado na Vercel sobre Supabase. Esta spec implementa **as duas telas funcionais restantes do jogo** — **Game Day** e **Resultado** — completando o fluxo de quatro telas (Meu Time → Estratégia → Game Day → Resultado).

A tela Game Day apresenta três modos de adversário em botões grandes, valida o elenco e a seed antes de simular, confirma a simulação com um clique e invoca a função de backend de simulação passando as duas escalações, as duas estratégias e um seed de RNG. Durante e após a simulação, a tela exibe o andamento da partida (placar, período, relógio, down/distância, posse e narrativa por snap) e reproduz uma **animação simples em estilo 8-bit** dos sprites dos Pokémon dos dois times, dirigida pelo log determinístico. A tela Resultado apresenta o placar final, o vencedor ou empate, estatísticas sucintas (corridas, passes, turnovers, faltas), um resumo de eventos (highlights) e botões para voltar ao Game Day ou editar o time.

Esta spec **consome**: o schema de `pfl-foundation`; a **camada de leitura** de `pfl-data-catalog` (`lib/data/`, incluindo `getMove`, `getAbility`, `getAllowedSpecies`, e o acesso a sprites/`raw_data` da PokéAPI); a **validação e a importação de seed** entregues em `pfl-team-strategy-ui` (`lib/validation` e o fluxo de Importacao_Seed); e o **motor de simulação** de `pfl-simulation-engine`, acessado exclusivamente pela `Funcao_Simulacao` (Vercel Function) que recebe duas escalações, duas estratégias e um `Seed_RNG` e retorna um `Log_Partida` determinístico e um `Placar`.

Estão **fora do escopo** desta spec: a lógica interna do motor de simulação (spec 3), a montagem de roster e a seleção de estratégia (spec 4), a definição do schema (spec 1) e a camada de leitura do catálogo (spec 2). Esta spec **não** simula partidas por conta própria, **não** calcula resultados e **não** gera aleatoriedade de jogo; toda resolução vem da `Funcao_Simulacao`, e a animação é uma **representação visual do `Log_Partida` que não altera o resultado**.

As fontes autoritativas são o documento `GDD_MESTRE.md` (seção 3, com apoio das seções 9, 10 e 11), os critérios de `CRITERIOS_ACEITE.md`, e os contratos de entrada/saída definidos em `pfl-simulation-engine`. Em caso de conflito entre documentos, o `GDD_MESTRE.md` prevalece; o requisito do usuário de uma animação 8-bit é complementar ao GDD e não substitui a narrativa textual exigida pelo log.

## Glossary

- **PFL**: Pokémon Football League, o webapp alvo deste projeto.
- **App_PFL**: a aplicação Next.js (React + TypeScript) que renderiza as telas e executa a lógica desta spec no cliente.
- **Camada_Leitura**: o conjunto de funções de acesso a dados entregue em `pfl-data-catalog` (incluindo `getMove`, `getAbility`, `getAllowedSpecies` e o acesso a sprites e `raw_data`), única fonte de catálogo e de sprites usada por esta spec.
- **Lib_Validacao**: a biblioteca de validação de elenco e de seed entregue em `pfl-team-strategy-ui` (`lib/validation` e o fluxo de Importacao_Seed), reutilizada por esta spec antes de simular.
- **Tela_Game_Day**: a interface que apresenta os modos de adversário, valida pré-simulação, confirma e aciona a simulação, exibe o andamento da partida e reproduz a Animacao_8bit.
- **Tela_Resultado**: a interface que apresenta o placar final, o vencedor ou empate, as estatísticas sucintas, os Highlights e os controles de navegação após a Partida.
- **Modo_Adversario**: um dos três modos de oponente oferecidos na Tela_Game_Day: Modo_Bot_Aleatorio, Modo_Desafiar_Curti e Modo_Importar_Seed.
- **Modo_Bot_Aleatorio**: o modo em que o adversário é o Bot aleatório do motor.
- **Modo_Desafiar_Curti**: o modo em que o adversário é o Bot Curti do motor, que usa o preset CURTI.
- **Modo_Importar_Seed**: o modo em que o adversário é o Bot de seed de terceiros do motor, carregado a partir de um `.pflseed.json` importado.
- **Funcao_Simulacao**: a Vercel Function de backend, definida em `pfl-simulation-engine`, que recebe as duas Escalacoes, as duas Estrategias e o Seed_RNG e retorna o Log_Partida e o Placar.
- **Escalacao**: a atribuição de atletas aos papéis das unidades de um time, provida como entrada à Funcao_Simulacao.
- **Estrategia**: o estilo e as prioridades de jogadas de um time, provida como entrada à Funcao_Simulacao.
- **Seed_RNG**: o valor inteiro que inicializa a aleatoriedade de uma Partida, distinto e separado do seed de time, provido como entrada à Funcao_Simulacao.
- **Partida**: uma simulação completa de futebol americano resolvida pela Funcao_Simulacao a partir das Escalacoes, das Estrategias e do Seed_RNG.
- **Log_Partida**: o registro determinístico e ordenado da Partida retornado pela Funcao_Simulacao, incluindo narrativa por Snap, condições, decisões e estatísticas.
- **Placar**: o resultado numérico de pontos de cada time retornado pela Funcao_Simulacao.
- **Snap**: uma jogada individual registrada no Log_Partida.
- **Narrativa_Snap**: o texto descritivo de um Snap presente no Log_Partida, usado como conteúdo textual exibido ao jogador.
- **Clima**: a condição meteorológica da Partida sorteada pelo motor e registrada no Log_Partida; a Tela_Game_Day apenas exibe o Clima, sem sorteá-lo.
- **Animacao_8bit**: a representação visual em estilo 8-bit, exibida na Tela_Game_Day, dos sprites dos Pokémon dos dois times se enfrentando Snap a Snap, dirigida exclusivamente pelo Log_Partida e que não altera o Placar nem o Log_Partida.
- **Sprite_Pokemon**: a imagem de um Pokémon obtida pela Camada_Leitura a partir de sprites/`raw_data` da PokéAPI, usada na Animacao_8bit.
- **Alternativa_Textual**: a Narrativa_Snap do Log_Partida apresentada como equivalente textual acessível da Animacao_8bit.
- **Controle_Pular**: o controle que encerra imediatamente a Animacao_8bit e leva o jogador ao estado final da Partida ou à Tela_Resultado.
- **Controle_Acelerar**: o controle que aumenta a velocidade de reprodução da Animacao_8bit sem alterar o Log_Partida.
- **Highlights**: o resumo de eventos relevantes da Partida derivado do Log_Partida, exibido na Tela_Resultado.
- **Estatisticas_Partida**: as estatísticas sucintas da Partida presentes no Log_Partida: corridas, passes, turnovers e faltas.
- **Efeito_Inerte**: um golpe ou habilidade cujo efeito esportivo não produz bônus no MVP e é sinalizado por aviso no Log_Partida; a Tela_Game_Day e a Tela_Resultado exibem esse aviso conforme o log, sem aplicar bônus silencioso.
- **Estado_Carregamento**: o estado honesto de progresso exibido pela Tela_Game_Day enquanto a Funcao_Simulacao está sendo executada e o Log_Partida ainda não foi recebido.
- **Reproducao_Por_Seed**: a capacidade de, dadas as mesmas Escalacoes, as mesmas Estrategias e o mesmo Seed_RNG, obter da Funcao_Simulacao o mesmo Log_Partida e o mesmo Placar e, consequentemente, a mesma sequência da Animacao_8bit.
- **Anti_Slop**: o conjunto de regras de qualidade de UI do projeto que exige interface honesta, acessível, operável por teclado e livre de conteúdo genérico de IA ou números sem origem.

## Requirements

### Requirement 1: Modos de adversário em botões grandes

**User Story:** Como jogador do PFL, quero escolher o adversário entre três modos apresentados em botões grandes, para que eu inicie uma partida de forma simples e clara.

#### Acceptance Criteria

1. THE Tela_Game_Day SHALL apresentar exatamente três controles grandes e rotulados correspondentes a Modo_Bot_Aleatorio ("Bot aleatório"), Modo_Desafiar_Curti ("Desafiar Curti") e Modo_Importar_Seed ("Importar seed").
2. WHEN o jogador aciona um dos três controles de Modo_Adversario, THE Tela_Game_Day SHALL registrar o Modo_Adversario selecionado para a Partida a ser simulada.
3. THE Tela_Game_Day SHALL exibir qual Modo_Adversario está selecionado antes da confirmação da simulação.

### Requirement 2: Mapeamento dos três modos para os bots do motor

**User Story:** Como jogador do PFL, quero que cada modo de adversário acione o bot correspondente no motor, para que a partida use o oponente que escolhi.

#### Acceptance Criteria

1. WHEN o Modo_Adversario selecionado é Modo_Bot_Aleatorio, THE Tela_Game_Day SHALL invocar a Funcao_Simulacao indicando o Bot aleatório como adversário.
2. WHEN o Modo_Adversario selecionado é Modo_Desafiar_Curti, THE Tela_Game_Day SHALL invocar a Funcao_Simulacao indicando o Bot Curti, baseado no preset CURTI, como adversário.
3. WHEN o Modo_Adversario selecionado é Modo_Importar_Seed, THE Tela_Game_Day SHALL invocar a Funcao_Simulacao indicando o Bot de seed de terceiros, usando a Escalacao e a Estrategia carregadas da seed importada, como adversário.
4. THE Tela_Game_Day SHALL restringir a seleção de adversário aos três Modos_Adversario suportados, sem oferecer modos fora de Modo_Bot_Aleatorio, Modo_Desafiar_Curti e Modo_Importar_Seed.

### Requirement 3: Importação da seed do adversário no modo Importar seed

**User Story:** Como jogador do PFL, quero importar uma seed de terceiros como adversário com validação completa, para que apenas times íntegros e compatíveis entrem na partida.

#### Acceptance Criteria

1. WHEN o jogador aciona Modo_Importar_Seed, THE Tela_Game_Day SHALL solicitar um arquivo `.pflseed.json` e submetê-lo ao fluxo de Importacao_Seed da Lib_Validacao.
2. IF a Importacao_Seed recusa o arquivo de seed do adversário por qualquer motivo, THEN THE Tela_Game_Day SHALL impedir a simulação, preservar o estado corrente da tela e exibir uma mensagem legível identificando o motivo específico da recusa.
3. WHEN a Importacao_Seed aprova o arquivo de seed do adversário, THE Tela_Game_Day SHALL usar a Escalacao e a Estrategia da seed aprovada como entrada do adversário para a Funcao_Simulacao.
4. THE Tela_Game_Day SHALL tratar a seed do adversário importada como elenco e estratégia apenas, sem executar qualquer código contido no arquivo.

### Requirement 4: Validação de elenco e seed antes de simular

**User Story:** Como jogador do PFL, quero que o elenco e a seed sejam validados antes da simulação, para que apenas partidas com entradas válidas sejam iniciadas.

#### Acceptance Criteria

1. WHEN o jogador aciona o controle de confirmação de simulação, THE Tela_Game_Day SHALL validar a Escalacao e a Estrategia do time do jogador pela Lib_Validacao e aguardar o resultado da validação antes de invocar a Funcao_Simulacao.
2. WHEN o jogador aciona o controle de confirmação de simulação e o Modo_Adversario é Modo_Importar_Seed, THE Tela_Game_Day SHALL validar a seed do adversário pelo fluxo de Importacao_Seed e aguardar o resultado antes de invocar a Funcao_Simulacao.
3. IF a validação de elenco do jogador identifica uma unidade com menos de 11 identidades distintas, um atleta sem exatamente 1 habilidade e exatamente 4 golpes distintos elegíveis, ou qualquer outra condição recusada pela Lib_Validacao, THEN THE Tela_Game_Day SHALL impedir a simulação, preservar a Escalacao e a Estrategia inalteradas e exibir um aviso legível identificando o item inválido e o motivo da recusa.
4. IF a validação da seed do adversário no Modo_Importar_Seed é recusada pela Importacao_Seed, THEN THE Tela_Game_Day SHALL impedir a simulação, preservar o estado corrente da tela e exibir um aviso legível identificando o motivo da recusa.
5. WHILE existe ao menos uma condição de validação de elenco ou de seed pendente ou recusada, THE Tela_Game_Day SHALL manter o controle de confirmação de simulação indisponível para acionamento.

### Requirement 5: Confirmação da simulação com um clique

**User Story:** Como jogador do PFL, quero confirmar a simulação com um único clique após a validação, para que iniciar a partida seja direto.

#### Acceptance Criteria

1. WHERE a validação de elenco e de seed foi aprovada e um Modo_Adversario está selecionado, THE Tela_Game_Day SHALL apresentar um único controle de confirmação de simulação habilitado.
2. WHEN o jogador aciona o controle de confirmação de simulação, THE Tela_Game_Day SHALL invocar a Funcao_Simulacao uma única vez para a Partida corrente.
3. WHILE uma invocação da Funcao_Simulacao está em andamento, THE Tela_Game_Day SHALL impedir o acionamento repetido do controle de confirmação para a mesma Partida.

### Requirement 6: Invocação da função de simulação com seed de RNG

**User Story:** Como jogador do PFL, quero que a tela envie as escalações, as estratégias e um seed ao motor, para que a partida seja resolvida pelo backend determinístico.

#### Acceptance Criteria

1. WHEN a simulação é confirmada, THE Tela_Game_Day SHALL invocar a Funcao_Simulacao fornecendo a Escalacao do jogador, a Escalacao do adversário, a Estrategia do jogador, a Estrategia do adversário e um Seed_RNG.
2. THE Tela_Game_Day SHALL fornecer o Seed_RNG como entrada distinta e separada de qualquer seed de time, sem derivar um do outro.
3. WHEN a Funcao_Simulacao conclui com sucesso, THE Tela_Game_Day SHALL receber e reter o Log_Partida e o Placar retornados.
4. THE Tela_Game_Day SHALL obter o Placar e todos os valores de andamento da Partida exclusivamente do Log_Partida e do Placar retornados pela Funcao_Simulacao, sem calcular resultado próprio.
5. IF a Funcao_Simulacao retorna um erro de entrada inválida ou incompleta, THEN THE Tela_Game_Day SHALL exibir o motivo descritivo do erro e não iniciar a Animacao_8bit nem navegar para a Tela_Resultado.

### Requirement 7: Estados de carregamento honestos durante a simulação

**User Story:** Como jogador do PFL, quero ver um estado de carregamento honesto enquanto a partida é simulada, para que eu saiba que o sistema está processando e não travado.

#### Acceptance Criteria

1. WHILE a Funcao_Simulacao está sendo executada e o Log_Partida ainda não foi recebido, THE Tela_Game_Day SHALL exibir um Estado_Carregamento que indique que a Partida está sendo simulada.
2. WHEN o Log_Partida é recebido, THE Tela_Game_Day SHALL encerrar o Estado_Carregamento.
3. THE Tela_Game_Day SHALL abster-se de exibir placar, estatísticas ou andamento da Partida enquanto o Log_Partida correspondente não tiver sido recebido.
4. IF a invocação da Funcao_Simulacao falha por erro de comunicação, THEN THE Tela_Game_Day SHALL encerrar o Estado_Carregamento e exibir uma mensagem legível informando que a simulação não foi concluída, preservando a possibilidade de nova tentativa.

### Requirement 8: Exibição do andamento da partida

**User Story:** Como jogador do PFL, quero acompanhar o andamento da partida com placar, período, relógio, down/distância, posse e narrativa, para que eu entenda o que acontece a cada jogada.

#### Acceptance Criteria

1. WHILE a Partida é apresentada durante ou após a simulação, THE Tela_Game_Day SHALL exibir o Placar corrente de cada time conforme o Log_Partida.
2. THE Tela_Game_Day SHALL exibir, para o Snap corrente, o período (quarto), o relógio de jogo, o down, a distância e a posse corrente conforme registrados no Log_Partida.
3. THE Tela_Game_Day SHALL exibir a Narrativa_Snap de cada Snap conforme a ordem determinística do Log_Partida.
4. THE Tela_Game_Day SHALL exibir o Clima da Partida conforme registrado no Log_Partida, sem sortear ou alterar o Clima.
5. THE Tela_Game_Day SHALL apresentar apenas valores de andamento cuja origem seja rastreável ao Log_Partida ou ao Placar, sem exibir números ou estatísticas sem origem.

### Requirement 9: Animação 8-bit dirigida pelo log

**User Story:** Como jogador do PFL, quero assistir a uma animação simples em 8-bit dos sprites dos dois times se enfrentando, para que a partida tenha uma representação visual antes das estatísticas.

#### Acceptance Criteria

1. WHEN o Log_Partida é recebido, THE Tela_Game_Day SHALL reproduzir a Animacao_8bit exibindo os Sprites_Pokemon dos Pokémon dos dois times se enfrentando, representando os Snaps na mesma ordem determinística em que estão registrados no Log_Partida, sem omitir, reordenar nem repetir Snaps.
2. THE Tela_Game_Day SHALL obter cada Sprite_Pokemon exclusivamente da Camada_Leitura a partir de sprites/`raw_data`, sem acessar fontes externas em tempo de execução.
3. THE Animacao_8bit SHALL ser dirigida exclusivamente pela sequência de Snaps do Log_Partida, sem introduzir eventos não presentes no Log_Partida.
4. THE Animacao_8bit SHALL abster-se de alterar o Log_Partida e o Placar, atuando apenas como representação visual.
5. WHEN a Animacao_8bit conclui a representação de todos os Snaps do Log_Partida, THE Tela_Game_Day SHALL conduzir o jogador à Tela_Resultado usando o Placar e o resultado já presentes no Log_Partida, sem recalcular resultado próprio.
6. IF um Sprite_Pokemon de algum Pokémon do Log_Partida não está disponível na Camada_Leitura, THEN THE Tela_Game_Day SHALL representar esse Pokémon por um sprite substituto padrão e prosseguir a reprodução dos demais Snaps, sem acessar fontes externas e sem interromper a Animacao_8bit.
7. IF o Log_Partida recebido não contém nenhum Snap, THEN THE Tela_Game_Day SHALL encerrar a Animacao_8bit sem exibir quadros de confronto e conduzir o jogador à Tela_Resultado usando o Placar e o resultado presentes no Log_Partida.

### Requirement 10: Determinismo da animação em relação ao log

**User Story:** Como jogador do PFL, quero que a mesma partida produza sempre a mesma animação, para que a representação visual seja consistente e auditável.

#### Acceptance Criteria

1. WHEN a Animacao_8bit é reproduzida duas vezes a partir de um mesmo Log_Partida, THE Tela_Game_Day SHALL produzir a mesma sequência de quadros e de Snaps representados nas duas reproduções.
2. THE Animacao_8bit SHALL derivar toda a sua sequência do Log_Partida, sem usar relógio de sistema, aleatoriedade local ou qualquer fonte que torne a sequência divergente entre reproduções de um mesmo Log_Partida.

### Requirement 11: Animação pulável e aceleravel com alternativa textual

**User Story:** Como jogador do PFL, quero pular ou acelerar a animação e ter uma alternativa textual, para que eu não fique preso na animação e possa acompanhar por texto.

#### Acceptance Criteria

1. WHILE a Animacao_8bit estiver em reprodução, THE Tela_Game_Day SHALL apresentar um Controle_Pular e um Controle_Acelerar visíveis e acionáveis.
2. WHEN o jogador aciona o Controle_Pular, THE Tela_Game_Day SHALL encerrar a Animacao_8bit em até 500 milissegundos e conduzir o jogador ao estado final da Partida ou à Tela_Resultado, usando o resultado já presente no Log_Partida.
3. WHEN o jogador aciona o Controle_Acelerar, THE Tela_Game_Day SHALL aumentar a velocidade de reprodução da Animacao_8bit para 2x a velocidade padrão, sem alterar o Log_Partida nem o Placar.
4. WHEN o jogador aciona o Controle_Acelerar enquanto a reprodução já estiver em 2x, THE Tela_Game_Day SHALL retornar a velocidade de reprodução para 1x (velocidade padrão), alternando entre 1x e 2x a cada acionamento.
5. THE Tela_Game_Day SHALL apresentar a Alternativa_Textual, correspondente à Narrativa_Snap do Log_Partida, como equivalente acessível da Animacao_8bit, exibindo o mesmo conteúdo independentemente de a Animacao_8bit ter sido pulada, acelerada ou reproduzida integralmente.
6. THE Tela_Game_Day SHALL permitir que o Controle_Pular e o Controle_Acelerar recebam foco e sejam acionados por teclado, exibindo um indicador de foco visível no controle focado.
7. IF a Animacao_8bit não estiver disponível ou já tiver sido concluída, THEN THE Tela_Game_Day SHALL ocultar o Controle_Pular e o Controle_Acelerar e conduzir o jogador diretamente ao estado final da Partida ou à Tela_Resultado, mantendo a Alternativa_Textual acessível.

### Requirement 12: Exibição de efeitos inertes e avisos na narrativa

**User Story:** Como jogador do PFL, quero ver na narrativa quando um efeito ficou inerte, para que eu não acredite em bônus que não ocorreram.

#### Acceptance Criteria

1. WHERE o Log_Partida registra que um Efeito_Inerte ou um aviso de ativação ocorreu em um Snap, THE Tela_Game_Day SHALL exibir esse aviso junto à Narrativa_Snap correspondente conforme o Log_Partida.
2. THE Tela_Game_Day SHALL abster-se de representar na Animacao_8bit qualquer bônus de Efeito_Inerte que o Log_Partida não registre como aplicado.
3. THE Tela_Game_Day SHALL exibir os avisos do Log_Partida sem introduzir bônus silencioso, mantendo a exibição fiel ao conteúdo do Log_Partida.

### Requirement 13: Placar final e resultado na tela Resultado

**User Story:** Como jogador do PFL, quero ver o placar final e o vencedor ou empate, para que eu saiba o desfecho da partida.

#### Acceptance Criteria

1. WHEN a Tela_Resultado é apresentada, THE Tela_Resultado SHALL exibir o Placar final de cada time conforme o Placar retornado pela Funcao_Simulacao.
2. WHEN os times têm pontuações finais diferentes, THE Tela_Resultado SHALL identificar o time de maior pontuação como vencedor.
3. WHEN os times têm pontuações finais iguais ao fim do tempo regulamentar, THE Tela_Resultado SHALL indicar empate.
4. THE Tela_Resultado SHALL obter o Placar final e o desfecho exclusivamente do Placar e do Log_Partida, sem recalcular ou inventar resultado.

### Requirement 14: Estatísticas sucintas e highlights

**User Story:** Como jogador do PFL, quero estatísticas sucintas e um resumo de eventos, para que eu avalie o que aconteceu na partida.

#### Acceptance Criteria

1. THE Tela_Resultado SHALL exibir as Estatisticas_Partida de corridas, passes, turnovers e faltas conforme registradas no Log_Partida.
2. THE Tela_Resultado SHALL exibir os Highlights como resumo de eventos relevantes derivado do Log_Partida.
3. THE Tela_Resultado SHALL apresentar apenas estatísticas e eventos cuja origem seja rastreável ao Log_Partida, sem exibir números ou eventos sem origem.

### Requirement 15: Navegação a partir da tela Resultado

**User Story:** Como jogador do PFL, quero voltar ao Game Day ou editar meu time a partir do resultado, para que eu continue jogando ou ajuste a equipe.

#### Acceptance Criteria

1. THE Tela_Resultado SHALL apresentar um controle rotulado para voltar à Tela_Game_Day e um controle rotulado para editar o time.
2. WHEN o jogador aciona o controle de voltar ao Game Day, THE App_PFL SHALL navegar para a Tela_Game_Day.
3. WHEN o jogador aciona o controle de editar o time, THE App_PFL SHALL navegar para a tela Meu Time.

### Requirement 16: Determinismo e reprodutibilidade por seed

**User Story:** Como jogador do PFL, quero que a mesma partida possa ser reproduzida a partir de um seed, para que resultados sejam auditáveis e repetíveis.

#### Acceptance Criteria

1. WHEN o jogador solicita a simulação com as mesmas Escalacoes, as mesmas Estrategias e o mesmo Seed_RNG de uma Partida anterior, THE Tela_Game_Day SHALL obter da Funcao_Simulacao o mesmo Log_Partida e o mesmo Placar da Partida anterior.
2. WHEN um mesmo Log_Partida é reproduzido, THE Tela_Game_Day SHALL exibir a mesma sequência de andamento e a mesma sequência da Animacao_8bit.
3. THE Tela_Game_Day SHALL exibir o Seed_RNG utilizado na Partida corrente de forma rastreável ao jogador.

### Requirement 17: Acessibilidade e UI honesta (anti-slop)

**User Story:** Como jogador do PFL, quero uma interface simples, acessível e honesta nas telas Game Day e Resultado, para que o uso seja claro, operável por teclado e livre de informação inventada.

#### Acceptance Criteria

1. THE App_PFL SHALL permitir operar todos os controles interativos das telas Game Day e Resultado por teclado, numa ordem de navegação que siga a sequência visual dos controles, sem nenhum controle inacessível por teclado.
2. WHILE um controle interativo está focado, THE App_PFL SHALL exibir um indicador de foco visível, distinguível dos demais estados.
3. THE App_PFL SHALL apresentar os três controles de Modo_Adversario e o controle de confirmação de simulação como alvos grandes e com rótulos textuais explícitos.
4. THE App_PFL SHALL fornecer a Alternativa_Textual da Animacao_8bit de modo que o andamento da Partida seja compreensível sem depender da animação.
5. THE App_PFL SHALL exibir apenas valores cuja origem seja rastreável ao Log_Partida, ao Placar ou à Camada_Leitura, sem apresentar números ou estatísticas sem origem.
6. THE App_PFL SHALL apresentar texto legível sobre o seu fundo e SHALL distinguir os estados de foco, erro e seleção entre si e do estado padrão por mais de um recurso visual, não apenas pela cor.
7. WHEN uma mensagem de erro ou de validação é exibida, THE App_PFL SHALL associá-la de forma programática ao controle correspondente, de modo que um leitor de tela anuncie a mensagem ao focar o controle.
