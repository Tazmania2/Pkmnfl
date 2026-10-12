'use client';

/**
 * `BarraAcoes` (`components/team/BarraAcoes.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.4.
 *
 * Componente de **apresentação** (burro): a barra de ações da Tela_Meu_Time.
 * Oferece três controles rotulados — "Salvar" (R9.1), "Exportar seed" (R14.1)
 * e "Importar seed" (R15.1) — e exibe a confirmação de salvamento (R9.4).
 *
 * Este componente **não** faz IO: ele apenas invoca callbacks. A orquestração
 * (tarefa 11.1) é quem fia esses callbacks às rotas da seção 8:
 * - `onSave`        → `POST /api/team`        (revalida e persiste o time)
 * - `onExportSeed`  → `POST /api/seed/export` (gera o `.pflseed.json`)
 * - `onImportSeed`  → `POST /api/seed/import` (pipeline de importação)
 *
 * Salvamento (R9.4): quando `saveConfirmation` está definido, a confirmação é
 * renderizada numa região ARIA-live (`role="status"`, `aria-live="polite"`)
 * para que leitores de tela a anunciem. Enquanto `saving` é verdadeiro, o botão
 * Salvar indica progresso e fica desabilitado para evitar envio duplicado.
 *
 * Importar seed (R15.1): usa um `<input type="file">` real (acessível por
 * teclado) estilizado por um `<label>` com aparência de botão, aceitando
 * `.pflseed.json`. Ao escolher um arquivo, chama `onImportSeed(file)` e limpa
 * o valor do input para permitir reimportar o mesmo arquivo.
 *
 * Anti-slop / acessibilidade (R17.1–R17.4; passagem completa em 11.2):
 * - Controles operáveis por teclado, com foco visível via `:focus-visible`
 *   escopado (sem CSS global).
 * - Rótulos textuais explícitos; estados (progresso, desabilitado) sinalizados
 *   por texto e atributos ARIA, nunca só por cor.
 *
 * _Requirements: 9.1, 9.4, 14.1, 15.1_
 */

import { useRef, type ChangeEvent, type ReactNode } from 'react';

/** Extensão/tipo aceito pelo importador de seed (R15.1). */
const ACCEPT_SEED = '.pflseed.json,application/json';

export interface BarraAcoesProps {
  /** Aciona o salvamento do Time_Usuario (R9.1). Pode ser assíncrono. */
  readonly onSave: () => void | Promise<void>;
  /** Aciona a exportação de seed `.pflseed.json` (R14.1). Pode ser assíncrono. */
  readonly onExportSeed: () => void | Promise<void>;
  /** Aciona a importação do arquivo de seed escolhido (R15.1). Pode ser assíncrono. */
  readonly onImportSeed: (file: File) => void | Promise<void>;
  /** Enquanto verdadeiro, o salvamento está em andamento (evita duplo envio). */
  readonly saving?: boolean;
  /** Mensagem de confirmação de salvamento; quando definida, é anunciada (R9.4). */
  readonly saveConfirmation?: string | null;
  /** Desabilita todos os controles (ex.: nenhum time em edição). */
  readonly disabled?: boolean;
}

/**
 * Indicador de foco visível escopado — `:focus-visible` não é expressável por
 * estilo inline; um `<style>` escopado por `data-pfl-barra-acoes` garante o
 * indicador de foco sem vazar CSS global.
 */
const FOCUS_STYLE_ID = 'pfl-barra-acoes-focus';

const FOCUS_STYLE = `
[data-pfl-barra-acoes] button:focus-visible,
[data-pfl-barra-acoes] input[type="file"]:focus-visible + label,
[data-pfl-barra-acoes] label:focus-within {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

/** Estilo base compartilhado pelos controles em forma de botão. */
const CONTROLE_BASE = {
  minHeight: '3.25rem',
  padding: '0.75rem 1.25rem',
  fontSize: '1rem',
  fontWeight: 600,
  borderRadius: '0.5rem',
  cursor: 'pointer',
  textAlign: 'center' as const,
};

export function BarraAcoes({
  onSave,
  onExportSeed,
  onImportSeed,
  saving = false,
  saveConfirmation = null,
  disabled = false,
}: BarraAcoesProps): ReactNode {
  const inputArquivoRef = useRef<HTMLInputElement | null>(null);

  const importDesabilitado = disabled || saving;

  function handleArquivoEscolhido(evento: ChangeEvent<HTMLInputElement>): void {
    const arquivo = evento.target.files?.[0];
    // Limpa o valor para permitir reimportar o mesmo arquivo em seguida.
    evento.target.value = '';
    if (arquivo) {
      void onImportSeed(arquivo);
    }
  }

  return (
    <div data-pfl-barra-acoes>
      {/* Indicador de foco visível: escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      <div
        role="group"
        aria-label="Ações do time"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}
      >
        {/* Salvar (R9.1): desabilita e sinaliza progresso enquanto salva (R9.4). */}
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={disabled || saving}
          aria-busy={saving}
          style={{
            ...CONTROLE_BASE,
            flex: '1 1 10rem',
            border: '2px solid #1a1a1a',
            background: disabled || saving ? '#e6e6e6' : '#1a1a1a',
            color: disabled || saving ? '#4a4a4a' : '#ffffff',
          }}
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>

        {/* Exportar seed (R14.1). */}
        <button
          type="button"
          onClick={() => void onExportSeed()}
          disabled={disabled}
          style={{
            ...CONTROLE_BASE,
            flex: '1 1 10rem',
            border: '1px solid #8a8a8a',
            background: '#ffffff',
            color: '#1a1a1a',
          }}
        >
          Exportar seed
        </button>

        {/*
          Importar seed (R15.1): input de arquivo real (acessível por teclado),
          visualmente oculto, com um <label> estilizado como botão. O label é
          programaticamente associado ao input pelo `htmlFor`.
        */}
        <label
          htmlFor="pfl-barra-acoes-import"
          aria-disabled={importDesabilitado}
          style={{
            ...CONTROLE_BASE,
            flex: '1 1 10rem',
            display: 'inline-block',
            border: '1px solid #8a8a8a',
            background: importDesabilitado ? '#e6e6e6' : '#ffffff',
            color: importDesabilitado ? '#4a4a4a' : '#1a1a1a',
            cursor: importDesabilitado ? 'not-allowed' : 'pointer',
          }}
        >
          Importar seed
        </label>
        <input
          ref={inputArquivoRef}
          id="pfl-barra-acoes-import"
          type="file"
          accept={ACCEPT_SEED}
          onChange={handleArquivoEscolhido}
          disabled={importDesabilitado}
          style={{
            // Visualmente oculto, porém focável e operável por teclado.
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        />
      </div>

      {/*
        Confirmação de salvamento (R9.4): região ARIA-live sempre presente no
        DOM para que leitores de tela anunciem a mensagem quando ela surgir.
      */}
      <p
        role="status"
        aria-live="polite"
        style={{
          margin: '0.75rem 0 0',
          minHeight: '1.25rem',
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: '#1a5c2e',
        }}
      >
        {saveConfirmation ?? ''}
      </p>
    </div>
  );
}
