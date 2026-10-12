import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getSupabaseEnv,
  MissingSupabaseEnvError,
  SUPABASE_ENV_VARS,
  type SupabaseEnvVarName,
} from './env';

/**
 * Testes de exemplo/edge para a validação de variáveis de ambiente do
 * Módulo Cliente_Supabase (Task 5.2).
 *
 * _Requirements: 2.3_ — quando uma variável obrigatória está ausente ou
 * vazia (após `trim`), a inicialização aborta sem conexão e o erro
 * identifica PELO NOME cada variável faltante.
 *
 * Cada teste manipula `process.env` e o restaura ao estado original no
 * `afterEach`, evitando vazamento de estado entre casos.
 */

/** Valores de preenchimento (não são credenciais reais; só satisfazem a validação). */
const VALID_VALUES: Record<SupabaseEnvVarName, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder',
};

describe('getSupabaseEnv — validação de env vars (R2.3)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Preserva uma cópia e começa cada caso a partir de um conjunto válido.
    originalEnv = process.env;
    process.env = { ...originalEnv };
    for (const name of SUPABASE_ENV_VARS) {
      process.env[name] = VALID_VALUES[name];
    }
  });

  afterEach(() => {
    // Restaura o ambiente original.
    process.env = originalEnv;
  });

  it('retorna a configuração tipada quando todas as variáveis são válidas', () => {
    const config = getSupabaseEnv();
    expect(config).toEqual({
      url: VALID_VALUES.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: VALID_VALUES.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: VALID_VALUES.SUPABASE_SERVICE_ROLE_KEY,
    });
  });

  describe('uma única variável faltante', () => {
    it('lança MissingSupabaseEnvError nomeando a variável ausente', () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      let caught: unknown;
      try {
        getSupabaseEnv();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MissingSupabaseEnvError);
      const err = caught as MissingSupabaseEnvError;
      expect(err.missing).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
      // A mensagem identifica a variável pelo nome.
      expect(err.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      // As variáveis presentes não são listadas como faltantes.
      expect(err.missing).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(err.missing).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    });
  });

  describe('várias variáveis faltantes', () => {
    it('coleta todas as faltantes e a mensagem lista cada nome', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      let caught: unknown;
      try {
        getSupabaseEnv();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MissingSupabaseEnvError);
      const err = caught as MissingSupabaseEnvError;
      expect(err.missing).toEqual([
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ]);
      // A mensagem lista CADA nome faltante.
      expect(err.message).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(err.message).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      // A variável presente não aparece na lista de faltantes.
      expect(err.missing).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    });

    it('lista todas quando todas estão ausentes, na ordem canônica', () => {
      for (const name of SUPABASE_ENV_VARS) {
        delete process.env[name];
      }

      let caught: unknown;
      try {
        getSupabaseEnv();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MissingSupabaseEnvError);
      const err = caught as MissingSupabaseEnvError;
      expect(err.missing).toEqual([...SUPABASE_ENV_VARS]);
      for (const name of SUPABASE_ENV_VARS) {
        expect(err.message).toContain(name);
      }
    });
  });

  describe('valor vazio-após-trim', () => {
    it('trata string só com espaços como faltante e a nomeia', () => {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '   ';

      let caught: unknown;
      try {
        getSupabaseEnv();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MissingSupabaseEnvError);
      const err = caught as MissingSupabaseEnvError;
      expect(err.missing).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
      expect(err.message).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    });

    it('trata string vazia e espaços em branco (tabs/newlines) como faltantes', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = '';
      process.env.SUPABASE_SERVICE_ROLE_KEY = '\t\n  ';

      let caught: unknown;
      try {
        getSupabaseEnv();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MissingSupabaseEnvError);
      const err = caught as MissingSupabaseEnvError;
      expect(err.missing).toEqual([
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ]);
      expect(err.message).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(err.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });
  });
});
