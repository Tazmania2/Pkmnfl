'use client';

/**
 * Provider React da store de partida (`components/match/MatchStoreProvider.tsx`)
 * — spec `pfl-gameday-result-ui`, Task 12.1.
 *
 * A camada React sobre a `MatchStore` framework-agnóstica de `lib/match/store.ts`.
 * As duas telas (`/game-day` e `/resultado`) compartilham **uma única** instância
 * de store por sessão, montada acima das rotas num layout comum (design: "Estado
 * da partida compartilhado entre telas"). Como o Next.js App Router não garante
 * preservação de estado de módulo entre navegações, a store vive aqui, no Context,
 * complementada por um snapshot em `sessionStorage` serializado de forma estável
 * — assim o `log`+`score` retidos (e o `Seed_RNG` exibível) sobrevivem a
 * refresh/deep-link em `/resultado` **sem reenviar a simulação nem recalcular
 * valores** (R16.2, R6.4). O `Seed_RNG` exibido permanece rastreável porque vive
 * no estado da store e é serializado verbatim no snapshot (R16.3).
 *
 * Princípios de design refletidos:
 * - **A store é a fonte da verdade**: este provider não calcula nada de jogo;
 *   apenas (a) cria/retém a instância, (b) torna suas mutações reativas para o
 *   React e (c) persiste/restaura o snapshot. Toda transição continua na FSM pura.
 * - **Apresentação separada de lógica**: a (de)serialização estável é da store
 *   (`snapshot()`/`restore()`); aqui só orquestramos o acesso ao `sessionStorage`,
 *   sempre guardado contra SSR (nunca tocamos `window` fora de efeitos/handlers).
 *
 * Reatividade: a `MatchStore` muta estado imperativamente e não expõe assinatura.
 * Envolvemos os métodos de transição num *store externo* com `useSyncExternalStore`:
 * cada transição delega ao método real, persiste o snapshot e notifica os
 * inscritos, que então re-renderizam com o `getState()` atualizado. Isso mantém as
 * duas telas em sincronia sem acoplar o núcleo ao React.
 *
 * _Requirements: 16.2, 16.3_
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createMatchStore, type MatchStore, type MatchState } from '@/lib/match';

/**
 * Chave fixa do snapshot da partida em `sessionStorage`. Única por sessão de aba:
 * `sessionStorage` isola por aba e é limpo ao fechá-la, o que casa com o ciclo de
 * vida de uma partida (não precisa persistir entre sessões, mas precisa sobreviver
 * a refresh/deep-link dentro da mesma aba, R16.2).
 */
export const MATCH_SNAPSHOT_KEY = 'pfl:match';

/**
 * Valor do Context: a instância da store (para disparar transições) e o estado
 * corrente reativo (para renderizar). Componentes obtêm ambos por `useMatchStore()`.
 */
export interface MatchStoreContextValue {
  /** A store compartilhada — chame suas transições para avançar a FSM. */
  readonly store: MatchStore;
  /** Snapshot reativo do estado corrente; re-renderiza a cada transição. */
  readonly state: MatchState;
}

/**
 * `undefined` como sentinela de "fora do provider": permite `useMatchStore()`
 * lançar um erro claro quando usado sem o provider montado acima.
 */
const MatchStoreContext = createContext<MatchStoreContextValue | undefined>(undefined);

/**
 * Lê o snapshot persistido no `sessionStorage`, se existir. Guardado contra SSR
 * (onde `window`/`sessionStorage` não existem) e contra ambientes em que o acesso
 * pode lançar (ex.: armazenamento desabilitado por política de privacidade).
 */
function readPersistedSnapshot(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage.getItem(MATCH_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

/**
 * Escreve o snapshot corrente no `sessionStorage`. Também guardado contra SSR e
 * contra exceções de acesso (nunca derruba a UI por falha de persistência).
 */
function writePersistedSnapshot(snapshot: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(MATCH_SNAPSHOT_KEY, snapshot);
  } catch {
    // Persistência é melhor-esforço: uma falha de escrita não deve interromper a
    // partida. O estado em memória permanece a fonte da verdade da sessão.
  }
}

/**
 * Provider da `MatchStore`. Cria uma instância por sessão (lazy, via `useRef`) e
 * expõe estado reativo via `useSyncExternalStore`.
 *
 * - **Restauração (R16.2)**: na primeira inicialização, se há um snapshot em
 *   `sessionStorage`, `store.restore(it)` o reaplica verbatim antes de qualquer
 *   render — um refresh/deep-link em `/resultado` recupera `log`+`score`+`seedRng`
 *   sem refetch nem recomputo.
 * - **Persistência**: cada transição grava `store.snapshot()` de volta no
 *   `sessionStorage`, mantendo o espelho em disco atualizado.
 *
 * @param children As páginas `/game-day` e `/resultado` sob o grupo `(match)`.
 */
export function MatchStoreProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  // Instância única por sessão (lazy). A restauração do snapshot persistido é
  // feita na mesma inicialização, de forma síncrona: o estado restaurado já vale
  // no primeiro render do cliente (R16.2). `readPersistedSnapshot` é no-op no SSR,
  // então o servidor renderiza a partir do estado inicial sem divergir do núcleo.
  const storeRef = useRef<MatchStore | null>(null);
  if (storeRef.current === null) {
    const store = createMatchStore();
    const persisted = readPersistedSnapshot();
    if (persisted !== null) {
      store.restore(persisted);
    }
    storeRef.current = store;
  }
  const store = storeRef.current;

  // Registro de inscritos do store externo (padrão `useSyncExternalStore`). As
  // transições, após mutar a store, notificam todos para re-renderizar.
  const listenersRef = useRef<Set<() => void>>(new Set());

  const subscribe = useCallback((listener: () => void) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => store.getState(), [store]);

  // No servidor, o estado é sempre o inicial da store recém-criada (sem acesso a
  // `sessionStorage`). `getServerSnapshot` evita o aviso de hidratação ao fornecer
  // explicitamente esse mesmo `getState()`.
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Fachada reativa: cada transição delega ao método real da store, persiste o
  // snapshot resultante e notifica os inscritos. `reset`/`snapshot`/`restore` e os
  // getters também são expostos; apenas as *mutações* notificam.
  const reactiveStore = useMemo<MatchStore>(() => {
    const notify = (): void => {
      writePersistedSnapshot(store.snapshot());
      for (const listener of listenersRef.current) {
        listener();
      }
    };

    return {
      getState: () => store.getState(),
      snapshot: () => store.snapshot(),
      selecionarModo: (modo) => {
        store.selecionarModo(modo);
        notify();
      },
      setAdversarioSeed: (draft) => {
        store.setAdversarioSeed(draft);
        notify();
      },
      iniciarSimulacao: (seedRng) => {
        store.iniciarSimulacao(seedRng);
        notify();
      },
      concluirSimulacao: (log, score) => {
        store.concluirSimulacao(log, score);
        notify();
      },
      registrarErro: (erro) => {
        store.registrarErro(erro);
        notify();
      },
      irParaResultado: () => {
        store.irParaResultado();
        notify();
      },
      reset: () => {
        store.reset();
        notify();
      },
      restore: (snapshot) => {
        store.restore(snapshot);
        notify();
      },
    };
  }, [store]);

  const value = useMemo<MatchStoreContextValue>(
    () => ({ store: reactiveStore, state }),
    [reactiveStore, state],
  );

  return <MatchStoreContext.Provider value={value}>{children}</MatchStoreContext.Provider>;
}

/**
 * Hook de acesso à store de partida. Retorna a store reativa (para disparar
 * transições) e o estado corrente (para renderizar). Lança um erro claro se usado
 * fora do `MatchStoreProvider`, para que o engano seja pego em desenvolvimento em
 * vez de produzir um `undefined` silencioso.
 */
export function useMatchStore(): MatchStoreContextValue {
  const value = useContext(MatchStoreContext);
  if (value === undefined) {
    throw new Error(
      'useMatchStore deve ser usado dentro de <MatchStoreProvider> (layout do grupo de rotas (match)).',
    );
  }
  return value;
}
