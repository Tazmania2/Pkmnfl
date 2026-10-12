# Implementation Plan: pfl-simulation-engine

## Overview

Este plano converte o design do `pfl-simulation-engine` em uma sequência incremental de tarefas de codificação em **TypeScript puro**. A abordagem respeita a fronteira de pureza do design: primeiro os tipos compartilhados e o RNG determinístico (base de todo o determinismo), depois o estado imutável, o relógio e a máquina de estados, em seguida os componentes do pipeline de resolução de jogada (probabilidade, fadiga, clima, esfera, inércia, anatomia), depois matchups, log e estatísticas, a orquestração pura `simulate`, os bots e, por fim, o adaptador de backend `Funcao_Simulacao`.

Cada tarefa constrói sobre as anteriores e termina com integração — não há código órfão. Os testes baseados em propriedades (PBT) usam **`fast-check`** com no mínimo 100 iterações (`fc.assert(prop, { numRuns: 100 })`) e seed fixo em CI; cada teste de propriedade referencia a propriedade de design correspondente com a tag `// Feature: pfl-simulation-engine, Property {número}`. As 42 Correctness Properties recebem, cada uma, sua própria sub-tarefa de teste. Sub-tarefas de teste são marcadas com `*` (opcionais, não implementadas automaticamente).

Dependências externas: `pfl-foundation` (schema) e `pfl-data-catalog` (camada de leitura `lib/data/` e `design_baseline`). O núcleo consome apenas `ResolvedInput` imutável; nenhuma leitura externa ocorre dentro do núcleo.

## Tasks

- [x] 1. Preparar estrutura de módulos e tipos compartilhados do núcleo
  - [x] 1.1 Criar o esqueleto de `lib/sim/` e configurar o ambiente de testes
    - Criar a árvore de diretórios `lib/sim/` e `lib/sim/bots/` conforme a organização de módulos do design
    - Configurar `fast-check` e o runner de testes (vitest/jest) com seed fixo em CI
    - Garantir que o núcleo não importe nada de rede, banco, relógio ou ambiente (fronteira de pureza)
    - _Requirements: 1.5, 15.6_

  - [x] 1.2 Definir `types.ts` com os tipos compartilhados do núcleo
    - Definir `ResolvedAthlete`, `ResolvedLineup`, `ResolvedInput`, `Strategy`, `BotMode`
    - Definir `GameState`, `GamePhase`, `Weather`, `Vec3`, `Score`
    - Definir `SimulationParameters`, `Baseline`, `Matchup`, `EffectStatus`, `InertDecision`
    - Definir tipos de log: `LogEventType`, `StateSnapshot`, `LogEvent`, `GameLog`, `GameStats`, `JsonValue`
    - Definir `SimulationResult = { log; score; seedUsed }`
    - Marcar todas as entradas do núcleo como imutáveis (`readonly`)
    - _Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 13.1, 13.3_

- [x] 2. Implementar o Gerador_RNG determinístico
  - [x] 2.1 Implementar `rng.ts` (sfc32 + semeadura SplitMix64)
    - Implementar `createRng(seed: bigint): Rng` com expansão SplitMix64 → 4 lanes de 32 bits → sfc32
    - Implementar `nextFloat()` (float em [0,1) com 32 bits), `nextInt(min, max)` inclusivo sem viés de módulo, `state()`
    - Operar inteiramente em aritmética de 32 bits bitwise para independência de plataforma
    - Documentar cada ponto de consumo com comentário `// RNG consume #k: <motivo>`
    - _Requirements: 1.2, 1.3, 1.5_

  - [x] 2.2 Escrever property test de RNG como única fonte de entropia
    - **Property 2: RNG é a única fonte de entropia, derivada só do Seed_RNG**
    - **Validates: Requirements 1.2, 1.3**

- [x] 3. Implementar estado imutável, relógio e loop de ticks
  - [x] 3.1 Implementar `state.ts` (GameState imutável + transições puras)
    - Implementar criação de `GameState` inicial e transições puras `(GameState, PlayResolution) → GameState` sem mutação
    - Manter `ballOn` em jardas relativas às goal lines e `ballPos: Vec3` para a esfera
    - Manter `fatigue` como `ReadonlyMap<number, number>` indexada por `instance_id`
    - _Requirements: 3.7_

  - [x] 3.2 Implementar `clock.ts` (ticks, relógio, quartos, play_timeout)
    - Avançar a simulação em ticks de 0,1 s (`tick_s`) com `gameClockDeci` inteiro (décimos de segundo)
    - Organizar 4 quartos de 900 s (`quarter_seconds`); decrescer o relógio por ticks e regras de parada
    - Encerrar jogada no 300º tick quando atingir `play_timeout_s` (30 s) e emitir evento `TIMEOUT`
    - Derivar a duração da jogada em ticks de forma determinística a partir do resultado, nunca de tempo de parede
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Escrever property test de relógio discreto e monotônico
    - **Property 6: Relógio discreto e monotônico por quarto**
    - **Validates: Requirements 2.1, 2.3, 2.6**

  - [x] 3.4 Escrever property test de encerramento por tempo limite de jogada
    - **Property 7: Encerramento por tempo limite de jogada**
    - **Validates: Requirements 2.4**

- [x] 4. Implementar o Modelo_Probabilistico (probabilidade, corrida, passe)
  - [x] 4.1 Implementar `play/probability.ts`
    - Implementar `compute`: `p_bruta = base + difference_coefficient*Δattr + delta_matchup + skillMod + climaMod` com `base=0.5`, `coef=0.45`
    - Aplicar clamp final em `[min, max] = [0.05, 0.95]` como última operação sobre a probabilidade
    - Implementar `applySkillMod` limitando o módulo a `skill_mod_max_abs = 0.15`
    - Implementar `run`: `ganho = 2 + round(4*clamp(run_advantage, 0, 1))`; perda amostrada em `[-4, -1]`
    - Implementar `pass`: jardas-alvo em `[3, 10]` (curto) e `[12, 35]` (profundo), amostradas via RNG
    - Decidir sucesso por `rng.nextFloat() < p_final`
    - _Requirements: 6.1, 6.2, 6.3, 6.8, 6.9_

  - [x] 4.2 Escrever property test da fórmula da probabilidade
    - **Property 16: Fórmula da probabilidade de disputa**
    - **Validates: Requirements 6.1**

  - [x] 4.3 Escrever property test do clamp [0.05, 0.95]
    - **Property 17: Clamp de probabilidade sempre em [0.05, 0.95]**
    - **Validates: Requirements 6.2**

  - [x] 4.4 Escrever property test do limite de modificador de habilidade
    - **Property 18: Modificador de habilidade limitado a ±0.15**
    - **Validates: Requirements 6.3**

  - [x] 4.5 Escrever property test de ganho e perda de corrida
    - **Property 20: Ganho e perda de corrida pela fórmula**
    - **Validates: Requirements 6.8**

  - [x] 4.6 Escrever property test de jardas-alvo de passe
    - **Property 21: Jardas-alvo de passe nos intervalos definidos**
    - **Validates: Requirements 6.9**

- [x] 5. Implementar fadiga compartilhada e clima
  - [x] 5.1 Implementar `play/fatigue.ts` (fadiga compartilhada por instance_id)
    - Implementar `applyFatigue` com `+0.003` ativo, `+0.005` extremo, `-0.001` inativo, `+0.002` sob HEAT
    - Indexar por `instance_id` (compartilhada entre todas as unidades do indivíduo), persistente por toda a partida
    - Fazer clamp de toda penalidade em `[0, 0.12]` (`max_penalty`)
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 7.4, 11.5_

  - [x] 5.2 Escrever property test de fadiga compartilhada e limitada
    - **Property 19: Fadiga compartilhada, acumulada e limitada**
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.7, 7.4, 11.5**

  - [x] 5.3 Implementar `play/weather.ts` (sorteio e modificadores de clima)
    - Implementar `roll` por faixas cumulativas na ordem `CLEAR` (<0.40), `RAIN` (<0.60), `WIND` (<0.75), `HEAT` (<0.90), `COLD`, consumindo um único `rng.nextFloat()`
    - Implementar `modifiers`: RAIN recepção `-0.04` e fumble `+0.02`; WIND passe profundo `-0.05` e chute longo `-0.05`; COLD recepção `-0.02`; HEAT fadiga `+0.002`/snap; CLEAR sem modificador
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [x] 5.4 Escrever property test do sorteio de clima
    - **Property 22: Sorteio de clima pelas faixas cumulativas**
    - **Validates: Requirements 7.1**

  - [x] 5.5 Escrever property test dos modificadores de clima
    - **Property 23: Modificadores de clima aplicados conforme o clima**
    - **Validates: Requirements 7.2, 7.3, 7.5**

- [x] 6. Checkpoint — garantir que RNG, estado, relógio, probabilidade, fadiga e clima passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implementar Esfera_Supressao e política de telecinese
  - [x] 7.1 Implementar `play/sphere.ts`
    - Implementar `isInsideSphere(ballPos, point, radiusYards)` com `d2 <= raio²` (casca inclusiva, raio 2)
    - Reposicionar a esfera para a nova posição da bola no mesmo tick, antes de resolver qualquer poder
    - Suprimir poderes dentro da esfera com prioridade absoluta; suspender efeito ativo que entra na esfera
    - Preservar anatomia, física natural e momentum físico já adquiridos dentro da esfera
    - Proteger bola/portador em posse física contra poderes externos; permitir manipulação só com bola solta e fora
    - Marcar manipulação remota como não-posse/não-INT/não-TD e registrar a ocorrência
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 7.2 Escrever property test da geometria da esfera
    - **Property 25: Esfera de supressão inclui a casca e segue a bola**
    - **Validates: Requirements 8.1, 8.2**

  - [x] 7.3 Escrever property test de supressão com prioridade absoluta
    - **Property 26: Supressão neutraliza poderes sobrenaturais com prioridade absoluta**
    - **Validates: Requirements 8.3, 8.4, 8.5**

  - [x] 7.4 Escrever property test de proteção por posse física
    - **Property 27: Posse física protege contra poderes externos**
    - **Validates: Requirements 8.6**

  - [x] 7.5 Escrever property test de manipulação remota nunca ser posse/INT/TD
    - **Property 28: Manipulação remota nunca é posse, interceptação nem touchdown**
    - **Validates: Requirements 8.7, 8.8, 10.5, 10.7**

- [x] 8. Implementar política de efeitos inertes e validador anatômico
  - [x] 8.1 Implementar `play/inert.ts` (política de efeitos inertes com aviso)
    - Implementar `resolveEffectDisposition`: status `INERT_WITH_WARNING` → inerte; efeito sem registro → inerte com motivo de ausência de disposição
    - Aplicar zero bônus a todos os atributos afetados; não alterar nenhum atributo nem resultado da jogada
    - Preservar `Propriedades_Naturais` (stats, tipo, locomoção, resistências) sem modificação
    - Aplicar regras universais fixas; bônus de clima/contato/proteção só quando parametrizados no baseline
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.7_

  - [x] 8.2 Escrever property test de disposição inerte-com-motivo
    - **Property 29: Disposição de efeito é sempre inerte-com-motivo**
    - **Validates: Requirements 9.1, 9.2**

  - [x] 8.3 Implementar `play/anatomy.ts` (Validador_Funcoes)
    - Implementar `validateAnatomy(athlete, role, action): AnatomyOutcome` (`ok` | `allowed_with_limitation` | `blocked`)
    - Exigir requisitos por posição: QB (snap tangível + lançamento físico), C (snap físico para trás), RB (posse física incl. handoff na boca), WR/TE/CB (contato + controle + dois pés), K/P (impacto físico corpóreo)
    - Resolver secundária sem recepção física como deflexão/incompleto, nunca INT por magnetismo/telecinese
    - Aplicar exceções aprovadas: Rapidash (boca), Venusaur CURTI (vinha, sem golpe pré-snap gratuito), Magneton (desvia, não intercepta)
    - Bloquear ação impossível com aviso; permitir limitação com aviso; nunca substituir jogada ocultamente
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_

  - [x] 8.4 Escrever property test de validação anatômica por posição
    - **Property 32: Validação anatômica por posição**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6**

  - [x] 8.5 Escrever property test de bloqueio/limitação logados
    - **Property 33: Ação impossível bloqueia, limitação permite, ambas logam**
    - **Validates: Requirements 10.9, 10.10, 4.4**

- [x] 9. Implementar matchups e baseline
  - [x] 9.1 Implementar `matchups.ts` (lookup + delta simétrico + gancho de calibração)
    - Implementar `matchupDelta(baseline, offense, defense)` retornando o `offense_probability_delta` do par
    - Aplicar o delta ANTES da disputa e de forma simétrica (vantagem do ataque = desvantagem da defesa)
    - Deixar delta zero (matchup neutro) por conta dos atributos
    - Implementar `calibrateDeltas(baseline, nfl, enabled)` como identidade quando `enabled=false` (MVP)
    - Carimbar origem versionada e status não-calibrado para registro no log
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.10_

  - [x] 9.2 Escrever property test de delta simétrico aplicado antes da disputa
    - **Property 14: Delta de matchup é o do baseline, aplicado antes da disputa, de forma simétrica**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 10. Implementar seleção de jogada e pipeline de resolução
  - [x] 10.1 Implementar `play/select.ts` (seleção por situação + estilo)
    - Selecionar `Jogada_Ofensiva` e `Jogada_Defensiva` do `Catalogo_Jogadas` (18 jogadas) por down, distância, posição, relógio, clima, fadiga e estilo
    - Definir `PlayPolicy.choosePlay(ctx, catalog, rng)` com sorteio ponderado consumindo um `rng.nextFloat()` só quando há mais de uma opção com peso positivo
    - Restringir toda jogada ao catálogo; consumir RNG na ordem fixa ataque → defesa
    - _Requirements: 4.1, 4.2, 4.3, 12.2_

  - [x] 10.2 Escrever property test de jogada pertencer ao catálogo
    - **Property 12: Jogada selecionada pertence sempre ao catálogo**
    - **Validates: Requirements 4.1, 4.3, 12.2**

  - [x] 10.3 Implementar `play/pipeline.ts` (fases a–h em ordem fixa)
    - Orquestrar as fases: (a) seleção, (b) validação anatômica, (c) delta de matchup, (d) disputa, (e) clima/fadiga, (f) resolução do resultado, (g) atualização de fadiga, (h) emissão de log
    - Consumir o RNG na ordem fixa documentada (bot O, bot D, teste de sucesso, amostragens de resultado), pulando passos inaplicáveis
    - Abortar jogada sem pré-condição de formação legal com erro determinado + log, sem substituição oculta
    - Integrar `probability`, `fatigue`, `weather`, `sphere`, `inert`, `anatomy` e `matchups`
    - _Requirements: 4.4, 1.2_

  - [x] 10.4 Escrever property test de ordem fixa de consumo do RNG
    - **Property 5: Ordem fixa de consumo do RNG**
    - **Validates: Requirements 1.2**

  - [x] 10.5 Escrever property test de efeito inerte não alterar o resultado
    - **Property 30: Efeito inerte não altera o resultado da jogada**
    - **Validates: Requirements 9.3, 9.5, 9.6, 9.7**

- [x] 11. Checkpoint — garantir que esfera, inércia, anatomia, matchups, seleção e pipeline passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implementar a máquina de estados do fluxo de jogo (FSM)
  - [x] 12.1 Implementar `fsm.ts` (transições de posse, downs, distância)
    - Modelar transições puras `(GameState, PlayResolution) → GameState` para Drive/FirstDown/Turnover/ChangePossession
    - Conceder 4 downs para 10 jardas; reiniciar down ao alcançar a distância; transferir posse na posição corrente após 4º down não convertido
    - Modelar `EndOfQuarter`/`EndOfGame`; encerrar ao fim do 4º quarto sem overtime; empate → `score.tie` + `PENDING_DECISION`
    - _Requirements: 2.5, 2.6, 3.1, 3.2_

  - [x] 12.2 Implementar regras de pontuação e posição da bola
    - Registrar touchdown (6) quando portador legal em posse física alcança a end zone; habilitar PAT/2pt
    - Registrar field goal (3), safety (2 ao adversário), ponto extra (1) e conversão de 2 pontos (2)
    - Manter a posição da bola relativa às goal lines para determinar TD, safety e tentativas
    - Resolver down/distância/posse/pontuação de forma rastreável contra a edição NFL 2026
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 12.3 Implementar gatilhos de special teams por estado
    - Acionar `ST_O_KICKOFF`+`ST_D_KICK_RETURN` no chute inicial; `ST_O_PUNT`+`ST_D_PUNT_RETURN` no punt; `ST_O_FIELD_GOAL`+`ST_D_KICK_BLOCK` em FG/ponto extra
    - Selecionar special teams de forma situacional (função do estado), sem consumir o RNG de escolha
    - Permitir reuso de indivíduos fora de snaps simultâneos mantendo a fadiga compartilhada
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 12.4 Implementar faltas e Decisao_Produto_Pendente
    - Detectar e aplicar faltas de formação, elegibilidade e interferência conforme a edição NFL 2026
    - Impedir que a estratégia Pokémon desative a detecção; registrar falta e resolução de forma rastreável
    - Registrar situação não decidida pelo contrato como `Decisao_Produto_Pendente`, sem inventar mecânica
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 12.5 Escrever property test de downs, distância e troca de posse
    - **Property 9: Downs, distância e troca de posse**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 12.6 Escrever property test de posição da bola e eventos de pontuação
    - **Property 10: Posição da bola e eventos de pontuação coerentes**
    - **Validates: Requirements 3.3, 3.5, 3.7**

  - [x] 12.7 Escrever property test de empate virar pendência
    - **Property 8: Empate ao fim do tempo regulamentar vira pendência**
    - **Validates: Requirements 2.5**

  - [x] 12.8 Escrever property test de special teams por estado
    - **Property 34: Special teams acionados por estado, não por acaso**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [x] 12.9 Escrever property test de faltas detectadas e logadas
    - **Property 40: Faltas detectadas, logadas e inescapáveis pela estratégia**
    - **Validates: Requirements 14.1, 14.2, 14.3**

  - [x] 12.10 Escrever property test de lacuna de regra virar pendência
    - **Property 41: Lacuna de regra vira pendência rastreável**
    - **Validates: Requirements 14.4**

- [x] 13. Implementar log determinístico, serialização estável e estatísticas
  - [x] 13.1 Implementar `log.ts` (Log_Partida + serialização estável)
    - Construir o `Log_Partida` como lista ordenada de `LogEvent` com `seq` sequencial determinístico
    - Registrar por snap: posição da bola, posse, decisão de jogada, clima, fadiga, `StateSnapshot` completo e narrativa não vazia
    - Registrar motivo de (não) ativação de poder (`POWER_SUPPRESSED`, `POWER_INERT`, `TELEKINESIS_NOT_POSSESSION`); aviso único por ocorrência de efeito inerte relevante
    - Registrar `seedUsed` (decimal), `baselineVersion`, `baselineStatus`, clima e modificadores
    - Implementar `stableStringify` (chaves ordenadas lexicograficamente, sem espaços variáveis, relógio em inteiros)
    - _Requirements: 1.7, 5.5, 6.10, 7.6, 9.4, 13.1, 13.2, 13.3, 13.4, 13.6_

  - [x] 13.2 Implementar `stats.ts` (estatísticas agregadas)
    - Derivar `GameStats` dos eventos: corridas, passes/completos/INT, turnovers, faltas e `scoringSummary`
    - Garantir coerência entre a soma de pontos do `Placar` e os eventos de scoring
    - _Requirements: 13.5_

  - [x] 13.3 Escrever property test de completude do log por snap
    - **Property 37: Completude do log por snap**
    - **Validates: Requirements 13.1, 13.3, 13.4**

  - [x] 13.4 Escrever property test de motivo de (não) ativação de poder
    - **Property 38: Motivo de toda (não) ativação de poder**
    - **Validates: Requirements 13.2**

  - [x] 13.5 Escrever property test de aviso único por efeito inerte relevante
    - **Property 31: Efeito inerte relevante gera exatamente um aviso**
    - **Validates: Requirements 9.4**

  - [x] 13.6 Escrever property test de clima registrado no log
    - **Property 24: Clima e modificadores registrados no log**
    - **Validates: Requirements 7.6**

  - [x] 13.7 Escrever property test de origem versionada e status não-calibrado
    - **Property 15: Origem versionada e status não-calibrado no log**
    - **Validates: Requirements 5.5, 6.10**

  - [x] 13.8 Escrever property test de estatísticas coerentes com eventos
    - **Property 39: Estatísticas agregadas coerentes com os eventos**
    - **Validates: Requirements 13.5**

  - [x] 13.9 Escrever property test de soma de pontos coerente com scoring
    - **Property 11: Soma de pontos coerente com eventos de scoring**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6**

  - [x] 13.10 Escrever property test de log de decisão e fatores por snap
    - **Property 13: Todo snap registra decisão e fatores de situação**
    - **Validates: Requirements 4.5**

- [x] 14. Implementar a orquestração pura `simulate`
  - [x] 14.1 Implementar `simulate.ts` (função pura que orquestra tudo)
    - Implementar `simulate(input: ResolvedInput): SimulationResult` ligando RNG, inicialização (sorteio de clima), loop de ticks, FSM, pipeline de jogada, log e estatísticas
    - Criar o `Rng` uma única vez a partir de `input.seed`; consumir o clima na inicialização antes das jogadas
    - Produzir `{ log, score, seedUsed }` com `score.final`/`score.tie` corretos; registrar `seedUsed` no log
    - Garantir ausência total de I/O, relógio de sistema e entropia externa no caminho do núcleo
    - _Requirements: 1.1, 1.5, 1.7, 2.6_

  - [x] 14.2 Escrever property test de determinismo byte a byte
    - **Property 1: Determinismo byte a byte**
    - **Validates: Requirements 1.1, 1.5, 12.7, 13.6, 15.5**

  - [x] 14.3 Escrever property test de sensibilidade ao seed
    - **Property 3: Sensibilidade ao seed**
    - **Validates: Requirements 1.4**

  - [x] 14.4 Escrever property test de seed registrado no log
    - **Property 4: Seed registrado no log**
    - **Validates: Requirements 1.7**

- [x] 15. Implementar os três modos de bot
  - [x] 15.1 Implementar `bots/policy.ts` + presets
    - Definir a interface `PlayPolicy` e os pesos situacionais de cada preset (BALANCED, GROUND, AERIAL, CURTI)
    - Submeter todo bot ao mesmo motor, regras, RNG, fadiga e esfera; sem atributos ocultos nem leitura do estado oculto do adversário
    - _Requirements: 12.1_

  - [x] 15.2 Implementar `bots/randomBot.ts`, `bots/curtiBot.ts` e `bots/seededBot.ts`
    - `randomBot`: sortear exatamente 1 dos 4 presets na inicialização, restrito ao catálogo
    - `curtiBot`: usar o preset CURTI com seu perfil tático, sem atributos extras
    - `seededBot`: manter exatamente o time importado (sem modificar atributos) e aplicar a IA do preset padrão
    - Rejeitar modo não suportado e seed de terceiros inválida (tratado no adaptador; a política só expõe os três modos)
    - _Requirements: 12.2, 12.3, 12.4_

  - [x] 15.3 Escrever property test de bot sem vantagem oculta
    - **Property 35: Bot não recebe vantagem oculta**
    - **Validates: Requirements 12.1**

  - [x] 15.4 Escrever property test de preservação do time importado
    - **Property 36: Preservação do time importado no modo seed de terceiros**
    - **Validates: Requirements 12.4**

- [x] 16. Checkpoint — garantir que FSM, log, estatísticas, simulate e bots passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Implementar a Funcao_Simulacao (adaptador de backend)
  - [x] 17.1 Implementar `app/api/simulate/route.ts` (handler server-only)
    - Aceitar as duas escalações, as estratégias de ambos e o `Seed_RNG` (`SimulateRequest`)
    - Validar forma e faixas: seed presente, inteiro, em `[0, 2^64-1]`; escalações (4 golpes, `instance_id` único); estratégias; modo de bot
    - Resolver dados via `lib/data/` (`getDesignBaseline`, `getMove`, `getAbility`, gancho `getNflMatchups`) e montar `ResolvedInput` imutável
    - Invocar o núcleo puro `simulate` e serializar com `stableStringify`; retornar `{ log, score }`
    - Rejeitar entrada inválida/incompleta com erro descritivo + campo, sem executar a partida; seed inválida → recusa; modo/seed de terceiros inválidos → erro preservando o estado; executar só no backend
    - _Requirements: 1.6, 12.5, 12.6, 15.1, 15.2, 15.3, 15.4, 15.6_

  - [x] 17.2 Escrever property test de validação de entrada da função
    - **Property 42: Validação de entrada da função de backend**
    - **Validates: Requirements 1.6, 15.4**

  - [x] 17.3 Escrever testes de integração do contrato e reprodutibilidade
    - Smoke test do handler: aceita os 5 campos e retorna `{ log, score }`; núcleo não exposto ao cliente (server-only)
    - Partida completa reproduzível: mesmo seed = mesmo log/placar byte a byte entre invocações; seeds diferentes podem divergir
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 1.4_

- [x] 18. Checkpoint final — garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são sub-tarefas de teste opcionais e podem ser puladas para um MVP mais rápido; as tarefas de implementação sem `*` são obrigatórias.
- Cada tarefa referencia os requisitos (cláusulas granulares) para rastreabilidade.
- As 42 Correctness Properties do design recebem, cada uma, sua própria sub-tarefa de property test com `fast-check` (mín. 100 iterações), posicionada próxima da implementação que valida.
- Os checkpoints garantem validação incremental em cortes naturais do grafo de dependências.
- Testes de exemplo/integração complementam os PBT para contratos, configuração e caminhos de borda (seção Testing Strategy do design).
- O núcleo é puro: sem `Math.random`, `Date.now`, `crypto` não-determinístico, `performance.now` ou leitura de ambiente. Toda variação entra pela assinatura e sai no resultado.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.1", "5.1", "5.3", "7.1", "8.1", "8.3", "9.1"] },
    { "id": 4, "tasks": ["3.3", "3.4", "4.2", "4.3", "4.4", "4.5", "4.6", "5.2", "5.4", "5.5", "7.2", "7.3", "7.4", "7.5", "8.2", "8.4", "8.5", "9.2", "10.1"] },
    { "id": 5, "tasks": ["10.2", "10.3"] },
    { "id": 6, "tasks": ["10.4", "10.5", "12.1"] },
    { "id": 7, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 8, "tasks": ["12.5", "12.6", "12.7", "12.8", "12.9", "12.10", "13.1"] },
    { "id": 9, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "13.10"] },
    { "id": 10, "tasks": ["13.8", "13.9", "14.1"] },
    { "id": 11, "tasks": ["14.2", "14.3", "14.4", "15.1"] },
    { "id": 12, "tasks": ["15.2", "15.3"] },
    { "id": 13, "tasks": ["15.4", "17.1"] },
    { "id": 14, "tasks": ["17.2", "17.3"] }
  ]
}
```
