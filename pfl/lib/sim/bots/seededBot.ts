/**
 * Bot seed de terceiros — time importado + preset padrão
 * (`lib/sim/bots/seededBot.ts`).
 *
 * Modo "Seed de terceiros" (R12.4). Mantém **exatamente** o time importado
 * (`ResolvedLineup`) — sem modificar nenhum atributo — e aplica a IA do
 * **preset padrão**. A escolha do preset padrão para este modo é `BALANCED`:
 * um perfil neutro, sem viés de corrida/passe nem ajustes por jogada, de modo
 * que a IA não impõe estilo próprio sobre o time importado; o comportamento
 * emergente vem dos atributos do time preservado, não de uma inclinação tática.
 *
 * Invariante de preservação (R12.4): este módulo **não altera atributos de
 * atleta**. Ele apenas provê a `PlayPolicy` de seleção de jogada; a
 * `ResolvedLineup` importada é tratada como imutável e devolvida como está. A
 * função `assertLineupUnchanged` documenta e, opcionalmente, verifica essa
 * invariante em testes (referência estrutural idêntica à entrada), mas o
 * caminho de produção nunca clona nem muta a escalação. A validação da seed de
 * terceiros (presença, interpretabilidade) e a rejeição de seed inválida são
 * responsabilidade do **adaptador** (Task 17), que preserva o estado e recusa a
 * execução; a política aqui só expõe a IA do modo suportado.
 *
 * Sem vantagem oculta (R12.1): o bot roda sob o mesmo motor, RNG, Fadiga e
 * Esfera que o jogador; a `PlayPolicy` só enxerga o `PlaySelectionContext`
 * público, nunca o estado oculto do adversário nem os atributos importados do
 * próprio time (que ficam no `ResolvedInput`, não na política de jogada).
 *
 * Consumo de RNG: nenhum consumo na inicialização (preset fixo). Cada
 * `choosePlay` consome um único `rng.nextFloat()` apenas quando há mais de uma
 * opção com peso positivo, na ordem fixa O→D imposta pelo pipeline.
 *
 * Pureza: sem I/O, rede, relógio de sistema ou entropia externa.
 *
 * _Requirements: 12.4_
 */

import type { Preset, ResolvedLineup } from '../types';
import { presetPolicy, type PlayPolicy } from './policy';

/**
 * Preset padrão aplicado ao time importado no modo seed de terceiros. Escolha
 * documentada: `BALANCED` (neutro, sem viés nem ajustes por jogada), para que a
 * IA não sobreponha estilo próprio ao time preservado.
 */
export const SEEDED_BOT_DEFAULT_PRESET: Preset = 'BALANCED';

/**
 * Cria a `PlayPolicy` do modo seed de terceiros: a política situacional do
 * preset padrão (`BALANCED`), restrita ao catálogo. Não consome RNG na
 * construção e não toca nos atributos do time importado.
 *
 * @returns A `PlayPolicy` pura e determinística do preset padrão.
 */
export function createSeededBotPolicy(): PlayPolicy {
  return presetPolicy(SEEDED_BOT_DEFAULT_PRESET);
}

/**
 * Devolve o time importado **exatamente** como recebido (invariante de
 * preservação, R12.4). É a identidade sobre a `ResolvedLineup`: nenhum atributo
 * de atleta é modificado, nenhum clone é feito — a mesma referência imutável é
 * retornada. Existe para tornar a invariante explícita e verificável nos pontos
 * de uso e nos testes de propriedade (Task 15.4).
 *
 * @param lineup Escalação importada e resolvida.
 * @returns A mesma `ResolvedLineup`, sem qualquer modificação.
 */
export function preserveImportedLineup(lineup: ResolvedLineup): ResolvedLineup {
  return lineup;
}
