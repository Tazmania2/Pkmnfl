/**
 * Dicas posicionais e aviso anatômico (`lib/anatomy/index.ts`).
 *
 * Módulo **puro** (sem DOM, sem rede, sem I/O) que concentra duas
 * responsabilidades do design (seção "Dicas e Anatomia"):
 *
 * 1. {@link positionalHint} — texto **orientador** por par (espécie, posição).
 *    Sempre retorna uma dica não vazia e específica; jamais proíbe uma
 *    atribuição nem interfere no resultado de `assignRole` (R5.1, R5.2, R4.4).
 * 2. {@link anatomyWarning} — avaliação anatômica derivada das convenções de
 *    `ANATOMY_DECISIONS_FINAL.md`. Só retorna um {@link AnatomyFinding} quando a
 *    **função esportiva essencial** da posição não é fisicamente cumprível pela
 *    espécie; mesmo assim a atribuição continua permitida (R5.3, R8.2).
 *
 * A lógica anatômica é exposta por {@link ANATOMY_CONVENTIONS} (uma instância de
 * {@link AnatomyConventions}) para ser **compartilhada** com o motor de
 * validação (`lib/validation/`, aviso `ANATOMY_LIMIT`) e, no futuro, com o
 * `Validador_Funcoes` do motor de simulação — a mesma convenção numa única
 * fonte, sem duplicação de regras.
 *
 * ## Fonte das convenções
 *
 * As regras seguem o item 10 ("Validador de funções") de
 * `ANATOMY_DECISIONS_FINAL.md`, que mapeia cada posição à sua **função esportiva
 * essencial** e à **capacidade física** exigida para cumpri-la:
 *
 * | Posição | Função essencial | Capacidade exigida |
 * |---------|------------------|--------------------|
 * | QB      | receber snap tangível + lançar fisicamente | `physicalThrow` |
 * | C       | efetuar snap físico para trás              | `backwardSnap`  |
 * | RB/HB/FB| posse física da bola conduzindo-a          | `physicalPossession` |
 * | WR/TE/CB/S | recepção/interceptação com controle físico | `catchControl` |
 * | K/P     | impacto tangível de membro/casco na bola   | `physicalStrike` |
 *
 * Por decisão de game design, a atribuição é **sempre permitida**, com aviso;
 * apenas ações impossíveis são bloqueadas no motor — nunca a atribuição em si
 * (item 10). Por isso a convenção é **permissiva por padrão**: uma espécie só
 * recebe aviso quando está explicitamente registrada em
 * {@link SPECIES_CAPABILITIES} como **incapaz** da capacidade exigida pela
 * posição. As espécies dos presets (Venusaur C, Rapidash RB, Magneton S,
 * Alakazam QB, etc.) têm adaptações ficcionais aprovadas e, portanto, **não**
 * disparam aviso para suas funções publicadas.
 *
 * > Nota de manutenção: `SPECIES_CAPABILITIES` é uma tabela de convenções que
 * > começa com as decisões já documentadas no GDD. Novas incapacidades
 * > anatômicas devem ser acrescentadas aqui (uma linha por espécie), mantendo
 * > esta tabela como a fonte única consumida por UI e motor.
 *
 * _Requirements: 5.1, 5.2, 5.3, 8.2_
 */

/**
 * Capacidades físicas que uma função esportiva pode exigir. Cada valor
 * corresponde ao requisito do "Validador de funções" (item 10 do GDD).
 */
export type PhysicalCapability =
  /** Receber um snap tangível e lançar fisicamente a bola (QB). */
  | 'physicalThrow'
  /** Efetuar um snap físico para trás (Center). */
  | 'backwardSnap'
  /** Posse física estável conduzindo a bola (RB/HB/FB). */
  | 'physicalPossession'
  /** Recepção/interceptação com contato e controle físico (WR/TE/CB/S). */
  | 'catchControl'
  /** Impacto tangível de membro/casco para impulsionar a bola (K/P). */
  | 'physicalStrike';

/**
 * Categoria funcional de uma posição, agrupando os papéis que compartilham a
 * mesma função esportiva essencial. Posições sem exigência física específica
 * (ex.: linhas de bloqueio) usam `'contact'`, que nunca gera aviso anatômico.
 */
export type PositionFunction =
  | 'quarterback'
  | 'center'
  | 'ballCarrier'
  | 'receiver'
  | 'kicker'
  | 'contact';

/** Função esportiva essencial de uma posição e a capacidade que ela exige. */
export interface EssentialFunction {
  /** Categoria funcional da posição. */
  readonly fn: PositionFunction;
  /** Rótulo legível da função essencial, usado no texto do aviso. */
  readonly label: string;
  /**
   * Capacidade física exigida para cumprir a função. `null` quando a posição
   * não impõe requisito anatômico específico (nunca gera aviso).
   */
  readonly requires: PhysicalCapability | null;
}

/**
 * Resultado de uma avaliação anatômica: a função esportiva essencial que a
 * espécie não consegue cumprir fisicamente na posição indicada. É **informativo
 * e não bloqueante** — a atribuição segue permitida (R5.3/R8.2).
 */
export interface AnatomyFinding {
  /** Posição avaliada (chave normalizada da posição). */
  position: string;
  /** Função esportiva essencial que não pode ser cumprida. */
  essentialFunction: string;
  /** Motivo legível, derivado da convenção, do porquê não é cumprível. */
  reason: string;
}

/**
 * Convenções anatômicas compartilháveis. Expõe a avaliação anatômica como uma
 * única fonte reusada por UI e motor de validação, sem duplicar regras.
 */
export interface AnatomyConventions {
  /**
   * Convenções de `ANATOMY_DECISIONS_FINAL.md` — a mesma lógica do
   * `Validador_Funcoes` do motor. Retorna um aviso quando a função esportiva
   * essencial da posição não é fisicamente cumprível pela espécie; caso
   * contrário, `null`. Nunca proíbe a atribuição.
   */
  anatomyWarning(pokemonId: number, position: string): AnatomyFinding | null;
}

// ---------------------------------------------------------------------------
// Normalização de posição
// ---------------------------------------------------------------------------

/**
 * Normaliza uma string de posição para uma chave canônica em maiúsculas, sem
 * espaços nem separadores, para casar sinônimos de entrada (ex.: `"qb"`,
 * `"QB"`, `"Quarter Back"`).
 */
function normalizePosition(position: string): string {
  return position.trim().toUpperCase().replace(/[\s_-]+/g, '');
}

/**
 * Mapa de posição normalizada para a sua função esportiva essencial. Cobre as
 * abreviações usuais de futebol americano; posições de bloqueio/contato caem em
 * {@link UNSPECIFIED_FUNCTION} (sem exigência anatômica específica).
 *
 * Derivado do item 10 de `ANATOMY_DECISIONS_FINAL.md`.
 */
const POSITION_FUNCTIONS: Readonly<Record<string, EssentialFunction>> = {
  QB: { fn: 'quarterback', label: 'receber o snap e lançar a bola fisicamente', requires: 'physicalThrow' },
  C: { fn: 'center', label: 'efetuar um snap físico para trás', requires: 'backwardSnap' },
  RB: { fn: 'ballCarrier', label: 'manter posse física da bola conduzindo-a', requires: 'physicalPossession' },
  HB: { fn: 'ballCarrier', label: 'manter posse física da bola conduzindo-a', requires: 'physicalPossession' },
  FB: { fn: 'ballCarrier', label: 'manter posse física da bola conduzindo-a', requires: 'physicalPossession' },
  WR: { fn: 'receiver', label: 'receber a bola com contato e controle físico', requires: 'catchControl' },
  TE: { fn: 'receiver', label: 'receber a bola com contato e controle físico', requires: 'catchControl' },
  CB: { fn: 'receiver', label: 'interceptar com contato e controle físico', requires: 'catchControl' },
  S: { fn: 'receiver', label: 'interceptar com contato e controle físico', requires: 'catchControl' },
  SS: { fn: 'receiver', label: 'interceptar com contato e controle físico', requires: 'catchControl' },
  FS: { fn: 'receiver', label: 'interceptar com contato e controle físico', requires: 'catchControl' },
  K: { fn: 'kicker', label: 'impulsionar a bola com impacto físico', requires: 'physicalStrike' },
  P: { fn: 'kicker', label: 'impulsionar a bola com impacto físico', requires: 'physicalStrike' },
};

/**
 * Função atribuída a qualquer posição fora de {@link POSITION_FUNCTIONS}
 * (bloqueio, cobertura por contato, etc.): exige apenas colisão/contato físico,
 * que toda espécie corpórea cumpre, logo nunca gera aviso anatômico.
 */
const UNSPECIFIED_FUNCTION: EssentialFunction = {
  fn: 'contact',
  label: 'participar da jogada por contato físico',
  requires: null,
};

/** Resolve a função esportiva essencial de uma posição (chave normalizada). */
function essentialFunctionOf(position: string): EssentialFunction {
  const key = normalizePosition(position);
  return POSITION_FUNCTIONS[key] ?? UNSPECIFIED_FUNCTION;
}

// ---------------------------------------------------------------------------
// Capacidades por espécie (tabela de convenções)
// ---------------------------------------------------------------------------

/**
 * Tabela de convenções anatômicas por espécie: para cada `pokemonId`
 * registrado, o conjunto de capacidades físicas que a espécie **não** consegue
 * cumprir, conforme `ANATOMY_DECISIONS_FINAL.md`.
 *
 * Política (item 10 do GDD): a avaliação é **permissiva por padrão**. Uma
 * espécie ausente desta tabela — ou sem a capacidade listada como incapaz — é
 * considerada capaz, pois o GDD aprova adaptações ficcionais corpóreas (vinhas,
 * boca, cascos, pinças) para as funções essenciais. As decisões já publicadas
 * (Venusaur C, Rapidash RB, Magneton S, Alakazam QB) são, portanto,
 * **capazes** de suas funções e não aparecem como incapazes aqui.
 *
 * Esta tabela é a fonte única; novas incapacidades anatômicas confirmadas por
 * errata de design (o coder não decide em silêncio) devem ser adicionadas aqui.
 */
const SPECIES_INCAPABILITIES: Readonly<Record<number, readonly PhysicalCapability[]>> = {
  // Inicialmente vazia: nenhuma espécie dos presets é incapaz de sua função
  // publicada. Preenchida conforme erratas de design forem registradas.
};

/**
 * Motivo legível, por capacidade ausente, de por que a função essencial não é
 * fisicamente cumprível. Deriva das justificativas do GDD (telecinese/
 * magnetismo não contam como posse; sem gesto físico de lançamento não há
 * passe; sem meio físico de impacto não há chute).
 */
const INCAPABILITY_REASON: Readonly<Record<PhysicalCapability, string>> = {
  physicalThrow:
    'a espécie não dispõe de meio físico para receber o snap e lançar a bola; poderes não substituem o gesto físico',
  backwardSnap:
    'a espécie não dispõe de apêndice corpóreo tangível para efetuar um snap físico para trás',
  physicalPossession:
    'a espécie não consegue manter posse física estável da bola; aderência por poder não conta como posse',
  catchControl:
    'a espécie não consegue estabelecer contato e controle físico para a recepção; telecinese ou magnetismo não contam',
  physicalStrike:
    'a espécie não dispõe de membro, casco ou superfície corporal para impulsionar a bola com impacto físico',
};

/** Verifica se a espécie é incapaz de uma capacidade física, pela convenção. */
function speciesLacks(pokemonId: number, capability: PhysicalCapability): boolean {
  const incapable = SPECIES_INCAPABILITIES[pokemonId];
  return incapable !== undefined && incapable.includes(capability);
}

// ---------------------------------------------------------------------------
// Dicas posicionais
// ---------------------------------------------------------------------------

/**
 * Textos orientadores por função esportiva. São de caráter informativo e
 * jamais proíbem a atribuição (R5.1/R5.2/R4.4).
 */
const FUNCTION_HINTS: Readonly<Record<PositionFunction, string>> = {
  quarterback:
    'Quarterback recebe o snap e comanda o passe: priorize precisão e leitura de jogada.',
  center:
    'Center inicia a jogada com o snap para trás: priorize estabilidade e proteção da linha.',
  ballCarrier:
    'Corredor conduz a bola em posse física: priorize aceleração, controle e proteção da posse.',
  receiver:
    'Recepção/cobertura exige contato e controle: priorize alcance, mãos seguras e timing.',
  kicker:
    'Chute depende de impacto físico na bola: priorize potência e precisão do golpe.',
  contact:
    'Posição de contato na jogada: priorize força, bloqueio e presença física na linha.',
};

/**
 * Retorna uma dica **orientadora** específica ao par (espécie, posição).
 *
 * A dica combina a função esportiva da posição com uma indicação de adequação
 * anatômica: quando a convenção marca a espécie como incapaz da função
 * essencial, o texto sinaliza a baixa adequação — **sem** bloquear. O retorno é
 * sempre uma string não vazia e específica ao par, e sua existência jamais
 * altera o resultado de `assignRole` (R5.1, R5.2, R4.4).
 *
 * @param pokemonId Espécie da instância sendo posicionada.
 * @param position Posição/papel alvo (abreviação ou nome).
 * @returns Texto de dica não vazio, orientador e nunca bloqueante.
 */
export function positionalHint(pokemonId: number, position: string): string {
  const key = normalizePosition(position);
  const essential = essentialFunctionOf(position);
  const base = FUNCTION_HINTS[essential.fn];
  const label = key.length > 0 ? key : 'esta posição';

  const warning = anatomyWarning(pokemonId, position);
  if (warning !== null) {
    return `${base} Adequação baixa de #${pokemonId} em ${label}: ${warning.reason}. A atribuição continua permitida.`;
  }

  return `${base} #${pokemonId} pode assumir ${label}; a atribuição é livre, use a dica apenas como orientação.`;
}

// ---------------------------------------------------------------------------
// Aviso anatômico
// ---------------------------------------------------------------------------

/**
 * Avalia se a função esportiva essencial da posição é fisicamente cumprível
 * pela espécie, conforme as convenções de `ANATOMY_DECISIONS_FINAL.md`.
 *
 * Retorna um {@link AnatomyFinding} se e somente se a posição exige uma
 * capacidade física que a convenção registra como ausente na espécie; caso
 * contrário, `null`. Nunca proíbe a atribuição — o aviso é informativo e o
 * jogador decide manter ou alterar (R5.3, R8.2).
 *
 * @param pokemonId Espécie da instância.
 * @param position Posição/papel alvo (abreviação ou nome).
 * @returns Aviso anatômico ou `null` quando a função é cumprível.
 */
export function anatomyWarning(pokemonId: number, position: string): AnatomyFinding | null {
  const essential = essentialFunctionOf(position);
  if (essential.requires === null) {
    return null;
  }
  if (!speciesLacks(pokemonId, essential.requires)) {
    return null;
  }

  return {
    position: normalizePosition(position),
    essentialFunction: essential.label,
    reason: INCAPABILITY_REASON[essential.requires],
  };
}

/**
 * Instância compartilhável das convenções anatômicas. É a **fonte única**
 * consumida pelo motor de validação (`validateAthlete` → `ANATOMY_LIMIT`) e,
 * futuramente, pelo `Validador_Funcoes` do motor de simulação, garantindo que a
 * mesma regra não seja duplicada.
 */
export const ANATOMY_CONVENTIONS: AnatomyConventions = {
  anatomyWarning,
};
