# Requirements Document

## Introduction

A spec **pfl-simulation-engine** especifica o **motor de simulação determinístico** do projeto PFL (Pokémon Football League), um webapp que simula partidas de futebol americano com Pokémon de Kanto. Esta é a terceira de cinco specs e depende das anteriores: `pfl-foundation` (schema do banco) e `pfl-data-catalog` (catálogo populado, camada de leitura, dados de matchup NFL e baseline de design em `design_baseline/nfl_matchup_data`).

O escopo desta spec é o **núcleo lógico** que, dadas duas escalações, as estratégias de cada time e um seed de RNG, simula uma partida completa de futebol americano e produz um log determinístico e um placar reproduzível. O motor executa no **backend**, em Vercel Functions. Esta spec inclui o motor de simulação, a lógica dos três modos de bot e a função de backend que expõe a simulação.

Estão **fora do escopo** desta spec e serão tratados em specs separadas: as telas e componentes de interface do usuário, e o fluxo de montagem de time (roster, escalação e exportação/importação de seed). O prolongamento (overtime) também está **fora do MVP**: nesta primeira implementação uma partida pode terminar empatada ao fim do tempo regulamentar.

As regras implementadas pelo motor derivam do documento autoritativo `GDD_MESTRE.md` e dos artefatos de design congelados: `simulation_parameters.json`, `play_catalog_18.json`, `matchups_36.json`, `effects_52_mvp_disposition.json`, `ANATOMY_DECISIONS_FINAL.md`, `CRITERIOS_ACEITE.md` e `PRESET_CURTI.json`. Os parâmetros numéricos do modelo probabilístico constituem um **baseline de design congelado e NÃO calibrado empiricamente** (`status = FROZEN_MVP_DESIGN_BASELINE_NOT_EMPIRICALLY_CALIBRATED`); o motor deve tratá-los como valores de referência versionados, não como fatos de balanceamento validados.

## Glossary

- **PFL**: Pokémon Football League, o webapp alvo deste projeto.
- **Motor_Simulacao**: o componente de backend que executa a lógica determinística de uma partida completa a partir de escalações, estratégias e um seed de RNG, produzindo um Log_Partida e um Placar.
- **Partida**: uma simulação completa de futebol americano composta por quatro quartos de tempo regulamentar entre dois times.
- **Escalacao**: a atribuição de atletas instanciados aos papéis das unidades de jogo (ataque, defesa e special teams) de um dos times, provida como entrada ao Motor_Simulacao.
- **Estrategia**: o conjunto de identificadores de jogadas e parâmetros táticos (estilo e prioridades) selecionados para um time, provido como entrada ao Motor_Simulacao.
- **Preset**: um perfil tático pré-definido de estilo e prioridades. Os quatro presets de referência são BALANCED, GROUND, AERIAL e CURTI.
- **Seed_RNG**: o valor inteiro que inicializa o Gerador_RNG de uma Partida, provido como entrada ao Motor_Simulacao, **distinto e separado** do seed de time.
- **Gerador_RNG**: o gerador de números pseudoaleatórios reproduzível do Motor_Simulacao, inicializado exclusivamente pelo Seed_RNG.
- **Tick**: o passo de avanço discreto da simulação, com duração de 0,1 segundo (`tick_s = 0.1`).
- **Quarto**: um dos quatro períodos de tempo regulamentar, cada um com 900 segundos de relógio de jogo (`quarter_seconds = 900`).
- **Relogio_Jogo**: o cronômetro de tempo regulamentar de uma Partida, decrescido conforme a passagem de Ticks e as regras de parada de relógio.
- **Snap**: o início de uma jogada a partir da linha de scrimmage, após a troca legal de posse pelo center.
- **Down**: cada uma das quatro tentativas de que o ataque dispõe para avançar 10 jardas.
- **Distancia**: o número de jardas restantes para o ataque obter um novo conjunto de downs.
- **Play_Timeout**: o tempo máximo de 30 segundos (`play_timeout_s = 30`) de simulação por jogada antes de o Motor_Simulacao encerrar a jogada.
- **Catalogo_Jogadas**: o conjunto de 18 jogadas definidas em `play_catalog_18.json`: 6 ofensivas, 6 defensivas e 6 de special teams.
- **Jogada_Ofensiva**: uma das seis jogadas de ataque: O_RUN_INSIDE, O_RUN_OUTSIDE, O_PASS_SHORT, O_PASS_INTERMEDIATE, O_PASS_DEEP, O_PLAY_ACTION.
- **Jogada_Defensiva**: uma das seis jogadas de defesa: D_RUN_FIT, D_EDGE_CONTAIN, D_ZONE, D_MAN, D_RUSH, D_CONTAIN_QB.
- **Jogada_Special_Teams**: uma das seis jogadas de equipes especiais, sendo três chutando (ST_O_KICKOFF, ST_O_PUNT, ST_O_FIELD_GOAL) e três recebendo/defendendo (ST_D_KICK_RETURN, ST_D_PUNT_RETURN, ST_D_KICK_BLOCK).
- **Matchups_36**: a tabela de 36 confrontos ofensiva-por-defensiva de `matchups_36.json`, cada um com um delta de probabilidade situacional simétrico aplicado antes da disputa de atributos.
- **Disputa_Atributos**: o cálculo probabilístico que resolve um confronto entre unidades a partir dos atributos, posições, condições e ações, produzindo uma probabilidade de sucesso.
- **Modelo_Probabilistico**: o conjunto de parâmetros de `simulation_parameters.json` (`base = 0.5`, `difference_coefficient = 0.45`, `min = 0.05`, `max = 0.95`, `skill_mod_max_abs = 0.15`) e fórmulas de corrida e passe que governam a Disputa_Atributos.
- **Fadiga**: o acúmulo de penalidade de desempenho por atleta ao longo da Partida, compartilhado entre todas as unidades em que o mesmo indivíduo atua e persistente durante toda a Partida.
- **Clima**: a condição meteorológica da Partida, sorteada pelo Gerador_RNG entre CLEAR, RAIN, WIND, HEAT e COLD, com modificadores de `simulation_parameters.json`.
- **Esfera_Supressao**: a região esférica de raio de 2 jardas (`suppression_radius_yards = 2`) centrada na bola, que acompanha a bola a cada Tick e dentro da qual poderes sobrenaturais não ativam nem produzem efeito.
- **Efeito_Inerte**: um efeito esportivo adicional de golpe ou habilidade listado em `effects_52_mvp_disposition.json` cujo status é `INERT_WITH_WARNING`, equipável mas sem produzir bônus no MVP.
- **Propriedade_Natural**: anatomia, stats oficiais, locomoção natural e resistências elementais de um atleta, que permanecem válidas independentemente da política de Efeito_Inerte.
- **Validador_Funcoes**: o componente que verifica se um atleta cumpre os pré-requisitos anatômicos de sua posição conforme `ANATOMY_DECISIONS_FINAL.md`.
- **Bot**: um controlador automático de time que varia apenas a Estrategia de escolha de jogadas, nunca atributos ocultos nem poderes fora do Catalogo_Jogadas.
- **Log_Partida**: o registro determinístico e ordenado de toda a Partida, incluindo narrativa por Snap, condições, decisões, resolução de poderes e estatísticas.
- **Placar**: o resultado numérico de pontos de cada time ao longo e ao final da Partida.
- **Funcao_Simulacao**: a Vercel Function de backend que recebe as duas Escalacoes, as Estrategias e o Seed_RNG e retorna o Log_Partida e o Placar.
- **Decisao_Produto_Pendente**: uma regra de jogo que o contrato autoritativo não decide (por exemplo prolongamento ou faltas raras) e que o Motor_Simulacao registra como pendência rastreável em vez de inventar mecânica.

## Requirements

### Requirement 1: Determinismo e RNG reproduzível

**User Story:** Como desenvolvedor do PFL, quero que o motor seja estritamente determinístico, para que a mesma entrada reproduza sempre o mesmo resultado e eu possa depurar e auditar partidas.

#### Acceptance Criteria

1. WHEN duas execuções do Motor_Simulacao recebem Escalacoes idênticas, Estrategias idênticas e um mesmo Seed_RNG, THE Motor_Simulacao SHALL produzir Log_Partida e Placar idênticos byte a byte entre as duas execuções, independentemente de sistema operacional, arquitetura de hardware e de execuções intermediárias.
2. THE Motor_Simulacao SHALL obter todo valor aleatório da Partida exclusivamente do Gerador_RNG inicializado pelo Seed_RNG, sem consumir valores aleatórios de qualquer outra fonte durante a resolução.
3. THE Motor_Simulacao SHALL tratar o Seed_RNG como entrada distinta e independente do seed de time, sem derivar um do outro.
4. WHERE duas execuções possuem Escalacoes e Estrategias idênticas e diferem apenas no Seed_RNG, THE Motor_Simulacao SHALL permitir que o Log_Partida e o Placar resultantes sejam diferentes entre si.
5. THE Motor_Simulacao SHALL abster-se de usar relógio de sistema, identificadores aleatórios de ambiente ou qualquer fonte de entropia externa ao Gerador_RNG na resolução da Partida.
6. IF o Seed_RNG está ausente ou fora da faixa de 0 a 2^64 − 1, THEN THE Motor_Simulacao SHALL recusar a inicialização, não produzir Log_Partida nem Placar e apresentar uma indicação de erro.
7. THE Motor_Simulacao SHALL registrar o Seed_RNG utilizado no Log_Partida para fins de auditoria e reprodução.

### Requirement 2: Loop de simulação por ticks, relógio e quartos

**User Story:** Como desenvolvedor do PFL, quero que a partida avance por ticks discretos dentro de quatro quartos, para que o tempo de jogo e o encerramento sigam regras previsíveis.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL avançar a simulação em Ticks de 0,1 segundo conforme `tick_s`.
2. THE Motor_Simulacao SHALL organizar a Partida em quatro Quartos, cada um com 900 segundos de Relogio_Jogo conforme `quarter_seconds`.
3. WHILE uma jogada está em andamento, THE Motor_Simulacao SHALL decrescer o Relogio_Jogo conforme a passagem de Ticks e as regras de parada de relógio aplicáveis.
4. IF uma jogada atinge 30 segundos de simulação sem resolução conforme `play_timeout_s`, THEN THE Motor_Simulacao SHALL encerrar a jogada e registrar o encerramento por tempo limite no Log_Partida.
5. WHEN o Relogio_Jogo do quarto Quarto chega a zero com os times empatados, THE Motor_Simulacao SHALL encerrar a Partida em empate e registrar o prolongamento como Decisao_Produto_Pendente.
6. THE Motor_Simulacao SHALL encerrar a Partida ao final do quarto Quarto sem simular prolongamento no MVP.

### Requirement 3: Regras de down, distância e pontuação

**User Story:** Como desenvolvedor do PFL, quero que o motor aplique as regras de downs e de pontuação da NFL, para que o placar e a progressão de posse sejam corretos.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL conceder ao ataque quatro Downs para avançar 10 jardas e um novo conjunto de Downs ao alcançar a Distancia necessária.
2. WHEN o ataque não alcança a Distancia necessária após o quarto Down, THE Motor_Simulacao SHALL transferir a posse ao time adversário na posição corrente da bola.
3. WHEN o portador legal da bola alcança a end zone adversária em posse física, THE Motor_Simulacao SHALL registrar um touchdown de 6 pontos e habilitar a tentativa de ponto extra.
4. WHEN uma tentativa de field goal é convertida, THE Motor_Simulacao SHALL registrar 3 pontos para o time que chutou.
5. WHEN um portador da bola é derrubado ou a bola é declarada morta na própria end zone do time em posse, THE Motor_Simulacao SHALL registrar um safety de 2 pontos para o time adversário.
6. WHEN uma tentativa de ponto extra é convertida, THE Motor_Simulacao SHALL registrar 1 ponto para o chute e 2 pontos para a conversão de dois pontos, conforme a opção executada.
7. THE Motor_Simulacao SHALL manter a posição da bola em relação às goal lines do campo e usar essa posição para determinar touchdown, safety e tentativas de pontuação.
8. THE Motor_Simulacao SHALL resolver as regras de down, distância, posse, touchdown, safety e pontuação de forma rastreável contra a edição NFL de 2026.

### Requirement 4: Seleção automática de jogadas por situação

**User Story:** Como desenvolvedor do PFL, quero que o motor escolha automaticamente qual jogada chamar, para que a partida transcorra sem intervenção manual e conforme o estilo do time.

#### Acceptance Criteria

1. WHEN uma nova jogada vai iniciar, THE Motor_Simulacao SHALL selecionar automaticamente uma Jogada_Ofensiva e uma Jogada_Defensiva do Catalogo_Jogadas para os times em posse e sem posse, respectivamente.
2. THE Motor_Simulacao SHALL considerar Down, Distancia, posição no campo, Relogio_Jogo, Clima, Fadiga e o estilo da Estrategia selecionada ao decidir qual jogada chamar.
3. THE Motor_Simulacao SHALL restringir toda jogada selecionada ao conjunto de 18 jogadas do Catalogo_Jogadas, sem criar jogadas fora do catálogo.
4. WHEN uma jogada selecionada não satisfaz suas pré-condições de formação legal, THE Motor_Simulacao SHALL abortar a execução com erro determinado e registrá-lo no Log_Partida, sem substituição oculta de jogada.
5. THE Motor_Simulacao SHALL produzir, para cada jogada, um registro no Log_Partida da jogada escolhida e dos fatores de situação que motivaram a escolha.

### Requirement 5: Aplicação dos 36 matchups

**User Story:** Como desenvolvedor do PFL, quero que as vantagens situacionais de confronto sejam aplicadas de forma simétrica, para que a interação ataque-defesa reflita o design congelado.

#### Acceptance Criteria

1. WHEN uma Jogada_Ofensiva e uma Jogada_Defensiva são confrontadas, THE Motor_Simulacao SHALL localizar o par correspondente em Matchups_36 e aplicar o `offense_probability_delta` associado.
2. THE Motor_Simulacao SHALL aplicar o delta de matchup ANTES da Disputa_Atributos.
3. THE Motor_Simulacao SHALL aplicar os deltas de matchup de forma simétrica entre ataque e defesa, de modo que a vantagem concedida a um lado corresponda à desvantagem do outro.
4. WHEN o par de jogadas corresponde a um matchup neutro com delta igual a zero, THE Motor_Simulacao SHALL deixar a resolução por conta dos atributos, posições, condições e ações.
5. THE Motor_Simulacao SHALL tratar os valores de Matchups_36 como baseline de design não calibrado e registrar sua origem versionada no Log_Partida.

### Requirement 6: Modelo probabilístico e fadiga compartilhada

**User Story:** Como desenvolvedor do PFL, quero que as disputas usem o modelo probabilístico e a fadiga definidos no baseline, para que os resultados sejam coerentes e dentro de limites previsíveis.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL calcular a probabilidade de sucesso de uma Disputa_Atributos a partir de `base = 0.5`, `difference_coefficient = 0.45` e das diferenças de atributos aplicáveis.
2. THE Motor_Simulacao SHALL limitar toda probabilidade resultante ao intervalo entre `min = 0.05` e `max = 0.95`.
3. THE Motor_Simulacao SHALL limitar o módulo de qualquer modificador de habilidade a `skill_mod_max_abs = 0.15`.
4. WHEN um atleta participa de um snap ativo, THE Motor_Simulacao SHALL acrescentar `0.003` à sua Fadiga, e `0.005` quando realizar uma ação extrema conforme `fatigue.extreme_action`.
5. WHEN um atleta permanece inativo em um snap, THE Motor_Simulacao SHALL recuperar `0.001` de sua Fadiga conforme `fatigue.inactive_snap_recovery`.
6. THE Motor_Simulacao SHALL limitar a penalidade de Fadiga de qualquer atleta a `max_penalty = 0.12`.
7. THE Motor_Simulacao SHALL compartilhar a Fadiga de um mesmo indivíduo entre todas as unidades em que ele atua e persistir essa Fadiga durante toda a Partida.
8. THE Motor_Simulacao SHALL calcular o ganho de corrida pela fórmula `2 + round(4 * clamp(run_advantage, 0, 1))` e aplicar perda entre `-4` e `-1` jardas quando o gap de corrida é perdido, conforme `run`.
9. THE Motor_Simulacao SHALL amostrar as jardas-alvo de passe nos intervalos `[3, 10]` para passe curto e `[12, 35]` para passe profundo conforme `pass`.
10. THE Motor_Simulacao SHALL registrar que os parâmetros do Modelo_Probabilistico constituem baseline de design não calibrado empiricamente.

### Requirement 7: Clima e seus modificadores

**User Story:** Como desenvolvedor do PFL, quero que o clima seja sorteado e afete a jogabilidade, para que as condições ambientais influenciem a partida de forma reproduzível.

#### Acceptance Criteria

1. WHEN uma Partida é inicializada, THE Motor_Simulacao SHALL sortear o Clima pelo Gerador_RNG com as probabilidades CLEAR 0.40, RAIN 0.20, WIND 0.15, HEAT 0.15 e COLD 0.10 conforme `weather`.
2. WHERE o Clima é RAIN, THE Motor_Simulacao SHALL aplicar modificador de recepção de `-0.04` e acréscimo de probabilidade de fumble de `0.02`.
3. WHERE o Clima é WIND, THE Motor_Simulacao SHALL aplicar modificador de `-0.05` a passes profundos e de `-0.05` a chutes longos.
4. WHERE o Clima é HEAT, THE Motor_Simulacao SHALL acrescentar `0.002` de Fadiga por snap conforme `weather_modifiers.HEAT`.
5. WHERE o Clima é COLD, THE Motor_Simulacao SHALL aplicar modificador de recepção de `-0.02`.
6. THE Motor_Simulacao SHALL registrar o Clima sorteado e os modificadores aplicados no Log_Partida.

### Requirement 8: Esfera de supressão

**User Story:** Como desenvolvedor do PFL, quero que a esfera de supressão neutralize poderes sobrenaturais ao redor da bola, para que a disputa pela bola permaneça física e justa.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL manter a Esfera_Supressao com raio de 2 jardas conforme `suppression_radius_yards`, centrada na posição corrente da bola, incluindo como interior da esfera os pontos situados exatamente a 2 jardas da bola.
2. WHEN a bola muda de posição em um Tick, THE Motor_Simulacao SHALL reposicionar a Esfera_Supressao para a nova posição da bola nesse mesmo Tick, antes de resolver qualquer poder sobrenatural daquele Tick.
3. WHILE um atleta ou efeito sobrenatural está dentro da Esfera_Supressao, THE Motor_Simulacao SHALL impedir que poderes sobrenaturais ativem ou afetem a jogada, com prioridade absoluta sobre quaisquer outras regras de efeito.
4. WHEN um efeito sobrenatural previamente ativo passa a estar dentro da Esfera_Supressao, THE Motor_Simulacao SHALL suspender imediatamente esse efeito enquanto permanecer dentro da esfera.
5. THE Motor_Simulacao SHALL preservar dentro da Esfera_Supressao a anatomia, a física natural e o momentum já adquiridos por meios físicos.
6. WHILE a bola está em posse física de um atleta, caracterizada por contato contínuo e controle mecânico estável, THE Motor_Simulacao SHALL proteger a bola e o portador contra poderes externos sobrenaturais.
7. WHERE a bola está solta e fora da Esfera_Supressao, THE Motor_Simulacao SHALL permitir manipulação por ação sobrenatural externa.
8. WHEN a bola é deslocada por manipulação sobrenatural externa, THE Motor_Simulacao SHALL registrar que a manipulação remota não constitui posse, interceptação nem touchdown.

### Requirement 9: Política de efeitos inertes com aviso

**User Story:** Como desenvolvedor do PFL, quero que efeitos sobrenaturais adicionais fiquem inertes e sinalizados, para que nenhum bônus não aprovado entre em jogo silenciosamente.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL tratar como Efeito_Inerte todo efeito esportivo adicional de golpe ou habilidade cujo campo de status em `effects_52_mvp_disposition.json` seja igual ao valor `INERT_WITH_WARNING`.
2. IF um efeito esportivo adicional não possuir registro correspondente em `effects_52_mvp_disposition.json`, THEN THE Motor_Simulacao SHALL tratá-lo como Efeito_Inerte e registrar no Log_Partida um aviso indicando a ausência de disposição aprovada para o efeito.
3. WHILE um Efeito_Inerte estiver equipado, THE Motor_Simulacao SHALL mantê-lo equipado aplicando zero de bônus a todos os atributos de desempenho afetados pelo efeito.
4. WHEN um Efeito_Inerte seria relevante em uma jogada, THE Motor_Simulacao SHALL registrar exatamente um aviso no Log_Partida por ocorrência, identificando o efeito e o atleta associado, e SHALL abster-se de alterar qualquer atributo ou resultado da jogada.
5. THE Motor_Simulacao SHALL continuar aplicando as Propriedades_Naturais de cada atleta sem qualquer modificação decorrente da política de Efeito_Inerte.
6. THE Motor_Simulacao SHALL abster-se de aplicar qualquer mecânica, bônus ou penalidade a um Efeito_Inerte não aprovado, mantendo o resultado da jogada idêntico ao que ocorreria sem o efeito equipado.
7. THE Motor_Simulacao SHALL aplicar as regras universais fixas de Esfera_Supressao e de telecinese, e SHALL aplicar bônus de clima, contato ou proteção somente quando a regra específica correspondente estiver parametrizada no baseline, abstendo-se de aplicá-los quando não parametrizada.

### Requirement 10: Validação anatômica de funções

**User Story:** Como desenvolvedor do PFL, quero que o motor valide as ações pela anatomia de cada atleta, para que apenas ações fisicamente possíveis sejam executadas conforme as convenções PFL.

#### Acceptance Criteria

1. WHEN um atleta vai atuar como QB, THE Validador_Funcoes SHALL exigir recebimento de snap tangível e lançamento físico da bola.
2. WHEN um atleta vai atuar como center, THE Validador_Funcoes SHALL exigir um snap físico para trás.
3. WHEN um atleta vai atuar como RB, THE Validador_Funcoes SHALL exigir posse física da bola, incluindo recebimento de handoff na boca para quadrúpedes como Rapidash.
4. WHEN um atleta vai atuar como WR, TE ou CB em recepção ou interceptação, THE Validador_Funcoes SHALL exigir contato físico, controle e o equivalente a dois pés no campo.
5. WHEN um atleta de secundária sem recepção física disputa a bola, THE Motor_Simulacao SHALL resolver a ação como deflexão ou passe incompleto, nunca como interceptação por magnetismo ou telecinese.
6. WHEN um atleta vai atuar como K ou P, THE Validador_Funcoes SHALL exigir impacto físico por membro, casco ou outra superfície corporal.
7. THE Motor_Simulacao SHALL tratar manipulação por telecinese como não constituinte de recepção.
8. WHERE o Venusaur do preset CURTI atua como center, THE Motor_Simulacao SHALL permitir o snap por vinha corpórea tangível conforme a exceção aprovada, sem tratar golpe sobrenatural como snap pré-snap gratuito.
9. IF uma ação é anatomicamente impossível, THEN THE Motor_Simulacao SHALL bloquear a ação e registrar um aviso no Log_Partida.
10. IF uma atribuição de posição é possível apenas com limitação, THEN THE Motor_Simulacao SHALL permitir a atribuição e registrar o aviso de limitação.

### Requirement 11: Special teams automáticos

**User Story:** Como desenvolvedor do PFL, quero que as jogadas de equipes especiais sejam acionadas automaticamente pelo estado do jogo, para que chutes, retornos e tentativas ocorram nos momentos corretos.

#### Acceptance Criteria

1. WHEN o estado de jogo requer chute inicial após pontuação ou início de período, THE Motor_Simulacao SHALL acionar automaticamente ST_O_KICKOFF e a resposta ST_D_KICK_RETURN.
2. WHEN o estado de jogo corresponde a decisão de punt, THE Motor_Simulacao SHALL acionar automaticamente ST_O_PUNT e a resposta ST_D_PUNT_RETURN.
3. WHEN o estado de jogo corresponde a tentativa de field goal ou ponto extra, THE Motor_Simulacao SHALL acionar automaticamente ST_O_FIELD_GOAL e a resposta ST_D_KICK_BLOCK.
4. THE Motor_Simulacao SHALL selecionar as Jogadas_Special_Teams de forma situacional conforme o estado do jogo, não de forma aleatória.
5. THE Motor_Simulacao SHALL permitir que special teams reutilizem indivíduos da mesma equipe fora de snaps simultâneos, mantendo a Fadiga compartilhada.

### Requirement 12: Modos de bot

**User Story:** Como desenvolvedor do PFL, quero três modos de adversário controlados por bot, para que uma partida possa ser simulada contra oponentes com estratégias distintas e justas.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL submeter todo Bot ao mesmo motor, às mesmas regras, ao mesmo Gerador_RNG, à mesma Fadiga e à mesma Esfera_Supressao aplicados ao time do jogador, sem conceder a nenhum Bot atributos ocultos, bônus de atributos ou leitura do estado oculto do adversário.
2. WHEN o modo é Bot aleatório, THE Motor_Simulacao SHALL sortear exatamente um dos quatro Presets definidos e suas variações de estilo e prioridade restritas ao Catalogo_Jogadas, sem usar poderes fora do Catalogo_Jogadas.
3. WHEN o modo é Bot Curti, THE Motor_Simulacao SHALL usar o preset CURTI com seu perfil tático de escolha de jogadas, sem atributos extras e sem leitura onisciente do estado oculto do adversário.
4. WHEN o modo é Bot seed de terceiros e a seed importada é válida, THE Motor_Simulacao SHALL manter exatamente o time importado, sem modificar atributos, e aplicar a IA de escolha de jogadas definida pelo preset padrão.
5. IF o modo é Bot seed de terceiros e a seed importada é inválida ou não pode ser interpretada, THEN THE Motor_Simulacao SHALL rejeitar a importação, não iniciar a simulação e apresentar uma indicação de erro informando que a seed é inválida, preservando o estado anterior sem alterações.
6. IF o modo de bot solicitado não é um dos três modos suportados (aleatório, Curti ou seed de terceiros), THEN THE Motor_Simulacao SHALL recusar a execução e apresentar uma indicação de erro informando que o modo é inválido, sem iniciar a simulação.
7. WHEN um Bot executa escolhas de jogadas com um mesmo valor de Gerador_RNG e um mesmo estado inicial de partida, THE Motor_Simulacao SHALL produzir a mesma sequência de escolhas de jogadas de forma reproduzível.

### Requirement 13: Log determinístico e estatísticas

**User Story:** Como desenvolvedor do PFL, quero um log detalhado e estatísticas por partida, para que cada decisão e evento seja auditável e reproduzível.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL registrar, para cada Snap, a posição da bola, a posse, a decisão de jogada e as condições de Clima e Fadiga vigentes.
2. WHEN uma habilidade ou golpe ativa ou deixa de ativar em uma jogada, THE Motor_Simulacao SHALL registrar o motivo, incluindo os casos de Efeito_Inerte e de supressão dentro da Esfera_Supressao.
3. THE Motor_Simulacao SHALL registrar, por Snap, o Placar, o Quarto, o Relogio_Jogo, o Down, a Distancia e a posse corrente.
4. THE Motor_Simulacao SHALL registrar uma narrativa por Snap no Log_Partida.
5. THE Motor_Simulacao SHALL produzir estatísticas da Partida contendo corridas, passes, turnovers, faltas e resumo de eventos.
6. THE Motor_Simulacao SHALL ordenar o Log_Partida de forma determinística, de modo que entradas idênticas produzam logs idênticos.

### Requirement 14: Tratamento de faltas e lacunas de regra

**User Story:** Como desenvolvedor do PFL, quero que faltas sejam tratadas pelas regras da NFL e que lacunas sejam registradas, para que o motor não invente mecânica onde o contrato não decide.

#### Acceptance Criteria

1. THE Motor_Simulacao SHALL detectar e aplicar faltas de formação, de elegibilidade e de interferência conforme a edição NFL de 2026.
2. THE Motor_Simulacao SHALL impedir que a estratégia Pokémon de qualquer time autorize o descumprimento de faltas aplicáveis.
3. WHEN uma falta é detectada, THE Motor_Simulacao SHALL registrar a falta e sua resolução no Log_Partida de forma rastreável.
4. IF uma situação de regra não é decidida pelo contrato autoritativo, THEN THE Motor_Simulacao SHALL registrá-la como Decisao_Produto_Pendente em vez de inventar mecânica.

### Requirement 15: Função de backend de simulação

**User Story:** Como desenvolvedor do PFL, quero uma função de backend que receba escalações, estratégias e seed e retorne log e placar, para que a simulação seja consumível pelas demais partes do sistema.

#### Acceptance Criteria

1. THE Funcao_Simulacao SHALL ser exposta como uma Vercel Function de backend.
2. WHEN a Funcao_Simulacao é invocada, THE Funcao_Simulacao SHALL aceitar como entrada as duas Escalacoes, as Estrategias de ambos os times e o Seed_RNG.
3. WHEN a simulação conclui com sucesso, THE Funcao_Simulacao SHALL retornar o Log_Partida e o Placar produzidos pelo Motor_Simulacao.
4. IF uma entrada da Funcao_Simulacao é inválida ou incompleta, THEN THE Funcao_Simulacao SHALL retornar um erro descritivo identificando o campo inválido, sem executar a Partida.
5. WHEN a Funcao_Simulacao é invocada duas vezes com entradas idênticas, THE Funcao_Simulacao SHALL retornar Log_Partida e Placar idênticos entre as invocações.
6. THE Funcao_Simulacao SHALL executar a simulação exclusivamente no backend, sem expor a lógica do Motor_Simulacao ao cliente.
