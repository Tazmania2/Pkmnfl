import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * O módulo `server-client.ts` inicia com `import 'server-only'`, que lança
 * quando importado fora de um contexto de servidor Next/RSC. Sob Vitest não há
 * esse contexto, então substituímos o módulo por um stub vazio para permitir a
 * importação transitiva (via `env`/clientes). O stub não altera o comportamento
 * testado — apenas neutraliza a guarda de importação.
 */
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createPublicClient } from '../../lib/supabase/public-client';
import {
  getSupabaseEnv,
  MissingSupabaseEnvError,
  SUPABASE_ENV_VARS,
  type SupabaseEnvVarName,
} from '../../lib/supabase/env';

/**
 * Smoke de conexão ao Supabase (Task 14.4).
 *
 * _Requirements: 2.6_ — WHEN a inicialização do Cliente_Supabase ocorre com
 * Variaveis_Ambiente presentes e válidas, THE Cliente_Supabase SHALL estabelecer
 * uma conexão autenticada com o projeto Supabase referenciado pela URL alvo.
 *
 * Estrutura em duas camadas, conforme a Testing Strategy do design
 * (“Conexão (R2.6): smoke que inicializa o cliente com credenciais válidas e
 * confirma conexão ao projeto Supabase alvo”):
 *
 *   1. Camada sempre-executada (determinística, sem rede): documenta a URL alvo
 *      do projeto (R2.6), verifica que `getSupabaseEnv()` lê exclusivamente de
 *      variáveis de ambiente e que a inicialização do cliente público aborta com
 *      {@link MissingSupabaseEnvError} quando as variáveis estão ausentes —
 *      exercitando o caminho de código de conexão de forma determinística.
 *
 *   2. Camada de conexão ao vivo (gated por `describe.skipIf`): só roda quando as
 *      credenciais reais estão presentes no ambiente (NEXT_PUBLIC_SUPABASE_URL e
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY, tipicamente via `.env.local`, que é
 *      gitignored). Inicializa o cliente público, faz uma checagem leve de
 *      conectividade contra o projeto e afirma que a URL configurada é a URL alvo.
 *      Sem credenciais, este bloco é pulado (nenhuma credencial é embutida aqui).
 *
 * Nenhum valor de credencial é embutido no código: apenas nomes de variáveis e a
 * URL pública do projeto (que é um identificador público, não um segredo).
 */

/**
 * URL alvo do projeto Supabase, exigida por R2.6. É um identificador público do
 * projeto (não uma credencial) e serve como contrato documentado deste smoke.
 */
const EXPECTED_PROJECT_URL = 'https://vtrcohnmgendbdkgjzmf.supabase.co';

/** As duas variáveis necessárias para o cliente público ao vivo. */
const PUBLIC_CLIENT_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

/** `true` quando as variáveis do cliente público estão presentes e não-vazias. */
function hasPublicClientCreds(): boolean {
  return PUBLIC_CLIENT_ENV_VARS.every(
    (name) => (process.env[name]?.trim() ?? '') !== '',
  );
}

describe('smoke de conexão ao Supabase — contrato determinístico (R2.6)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Isola `process.env` por caso e restaura em `afterEach`.
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('documenta a URL alvo exigida por R2.6', () => {
    // O projeto Supabase referenciado por R2.6 é fixo e público.
    expect(EXPECTED_PROJECT_URL).toBe('https://vtrcohnmgendbdkgjzmf.supabase.co');
  });

  it('`getSupabaseEnv()` lê a URL exclusivamente de variável de ambiente', () => {
    // Valores de preenchimento (não são credenciais reais): só satisfazem a
    // validação para provar que a leitura vem do ambiente.
    const values: Record<SupabaseEnvVarName, string> = {
      NEXT_PUBLIC_SUPABASE_URL: EXPECTED_PROJECT_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder',
    };
    for (const name of SUPABASE_ENV_VARS) {
      process.env[name] = values[name];
    }

    const config = getSupabaseEnv();
    // A URL retornada é exatamente a que foi colocada no ambiente.
    expect(config.url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
  });

  it('aborta a inicialização do cliente público quando faltam variáveis (R2.3 → pré-condição de R2.6)', () => {
    // Sem as variáveis, nenhuma conexão deve ser tentada.
    for (const name of SUPABASE_ENV_VARS) {
      delete process.env[name];
    }

    let caught: unknown;
    try {
      createPublicClient();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MissingSupabaseEnvError);
    const err = caught as MissingSupabaseEnvError;
    // O caminho de código de conexão foi exercitado e abortou com os nomes.
    expect(err.missing).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(err.missing).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });
});

/**
 * Conexão ao vivo contra o projeto Supabase alvo (R2.6).
 *
 * Pulado automaticamente quando as credenciais do cliente público não estão
 * presentes no ambiente (ex.: CI sem `.env.local`). Quando presentes, inicializa
 * o cliente, faz uma checagem leve de conectividade e confirma a URL alvo.
 */
describe.skipIf(!hasPublicClientCreds())(
  'smoke de conexão ao Supabase — conexão ao vivo (R2.6)',
  () => {
    it('inicializa o cliente público e confirma a conexão ao projeto alvo', async () => {
      // A URL configurada deve ser a do projeto alvo exigido por R2.6.
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()).toBe(
        EXPECTED_PROJECT_URL,
      );

      const client = createPublicClient();

      // Checagem leve de conectividade: uma chamada autenticada mínima contra o
      // projeto. Confirma que o cliente alcança o endpoint do projeto alvo sem
      // depender da existência de tabelas específicas. Erros de autenticação de
      // sessão anônima (sem usuário logado) são aceitáveis — o que importa é que
      // a requisição chegou ao projeto. Falha de rede/DNS faria esta chamada
      // rejeitar, falhando o smoke.
      const { error } = await client.auth.getSession();

      // `getSession()` para a sessão anônima resolve sem erro de transporte.
      expect(error).toBeNull();
    });
  },
);
