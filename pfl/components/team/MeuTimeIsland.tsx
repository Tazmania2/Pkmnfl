'use client';

/**
 * Island cliente da Tela_Meu_Time (`components/team/MeuTimeIsland.tsx`) — spec
 * `pfl-team-strategy-ui`, Tasks 8.4 e 11.1.
 *
 * Monta a tela Meu Time sobre o `TeamDraft` compartilhado ({@link useTeamDraft})
 * e **fia a persistência** da {@link BarraAcoes} às rotas da seção 8 por `fetch`
 * do cliente:
 * - **Salvar**        → `POST /api/team`        (R9.2/R9.3/R9.4)
 * - **Exportar seed** → `POST /api/seed/export` (R14.2) + download `.pflseed.json`
 * - **Importar seed** → `POST /api/seed/import` (R15.10/R15.11)
 *
 * ## Atomicidade das recusas (R9.3, R15.10/R15.11)
 *
 * A regra transversal desta tarefa é: **uma requisição falha ou recusada nunca
 * corrompe o `TeamDraft` em memória**. Isto é garantido estruturalmente, não por
 * convenção:
 * - O `draft` só é substituído (`actions.setDraft`) **depois** de uma resposta
 *   de sucesso confirmada (`200` + `ok:true`). Em qualquer outro caminho —
 *   recusa de regra (`409`/`422`), erro de rede, corpo ilegível — nenhuma ação
 *   da store é chamada, logo o estado anterior permanece **bit a bit idêntico**.
 * - O salvamento (`onSave`) **jamais** muta o draft: sucesso só registra uma
 *   confirmação textual (R9.4) e memoriza o `teamId` devolvido; recusa (`409`)
 *   apenas exibe os `warnings` retornados, sem tocar o roster/estratégia (R9.3).
 * - A importação (`onImportSeed`) só chama `setDraft` no ramo `ok:true`; numa
 *   recusa `422 { step, message }` o draft corrente é **preservado** e a causa é
 *   exibida (R15.10/R15.11).
 *
 * ## Fluxo salvar → exportar/importar e `team_seeds`
 *
 * A rota de importação só persiste em `team_seeds` quando um `teamId` é
 * fornecido (query `?teamId=`); sem ele, a importação apenas **valida** o
 * documento sem persistir. Por isso, após um salvamento bem-sucedido guardamos o
 * `teamId` retornado e o anexamos à importação subsequente, de modo que um
 * round-trip salvar→exportar→importar persista o seed sob o time salvo. Antes do
 * primeiro salvamento, a importação é somente-validação (o draft é substituído
 * em memória, mas nada é gravado em `team_seeds`).
 *
 * O userId não é autenticado nesta spec; usamos um id de desenvolvimento
 * constante (sobrescrevível por prop) como dono do `user_team`.
 *
 * _Requirements: 9.2, 9.3, 9.4, 14.2, 15.10, 15.11_
 */

import { useCallback, useState, type ReactNode } from 'react';
import { useTeamDraft } from './TeamDraftProvider';
import { SeletorOrigem } from './SeletorOrigem';
import { GradeRoster } from './GradeRoster';
import { BarraAcoes } from './BarraAcoes';

/**
 * UserId de desenvolvimento (sem autenticação nesta spec). É o dono do
 * `user_team` persistido; pode ser sobrescrito por prop quando um id real
 * estiver disponível.
 */
const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Props do island de Meu Time. `allowedSpecies` é a elegibilidade de espécie
 * hidratada no servidor (ou `null` quando não disponível no momento da render).
 */
export interface MeuTimeIslandProps {
  /** `pokemon_id` permitidos, hidratados no servidor; `null` se indisponível. */
  readonly allowedSpecies: readonly number[] | null;
  /** Dono do time persistido; padrão {@link DEV_USER_ID} (sem auth nesta spec). */
  readonly userId?: string;
}

/** Mensagem de aviso exibida inline (recusa de regra ou falha de IO). */
interface Aviso {
  readonly tom: 'erro' | 'info';
  readonly texto: string;
}

/**
 * Renderiza a tela Meu Time: origem (preset/do zero) + grade do roster + barra
 * de ações fiada à persistência. O editor de roster/ficha completo mora nas
 * tarefas 9.x; aqui a seleção de origem e a grade já consomem o estado
 * compartilhado, e a barra de ações cobre o requisito crítico desta tarefa — a
 * persistência com recusa atômica.
 */
export function MeuTimeIsland({
  allowedSpecies,
  userId = DEV_USER_ID,
}: MeuTimeIslandProps): ReactNode {
  const { draft, actions } = useTeamDraft();

  const [saving, setSaving] = useState(false);
  const [saveConfirmation, setSaveConfirmation] = useState<string | null>(null);
  const [savedTeamId, setSavedTeamId] = useState<string | null>(
    draft.teamId ?? null,
  );
  const [avisos, setAvisos] = useState<readonly string[]>([]);
  const [mensagemImport, setMensagemImport] = useState<Aviso | null>(null);

  /**
   * Salvar (R9.2/R9.3/R9.4). POST `/api/team` com `{ userId, draft }`. O servidor
   * revalida (`validateDraft`) antes de persistir. Sucesso só registra a
   * confirmação e memoriza o `teamId`; recusa (`409`) exibe os `warnings` e **não
   * muta o draft**; qualquer erro preserva o estado igualmente.
   */
  const onSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    setSaveConfirmation(null);
    setAvisos([]);
    try {
      const resposta = await fetch('/api/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, draft }),
      });

      if (resposta.status === 200) {
        const corpo = (await resposta.json()) as { ok?: boolean; teamId?: string };
        if (corpo.ok === true && typeof corpo.teamId === 'string') {
          setSavedTeamId(corpo.teamId);
          // R9.4: confirmação discreta; o draft NÃO é mutado no salvamento.
          setSaveConfirmation('Time salvo com sucesso.');
        } else {
          setAvisos(['O servidor confirmou 200 mas sem um teamId válido.']);
        }
        return;
      }

      if (resposta.status === 409) {
        // R9.3: recusa por avisos bloqueantes; estado preservado.
        const corpo = (await resposta.json()) as {
          error?: string;
          warnings?: readonly { message?: string }[];
        };
        const mensagens =
          corpo.warnings?.map(
            (w) => w.message ?? 'aviso bloqueante sem mensagem',
          ) ?? [];
        setAvisos(
          mensagens.length > 0
            ? mensagens
            : [corpo.error ?? 'Salvamento recusado por avisos bloqueantes.'],
        );
        return;
      }

      // 400/500 e demais: exibe o motivo; estado preservado.
      const corpo = (await resposta
        .json()
        .catch(() => ({}))) as { error?: string };
      setAvisos([
        corpo.error ?? `Falha ao salvar (HTTP ${resposta.status}).`,
      ]);
    } catch (err) {
      // Erro de rede: nenhuma ação da store foi chamada → draft intacto.
      setAvisos([
        `Falha de rede ao salvar: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ]);
    } finally {
      setSaving(false);
    }
  }, [draft, userId]);

  /**
   * Exportar seed (R14.2). POST `/api/seed/export` com o draft; dispara o
   * download do `.pflseed.json` devolvido montando um `Blob` + âncora. Não toca
   * a store.
   */
  const onExportSeed = useCallback(async (): Promise<void> => {
    setAvisos([]);
    setMensagemImport(null);
    try {
      const resposta = await fetch('/api/seed/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      if (!resposta.ok) {
        const corpo = (await resposta
          .json()
          .catch(() => ({}))) as { error?: string };
        setAvisos([
          corpo.error ?? `Falha ao exportar seed (HTTP ${resposta.status}).`,
        ]);
        return;
      }
      const documento = await resposta.text();
      const blob = new Blob([documento], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const nome =
        (draft.name && draft.name.trim().length > 0
          ? draft.name.trim().replace(/[^\w.-]+/g, '_')
          : 'team') + '.pflseed.json';
      const ancora = document.createElement('a');
      ancora.href = url;
      ancora.download = nome;
      document.body.appendChild(ancora);
      ancora.click();
      ancora.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAvisos([
        `Falha ao exportar seed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ]);
    }
  }, [draft]);

  /**
   * Importar seed (R15.10/R15.11). Lê os bytes do arquivo e POSTa em
   * `/api/seed/import`. Se há um `teamId` salvo, o anexa à query para persistir
   * em `team_seeds`; sem ele, a importação é somente-validação. O draft só é
   * substituído no ramo `ok:true`; numa recusa `422` (ou qualquer erro) o estado
   * é **preservado** e a causa (`step`/`message`) é exibida.
   */
  const onImportSeed = useCallback(
    async (file: File): Promise<void> => {
      setAvisos([]);
      setMensagemImport(null);
      try {
        const bytes = await file.arrayBuffer();
        const qs =
          savedTeamId !== null
            ? `?teamId=${encodeURIComponent(savedTeamId)}`
            : '';
        const resposta = await fetch(`/api/seed/import${qs}`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes,
        });

        if (resposta.status === 200) {
          const corpo = (await resposta.json()) as {
            ok?: boolean;
            draft?: unknown;
          };
          if (corpo.ok === true && isTeamDraftLike(corpo.draft)) {
            // Único caminho que muta o estado: sucesso confirmado (R15.11).
            actions.setDraft(corpo.draft);
            setMensagemImport({
              tom: 'info',
              texto: 'Seed importado e carregado com sucesso.',
            });
          } else {
            // Sucesso de validação sem draft devolvido (rota só-validação):
            // preserva o estado corrente e informa.
            setMensagemImport({
              tom: 'info',
              texto:
                'Seed válido. O estado atual foi preservado (importação sem substituição).',
            });
          }
          return;
        }

        if (resposta.status === 422) {
          // R15.10/R15.11: recusa legível; estado preservado, sem setDraft.
          const corpo = (await resposta.json()) as {
            step?: string;
            message?: string;
          };
          setMensagemImport({
            tom: 'erro',
            texto: `Importação recusada em ${corpo.step ?? 'etapa desconhecida'}: ${
              corpo.message ?? 'documento inválido'
            }`,
          });
          return;
        }

        const corpo = (await resposta
          .json()
          .catch(() => ({}))) as { error?: string };
        setMensagemImport({
          tom: 'erro',
          texto:
            corpo.error ?? `Falha ao importar seed (HTTP ${resposta.status}).`,
        });
      } catch (err) {
        // Erro de rede/leitura: nenhuma substituição ocorreu → draft intacto.
        setMensagemImport({
          tom: 'erro',
          texto: `Falha ao importar seed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    },
    [actions, savedTeamId],
  );

  return (
    <section aria-labelledby="meu-time-titulo">
      <h1 id="meu-time-titulo">Meu Time</h1>

      <p>
        Espécies permitidas:{' '}
        {allowedSpecies === null
          ? 'indisponíveis no momento'
          : `${allowedSpecies.length} carregadas`}
      </p>

      {/* Origem: preset copiável ou começar do zero (R1.*). */}
      <SeletorOrigem
        onUsePreset={(presetId) => {
          setSaveConfirmation(null);
          setAvisos([]);
          setMensagemImport(null);
          actions.loadFromPreset(presetId);
        }}
        onStartEmpty={() => {
          setSaveConfirmation(null);
          setAvisos([]);
          setMensagemImport(null);
          actions.loadEmpty();
        }}
      />

      {/* Grade do roster (contador X/53, item distinto por instância, R2.*). */}
      <GradeRoster
        roster={draft.roster}
        onSelectAthlete={() => {
          /* edição da ficha chega nas tarefas 9.x; placeholder estável. */
        }}
      />

      {/* Avisos de salvamento recusado/erro (R9.3), associados por ARIA. */}
      {avisos.length > 0 ? (
        <div
          role="alert"
          aria-label="Avisos de salvamento"
          style={{
            margin: '0.75rem 0',
            padding: '0.625rem 0.875rem',
            border: '2px solid #8a1a1a',
            borderRadius: '0.5rem',
            background: '#fdecec',
            color: '#5a0000',
          }}
        >
          <strong>Não foi possível salvar:</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            {avisos.map((texto, i) => (
              <li key={`${i}-${texto}`}>{texto}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Resultado da importação (sucesso ou recusa R15.10/R15.11). */}
      {mensagemImport !== null ? (
        <p
          role={mensagemImport.tom === 'erro' ? 'alert' : 'status'}
          aria-live="polite"
          style={{
            margin: '0.75rem 0',
            padding: '0.625rem 0.875rem',
            borderRadius: '0.5rem',
            border:
              mensagemImport.tom === 'erro'
                ? '2px solid #8a1a1a'
                : '2px solid #1a5c2e',
            background: mensagemImport.tom === 'erro' ? '#fdecec' : '#eafaef',
            color: mensagemImport.tom === 'erro' ? '#5a0000' : '#1a5c2e',
          }}
        >
          <strong>
            {mensagemImport.tom === 'erro' ? 'Importação:' : 'Importação:'}
          </strong>{' '}
          {mensagemImport.texto}
        </p>
      ) : null}

      {/* Barra de ações fiada à persistência (R9/R14/R15). */}
      <BarraAcoes
        onSave={onSave}
        onExportSeed={onExportSeed}
        onImportSeed={onImportSeed}
        saving={saving}
        saveConfirmation={saveConfirmation}
      />
    </section>
  );
}

/**
 * Guard de forma mínimo para o `draft` devolvido por `/api/seed/import` no ramo
 * de sucesso. Evita chamar `setDraft` com um valor que não é um `TeamDraft`,
 * preservando a integridade do estado mesmo diante de uma resposta inesperada.
 */
function isTeamDraftLike(value: unknown): value is import('@/lib/team/model').TeamDraft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.roster) &&
    Array.isArray(v.lineups) &&
    typeof v.strategy === 'object' &&
    v.strategy !== null
  );
}
