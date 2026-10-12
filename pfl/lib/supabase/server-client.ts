/**
 * Cliente Supabase com privilégio de service role (somente servidor).
 *
 * Cria o cliente a partir de `URL + SERVICE_ROLE_KEY` (R2.1), lendo os valores
 * exclusivamente de variáveis de ambiente via {@link getSupabaseEnv}. A service
 * role **ignora RLS** e tem acesso privilegiado, portanto este módulo nunca pode
 * acabar no bundle de cliente.
 *
 * `import 'server-only'` (R2.6) faz o build falhar caso este arquivo seja
 * importado, direta ou transitivamente, por um Client Component — garantindo que
 * a chave de service role jamais seja exposta ao browser.
 *
 * Falhas de autenticação (R2.4) são propagadas sem incluir o valor da credencial
 * em mensagens ou logs: apenas o nome da variável de ambiente envolvida aparece
 * no diagnóstico.
 */
import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseEnv, type SupabaseEnvVarName } from './env';

/**
 * Erro de falha de autenticação do cliente service-role.
 *
 * A mensagem referencia a credencial apenas pelo NOME da variável de ambiente
 * (`SUPABASE_SERVICE_ROLE_KEY`), nunca pelo seu valor, atendendo R2.4.
 */
export class SupabaseAuthenticationError extends Error {
  /** Nome da variável de ambiente cuja credencial foi rejeitada. */
  public readonly credentialEnvVar: SupabaseEnvVarName;

  constructor(cause?: unknown) {
    const credentialEnvVar: SupabaseEnvVarName = 'SUPABASE_SERVICE_ROLE_KEY';
    super(
      'Falha ao autenticar o cliente service-role do Supabase: a credencial em ' +
        `${credentialEnvVar} foi rejeitada. ` +
        'Verifique o valor configurado no ambiente (o valor não é exibido por segurança).',
    );
    this.name = 'SupabaseAuthenticationError';
    this.credentialEnvVar = credentialEnvVar;
    if (cause !== undefined) {
      // Preserva a origem para diagnóstico sem jamais logar o valor da credencial.
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Cria o cliente Supabase com privilégio de service role.
 *
 * Lê e valida as variáveis de ambiente (lançando {@link MissingSupabaseEnvError}
 * quando ausentes/vazias, via {@link getSupabaseEnv}) e constrói o cliente com a
 * URL do projeto e a chave de service role. Como a service role bypassa RLS, a
 * sessão não é persistida nem auto-renovada — este é um cliente de backend.
 *
 * @returns Um {@link SupabaseClient} com privilégio de service role.
 * @throws {MissingSupabaseEnvError} Se faltar alguma variável de ambiente.
 */
export function createServerClient(): SupabaseClient {
  const { url, serviceRoleKey } = getSupabaseEnv();

  return createClient(url, serviceRoleKey, {
    auth: {
      // Contexto de backend: nenhuma sessão de usuário a persistir ou renovar.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Verifica se um erro de autenticação proveniente do Supabase está relacionado
 * a credenciais rejeitadas (ex.: chave de service role inválida).
 *
 * Mantém a inspeção restrita a propriedades de diagnóstico (status/código),
 * nunca ao valor da credencial.
 */
function isAuthenticationRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { status?: unknown; code?: unknown };
  if (candidate.status === 401 || candidate.status === 403) {
    return true;
  }
  return candidate.code === '401' || candidate.code === '403';
}

/**
 * Executa a primeira operação autenticada contra o Supabase e propaga uma falha
 * de autenticação como {@link SupabaseAuthenticationError} caso a credencial seja
 * rejeitada (R2.4) — sem jamais incluir o valor da credencial na mensagem/log.
 *
 * Erros não relacionados à autenticação são repassados sem alteração.
 *
 * @param client Cliente service-role a validar (default: {@link createServerClient}).
 * @throws {SupabaseAuthenticationError} Se a credencial for rejeitada.
 */
export async function assertServerClientAuthenticated(
  client: SupabaseClient = createServerClient(),
): Promise<SupabaseClient> {
  try {
    const { error } = await client.auth.getUser();
    if (error !== null && isAuthenticationRejection(error)) {
      throw new SupabaseAuthenticationError(error);
    }
  } catch (error) {
    if (error instanceof SupabaseAuthenticationError) {
      throw error;
    }
    if (isAuthenticationRejection(error)) {
      throw new SupabaseAuthenticationError(error);
    }
    throw error;
  }

  return client;
}
