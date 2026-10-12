'use client';

/**
 * `FichaAtleta` (`components/team/FichaAtleta.tsx`) — spec
 * `pfl-team-strategy-ui`, Task 9.3.
 *
 * Componente de **apresentação** da ficha do atleta: 1 habilidade
 * ({@link SeletorHabilidade}) + 4 golpes ({@link SeletorGolpes}), com avisos
 * inline **fiados ao motor de validação puro** (`validateAthlete`) e associados
 * por ARIA ao controle que os originou (R17.7). Recusa salvar enquanto houver
 * qualquer aviso **bloqueante** ativo (R7.6).
 *
 * ## Debounce / recomputação de avisos (R7 — "≤500ms")
 *
 * `validateAthlete` é **puro, síncrono e barato** (opera só sobre o
 * {@link EligibilitySnapshot} já resolvido, sem rede nem DOM). Por isso a ficha
 * **recomputa os avisos de forma síncrona** a cada render, derivando-os do
 * `athlete` + `snapshot` recebidos. A atualização é portanto **imediata** após
 * cada alteração — o orçamento de ≤500ms do design é satisfeito trivialmente
 * (0ms), sem o custo e a não-determinismo de um `setTimeout`. Essa escolha
 * mantém o componente puro em relação às props e simples de testar: dado o mesmo
 * `athlete`/`snapshot`, a lista de avisos renderizada é determinística.
 *
 * O componente é **de apresentação**: emite `onChange(patch)` para cada edição
 * (habilidade/golpe) e `onSave()` apenas quando não há aviso bloqueante; a
 * persistência real (store/Server Action) é responsabilidade do orquestrador.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.3,
 * 17.7_
 */

import { useMemo, type ReactNode } from 'react';
import type { EligibilitySnapshot } from '@/lib/team/eligibility-adapter';
import type { AthleteDraft } from '@/lib/team/model';
import type { AnatomyConventions } from '@/lib/anatomy';
import {
  DEFAULT_ANATOMY_CONVENTIONS,
  hasBlocking,
  validateAthlete,
  type ValidationWarning,
} from '@/lib/validation';
import { AvisoEfeitoInerte } from './AvisoEfeitoInerte';
import {
  SeletorGolpes,
  type OpcaoGolpe,
} from './SeletorGolpes';
import {
  SeletorHabilidade,
  type OpcaoHabilidade,
} from './SeletorHabilidade';

export interface FichaAtletaProps {
  /** Atleta em edição; a ficha reflete e valida exatamente este estado. */
  readonly athlete: AthleteDraft;
  /** Snapshot síncrono de elegibilidade consumido pelo motor e seletores. */
  readonly snapshot: EligibilitySnapshot;
  /** Opções de habilidade = `getAvailableAbilities(pokemonId)` (R6.2). */
  readonly abilityOptions: readonly OpcaoHabilidade[];
  /** Opções de golpe = `getLearnableMoveIds(pokemonId)` (R6.3). */
  readonly moveOptions: readonly OpcaoGolpe[];
  /** Convenções de anatomia; usa a fonte única padrão quando omitido. */
  readonly anatomy?: AnatomyConventions;
  /** Emite o patch de uma edição (habilidade/golpe) para o orquestrador. */
  readonly onChange: (patch: Partial<AthleteDraft>) => void;
  /** Salvar; só é acionável quando não há aviso bloqueante (R7.6). */
  readonly onSave?: () => void;
}

/** Prefixo dos `id`s de aviso, para associação por `aria-describedby`. */
const WARNING_ID_PREFIX = 'pfl-ficha-aviso';

/** `id` base do seletor de habilidade. */
const ABILITY_SELECT_ID = 'pfl-ficha-habilidade';

/** Prefixo dos `id`s dos selects de golpe (um por slot). */
const MOVE_SELECT_PREFIX = 'pfl-ficha-golpe';

/**
 * Monta um `id` estável e único para o aviso de índice `i`, usado tanto no
 * elemento do aviso quanto no `aria-describedby` do controle associado (R17.7).
 */
function warningId(index: number): string {
  return `${WARNING_ID_PREFIX}-${index}`;
}

export function FichaAtleta({
  athlete,
  snapshot,
  abilityOptions,
  moveOptions,
  anatomy = DEFAULT_ANATOMY_CONVENTIONS,
  onChange,
  onSave,
}: FichaAtletaProps): ReactNode {
  // Recomputação síncrona dos avisos (≤500ms satisfeito trivialmente; ver
  // cabeçalho). `useMemo` evita recomputar quando nada relevante mudou.
  const warnings = useMemo<ValidationWarning[]>(
    () => validateAthlete(athlete, snapshot, anatomy),
    [athlete, snapshot, anatomy],
  );

  const blocked = hasBlocking(warnings);

  // Associa cada aviso ao `id` do controle-alvo e constrói, por controle, a
  // lista de `aria-describedby` (R17.7). Mantemos a ordem dos avisos.
  const abilityDescribedByIds: string[] = [];
  const moveDescribedByIds: Record<number, string[]> = {};

  warnings.forEach((warning, index) => {
    const id = warningId(index);
    const { target } = warning;
    if (target.kind === 'ability') {
      abilityDescribedByIds.push(id);
    } else if (target.kind === 'move' && target.moveId !== undefined) {
      // Associa o aviso ao(s) slot(s) que contêm o golpe apontado.
      athlete.moveIds.forEach((moveId, slotIndex) => {
        if (moveId === target.moveId) {
          (moveDescribedByIds[slotIndex] ??= []).push(id);
        }
      });
    }
  });

  const abilityDescribedBy =
    abilityDescribedByIds.length > 0
      ? abilityDescribedByIds.join(' ')
      : undefined;

  const moveDescribedBy: Record<number, string> = {};
  for (const [slotIndex, ids] of Object.entries(moveDescribedByIds)) {
    moveDescribedBy[Number(slotIndex)] = ids.join(' ');
  }

  // Avisos de efeito inerte são renderizados pelo AvisoEfeitoInerte (não
  // bloqueantes); os demais, numa lista de avisos associada por id.
  return (
    <section aria-label="Ficha do atleta">
      <SeletorHabilidade
        abilityId={athlete.abilityId}
        options={abilityOptions}
        selectId={ABILITY_SELECT_ID}
        describedBy={abilityDescribedBy}
        onChange={(abilityId) => onChange({ abilityId })}
      />

      <div style={{ marginTop: '1rem' }}>
        <SeletorGolpes
          moveIds={athlete.moveIds}
          options={moveOptions}
          idPrefix={MOVE_SELECT_PREFIX}
          describedBy={moveDescribedBy}
          onChange={(slotIndex, moveId) => {
            // Substitui o golpe do slot alterado, preservando os demais.
            const nextMoves = athlete.moveIds.slice();
            nextMoves[slotIndex] = moveId;
            onChange({ moveIds: nextMoves });
          }}
        />
      </div>

      {/* Avisos inline: inertes via AvisoEfeitoInerte (não bloqueantes),
          demais como itens associados por id ao controle (R17.6/R17.7). */}
      {warnings.length > 0 ? (
        <div
          aria-label="Avisos da ficha"
          style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}
        >
          {warnings.map((warning, index) => {
            const id = warningId(index);
            if (warning.code === 'INERT_EFFECT') {
              return (
                <AvisoEfeitoInerte key={id} id={id} message={warning.message} />
              );
            }
            return (
              <p
                key={id}
                id={id}
                role={warning.blocking ? 'alert' : 'note'}
                style={{
                  margin: 0,
                  padding: '0.625rem 0.875rem',
                  border: warning.blocking
                    ? '2px solid #8a1a1a'
                    : '2px solid #8a5a00',
                  borderRadius: '0.5rem',
                  background: warning.blocking ? '#fdecec' : '#fff6e5',
                  color: warning.blocking ? '#5a0000' : '#5a3d00',
                  fontSize: '0.9375rem',
                }}
              >
                {/* Rótulo textual reforça o estado além da cor (R17.4/R17.6). */}
                <strong>{warning.blocking ? 'Erro: ' : 'Aviso: '}</strong>
                {warning.message}
              </p>
            );
          })}
        </div>
      ) : null}

      {onSave ? (
        <div style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            // Gate de persistência: desabilitado enquanto houver bloqueante
            // (R7.6). O guard no handler reforça a recusa mesmo sem o atributo.
            disabled={blocked}
            aria-disabled={blocked}
            onClick={() => {
              if (!blocked) {
                onSave();
              }
            }}
            style={{
              minHeight: '3rem',
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 600,
              border: '2px solid #1a1a1a',
              borderRadius: '0.5rem',
              background: blocked ? '#e6e6e6' : '#1a1a1a',
              color: blocked ? '#6a6a6a' : '#ffffff',
              cursor: blocked ? 'not-allowed' : 'pointer',
            }}
          >
            Salvar ficha
          </button>
          {blocked ? (
            <p
              role="status"
              style={{
                margin: '0.5rem 0 0',
                fontSize: '0.875rem',
                color: '#5a0000',
              }}
            >
              Corrija os avisos bloqueantes acima para salvar.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
