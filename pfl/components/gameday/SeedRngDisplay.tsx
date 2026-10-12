'use client';

/**
 * `SeedRngDisplay` (`components/gameday/SeedRngDisplay.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 13.1.
 *
 * Componente de **apresentação** (burro): recebe o `Seed_RNG` corrente por prop e
 * o exibe de forma **rastreável** ao jogador (R16.3), com uma afordância de
 * **copiar para a área de transferência**. O valor nunca é derivado nem
 * recalculado aqui — é exatamente o `seedRng` retido na store (design: "Seed de
 * RNG separado do seed de time").
 *
 * Comportamento:
 * - Quando `seedRng` é `null` (nenhuma partida iniciada), renderiza um placeholder
 *   honesto em vez de inventar um valor — nenhum número sem origem (R17.5).
 * - O valor é mostrado monospaçado e selecionável, e um `<button>` rotulado copia
 *   o seed via `navigator.clipboard`, guardado contra ambientes sem a API.
 *
 * Acessibilidade (anti-slop):
 * - O botão "Copiar" é um `<button>` real, focável e acionável por teclado, com
 *   rótulo textual explícito; o resultado da cópia é anunciado via `aria-live`.
 * - O valor do seed é associado por `aria-describedby` ao rótulo, de modo que um
 *   leitor de tela anuncie o contexto ao focar.
 *
 * _Requirements: 16.3, 17.2_
 */

import { useCallback, useState, type ReactNode } from 'react';

export interface SeedRngDisplayProps {
  /** Seed_RNG corrente (decimal uint64 como string) ou `null` se não há partida. */
  readonly seedRng: string | null;
}

/** Estado da última tentativa de cópia, para feedback honesto ao jogador. */
type CopyStatus = 'idle' | 'copied' | 'unavailable';

const LABEL_ID = 'pfl-seed-rng-label';
const VALUE_ID = 'pfl-seed-rng-value';

export function SeedRngDisplay({ seedRng }: SeedRngDisplayProps): ReactNode {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  const handleCopy = useCallback(async () => {
    if (seedRng === null) {
      return;
    }
    // Afordância de cópia guardada: nem todo ambiente expõe a Clipboard API
    // (SSR, http não seguro, permissões negadas). Falha vira feedback honesto.
    const clipboard =
      typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setCopyStatus('unavailable');
      return;
    }
    try {
      await clipboard.writeText(seedRng);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('unavailable');
    }
  }, [seedRng]);

  return (
    <section
      aria-labelledby={LABEL_ID}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
        padding: '0.75rem 1rem',
        border: '1px solid #8a8a8a',
        borderRadius: '0.5rem',
        maxWidth: '28rem',
      }}
    >
      <span id={LABEL_ID} style={{ fontSize: '0.875rem', fontWeight: 600 }}>
        Seed de RNG da partida
      </span>

      {seedRng === null ? (
        // Placeholder honesto: sem partida, não há seed a exibir (R17.5).
        <span style={{ fontSize: '0.9375rem', color: '#555555' }}>
          Nenhuma partida iniciada — o seed aparecerá aqui ao simular.
        </span>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <code
            id={VALUE_ID}
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '1rem',
              userSelect: 'all',
              wordBreak: 'break-all',
            }}
          >
            {seedRng}
          </code>
          <button
            type="button"
            onClick={() => {
              void handleCopy();
            }}
            aria-describedby={VALUE_ID}
            style={{
              minHeight: '2.5rem',
              padding: '0.375rem 0.875rem',
              fontSize: '0.9375rem',
              border: '1px solid #1a1a1a',
              borderRadius: '0.375rem',
              background: '#ffffff',
              color: '#1a1a1a',
              cursor: 'pointer',
            }}
          >
            Copiar seed
          </button>
        </div>
      )}

      {/* Feedback honesto da cópia, anunciado por leitores de tela. */}
      <span aria-live="polite" style={{ fontSize: '0.8125rem', minHeight: '1rem' }}>
        {copyStatus === 'copied' && 'Seed copiado para a área de transferência.'}
        {copyStatus === 'unavailable' &&
          'Não foi possível copiar automaticamente — selecione o valor e copie manualmente.'}
      </span>
    </section>
  );
}
