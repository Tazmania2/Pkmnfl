'use client';

/**
 * `AnimationPlayer` (`components/gameday/AnimationPlayer.tsx`) — spec
 * `pfl-gameday-result-ui`, Task 14.1.
 *
 * **Player burro** da `Animacao_8bit`: recebe as `Scene[]` já computadas por
 * `buildAnimationScenes(log)` e apenas as **reproduz**. Nunca decide **quais**
 * cenas existem nem em que ordem — isso é função pura do log (R9.1, R10.1). O
 * laço de `requestAnimationFrame` acumula tempo decorrido de parede e serve
 * **só para cadência**: quando o acumulado atinge `durationHint / speed` da
 * cena corrente, avança para a próxima (R10.1, R10.2). A lista de cenas é
 * imutável durante toda a reprodução.
 *
 * Controles (R11.*):
 * - **Pular** (`Controle_Pular`): define `currentIndex = scenes.length` e chama
 *   `onComplete` imediatamente (≤500ms — não há recomputação) (R11.2).
 * - **Acelerar** (`Controle_Acelerar`): alterna `speed` 1x↔2x (R11.3, R11.4).
 *   Só altera o divisor de cadência, nunca o log.
 *
 * **API de velocidade — decisão (controlada).** O design define `speed: 1 | 2`
 * como **prop**. Mantemos a velocidade **controlada pelo pai**: o componente
 * recebe `speed` e expõe `onToggleSpeed?`; o botão de acelerar reflete o `speed`
 * corrente e, ao ser acionado, chama `onToggleSpeed` para o pai alternar o valor.
 * Apenas o `currentIndex` é estado **interno** do player (índice/cadência).
 * Assim a alternância de velocidade é determinística e observável de fora
 * (Property 18), e o player permanece burro.
 *
 * Sprites: cada `pokemonId` da cena é resolvido por `resolveSprite(id, species)`
 * — a imagem vem da Camada_Leitura ou do substituto local (R9.6), nunca de fonte
 * externa (R9.2). O `species: SpeciesRawIndex` é fornecido pela página.
 *
 * Casos de borda:
 * - `scenes.length === 0` (log sem Snaps, R9.7) → chama `onComplete` uma vez via
 *   efeito e renderiza nada (a `AlternativaTextual`, renderizada pela página,
 *   permanece acessível).
 * - Ao concluir todas as cenas (R9.5) → chama `onComplete` uma vez.
 *
 * Acessibilidade (R11.1, R11.6, R17.2): controles são `<button>` reais,
 * focáveis e acionáveis por teclado (Enter/Espaço), com rótulo textual e foco
 * visível. Os controles de pular/acelerar são **ocultados** quando a animação é
 * indisponível (sem cenas) ou já concluída (R11.7); a `AlternativaTextual`
 * (fora deste componente) continua disponível. O foco nunca é aprisionado.
 *
 * _Requirements: 9.1, 9.4, 9.5, 9.6, 9.7, 10.1, 11.1, 11.2, 11.3, 11.4, 11.6, 11.7, 17.2_
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { resolveSprite } from '@/lib/match';
import type { Scene, SpriteRef, SpeciesRawIndex } from '@/lib/match';

export interface AnimationPlayerProps {
  /** Sequência completa de cenas de `buildAnimationScenes(log)` — imutável (R9.1, R10.1). */
  readonly scenes: ReadonlyArray<Scene>;
  /** Velocidade de reprodução controlada pelo pai: 1x ou 2x (R11.3, R11.4). */
  readonly speed: 1 | 2;
  /** Índice da Camada_Leitura para resolver sprites por `pokemonId` (R9.2, R9.6). */
  readonly species: SpeciesRawIndex;
  /** Sincroniza HUD/Alternativa_Textual a cada avanço de cena (índice da nova cena corrente). */
  readonly onAdvance?: (index: number) => void;
  /** Chamado ao concluir todas as cenas ou ao pular (R9.5, R11.2). */
  readonly onComplete: () => void;
  /** Alterna a velocidade 1x↔2x no pai (R11.3, R11.4); ausente → botão acelerar oculto. */
  readonly onToggleSpeed?: () => void;
}

const FOCUS_STYLE_ID = 'pfl-animation-player-focus';

const FOCUS_STYLE = `
[data-pfl-player-control]:focus-visible {
  outline: 3px solid #1a1a1a;
  outline-offset: 3px;
}
`;

/**
 * Estilo compartilhado dos controles do player: `<button>` grandes com rótulo
 * textual (R17.3) e foco visível (R17.2); cor é só reforço.
 */
const CONTROL_STYLE: React.CSSProperties = {
  minHeight: '2.75rem',
  minWidth: '7rem',
  padding: '0.75rem 1.25rem',
  fontSize: '1rem',
  fontWeight: 700,
  border: '3px solid #1a1a1a',
  borderRadius: '0.5rem',
  background: '#1a1a1a',
  color: '#ffffff',
  cursor: 'pointer',
};

export function AnimationPlayer({
  scenes,
  speed,
  species,
  onAdvance,
  onComplete,
  onToggleSpeed,
}: AnimationPlayerProps): ReactNode {
  const total = scenes.length;

  // Único estado interno: a posição corrente na sequência. `currentIndex ===
  // total` significa "concluída" (todas as cenas reproduzidas ou pulada).
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  // Guarda para chamar `onComplete` no máximo uma vez por reprodução (R9.5).
  const completedRef = useRef<boolean>(false);
  // Mantém a referência de callbacks estável para o laço de rAF sem reinstalá-lo.
  const onCompleteRef = useRef<AnimationPlayerProps['onComplete']>(onComplete);
  const onAdvanceRef = useRef<AnimationPlayerProps['onAdvance']>(onAdvance);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onAdvanceRef.current = onAdvance;
  }, [onComplete, onAdvance]);

  // Dispara `onComplete` uma única vez ao atingir o fim (ou com log vazio, R9.7).
  const concluida = total === 0 || currentIndex >= total;
  useEffect(() => {
    if (concluida && !completedRef.current) {
      completedRef.current = true;
      onCompleteRef.current();
    }
  }, [concluida]);

  // ------------------------------------------------------------------------
  // Laço de cadência (rAF): SÓ decide QUANDO avançar, nunca PARA ONDE (R10.1).
  // ------------------------------------------------------------------------
  // Guardamos `speed` e `currentIndex` em refs para que o laço leia os valores
  // correntes sem ser reinstalado a cada avanço/alternância de velocidade — a
  // cadência permanece contínua e determinística.
  const speedRef = useRef<1 | 2>(speed);
  const indexRef = useRef<number>(currentIndex);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    // Nada a reproduzir: sem cenas (R9.7) ou já concluída. O efeito de conclusão
    // acima cuida do `onComplete`.
    if (total === 0 || currentIndex >= total) {
      return;
    }

    let rafId = 0;
    let lastTs: number | null = null;
    let elapsed = 0;

    const tick = (ts: number): void => {
      if (lastTs === null) {
        lastTs = ts;
      }
      elapsed += ts - lastTs;
      lastTs = ts;

      const idx = indexRef.current;
      const scene = scenes[idx];
      if (scene === undefined) {
        return;
      }

      // Cadência: duração-base da cena (derivada do log) dividida pela velocidade
      // corrente. `rAF` só compara tempo de parede contra esse limiar (R10.2).
      const threshold = scene.durationHint / speedRef.current;
      if (elapsed >= threshold) {
        elapsed = 0;
        const next = idx + 1;
        indexRef.current = next;
        setCurrentIndex(next);
        if (next < total) {
          onAdvanceRef.current?.(next);
        }
        // Em `next === total` o efeito de conclusão dispara `onComplete`.
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
    // Reinstala o laço apenas quando a identidade da sequência muda ou quando a
    // reprodução recomeça do zero; os valores dinâmicos (speed/index) são lidos
    // por ref dentro do laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, total]);

  // ------------------------------------------------------------------------
  // Controles
  // ------------------------------------------------------------------------

  /** Pular (R11.2): vai ao fim da lista imediatamente — sem recomputação. */
  const handleSkip = useCallback(() => {
    indexRef.current = total;
    setCurrentIndex(total);
  }, [total]);

  /** Acelerar (R11.3, R11.4): delega a alternância 1x↔2x ao pai (velocidade controlada). */
  const handleToggleSpeed = useCallback(() => {
    onToggleSpeed?.();
  }, [onToggleSpeed]);

  // Oculta os controles quando a animação é indisponível/concluída (R11.7). A
  // Alternativa_Textual é renderizada pela página e permanece acessível.
  if (concluida) {
    return null;
  }

  const scene = scenes[currentIndex];
  if (scene === undefined) {
    return null;
  }

  return (
    <section className="pfl-animation-player" aria-label="Animação da partida">
      {/* Indicador de foco visível (R17.2): escopado, sem CSS global. */}
      <style id={FOCUS_STYLE_ID}>{FOCUS_STYLE}</style>

      {/* Palco 8-bit: sprites resolvidos da Camada_Leitura (ou substituto, R9.6). */}
      <div className="pfl-animation-player__palco" aria-hidden="true">
        <div className="pfl-animation-player__lado pfl-animation-player__lado--ofensiva">
          {renderSprites(scene.offenseSprites, species, `snap-${scene.snap}-of`)}
        </div>
        <div className="pfl-animation-player__lado pfl-animation-player__lado--defensiva">
          {renderSprites(scene.defenseSprites, species, `snap-${scene.snap}-def`)}
        </div>
      </div>

      {/* Controles de pular/acelerar — <button> reais, focáveis por teclado (R11.1, R11.6). */}
      <div className="pfl-animation-player__controles" role="group" aria-label="Controles da animação">
        <button
          type="button"
          data-pfl-player-control
          onClick={handleSkip}
          style={CONTROL_STYLE}
        >
          Pular animação
        </button>

        {onToggleSpeed !== undefined ? (
          <button
            type="button"
            data-pfl-player-control
            onClick={handleToggleSpeed}
            aria-pressed={speed === 2}
            style={CONTROL_STYLE}
          >
            {`Velocidade ${speed}x (alternar para ${speed === 1 ? 2 : 1}x)`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Resolve e renderiza os sprites de um lado do Snap. Cada `pokemonId` passa por
 * `resolveSprite` (Camada_Leitura ou substituto local, R9.6); o `<img>` usa o
 * `src` resolvido e o `alt` descritivo (R17.4). Lado sem sprites → nada.
 */
function renderSprites(
  refs: ReadonlyArray<SpriteRef>,
  species: SpeciesRawIndex,
  keyPrefix: string,
): ReactNode {
  return refs.map((ref, i) => {
    const resolved = resolveSprite(ref.pokemonId, species);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={`${keyPrefix}-${ref.pokemonId}-${i}`}
        src={resolved.src}
        alt={resolved.alt}
        className={
          resolved.isFallback
            ? 'pfl-animation-player__sprite pfl-animation-player__sprite--substituto'
            : 'pfl-animation-player__sprite'
        }
      />
    );
  });
}

export default AnimationPlayer;
