/**
 * Geração e validação do `Seed_RNG` (`lib/match/seed-rng.ts`) — spec
 * `pfl-gameday-result-ui`.
 *
 * O `Seed_RNG` é um inteiro sem sinal de 64 bits (uint64) representado como
 * **string decimal canônica** no intervalo `"0".."18446744073709551615"`
 * (= `[0, 2^64 − 1]`). Ele é a semente de reprodutibilidade da partida: as
 * mesmas Escalacoes + Estrategias + `Seed_RNG` reproduzem log, placar e
 * animação (R16.1, R16.2), e o valor é exibido ao jogador de forma rastreável
 * (R16.3).
 *
 * Princípios (design "Geração do Seed_RNG"):
 * - **Seed de RNG separado do seed de time** (R6.2): o `Seed_RNG` é gerado como
 *   entrada distinta e **nunca** derivado de qualquer seed de time. Este módulo
 *   não recebe, lê nem referencia seed de time: a independência é estrutural.
 * - **Entropia só na geração de uma NOVA partida**: a única parte impura deste
 *   módulo é `gerarSeedRng`, que consulta a fonte de entropia criptográfica.
 *   `parseSeedRng` é **pura e total** — para reprodução, o jogador reinforma um
 *   seed anterior e ele é apenas validado, sem consultar entropia.
 *
 * A faixa é verificada com `BigInt`, que preserva o valor exato do uint64 sem
 * perda de precisão (idêntico ao tratamento do motor em `lib/sim`, que carrega
 * o seed como `bigint` e o serializa com `bigint.toString(10)`).
 *
 * _Requirements: 6.2, 16.1, 16.3_
 */

/** Limite superior do domínio do `Seed_RNG`: `2^64 − 1` (uint64 máximo). */
const UINT64_MAX: bigint = (1n << 64n) - 1n;

/**
 * Representação decimal canônica de um inteiro não negativo:
 * - `"0"` isolado, **ou**
 * - uma sequência de dígitos começando por `1–9` (sem zeros à esquerda).
 *
 * Rejeita, por construção: string vazia, espaços, sinal (`+`/`-`), separadores,
 * notação científica/ponto flutuante, não dígitos e formas com zero à esquerda
 * (ex.: `"007"`), conforme as convenções do projeto.
 */
const DECIMAL_CANONICO = /^(?:0|[1-9]\d*)$/;

/**
 * Gera um novo `Seed_RNG` uint64 como string decimal canônica.
 *
 * **Única função impura do módulo**: lê 8 bytes da fonte de entropia
 * criptográfica (`crypto.getRandomValues`, disponível no browser e no Node via
 * `globalThis.crypto`) e os combina, big-endian, num `bigint` de 64 bits. O
 * resultado cobre uniformemente todo `[0, 2^64 − 1]`.
 *
 * Chamada **apenas** na criação de uma nova partida (nunca dentro de função
 * pura). O valor **não** é derivado de nenhum seed de time (R6.2): não há tal
 * parâmetro.
 *
 * @returns `Seed_RNG` em decimal, `"0".."18446744073709551615"`.
 */
export function gerarSeedRng(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);

  let seed = 0n;
  for (const byte of bytes) {
    seed = (seed << 8n) | BigInt(byte);
  }

  // Por construção, `seed` ∈ [0, 2^64 − 1]; `toString(10)` é canônico (sem
  // zeros à esquerda) e determinístico.
  return seed.toString(10);
}

/**
 * Valida e normaliza um `Seed_RNG` reinformado pelo jogador (reprodução).
 *
 * Função **pura e total**: aceita a entrada apenas se for um inteiro decimal
 * canônico dentro de `[0, 2^64 − 1]`; caso contrário devolve `null`. Nunca
 * consulta entropia nem deriva o valor de outro seed.
 *
 * Entradas rejeitadas (`null`):
 * - vazia ou só espaços;
 * - negativa (`"-1"`) ou com sinal (`"+5"`);
 * - acima do máximo uint64 (`> 18446744073709551615`);
 * - não numérica (`"abc"`, `"1.5"`, `"1e3"`, `"0x10"`, `"12 34"`);
 * - com zeros à esquerda (`"007"`) — forma não canônica.
 *
 * @param entrada String candidata a `Seed_RNG`.
 * @returns A string decimal canônica validada, ou `null` se inválida.
 */
export function parseSeedRng(entrada: string): string | null {
  if (typeof entrada !== 'string') {
    return null;
  }

  if (!DECIMAL_CANONICO.test(entrada)) {
    return null;
  }

  // A entrada já é um decimal canônico; só resta checar o teto do uint64.
  const valor = BigInt(entrada);
  if (valor > UINT64_MAX) {
    return null;
  }

  return entrada;
}
