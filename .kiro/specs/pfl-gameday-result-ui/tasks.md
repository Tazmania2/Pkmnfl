# Implementation Plan: pfl-gameday-result-ui

## Overview

Este plano converte o design das telas **Game Day** (`/game-day`) e **Resultado** (`/resultado`) numa sequência de tarefas de implementação incrementais em **Next.js (React + TypeScript, App Router)**. A estratégia segue os princípios do design: **o log é a única verdade**, **apresentação separada de lógica**, **animação como função pura do log + player burro**, e **anti-slop** (teclado, foco, contraste, estados distinguíveis, alternativa textual, nenhum número sem origem).

A ordem de construção parte dos **módulos puros** (`lib/match/`) — o coração testável da spec — para então montar a **store/FSM**, o **adaptador de chamada ao motor**, os **componentes de apresentação**, as **rotas** e a **integração** final. Cada propriedade das 27 Correctness Properties vira um teste de propriedade (`fast-check`, mín. 100 iterações) posicionado junto ao módulo que a satisfaz. Testes de componente/acessibilidade (`@testing-library/react` + `jest-axe`) e de integração (mock determinístico de `POST /api/simulate`) complementam.

Reusos estritos (sem reimplementar): `lib/validation` (`validateDraft`/`hasBlocking`) e `lib/seed/import` (`importSeed`) de `pfl-team-strategy-ui`; `lib/data/` (sprites via `raw_data`) de `pfl-data-catalog`; e `POST /api/simulate` de `pfl-simulation-engine`.

> Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido. As demais são obrigatórias. Cada tarefa referencia cláusulas de requisito específicas para rastreabilidade.

## Tasks

- [x] 1. Preparar estrutura, tipos de consumo e infraestrutura de testes
  - Criar a estrutura de diretórios `lib/match/`, `components/gameday/`, `components/result/` e `app/(match)/` (layout comum às duas rotas).
  - Definir o módulo de tipos locais `lib/match/types.ts` com `ModoAdversario`, `MatchPhase`, `MatchState`, `MatchError`, `Scene`, `SpriteRef`, `ProgressFrame`, `Outcome`, `Highlight`, `SpriteResolution`, `SimulateInput`, `SimulateOutcome`.
  - Reexportar/importar os contratos consumidos (`GameLog`, `LogEvent`, `StateSnapshot`, `GameStats`, `Score`, `Weather`, `SimulateRequest`, `SimulateResponse`, `SimulateError`, `BotMode`, `TeamDraft`, `ImportResult`) das specs anteriores, sem redefinir.
  - Configurar `fast-check` no runner existente (Vitest/Jest) e `jest-axe`/`axe-core` + `@testing-library/react`; garantir `numRuns: 100` por padrão nos testes de propriedade.
  - _Requirements: 2.4, 6.1, 6.4, 17.5_

- [x] 2. Implementar o mapeamento de modos e a geração de seed (módulos puros base)
  - [x] 2.1 Implementar `lib/match/modo.ts`
    - Escrever `modoParaBot(modo)` como função pura total sobre os três modos (`bot_aleatorio`→`random`, `desafiar_curti`→`curti`, `importar_seed`→`seeded`) e exportar `MODOS_SUPORTADOS` (cardinalidade três).
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Escrever teste de propriedade para `modoParaBot`
    - **Property 1: Mapeamento modo → bot é total e correto**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [x] 2.3 Implementar `lib/match/seed-rng.ts`
    - Escrever `gerarSeedRng()` (uint64 como string decimal, entropia só na geração de nova partida) e `parseSeedRng(entrada)` (valida faixa `[0, 2^64−1]`; `null` se inválido). O `Seed_RNG` nunca é derivado de seed de time.
    - _Requirements: 6.2, 16.1, 16.3_

  - [x] 2.4 Escrever testes unitários para `seed-rng`
    - Testar faixa uint64, limites (`0`, `2^64−1`), entradas inválidas (vazio, negativo, overflow, não numérico).
    - _Requirements: 6.2_

- [x] 3. Implementar os leitores de andamento puros (`lib/match/progress.ts`)
  - [x] 3.1 Implementar `progressAt(log, eventIndex)` e `formatClock(gameClockDeci)`
    - `progressAt` projeta `log.events[i].state`/`narrative` num `ProgressFrame` (placar, quarto, relógio, down, distância, posse, clima, narrativa, warnings de `powerReason`/`detail`), sem inventar valores. `formatClock` converte décimos → `mm:ss`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 12.1_

  - [x] 3.2 Escrever teste de propriedade: projeção espelha o estado do evento
    - **Property 11: Projeção de andamento espelha o estado do evento**
    - **Validates: Requirements 8.1, 8.2, 8.4**

  - [x] 3.3 Escrever teste de propriedade: ordem determinística das narrativas
    - **Property 12: Narrativas exibidas seguem a ordem determinística do log**
    - **Validates: Requirements 8.3**

  - [x] 3.4 Escrever teste de propriedade: avisos de efeito inerte sem bônus silencioso
    - **Property 20: Fidelidade de avisos de efeito inerte, sem bônus silencioso**
    - **Validates: Requirements 12.1, 12.2, 12.3**

- [x] 4. Implementar o planejador de cenas da animação (`lib/match/animation.ts`)
  - [x] 4.1 Implementar `buildAnimationScenes(log): Scene[]`
    - Filtrar eventos de Snap preservando ordem crescente de `seq`; por Snap, montar `offenseSprites`/`defenseSprites` por posse, extrair `resultKind` do `detail`, `narrative`, `warnings` do `powerReason`/`detail`; derivar `durationHint` deterministicamente do próprio Snap (sem `Date`/`Math.random`), com `clamp` em `[MIN_MS, MAX_MS]`; numerar `index` 0..N-1. Log sem Snaps → `[]`.
    - _Requirements: 9.1, 9.3, 9.7, 10.1, 10.2, 12.1_

  - [x] 4.2 Escrever teste de propriedade: bijeção ordenada Snap↔cena
    - **Property 13: Cenas da animação são uma bijeção ordenada dos Snaps do log**
    - **Validates: Requirements 9.1, 9.3**

  - [x] 4.3 Escrever teste de propriedade: pureza e determinismo
    - **Property 14: `buildAnimationScenes` é pura e determinística** (injetar `Date.now`/`Math.random` adulterados)
    - **Validates: Requirements 10.1, 10.2, 16.2**

  - [x] 4.4 Escrever teste de propriedade: log sem Snaps produz zero cenas
    - **Property 17: Log sem Snaps produz zero cenas e vai direto ao resultado**
    - **Validates: Requirements 9.7**

- [x] 5. Implementar a camada fina de sprites (`lib/match/sprites.ts`)
  - [x] 5.1 Implementar `resolveSprite(pokemonId, species): SpriteResolution`
    - Selecionar deterministicamente a melhor entrada 8-bit de `species.raw_data.sprites` (via Camada_Leitura); se ausente, retornar `SPRITE_SUBSTITUTO` local (`isFallback: true`); preencher `alt` descritivo. Nunca acessar fontes externas em runtime.
    - Adicionar o asset `public/sprites/substituto.png` (sprite substituto padrão empacotado).
    - _Requirements: 9.2, 9.6, 17.4_

  - [x] 5.2 Escrever teste de propriedade: sprite da Camada_Leitura ou substituto local
    - **Property 21: Sprite vem da Camada_Leitura ou do substituto local, nunca de fonte externa**
    - **Validates: Requirements 9.2, 9.6**

- [x] 6. Implementar as funções puras de resultado (`lib/match/result.ts`)
  - [x] 6.1 Implementar `determineOutcome(score)` e `selectHighlights(log)`
    - `determineOutcome` deriva `winner`/`tie` apenas de `score.home`/`score.away`. `selectHighlights` percorre `log.events`/`log.stats.scoringSummary` em ordem determinística, cada `Highlight` referenciando um `eventIndex` existente; sem inventar eventos.
    - _Requirements: 13.2, 13.3, 13.4, 14.2, 14.3_

  - [x] 6.2 Escrever teste de propriedade: desfecho derivado só do placar
    - **Property 22: Desfecho derivado exclusivamente do placar**
    - **Validates: Requirements 13.2, 13.3, 13.4**

  - [x] 6.3 Escrever teste de propriedade: highlights derivados, determinísticos e rastreáveis
    - **Property 24: Highlights são derivados, determinísticos e rastreáveis ao log**
    - **Validates: Requirements 14.2, 14.3**

  - [x] 6.4 Escrever teste de propriedade: origem rastreável de todo valor exibido
    - **Property 10: Origem rastreável de todo valor exibido** (sobre `progressAt`/`determineOutcome`/`selectHighlights`)
    - **Validates: Requirements 6.4, 8.5, 13.4, 14.3, 17.5**

- [x] 7. Checkpoint — garantir que os módulos puros passam
  - Garantir que todos os testes passam, pergunte ao usuário caso surjam dúvidas.

- [x] 8. Implementar a store de partida e a FSM (`lib/match/store.ts`)
  - [x] 8.1 Implementar `MatchStore` com transições puras da FSM
    - Modelar as fases `Selecionando→Validando→Simulando→Animando→Resultado→Erro`; implementar `selecionarModo`, `setAdversarioSeed`, `iniciarSimulacao` (só transita de `Selecionando`; idempotente em `Simulando`), `concluirSimulacao`, `registrarErro`, `irParaResultado`, `reset`. A store nunca calcula placar/estatística — apenas retém o que o motor devolveu.
    - Implementar `confirmarHabilitado(state)`: habilitado sse modo selecionado + validação sem bloqueio + (no `importar_seed`) seed aprovada.
    - _Requirements: 1.2, 3.3, 5.2, 5.3, 6.3, 6.4, 7.3, 4.5, 5.1_

  - [x] 8.2 Implementar `snapshot()`/`restore()` via `sessionStorage`
    - Serializar `MatchState` de forma estável (`stableStringify`) para sobreviver a refresh/deep-link em `/resultado`; restaurar sem recalcular valores.
    - _Requirements: 16.2, 16.3_

  - [x] 8.3 Escrever teste de propriedade: seleção de modo registra o modo escolhido
    - **Property 2: Seleção de modo registra exatamente o modo escolhido**
    - **Validates: Requirements 1.2**

  - [x] 8.4 Escrever teste de propriedade: gate de confirmação
    - **Property 3: Gate de confirmação habilita se e somente se validação aprovada e modo selecionado**
    - **Validates: Requirements 4.5, 5.1**

  - [x] 8.5 Escrever teste de propriedade: idempotência da confirmação
    - **Property 6: Confirmação é idempotente por partida**
    - **Validates: Requirements 5.2, 5.3**

  - [x] 8.6 Escrever teste de propriedade: sucesso retém log/placar e avança
    - **Property 9: Sucesso retém log e placar e avança para a animação**
    - **Validates: Requirements 6.3**

  - [x] 8.7 Escrever teste de propriedade: exibição de andamento só com log recebido
    - **Property 27: Exibição de andamento só ocorre com log recebido**
    - **Validates: Requirements 7.3**

- [x] 9. Implementar o adaptador de chamada ao motor (`lib/match/simulate-client.ts`)
  - [x] 9.1 Implementar `runSimulation(input): Promise<SimulateOutcome>`
    - Montar o `SimulateRequest` com as duas escalações, as duas estratégias e o `seed` (= `Seed_RNG`), `botModeAway = modoParaBot(modo)`; `POST /api/simulate` uma única vez. Normalizar `400 { error, field }` → `{ ok:false, kind:'INPUT' }`; exceção de rede/timeout → `{ ok:false, kind:'NETWORK' }`; sucesso → `{ ok:true, log, score }`. Não recalcular valores.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 7.4, 2.3_

  - [x] 9.2 Escrever teste de propriedade: forma do request
    - **Property 7: O request de simulação contém as duas escalações, as duas estratégias e o Seed_RNG**
    - **Validates: Requirements 6.1, 2.3**

  - [x] 9.3 Escrever teste de propriedade: Seed_RNG independente do seed de time
    - **Property 8: Seed_RNG é independente do seed de time**
    - **Validates: Requirements 6.2**

  - [x] 9.4 Escrever teste de propriedade: erros de entrada/comunicação não animam nem navegam
    - **Property 26: Erros de entrada e de comunicação não animam nem navegam, e preservam a retomada**
    - **Validates: Requirements 6.5, 7.4**

- [x] 10. Integrar validação e importação de seed no fluxo pré-simulação
  - [x] 10.1 Implementar orquestração de validação pré-simulação
    - Ligar `validateDraft`/`hasBlocking` (time do jogador) e, no `importar_seed`, `importSeed` (adversário) ao `confirmarHabilitado` e à transição `Validando`; em recusa, registrar `MatchError` específico, preservar estado e bloquear a simulação; tratar a seed como dados (sem executar conteúdo).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 10.2 Escrever teste de propriedade: validação bloqueante preserva estado
    - **Property 4: Validação bloqueante impede a simulação e preserva o estado**
    - **Validates: Requirements 4.1, 4.3**

  - [x] 10.3 Escrever teste de propriedade: recusa de seed/validação do adversário
    - **Property 5: Recusa de seed/validação do adversário preserva o estado e explica o motivo**
    - **Validates: Requirements 3.2, 4.2, 4.4**

- [x] 11. Checkpoint — garantir que store, adaptador e integração passam
  - Garantir que todos os testes passam, pergunte ao usuário caso surjam dúvidas.

- [x] 12. Montar o Context provider da store e o layout comum
  - [x] 12.1 Implementar o provider de `MatchStore` em layout comum às rotas
    - Criar `app/(match)/layout.tsx` com React Context + provider montado acima de `/game-day` e `/resultado`, integrando `snapshot`/`restore` com `sessionStorage` e um hook `useMatchStore()`.
    - _Requirements: 16.2, 16.3_

- [x] 13. Implementar os componentes de apresentação da Tela Game Day
  - [x] 13.1 Implementar `SeletorModo` e `SeedRngDisplay`
    - `SeletorModo`: três `<button>` grandes rotulados ("Bot aleatório", "Desafiar Curti", "Importar seed"), marcando o selecionado por mais de um recurso visual (não só cor). `SeedRngDisplay`: exibe o `Seed_RNG` corrente de forma rastreável/copiável.
    - _Requirements: 1.1, 1.2, 1.3, 16.3, 17.2, 17.3, 17.6_

  - [x] 13.2 Implementar `ImportadorSeedAdversario`, `BotaoConfirmar`, `EstadoCarregamento` e `AvisoErro`
    - `ImportadorSeedAdversario`: pede `.pflseed.json`, chama `importSeed`, exibe motivo específico em recusa (ARIA). `BotaoConfirmar`: único controle, habilitado só quando `confirmarHabilitado`, idempotente em `Simulando`. `EstadoCarregamento`: indicador honesto, sem placar/estatística. `AvisoErro`: mensagem legível associada por `aria-describedby`/`aria-errormessage`, com retry.
    - _Requirements: 3.1, 3.2, 3.4, 4.5, 5.1, 5.2, 5.3, 6.5, 7.1, 7.2, 7.3, 7.4, 17.3, 17.7_

  - [x] 13.3 Implementar `PainelAndamento` (HUD) e `AlternativaTextual`
    - `PainelAndamento`: placar, quarto, relógio, down/distância, posse, clima e narrativa do Snap corrente via `progressAt`, exibindo avisos inertes junto à narrativa. `AlternativaTextual`: região `aria-live="polite"` com narrativa + avisos da cena corrente e a lista completa, invariante ao modo de reprodução.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 11.5, 12.1, 17.4_

  - [x] 13.4 Escrever teste de propriedade: Alternativa_Textual equivale à narrativa do log
    - **Property 19: Alternativa_Textual equivale à narrativa do log, invariante ao modo de reprodução**
    - **Validates: Requirements 11.5, 17.4**

  - [x] 13.5 Escrever testes de componente e acessibilidade dos controles Game Day
    - `SeletorModo` com três botões grandes rotulados; `BotaoConfirmar` desabilitado sob validação pendente; `EstadoCarregamento` aparece em `Simulando` e some ao receber log; checagens `jest-axe`, ordem de `Tab`, foco visível, erros anunciados ao focar.
    - _Requirements: 1.1, 1.3, 5.1, 7.1, 7.2, 17.1, 17.2, 17.6, 17.7_

- [x] 14. Implementar o player de animação (`components/gameday/AnimationPlayer.tsx`)
  - [x] 14.1 Implementar `AnimationPlayer` (player burro) com controles pular/acelerar
    - Receber `Scene[]` prontas; laço `requestAnimationFrame` só controla cadência (`durationHint / speed`), nunca a sequência. Pular: `currentIndex = scenes.length` + `onComplete` em ≤500ms. Acelerar: alterna `speed` 1x↔2x. Resolver sprites via `resolveSprite` (substituto em ausência). `scenes.length === 0` → `onComplete` imediato. Controles como `<button>` focáveis por teclado com foco visível; ocultar quando indisponível/concluída, mantendo a Alternativa_Textual.
    - _Requirements: 9.1, 9.4, 9.5, 9.6, 9.7, 10.1, 11.1, 11.2, 11.3, 11.4, 11.6, 11.7, 17.2_

  - [x] 14.2 Escrever teste de propriedade: reprodução/pular/acelerar não alteram log/placar
    - **Property 15: Reprodução, pular e acelerar não alteram log nem placar**
    - **Validates: Requirements 9.4**

  - [x] 14.3 Escrever teste de propriedade: conclusão/pular conduzem ao resultado com o placar do log
    - **Property 16: Conclusão e pular conduzem ao resultado usando o placar do log**
    - **Validates: Requirements 9.5, 11.2**

  - [x] 14.4 Escrever teste de propriedade: toggle de velocidade determinístico 1x/2x
    - **Property 18: Alternância de velocidade é determinística entre 1x e 2x**
    - **Validates: Requirements 11.3, 11.4**

  - [x] 14.5 Escrever testes de componente/acessibilidade do player
    - Controles de pular/acelerar visíveis e acionáveis por teclado durante a reprodução; medir que o pular conclui em ≤500ms; foco visível; `jest-axe`.
    - _Requirements: 11.1, 11.2, 11.6, 17.2_

- [x] 15. Implementar os componentes de apresentação da Tela Resultado
  - [x] 15.1 Implementar `PlacarFinal`, `ResultadoDesfecho`, `EstatisticasPartida`, `Highlights` e `NavegacaoResultado`
    - `PlacarFinal`: placar final direto do `Score`. `ResultadoDesfecho`: vencedor/empate via `determineOutcome`. `EstatisticasPartida`: corridas, passes, turnovers, faltas de `log.stats`. `Highlights`: lista de `selectHighlights(log)`. `NavegacaoResultado`: botões rotulados "Voltar ao Game Day" (`router.push('/game-day')`) e "Editar time" (`router.push('/time')`).
    - _Requirements: 13.1, 13.4, 14.1, 14.3, 15.1, 15.2, 15.3_

  - [x] 15.2 Escrever teste de propriedade: estatísticas exibidas igualam `GameStats`
    - **Property 23: Estatísticas exibidas igualam `GameStats` do log**
    - **Validates: Requirements 14.1**

  - [x] 15.3 Escrever testes de componente/acessibilidade da Tela Resultado
    - `PlacarFinal`/`EstatisticasPartida`/`Highlights` renderizam exatamente os valores do log/placar; `NavegacaoResultado` chama `router.push` com roteador mockado; `jest-axe`, ordem de `Tab`, foco visível.
    - _Requirements: 13.1, 14.1, 15.1, 15.2, 15.3, 17.1, 17.2_

- [x] 16. Implementar a rota Game Day e ligar a orquestração (`app/(match)/game-day/page.tsx`)
  - [x] 16.1 Montar `/game-day` como Client Component orquestrador
    - Compor `SeletorModo`, `ImportadorSeedAdversario`, `BotaoConfirmar`, `SeedRngDisplay`, `EstadoCarregamento`, `AvisoErro`, `PainelAndamento`, `AnimationPlayer`, `AlternativaTextual` sobre a store; conectar o fluxo validar→confirmar→`runSimulation`→`buildAnimationScenes`→animar; `onComplete`/pular → `irParaResultado` + `router.push('/resultado')`.
    - _Requirements: 4.1, 5.1, 5.2, 6.1, 6.3, 6.5, 7.1, 7.4, 9.5, 9.7, 11.2_

- [x] 17. Implementar a rota Resultado (`app/(match)/resultado/page.tsx`)
  - [x] 17.1 Montar `/resultado` como apresentação da store
    - Ler `log`+`score` já retidos (com `restore` do snapshot em refresh/deep-link); compor `PlacarFinal`, `ResultadoDesfecho`, `EstatisticasPartida`, `Highlights`, `NavegacaoResultado`. Não reenviar simulação.
    - _Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 15.1, 16.2_

  - [x] 17.2 Escrever teste de propriedade: Seed_RNG exibido é o seed da partida corrente
    - **Property 25: Seed_RNG exibido é o seed da partida corrente**
    - **Validates: Requirements 16.3**

- [x] 18. Testes de integração de ponta a ponta das telas
  - [x] 18.1 Escrever testes de integração contra mock determinístico de `/api/simulate`
    - Round-trip de reprodução por seed (mesmo request → mesmo `log`/`score`, R16.1); `400` → estado `INPUT` sem animar/navegar (R6.5); exceção de rede → estado `NETWORK` com retry (R7.4); `Modo_Importar_Seed` com `.pflseed.json` válido e inválido exercitando `importSeed` (R3.1–R3.3); smoke de segurança (importação só parseia, nunca executa, R3.4).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.5, 7.4, 16.1_

- [x] 19. Checkpoint final — garantir que todos os testes passam
  - Garantir que todos os testes passam, pergunte ao usuário caso surjam dúvidas.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido.
- Cada tarefa referencia cláusulas de requisito específicas para rastreabilidade.
- Checkpoints asseguram validação incremental dos módulos puros, da store/integração e do conjunto final.
- Os testes de propriedade (`fast-check`, mín. 100 iterações) validam as 27 Correctness Properties; cada propriedade é uma sub-tarefa própria, anotada com número da propriedade e cláusulas de requisito, posicionada junto ao módulo que a satisfaz.
- Testes de componente/acessibilidade (`@testing-library/react` + `jest-axe`) e de integração (mock determinístico do motor) cobrem UI estática, navegação, acessibilidade e a borda com o endpoint.
- O log é a única verdade: nenhum valor é recalculado no cliente; a animação é representação visual e nunca altera `Log_Partida` nem `Placar`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "3.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.2", "3.3", "3.4", "4.1", "5.2", "6.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "6.2", "6.3", "6.4", "8.1"] },
    { "id": 4, "tasks": ["8.2", "9.1", "8.3", "8.4", "8.5", "8.6", "8.7"] },
    { "id": 5, "tasks": ["9.2", "9.3", "9.4", "10.1"] },
    { "id": 6, "tasks": ["10.2", "10.3", "12.1"] },
    { "id": 7, "tasks": ["13.1", "13.2", "13.3", "15.1"] },
    { "id": 8, "tasks": ["13.4", "13.5", "14.1", "15.2", "15.3", "17.2"] },
    { "id": 9, "tasks": ["14.2", "14.3", "14.4", "14.5", "16.1", "17.1"] },
    { "id": 10, "tasks": ["18.1"] }
  ]
}
```
