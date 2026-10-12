'use client';

/**
 * `AlternativaTextual` — `components/gameday/AlternativaTextual.tsx`, spec
 * `pfl-gameday-result-ui`, Task 13.3.
 *
 * Equivalente **textual acessível** da `Animacao_8bit`: uma região
 * `aria-live="polite"` (R17.4) que torna o andamento da Partida compreensível
 * **sem** depender da animação. Recebe as cenas já computadas por
 * `buildAnimationScenes(log)` e o índice corrente, por props (NÃO acessa a store).
 *
 * Dois conteúdos complementares, ambos derivados do `Log_Partida`:
 * - a **cena corrente** — sua `narrative` e seus `warnings` de efeito
 *   inerte/supressão (R12.1) — anunciada ao vivo pelos leitores de tela conforme
 *   avança (`aria-live="polite"`, R17.4);
 * - a **lista completa e ordenada** de todas as narrativas do log, para que o
 *   jogador acompanhe toda a Partida por texto.
 *
 * **Invariância ao modo de reprodução (R11.5)**: o conteúdo textual é função
 * apenas das `scenes` (= do log) — pular, acelerar ou reproduzir integralmente
 * **não** altera o que é exibido aqui. A lista completa é sempre a mesma; o
 * destaque da cena corrente apenas reflete o progresso de leitura, nunca o modo.
 *
 * _Requirements: 11.5, 12.1, 17.4_
 */

import type { Scene } from '@/lib/match';

/**
 * Props da `AlternativaTextual`. As cenas vêm de `buildAnimationScenes(log)` e são
 * **invariantes** ao modo de reprodução (R11.5). `currentIndex` é o índice da cena
 * corrente (clampado internamente à faixa válida); quando a animação ainda não
 * começou ou já concluiu, a região permanece acessível com a lista completa.
 */
export interface AlternativaTextualProps {
  /** Sequência completa de cenas (ordem determinística do log) — invariante (R11.5). */
  readonly scenes: ReadonlyArray<Scene>;
  /** Índice da cena corrente em `scenes`; valores fora de faixa são tolerados. */
  readonly currentIndex: number;
}

/**
 * Região textual acessível da animação. Renderiza a narrativa + avisos da cena
 * corrente numa live region `polite` e, em seguida, a lista ordenada completa de
 * todas as narrativas do log, marcando a cena corrente para orientação visual.
 *
 * `scenes` vazio (log sem Snaps, R9.7) → exibe apenas o aviso de ausência de
 * lances, mantendo a região acessível (R11.7).
 */
export function AlternativaTextual({
  scenes,
  currentIndex,
}: AlternativaTextualProps): React.ReactElement {
  const total = scenes.length;
  // Clampa o índice à faixa [0, total-1] para selecionar a cena corrente sem
  // acesso fora de faixa; se não há cenas, não há corrente.
  const safeIndex = total === 0 ? -1 : Math.min(Math.max(currentIndex, 0), total - 1);
  const atual = safeIndex >= 0 ? scenes[safeIndex] : undefined;

  return (
    <section className="pfl-alt-textual" aria-label="Alternativa textual da animação">
      {/* Cena corrente anunciada ao vivo (R17.4). A live region é polite para não
          interromper o leitor de tela; o atomic garante o anúncio do bloco inteiro
          (narrativa + avisos) a cada avanço de cena. */}
      <div
        className="pfl-alt-textual__corrente"
        aria-live="polite"
        aria-atomic="true"
      >
        {atual !== undefined ? (
          <>
            <p className="pfl-alt-textual__narrativa">
              <span className="pfl-alt-textual__rotulo-snap">Snap {atual.snap}:</span>{' '}
              {atual.narrative}
            </p>
            {atual.warnings.length > 0 ? (
              <ul className="pfl-alt-textual__avisos" aria-label="Avisos do lance">
                {atual.warnings.map((aviso, i) => (
                  <li key={`atual-aviso-${i}`} className="pfl-alt-textual__aviso">
                    {aviso}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="pfl-alt-textual__vazio">Sem lances para narrar nesta partida.</p>
        )}
      </div>

      {/* Lista completa e ordenada de todas as narrativas do log (R11.5). Conteúdo
          idêntico independentemente de a animação ter sido pulada/acelerada/
          reproduzida: é função apenas das `scenes`. A cena corrente é marcada por
          mais de um recurso (aria-current + classe), não só cor (R17.6). */}
      {total > 0 ? (
        <ol className="pfl-alt-textual__lista" aria-label="Narrativa completa da partida">
          {scenes.map((cena, i) => {
            const corrente = i === safeIndex;
            return (
              <li
                key={`cena-${cena.index}`}
                className={
                  corrente
                    ? 'pfl-alt-textual__item pfl-alt-textual__item--corrente'
                    : 'pfl-alt-textual__item'
                }
                aria-current={corrente ? 'step' : undefined}
              >
                <span className="pfl-alt-textual__rotulo-snap">Snap {cena.snap}:</span>{' '}
                {cena.narrative}
                {cena.warnings.length > 0 ? (
                  <ul className="pfl-alt-textual__avisos" aria-label="Avisos do lance">
                    {cena.warnings.map((aviso, j) => (
                      <li key={`cena-${cena.index}-aviso-${j}`} className="pfl-alt-textual__aviso">
                        {aviso}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

export default AlternativaTextual;
