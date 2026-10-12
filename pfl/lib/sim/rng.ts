/**
 * Gerador_RNG determinístico (`lib/sim/rng.ts`).
 *
 * PRNG **sfc32** (Small Fast Counter, 32 bits, 4 palavras de estado) semeado a
 * partir de um `Seed_RNG` uint64 por um expansor **SplitMix64**. Opera inteiramente
 * em aritmética de 32 bits via operadores bitwise (`>>>`, `<<`, `|`, `+` com `>>> 0`),
 * exatos e idênticos em qualquer motor JS/arquitetura — garantindo reprodutibilidade
 * byte a byte independente de SO e hardware (R1.1).
 *
 * Pureza (R1.5): não usa `Math.random`, `Date`, `crypto`, `performance` nem lê
 * ambiente. Todo valor aleatório da Partida provém deste `Rng`, criado uma única
 * vez a partir do `Seed_RNG` (R1.2). O `Seed_RNG` é entrada distinta do seed de
 * time; um nunca deriva do outro (R1.3) — `createRng` recebe apenas o `Seed_RNG`.
 *
 * `BigInt` é usado SOMENTE na expansão SplitMix64 da semente de 64 bits (fora do
 * caminho quente). Após derivar os 4 lanes de 32 bits, toda a geração usa `number`.
 *
 * _Requirements: 1.2, 1.3, 1.5_
 */

/** Contrato do Gerador_RNG (ver design: "Contrato do Gerador_RNG"). */
export interface Rng {
  /** Próximo float em [0,1) com 32 bits de precisão. Avança o estado. */
  nextFloat(): number;
  /** Inteiro uniforme em [min, max] inclusivo, sem viés de módulo (rejection sampling). */
  nextInt(min: number, max: number): number;
  /** Snapshot opcional do estado interno (para log/debug), não usado na resolução. */
  state(): readonly [number, number, number, number];
}

/** Máscara de 64 bits para a aritmética do SplitMix64. */
const MASK_64 = (1n << 64n) - 1n;

/**
 * Um passo do expansor SplitMix64. Recebe o estado `s` (uint64 como bigint) e
 * devolve `{ value, next }`, onde `value` é a saída misturada de 64 bits e `next`
 * é o estado avançado. Usado só para semear sfc32, nunca no caminho quente.
 *
 * Constantes clássicas do SplitMix64 (Vigna): incremento 0x9E3779B97F4A7C15 e
 * mixer com shifts 30/27/31 e multiplicadores 0xBF58476D1CE4E5B9 / 0x94D049BB133111EB.
 */
function splitmix64Step(s: bigint): { value: bigint; next: bigint } {
  const next = (s + 0x9e3779b97f4a7c15n) & MASK_64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  z = (z ^ (z >> 31n)) & MASK_64;
  return { value: z, next };
}

/**
 * Cria um `Rng` determinístico a partir do `Seed_RNG` uint64.
 *
 * Semeadura: SplitMix64(seed) gera duas palavras de 64 bits; cada palavra fornece
 * dois lanes de 32 bits (metades alta e baixa), preenchendo as 4 palavras de estado
 * de sfc32. Isso evita estados iniciais fracos (ex. seed 0) porque o próprio
 * SplitMix64 difunde o seed antes de qualquer uso.
 */
export function createRng(seed: bigint): Rng {
  // Normaliza para o domínio uint64 [0, 2^64 - 1] (R: Seed_RNG é um uint64).
  let sm = seed & MASK_64;

  // Expande o seed em 4 lanes de 32 bits via SplitMix64 (duas saídas de 64 bits).
  const r0 = splitmix64Step(sm);
  sm = r0.next;
  const r1 = splitmix64Step(sm);

  // 4 palavras de 32 bits do estado interno de sfc32 (a, b, c, d).
  let a = Number(r0.value & 0xffffffffn) >>> 0;
  let b = Number((r0.value >> 32n) & 0xffffffffn) >>> 0;
  let c = Number(r1.value & 0xffffffffn) >>> 0;
  let d = Number((r1.value >> 32n) & 0xffffffffn) >>> 0;

  /**
   * Núcleo sfc32: avança o estado e devolve um uint32. Toda a aritmética é de 32
   * bits (`| 0`, `>>> 0`, `<<`, `>>>`), exata e portável.
   */
  function nextUint32(): number {
    // Rotação de 21 bits de (a + b), somada ao contador c; d gira à esquerda 11.
    const t = (a + b) >>> 0;
    const sum = (t + d) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    d = (d + 1) >>> 0;
    c = (c + sum) >>> 0;
    return sum;
  }

  // Descarta algumas saídas iniciais para dissipar correlação do estado semeado
  // (prática padrão de sfc32: "warm-up" determinístico, igual em toda plataforma).
  for (let i = 0; i < 12; i++) {
    nextUint32();
  }

  const rng: Rng = {
    nextFloat(): number {
      // RNG consume #k: 1 saída de 32 bits convertida a float em [0,1).
      // Divisor 2^32 garante [0,1) com 32 bits de precisão (0 <= u < 2^32).
      return nextUint32() / 0x100000000;
    },

    nextInt(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new RangeError('nextInt requires integer bounds');
      }
      if (min > max) {
        throw new RangeError('nextInt requires min <= max');
      }
      // Faixa inclusiva [min, max] → `range` valores possíveis.
      const range = max - min + 1;
      if (range === 1) {
        return min;
      }
      // Rejection sampling sem viés de módulo: aceita apenas uint32 na maior
      // faixa múltipla de `range` que cabe em 2^32, descartando o excedente.
      // `limit` é o maior múltiplo de `range` <= 2^32.
      const span = 0x100000000; // 2^32
      const limit = span - (span % range);
      let u: number;
      do {
        // RNG consume #k: amostra uint32 para inteiro uniforme (pode repetir no rejeito).
        u = nextUint32();
      } while (u >= limit);
      return min + (u % range);
    },

    state(): readonly [number, number, number, number] {
      // Snapshot imutável; não avança o estado nem é usado na resolução.
      return [a >>> 0, b >>> 0, c >>> 0, d >>> 0] as const;
    },
  };

  return rng;
}
