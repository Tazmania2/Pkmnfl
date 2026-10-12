/**
 * Cliente público (anon) do Módulo Cliente_Supabase.
 *
 * Cria um cliente Supabase a partir de `URL + ANON_KEY` (R2.1), seguro para uso
 * tanto no browser quanto no servidor. Por usar a chave anônima pública, todas
 * as operações ficam sujeitas às políticas de Row Level Security (RLS) do projeto.
 *
 * As credenciais vêm exclusivamente de variáveis de ambiente, validadas por
 * `getSupabaseEnv()`; nenhum valor é embutido no código (R2.1).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseEnv } from './env';

/**
 * Cria o cliente público (anon) do Supabase.
 *
 * Lê e valida as variáveis de ambiente via {@link getSupabaseEnv} e instancia o
 * cliente com a URL do projeto e a chave anônima pública. Se alguma variável
 * obrigatória estiver ausente ou vazia, `getSupabaseEnv()` lança
 * {@link MissingSupabaseEnvError} e a inicialização é abortada antes de qualquer
 * conexão (R2.3).
 *
 * O cliente retornado é seguro para browser e servidor e respeita as políticas
 * RLS associadas à chave anônima.
 *
 * @returns Um {@link SupabaseClient} configurado com URL + ANON_KEY.
 * @throws {MissingSupabaseEnvError} Se faltar alguma variável obrigatória.
 */
export function createPublicClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseEnv();
  return createClient(url, anonKey);
}
