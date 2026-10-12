# Convenções de projeto — PFL

Este documento descreve as convenções base da fundação do PFL (Pokémon Football
League): a estrutura de pastas do projeto e a nomenclatura das variáveis de
ambiente. Ele é o artefato versionado que atende aos requisitos **R1.6**
(estrutura de pastas separando UI, backend e acesso a dados, descrita em
documentação versionada) e **R4.3** (documentar as convenções de estrutura de
pastas e de nomenclatura de variáveis de ambiente).

## Estrutura de pastas

O projeto é um app Next.js (App Router, React + TypeScript em strict mode)
preparado para deploy na Vercel. As camadas são mantidas em diretórios
distintos: **interface (UI)**, **backend** e **acesso a dados**.

```
pfl/
├─ app/                      # Next.js App Router — camada UI e rotas
│  ├─ (ui)/                  # páginas e layouts (UI)
│  │  └─ page.tsx
│  ├─ api/                   # Route Handlers (Vercel Functions / backend HTTP)
│  └─ layout.tsx             # layout raiz da aplicação
├─ functions/               # Vercel Functions isoladas de backend (não-UI)
├─ components/              # componentes React reutilizáveis (UI)
├─ lib/
│  ├─ supabase/             # Módulo Cliente_Supabase (anon + service role)
│  │  ├─ env.ts             # validação de variáveis de ambiente
│  │  ├─ public-client.ts   # cliente anon (browser/server)
│  │  └─ server-client.ts   # cliente service-role (somente server)
│  ├─ data/                 # data access layer (consultas, repositórios)
│  └─ seed/                 # (futuro) serialização/checksum de .pflseed.json
├─ supabase/
│  └─ migrations/           # arquivos de migration versionados (DDL)
├─ docs/
│  └─ project-conventions.md # este documento
├─ .env.example             # nomes das variáveis de ambiente obrigatórias
├─ .gitignore               # ignora arquivos .env* locais
├─ next.config.ts
├─ tsconfig.json            # strict mode habilitado
├─ vercel.json              # framework Next.js + runtime Node.js
├─ package.json
└─ package-lock.json        # lock de dependências versionado
```

> Observação: diretórios que ainda não têm código próprio nesta fundação são
> mantidos no repositório por meio de arquivos `.gitkeep`. O conteúdo
> definitivo (ex.: `lib/supabase/env.ts`, `public-client.ts`,
> `server-client.ts`) é entregue nas tarefas correspondentes da spec.

### Camada de interface (UI)

A interface do usuário vive em dois diretórios:

- **`app/(ui)/`** — páginas e layouts renderizados ao usuário. O grupo de rotas
  `(ui)` organiza as telas sem acrescentar segmento à URL.
- **`components/`** — componentes React reutilizáveis consumidos pelas páginas.

Essa camada chama o backend por HTTP e, quando apropriado, faz leitura pública
diretamente via cliente anon do Supabase (sujeito às políticas RLS).

### Camada de backend

O código de servidor fica separado da UI em dois diretórios:

- **`app/api/`** — Route Handlers do Next.js, executados como Vercel Functions.
  É o backend HTTP acessado pela UI.
- **`functions/`** — Vercel Functions isoladas de backend, para código de
  servidor que não é uma rota HTTP da aplicação (atende ao diretório dedicado
  de Vercel Functions exigido por R1.5).

O backend nunca é importado pelo bundle do browser. Operações privilegiadas
usam exclusivamente o cliente service-role (ver abaixo).

### Camada de acesso a dados

O acesso ao banco é isolado do restante da aplicação:

- **`lib/data/`** — data access layer: consultas e repositórios sobre o
  `Schema_PFL`. É a fronteira que esconde os detalhes do cliente Supabase do
  resto do app.
- **`lib/supabase/`** — o Módulo Cliente_Supabase, responsável por toda conexão
  autenticada:
  - `env.ts` — lê e valida as variáveis de ambiente obrigatórias.
  - `public-client.ts` — cliente anon (seguro no browser e no servidor).
  - `server-client.ts` — cliente service-role (somente em contexto de
    servidor).

Diretórios de apoio ao domínio de dados: **`lib/seed/`** (serialização e
checksum de `.pflseed.json`, em spec futura) e **`supabase/migrations/`**
(DDL versionado que define o schema).

### Resumo da separação de camadas

| Camada          | Diretórios                       | Responsabilidade                           |
|-----------------|----------------------------------|--------------------------------------------|
| Interface (UI)  | `app/(ui)/`, `components/`       | Páginas, layouts e componentes React       |
| Backend         | `app/api/`, `functions/`         | Route Handlers e Vercel Functions          |
| Acesso a dados  | `lib/data/`, `lib/supabase/`     | Consultas ao schema e cliente Supabase     |

## Nomenclatura de variáveis de ambiente

Nenhuma credencial é escrita no código-fonte. Todos os valores sensíveis ou
dependentes de ambiente são lidos em tempo de execução a partir de variáveis de
ambiente. O arquivo `.env.example`, versionado no repositório, lista os nomes
obrigatórios com valores em branco; os valores reais ficam em `.env.local`, que
nunca é comitado (ver `.gitignore`).

### Convenção de prefixo

A regra de nomenclatura segue a convenção do Next.js para visibilidade:

- **Prefixo `NEXT_PUBLIC_`** — a variável é embutida no bundle do cliente e,
  portanto, **exposta ao browser**. Use apenas para valores que podem ser
  públicos com segurança.
- **Sem prefixo `NEXT_PUBLIC_`** — a variável só existe no servidor e **nunca é
  enviada ao browser**. Use para toda credencial privilegiada.

### Variáveis obrigatórias

| Variável                        | Visibilidade          | Prefixo `NEXT_PUBLIC_` | Uso                                                     |
|---------------------------------|-----------------------|------------------------|---------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`      | Pública (browser-safe)| Sim                    | URL do projeto Supabase (cliente público e server-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública (browser-safe)| Sim                    | Chave pública anônima usada pelo cliente anon           |
| `SUPABASE_SERVICE_ROLE_KEY`     | Somente servidor      | Não                    | Chave de service role; privilegiada, ignora RLS         |

### Regras de nomenclatura

1. A URL do projeto e a chave anônima são **públicas por design** e usam o
   prefixo `NEXT_PUBLIC_`: `NEXT_PUBLIC_SUPABASE_URL` e
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. A chave de service role é privilegiada (bypassa RLS) e **nunca** pode levar o
   prefixo `NEXT_PUBLIC_`, para não vazar ao browser. O nome correto é
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Se qualquer variável obrigatória estiver ausente ou vazia em tempo de
   execução, a inicialização do Cliente_Supabase é abortada e o erro lista pelo
   nome cada variável faltante (R2.3). Mensagens de erro **nunca** ecoam o valor
   de uma credencial.
```