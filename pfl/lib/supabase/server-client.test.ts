import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O módulo sob teste inicia com `import 'server-only'`, que lança quando
 * importado fora de um contexto de servidor Next/RSC. Sob Vitest não há esse
 * contexto, então substituímos o módulo por um stub vazio para permitir a
 * importação. O stub não altera o comportamento testado (apenas a guarda de
 * importação é neutralizada).
 */
vi.mock('server-only', () => ({}));

import {
  assertServerClientAuthenticated,
  SupabaseAuthenticationError,
} from './server-client';

/**
 * Testes de exemplo para a falha de autenticação do cliente service-role
 * SEM vazamento de credencial (Task 5.5).
 *
 * _Requirements: 2.4_ — quando as variáveis de ambiente existem mas são
 * rejeitadas na autenticação com o Supabase, a inicialização encerra sem
 * expor o VALOR da credencial e retorna uma mensagem de falha de autenticação.
 * A mensagem deve referenciar a credencial apenas pelo NOME da variável
 * (`SUPABASE_SERVICE_ROLE_KEY`), nunca pelo seu valor.
 */

/**
 * Segredo claramente FALSO usado para provar que o valor nunca aparece na
 * mensagem de erro. Não é uma credencial real.
 */
const FAKE_SECRET = 'FAKE-SERVICE-ROLE-SECRET-abc123';

describe('SupabaseAuthenticationError — não vaza credencial (R2.4)', () => {
  it('não inclui o valor do segredo na mensagem, mesmo quando a causa o contém', () => {
    // A causa carrega um valor sensível, como poderia vir de um erro upstream.
    const cause = {
      status: 401,
      message: `rejected key ${FAKE_SECRET}`,
      serviceRoleKey: FAKE_SECRET,
    };

    const error = new SupabaseAuthenticationError(cause);

    // A mensagem NUNCA contém o valor da credencial.
    expect(error.message).not.toContain(FAKE_SECRET);
    // A mensagem referencia a credencial pelo NOME da variável de ambiente.
    expect(error.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(error.credentialEnvVar).toBe('SUPABASE_SERVICE_ROLE_KEY');
    // A causa é preservada para diagnóstico, mas fora da mensagem.
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });
});

describe('assertServerClientAuthenticated — rejeição de credencial (R2.4)', () => {
  /**
   * Constrói um stub mínimo de SupabaseClient cujo `auth.getUser()` resolve
   * com um erro de autenticação (status 401/403) carregando um valor de
   * credencial falso — para verificar que esse valor não escapa.
   */
  function makeStubClient(authError: unknown): SupabaseClient {
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: authError }),
      },
    } as unknown as SupabaseClient;
  }

  it('lança SupabaseAuthenticationError sem vazar o segredo (erro 401)', async () => {
    const client = makeStubClient({
      status: 401,
      message: `invalid service role key: ${FAKE_SECRET}`,
      name: 'AuthApiError',
    });

    let caught: unknown;
    try {
      await assertServerClientAuthenticated(client);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SupabaseAuthenticationError);
    const err = caught as SupabaseAuthenticationError;
    expect(err.message).not.toContain(FAKE_SECRET);
    expect(err.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('lança SupabaseAuthenticationError sem vazar o segredo (erro 403)', async () => {
    const client = makeStubClient({
      status: 403,
      message: `forbidden with key ${FAKE_SECRET}`,
      name: 'AuthApiError',
    });

    let caught: unknown;
    try {
      await assertServerClientAuthenticated(client);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SupabaseAuthenticationError);
    const err = caught as SupabaseAuthenticationError;
    expect(err.message).not.toContain(FAKE_SECRET);
    expect(err.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
