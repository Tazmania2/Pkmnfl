/**
 * Orquestração de validação pré-simulação (`lib/match/pre-simulacao.ts`) — spec
 * `pfl-gameday-result-ui`, Task 10.1.
 *
 * Sequencia a validação do time do jogador e a importação da seed do adversário
 * **antes** de autorizar a chamada ao motor, ligando `validateDraft`/`hasBlocking`
 * (time do jogador) e — no `Modo_Importar_Seed` — `importSeed` (adversário) ao
 * gate de confirmação (`confirmarHabilitado`) e à transição `Validando` da FSM
 * (design → "Fluxo das telas", "Máquina de estados", "Error Handling").
 *
 * ## Fronteira de dependência injetada (IMPORTANTE)
 *
 * As funções concretas `validateDraft`, `hasBlocking` e `importSeed` são
 * entregues pela spec `pfl-team-strategy-ui` (`lib/validation` e
 * `lib/seed/import`). No momento desta tarefa esses módulos **ainda não existem**
 * no repositório — exatamente como `lib/match/contracts.ts` já declara os tipos
 * `TeamDraft`/`ValidationWarning`/`ImportResult` como forward declarations até a
 * integração da spec 4.
 *
 * Para **não bloquear** esta spec e **não reimplementar** regras de validação de
 * time (princípio de design nº 4: "Validação reusada, nunca reimplementada"),
 * este módulo expõe uma **função de orquestração pura** que recebe essas três
 * funções por **injeção de dependência** (`PreSimulacaoDeps`). O orquestrador
 * **não** implementa nenhuma regra de "válido": ele apenas **sequencia** as
 * chamadas, interpreta o resultado e produz `MatchError`s específicos quando há
 * recusa, preservando o estado e bloqueando a simulação.
 *
 * Quando `pfl-team-strategy-ui` for integrada, o adaptador que monta `deps`
 * passará a referenciar `validateDraft`/`hasBlocking` de `@/lib/validation` e
 * `importSeed` de `@/lib/seed/import` diretamente — sem qualquer mudança neste
 * módulo (os tipos já são os de `contracts.ts`, que então reexportará os reais).
 *
 * ## Sequência (design → "Fluxo das telas")
 *
 * 1. **Validação do time do jogador** (R4.1): roda `validateDraft(playerDraft)`.
 *    Se `hasBlocking(warnings)` → produz `MatchError{ kind:'VALIDATION' }` com a
 *    mensagem/alvo do primeiro aviso bloqueante e **bloqueia** (não prossegue à
 *    simulação), preservando a Escalacao/Estrategia (R4.1, R4.3, R4.5).
 * 2. **(só no `importar_seed`) importação da seed do adversário** (R3.1, R4.2):
 *    roda `importSeed(seedBytes)`. Em recusa (`ok === false`) → produz
 *    `MatchError{ kind:'IMPORT' }` com o motivo específico e **bloqueia**,
 *    preservando o estado corrente (R3.2, R4.4). Em aprovação, devolve o
 *    `TeamDraft` do adversário para ser retido via `setAdversarioSeed` (R3.3).
 *
 * ## Seed tratada como dados (R3.4)
 *
 * O orquestrador recebe os bytes da seed como `Uint8Array` e os repassa a
 * `importSeed` **sem interpretar, avaliar ou executar** qualquer conteúdo. Não
 * há `eval`, `Function`, `require`, `import()` dinâmico nem qualquer execução de
 * código a partir do arquivo: a seed é apenas parseada como dados pelo pipeline
 * de importação (R3.4).
 *
 * O resultado é um discriminado `{ ok:true, adversarioDraft? }` /
 * `{ ok:false, error }` consumido pela página Game Day (Task 16.1) e pela store
 * (`setAdversarioSeed`/`iniciarSimulacao` ou `registrarErro`).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_
 */

import type {
  TeamDraft,
  ValidationWarning,
  ImportResult,
} from './contracts';
import type { MatchError, ModoAdversario } from './types';

// ---------------------------------------------------------------------------
// Fronteira de dependências injetadas (de pfl-team-strategy-ui)
// ---------------------------------------------------------------------------

/**
 * Valida o rascunho do time do jogador, retornando os avisos de validação.
 *
 * **Injetada** de `pfl-team-strategy-ui` (`lib/validation`). A assinatura real
 * recebe, além do `draft`, um retrato de elegibilidade e as convenções de
 * anatomia; este orquestrador não conhece essas regras — ele consome uma
 * função já **pré-ligada** ao contexto de validação (currying feito pelo
 * adaptador que monta `PreSimulacaoDeps`). Aqui, a entrada é apenas o `draft` do
 * jogador e a saída, a lista de `ValidationWarning` (R4.1).
 */
export type ValidateDraftFn = (draft: TeamDraft) => ReadonlyArray<ValidationWarning>;

/**
 * Indica se há **ao menos um** aviso bloqueante na lista — o gate que impede a
 * simulação (R4.5). **Injetada** de `pfl-team-strategy-ui`; o orquestrador não
 * reimplementa a noção de "bloqueante".
 */
export type HasBlockingFn = (warnings: ReadonlyArray<ValidationWarning>) => boolean;

/**
 * Importa a seed do adversário a partir dos **bytes crus** do `.pflseed.json`,
 * tratando-a **como dados** (R3.4): parseia/valida e devolve `ImportResult`
 * (`{ ok:true, draft }` ou `{ ok:false, reason }`). **Injetada** do fluxo de
 * Importacao_Seed de `pfl-team-strategy-ui` (`lib/seed/import`). O orquestrador
 * nunca executa o conteúdo do arquivo.
 */
export type ImportSeedFn = (seedBytes: Uint8Array) => ImportResult;

/**
 * Conjunto das dependências injetadas no orquestrador. Montado pelo adaptador
 * da camada de UI (Task 16.1) a partir de `pfl-team-strategy-ui`; mantém este
 * módulo livre de regras de validação/importação e, portanto, não bloqueado
 * pela ausência atual daquela spec.
 */
export interface PreSimulacaoDeps {
  readonly validateDraft: ValidateDraftFn;
  readonly hasBlocking: HasBlockingFn;
  /** Presente/necessária apenas no `Modo_Importar_Seed`. */
  readonly importSeed?: ImportSeedFn;
}

// ---------------------------------------------------------------------------
// Entrada e resultado da orquestração
// ---------------------------------------------------------------------------

/**
 * Entrada da orquestração pré-simulação: o rascunho do time do jogador (sempre
 * validado, R4.1), o modo de adversário corrente (R1.2) e — apenas no
 * `Modo_Importar_Seed` — os bytes da seed a importar (R3.1).
 */
export interface PreSimulacaoInput {
  /** Rascunho do time do jogador a validar (R4.1). */
  readonly playerDraft: TeamDraft;
  /** Modo de adversário selecionado (R1.2); decide se há importação de seed. */
  readonly modo: ModoAdversario;
  /**
   * Bytes crus do `.pflseed.json` do adversário, requeridos **sse**
   * `modo === 'importar_seed'` (R3.1). Tratados como dados (R3.4).
   */
  readonly seedBytes?: Uint8Array;
}

/**
 * Resultado discriminado da orquestração pré-simulação, consumido pela página
 * Game Day e pela store:
 *
 * - `{ ok:true, adversarioDraft? }` — todas as validações passaram; a simulação
 *   pode prosseguir. No `Modo_Importar_Seed`, `adversarioDraft` é o `TeamDraft`
 *   aprovado da seed, a ser retido via `setAdversarioSeed` (R3.3). Nos demais
 *   modos, `adversarioDraft` é omitido.
 * - `{ ok:false, error }` — alguma validação recusou; `error` é o `MatchError`
 *   específico (`VALIDATION` ou `IMPORT`). A simulação fica **bloqueada** e o
 *   estado corrente é preservado (R3.2, R4.1–R4.4).
 */
export type PreSimulacaoResult =
  | { readonly ok: true; readonly adversarioDraft?: TeamDraft }
  | { readonly ok: false; readonly error: MatchError };

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/**
 * Deriva o `MatchError{ kind:'VALIDATION' }` a partir dos avisos de validação do
 * jogador: usa o **primeiro aviso bloqueante** como mensagem/alvo legível
 * (R4.3/R17.7). Pressupõe que exista ao menos um bloqueante (garantido pelo
 * chamador via `hasBlocking`); como salvaguarda, cai para o primeiro aviso
 * disponível e, em último caso, uma mensagem genérica — sem jamais inventar
 * regras de validação.
 */
function erroDeValidacao(
  warnings: ReadonlyArray<ValidationWarning>,
): MatchError {
  const bloqueante =
    warnings.find((w) => w.blocking) ?? warnings[0] ?? null;

  if (bloqueante === null) {
    return {
      kind: 'VALIDATION',
      message: 'validação do elenco recusou a simulação',
    };
  }

  return bloqueante.field !== undefined
    ? { kind: 'VALIDATION', message: bloqueante.message, field: bloqueante.field }
    : { kind: 'VALIDATION', message: bloqueante.message };
}

/**
 * Orquestra a validação pré-simulação (R3, R4): sequencia a validação do time
 * do jogador e, no `Modo_Importar_Seed`, a importação da seed do adversário.
 *
 * Fluxo e garantias:
 *
 * 1. Roda `deps.validateDraft(playerDraft)` (R4.1). Se
 *    `deps.hasBlocking(warnings)` → retorna `{ ok:false, error:{ kind:'VALIDATION', ... } }`:
 *    **não** prossegue à importação nem à simulação, e o estado do jogador fica
 *    preservado (o orquestrador é puro e não muta nada) (R4.1, R4.3, R4.5).
 * 2. Se `modo === 'importar_seed'`: roda `deps.importSeed(seedBytes)` (R3.1,
 *    R4.2), tratando os bytes **como dados** (R3.4). Em recusa → retorna
 *    `{ ok:false, error:{ kind:'IMPORT', message:<motivo específico> } }`,
 *    bloqueando a simulação e preservando o estado (R3.2, R4.4). Em aprovação,
 *    devolve `{ ok:true, adversarioDraft }` (R3.3).
 * 3. Nos demais modos (sem importação) → `{ ok:true }`.
 *
 * O orquestrador é **puro**: não toca na store, não faz I/O e não executa
 * conteúdo da seed. O chamador (página Game Day, Task 16.1) aplica o resultado à
 * store: em `ok` chama `setAdversarioSeed(adversarioDraft)` (quando presente) e
 * `iniciarSimulacao`; em recusa chama `registrarErro(error)` e mantém a fase.
 *
 * @param input Rascunho do jogador, modo corrente e (no `importar_seed`) os
 *   bytes da seed.
 * @param deps Dependências injetadas de `pfl-team-strategy-ui`.
 * @returns Resultado discriminado da orquestração.
 */
export function orquestrarPreSimulacao(
  input: PreSimulacaoInput,
  deps: PreSimulacaoDeps,
): PreSimulacaoResult {
  // (1) Validação do time do jogador (R4.1). Reusa validateDraft/hasBlocking.
  const warnings = deps.validateDraft(input.playerDraft);
  if (deps.hasBlocking(warnings)) {
    // Bloqueante: não prossegue; estado preservado (orquestrador puro) (R4.1, R4.3, R4.5).
    return { ok: false, error: erroDeValidacao(warnings) };
  }

  // (2) Importação da seed do adversário — apenas no Modo_Importar_Seed (R3.1, R4.2).
  if (input.modo === 'importar_seed') {
    if (deps.importSeed === undefined) {
      // Dependência de importação ausente para o modo que a exige: bloqueia a
      // simulação sem inventar regras (estado preservado).
      return {
        ok: false,
        error: {
          kind: 'IMPORT',
          message: 'importação de seed indisponível para o modo selecionado',
        },
      };
    }

    if (input.seedBytes === undefined) {
      // Sem arquivo de seed submetido: nada a importar; bloqueia (R3.1).
      return {
        ok: false,
        error: {
          kind: 'IMPORT',
          message: 'nenhuma seed de adversário foi fornecida',
        },
      };
    }

    // Seed tratada como DADOS (R3.4): repassada verbatim; nenhum conteúdo é executado.
    const resultado: ImportResult = deps.importSeed(input.seedBytes);
    if (!resultado.ok) {
      // Recusa: motivo específico, simulação bloqueada, estado preservado (R3.2, R4.4).
      return {
        ok: false,
        error: { kind: 'IMPORT', message: resultado.reason.message },
      };
    }

    // Aprovada: devolve o time do adversário para retenção via setAdversarioSeed (R3.3).
    return { ok: true, adversarioDraft: resultado.draft };
  }

  // (3) Modos sem importação de seed: validação do jogador passou, pode simular.
  return { ok: true };
}
