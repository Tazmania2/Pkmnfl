'use client';

/**
 * `ImportadorSeedAdversario` (`components/gameday/ImportadorSeedAdversario.tsx`)
 * — spec `pfl-gameday-result-ui`, Task 13.2.
 *
 * Componente de **apresentação** (burro) do `Modo_Importar_Seed`: oferece um
 * campo de arquivo acessível que aceita um `.pflseed.json`, lê os **bytes** do
 * arquivo e os entrega ao **handler de importação injetado** (`onImportFile`).
 * O componente **não** importa nenhum módulo concreto de importação de seed: a
 * função real (`importSeed` de `pfl-team-strategy-ui`) ainda não existe no
 * repositório e é injetada pela página (Task 16.1) como dependência. Enquanto
 * isso, o contrato é apenas o tipo `ImportResult` de `@/lib/match`.
 *
 * Seed tratada **como dados** (R3.4): o arquivo é lido por `arrayBuffer()` e
 * repassado como `Uint8Array` ao handler. Nenhum `eval`, `Function`, `import()`
 * dinâmico ou execução de conteúdo do arquivo acontece aqui — a seed é dados,
 * não código.
 *
 * Em recusa (`ImportResult.ok === false`, ou prop `rejection` fornecida pela
 * orquestração), a mensagem **específica** do motivo é exibida e associada por
 * ARIA ao campo de arquivo (`aria-describedby` + `aria-errormessage` +
 * `aria-invalid`), de modo que um leitor de tela a anuncie ao focar o controle
 * (R3.2, R17.7). A simulação permanece bloqueada pela orquestração enquanto não
 * houver uma seed aprovada (R3.1, R4.4) — este componente apenas sinaliza o
 * resultado da importação via `onImported`.
 *
 * Anti-slop / acessibilidade:
 * - `<label>` textual explícito associado ao `<input type="file">` (R17.3).
 * - Foco visível por `:focus-visible` (R17.2).
 * - Estado de erro distinguível por mais de um recurso: texto do motivo, ícone
 *   textual ("⚠") e borda espessa — não apenas cor (R17.6).
 *
 * _Requirements: 3.1, 3.2, 3.4, 4.5, 17.3, 17.7_
 */

import { useId, useRef, useState, type ReactNode } from 'react';
import type { ImportResult } from '@/lib/match';

/**
 * Handler de importação injetado: recebe os **bytes crus** do `.pflseed.json` e
 * devolve um `ImportResult` (síncrono ou assíncrono). É a borda onde a página
 * (Task 16.1) liga o `importSeed` real de `pfl-team-strategy-ui`. Tratar a seed
 * como dados (R3.4) é responsabilidade compartilhada: este componente só lê
 * bytes e os repassa; o handler parseia/valida.
 */
export type ImportFileHandler = (
  bytes: Uint8Array,
) => ImportResult | Promise<ImportResult>;

export interface ImportadorSeedAdversarioProps {
  /** Handler injetado que recebe os bytes da seed e devolve o `ImportResult`. */
  readonly onImportFile: ImportFileHandler;
  /**
   * Chamado após uma tentativa de importação concluir, com o `ImportResult`.
   * A orquestração usa isto para reter o `TeamDraft` aprovado (R3.3) via
   * `setAdversarioSeed`, ou para manter a simulação bloqueada em recusa.
   */
  readonly onImported?: (result: ImportResult) => void;
  /**
   * Motivo de recusa a exibir, fornecido pela orquestração (ex.: um `MatchError`
   * de importação já registrado na store). Quando presente, tem precedência
   * sobre o motivo da última tentativa local, mantendo a tela e o estado
   * coerentes com a store (R3.2).
   */
  readonly rejection?: string | null;
}

const FOCUS_STYLE_ID = 'pfl-importador-seed-focus';

const FOCUS_STYLE = `
[data-pfl-importador-seed] input[type="file"]:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

/**
 * Lê os bytes de um `File` como `Uint8Array`, sem interpretar o conteúdo (R3.4).
 * Usa `arrayBuffer()` (padrão da plataforma) — a seed é dados, nunca executada.
 */
async function lerBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

export function ImportadorSeedAdversario({
  onImportFile,
  onImported,
  rejection,
}: ImportadorSeedAdversarioProps): ReactNode {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Motivo de recusa da última tentativa local (quando a orquestração não
  // fornece `rejection`). O prop `rejection` tem precedência.
  const [localRejection, setLocalRejection] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  // Motivo efetivamente exibido: prioriza o controlado pela orquestração.
  const motivoRecusa = rejection ?? localRejection;
  const temErro = motivoRecusa !== null && motivoRecusa !== undefined;

  async function handleChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (file === undefined) {
      return;
    }

    setImportando(true);
    setLocalRejection(null);

    try {
      const bytes = await lerBytes(file);
      // Seed como DADOS (R3.4): bytes repassados verbatim ao handler injetado.
      const result = await onImportFile(bytes);

      if (!result.ok) {
        // Recusa: motivo específico do pipeline de importação (R3.2).
        setLocalRejection(result.reason.message);
      } else {
        setLocalRejection(null);
      }

      onImported?.(result);
    } catch {
      // Falha ao ler o arquivo: motivo legível, estado preservado (R3.2).
      setLocalRejection('não foi possível ler o arquivo de seed.');
    } finally {
      setImportando(false);
    }
  }

  return (
    <div data-pfl-importador-seed>
      {/* Indicador de foco visível (R17.2): escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <label
        htmlFor={inputId}
        style={{
          display: 'block',
          fontSize: '1rem',
          fontWeight: 600,
          marginBottom: '0.5rem',
        }}
      >
        Importar seed do adversário (.pflseed.json)
      </label>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        // Restringe a seleção ao formato esperado (R3.1); seed é dados (R3.4).
        accept=".pflseed.json,application/json"
        onChange={handleChange}
        disabled={importando}
        // Associação programática do erro ao controle (R17.7): leitor de tela
        // anuncia a mensagem ao focar o campo.
        aria-invalid={temErro}
        aria-describedby={temErro ? errorId : undefined}
        aria-errormessage={temErro ? errorId : undefined}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: '28rem',
          padding: '0.625rem',
          fontSize: '0.9375rem',
          // Estado de erro distinguível por borda espessa (não só cor) (R17.6).
          border: temErro ? '3px solid #8a1a1a' : '1px solid #8a8a8a',
          borderRadius: '0.5rem',
          background: '#ffffff',
          color: '#1a1a1a',
          cursor: importando ? 'progress' : 'pointer',
        }}
      />

      {importando ? (
        <p
          aria-live="polite"
          style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}
        >
          Importando seed…
        </p>
      ) : null}

      {/* Mensagem de recusa específica, associada por ARIA ao campo (R3.2, R17.7).
          Distinguível por texto + ícone textual + cor (mais de um recurso, R17.6). */}
      {temErro ? (
        <p
          id={errorId}
          role="alert"
          style={{
            marginTop: '0.5rem',
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: '#8a1a1a',
          }}
        >
          <span aria-hidden="true">⚠ </span>
          Seed recusada: {motivoRecusa}
        </p>
      ) : null}
    </div>
  );
}
