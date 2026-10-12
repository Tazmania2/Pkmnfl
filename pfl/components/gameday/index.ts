/**
 * Barril de `components/gameday/` — componentes de apresentação da Tela_Game_Day
 * da spec `pfl-gameday-result-ui`. Ponto único de importação para as telas; cada
 * componente também é importável diretamente do seu próprio arquivo.
 *
 * Entregue por Task 13.1: `SeletorModo` (três botões grandes de modo, R1.*) e
 * `SeedRngDisplay` (exibição rastreável/copiável do Seed_RNG, R16.3). Tarefas
 * irmãs (13.2/13.3/14.1) acrescentam seus componentes a este barril.
 *
 * _Requirements: 1.1, 1.2, 1.3, 16.3, 17.2, 17.3, 17.6_
 */

export { SeletorModo } from './SeletorModo';
export type { SeletorModoProps } from './SeletorModo';

export { SeedRngDisplay } from './SeedRngDisplay';
export type { SeedRngDisplayProps } from './SeedRngDisplay';

// Entregue por Task 13.3: HUD de andamento + equivalente textual acessível.
export { PainelAndamento } from './PainelAndamento';
export type { PainelAndamentoProps } from './PainelAndamento';

export { AlternativaTextual } from './AlternativaTextual';
export type { AlternativaTextualProps } from './AlternativaTextual';

// Entregue por Task 13.2: importador de seed do adversário, botão de confirmação
// único/idempotente, estado de carregamento honesto e aviso de erro associado
// por ARIA com retry (R3.*, R4.5, R5.*, R6.5, R7.*, R17.3, R17.7).
export { ImportadorSeedAdversario } from './ImportadorSeedAdversario';
export type {
  ImportadorSeedAdversarioProps,
  ImportFileHandler,
} from './ImportadorSeedAdversario';

export { BotaoConfirmar } from './BotaoConfirmar';
export type { BotaoConfirmarProps } from './BotaoConfirmar';

export { EstadoCarregamento } from './EstadoCarregamento';
export type { EstadoCarregamentoProps } from './EstadoCarregamento';

export { AvisoErro, errorMessageId } from './AvisoErro';
export type { AvisoErroProps } from './AvisoErro';

// Entregue por Task 14.1: player burro da Animacao_8bit — reproduz as `Scene[]`
// já computadas (cadência via rAF, nunca a sequência), com controles de pular/
// acelerar acessíveis e sprites resolvidos pela Camada_Leitura (R9.*, R10.1,
// R11.1–R11.4, R11.6, R11.7, R17.2).
export { AnimationPlayer } from './AnimationPlayer';
export type { AnimationPlayerProps } from './AnimationPlayer';
