'use client';

/**
 * `GradeRoster` (`components/team/GradeRoster.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.1.
 *
 * Componente de **apresentação** (burro): renderiza o Roster como uma grade de
 * cartões, um {@link ItemRoster} por `AthleteDraft`. Cada instância é um item
 * distinto, inclusive quando duas instâncias repetem o `pokemonId` (duplicatas
 * de espécie ocupam vagas separadas — R2.1/R2.2). Exibe o contador `X/53`
 * usando {@link ROSTER_CAP} como denominador rastreável (R2.3) — o `53` nunca é
 * um número inventado, vem da store (R17.5).
 *
 * Quando o Roster está cheio e uma adição é tentada, o orquestrador passa um
 * `capReachedWarning`; este componente o apresenta como aviso **não
 * bloqueante**, associado por ARIA e anunciado por `aria-live` (R2.3/R2.4). O
 * componente não executa a recusa em si — a store (`addAthlete`) é quem recusa
 * a 54ª adição; aqui apenas se exibe a mensagem resultante.
 *
 * Botão opcional "Adicionar atleta" é renderizado apenas quando `onAddAthlete`
 * é fornecido, deixando a origem da adição a cargo do orquestrador.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4_
 */

import type { DragEvent, ReactNode } from 'react';
import type { AthleteDraft } from '@/lib/team/model';
import { ROSTER_CAP } from '@/lib/team/store';
import { ItemRoster } from './ItemRoster';

export interface GradeRosterProps {
  /** Roster corrente; cada item é uma instância distinta (R2.1/R2.2). */
  readonly roster: readonly AthleteDraft[];
  /** `instanceId` atualmente aberto na ficha (para destacar o cartão). */
  readonly selectedInstanceId?: number | null;
  /** Abre a `FichaAtleta` da instância acionada (clique/teclado) — R6.1. */
  readonly onSelectAthlete: (instanceId: number) => void;
  /**
   * Rótulos legíveis por instância (p.ex. nomes resolvidos pela
   * Camada_Leitura). Mapa `instanceId → rótulo`; opcional.
   */
  readonly labels?: Readonly<Record<number, string>>;
  /** Início de arrasto de um cartão para atribuição por drag (R4.1). */
  readonly onDragStartAthlete?: (
    instanceId: number,
    event: DragEvent<HTMLDivElement>,
  ) => void;
  /** Quando presente, renderiza um controle "Adicionar atleta". */
  readonly onAddAthlete?: () => void;
  /**
   * Aviso não bloqueante do teto do Roster (R2.4). Tipicamente definido pelo
   * orquestrador após uma tentativa de 54ª adição recusada pela store.
   */
  readonly capReachedWarning?: string | null;
}

/** Id do aviso de teto, para associação por `aria-describedby`. */
const CAP_WARNING_ID = 'pfl-grade-roster-cap-warning';

export function GradeRoster({
  roster,
  selectedInstanceId = null,
  onSelectAthlete,
  labels,
  onDragStartAthlete,
  onAddAthlete,
  capReachedWarning,
}: GradeRosterProps): ReactNode {
  const atFull = roster.length >= ROSTER_CAP;
  const temAviso = Boolean(capReachedWarning);

  return (
    <section aria-label="Roster do time">
      {/* Contador X/53 rastreável: denominador vem de ROSTER_CAP (R2.3/R17.5). */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
          gap: '1rem',
        }}
      >
        <p
          aria-live="polite"
          style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}
        >
          Roster: {roster.length}/{ROSTER_CAP}
        </p>

        {onAddAthlete ? (
          <button
            type="button"
            onClick={onAddAthlete}
            // Não desabilitamos no teto: a store recusa e devolve o aviso
            // (R2.4). Sinalizamos o estado cheio por ARIA, sem bloquear foco.
            aria-describedby={temAviso ? CAP_WARNING_ID : undefined}
            style={{
              minHeight: '3rem',
              padding: '0.75rem 1.125rem',
              fontSize: '0.9375rem',
              fontWeight: 600,
              border: '1px solid #8a8a8a',
              borderRadius: '0.5rem',
              background: '#ffffff',
              color: '#1a1a1a',
              cursor: 'pointer',
            }}
          >
            Adicionar atleta
          </button>
        ) : null}
      </header>

      {/* Aviso não bloqueante do teto (R2.4): associado por ARIA e anunciado. */}
      {temAviso ? (
        <p
          id={CAP_WARNING_ID}
          role="status"
          aria-live="polite"
          style={{
            margin: '0 0 0.75rem',
            padding: '0.625rem 0.875rem',
            border: '2px solid #8a5a00',
            borderRadius: '0.5rem',
            background: '#fff6e5',
            color: '#5a3d00',
            fontSize: '0.9375rem',
          }}
        >
          {/* Prefixo textual reforça o estado além da cor (R17.6). */}
          <strong>Aviso:</strong> {capReachedWarning}
        </p>
      ) : null}

      {roster.length === 0 ? (
        <p style={{ fontSize: '0.9375rem', color: '#4a4a4a', margin: 0 }}>
          Roster vazio. Nenhum atleta adicionado.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))',
            gap: '0.75rem',
          }}
        >
          {roster.map((athlete) => (
            // `key` por `instanceId`: identidade estável e distinta por
            // instância, inclusive para duplicatas de espécie (R2.2).
            <li key={athlete.instanceId}>
              <ItemRoster
                athlete={athlete}
                label={labels?.[athlete.instanceId]}
                selected={selectedInstanceId === athlete.instanceId}
                onOpen={onSelectAthlete}
                onDragStart={onDragStartAthlete}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Sinaliza o estado cheio de forma textual, mesmo sem tentativa recente. */}
      {atFull && !temAviso ? (
        <p
          aria-live="polite"
          style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#4a4a4a' }}
        >
          Roster completo ({ROSTER_CAP}/{ROSTER_CAP}).
        </p>
      ) : null}
    </section>
  );
}
