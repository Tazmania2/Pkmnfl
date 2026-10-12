/**
 * Validação de variáveis de ambiente do Módulo Cliente_Supabase.
 *
 * Lê exclusivamente de variáveis de ambiente (R2.1) e, caso qualquer
 * variável obrigatória esteja ausente ou vazia após `trim` (R2.3),
 * coleta TODOS os nomes faltantes e lança um erro cuja mensagem
 * identifica cada variável pelo nome — abortando antes de qualquer conexão.
 *
 * Nenhum valor de credencial é embutido no código: apenas nomes de variáveis.
 */

/** Nomes das variáveis de ambiente obrigatórias para conexão com o Supabase. */
export const SUPABASE_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

/** Nome de uma variável de ambiente obrigatória do Supabase. */
export type SupabaseEnvVarName = (typeof SUPABASE_ENV_VARS)[number];

/** Objeto de configuração tipado retornado quando todas as variáveis são válidas. */
export interface SupabaseEnvConfig {
  /** URL do projeto Supabase (cliente público e server-side). */
  readonly url: string;
  /** Chave pública anônima (anon), usada pelo cliente público. */
  readonly anonKey: string;
  /** Chave de service role (somente server). Nunca exposta ao browser. */
  readonly serviceRoleKey: string;
}

/**
 * Erro lançado quando uma ou mais variáveis de ambiente obrigatórias
 * estão ausentes ou vazias. Expõe os nomes faltantes para diagnóstico,
 * sem jamais conter valores de credencial.
 */
export class MissingSupabaseEnvError extends Error {
  /** Nomes das variáveis de ambiente faltantes, na ordem canônica. */
  public readonly missing: readonly SupabaseEnvVarName[];

  constructor(missing: readonly SupabaseEnvVarName[]) {
    super(
      'Configuração do Supabase incompleta: ' +
        `variáveis de ambiente obrigatórias ausentes ou vazias: ${missing.join(', ')}. ` +
        'Defina-as no ambiente (ex.: .env.local) antes de inicializar o cliente.',
    );
    this.name = 'MissingSupabaseEnvError';
    this.missing = missing;
  }
}

/**
 * Lê e valida as variáveis de ambiente obrigatórias do Supabase.
 *
 * @returns Objeto de configuração tipado quando todas estão presentes e válidas.
 * @throws {MissingSupabaseEnvError} Se uma ou mais variáveis estiverem
 *   ausentes ou vazias após `trim`. A mensagem lista cada nome faltante
 *   e a função aborta antes de qualquer conexão.
 */
export function getSupabaseEnv(): SupabaseEnvConfig {
  const resolved = {} as Record<SupabaseEnvVarName, string>;
  const missing: SupabaseEnvVarName[] = [];

  for (const name of SUPABASE_ENV_VARS) {
    const value = process.env[name]?.trim() ?? '';
    if (value === '') {
      missing.push(name);
    } else {
      resolved[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new MissingSupabaseEnvError(missing);
  }

  return {
    url: resolved.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: resolved.SUPABASE_SERVICE_ROLE_KEY,
  };
}
