# anti-slop (Anti_Slop) — regras de agente do projeto

Este diretório (`pfl/.kiro/steering/`) é o local reconhecido pelo Kiro como **regras
de projeto do agente**. O arquivo `antislop.md` aqui é o filtro core do pacote
[anti-slop](https://github.com/miqdadbadjuber/anti-slop) (`npx antislop-ai`), versão
**v3.2.20**, versionado no repositório conforme o Requisito 3 da spec `pfl-foundation`.

## Como foi instalado

O instalador oficial `npx antislop-ai` é uma TUI interativa que:

1. exige um terminal interativo real (recusa execução sem TTY, inclusive via stdin
   encaminhado ou processo em segundo plano); e
2. não lista o Kiro entre os agentes de destino que ele reconhece (Claude Code,
   Codex, Cursor, Gemini CLI, Copilot, etc.), portanto não grava artefatos em
   `.kiro/steering/`.

Por isso, seguimos a rota de **instalação manual documentada pelo próprio pacote**
(seção "First-Run Install Wizard" do `antislop.md`): posicionar o filtro core
`antislop.md` no local de regras do agente e versioná-lo. O conteúdo foi obtido do
repositório oficial na versão registrada em `antislop.VERSION`.

O comando `npx antislop-ai --mode during` foi executado e gravou a preferência global
de modo em `%APPDATA%\antislop\settings.json` (fora do repositório). Isso define o modo
padrão de uso do anti-slop; não altera os artefatos versionados aqui.

## Inclusão como regra sempre ativa

`antislop.md` possui front matter `inclusion: always`, de modo que o Kiro carrega essas
regras em toda sessão como steering de projeto.

## Skills opcionais

O core (`antislop.md`) é um filtro completo por si só. As skills adicionais
(`antislop-ui`, `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile`,
`antislop-code`) são opcionais e não foram instaladas. Para adicioná-las, obtenha as
pastas `skills/<nome>/SKILL.md` da release correspondente (v3.2.20) e coloque-as ao lado
de `antislop.md`.

## Atualização

Para atualizar: baixar novamente o `antislop.md` da release mais recente e substituir o
arquivo aqui, atualizando `antislop.VERSION`.
