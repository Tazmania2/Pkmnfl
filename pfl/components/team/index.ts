/**
 * Barril de `components/team/` — componentes de apresentação da Tela_Meu_Time
 * da spec `pfl-team-strategy-ui`. Ponto único de importação para as telas; cada
 * componente também é importável diretamente do seu próprio arquivo.
 *
 * Entregue por Task 9.1: origem e grade do roster — `SeletorOrigem` (origem do
 * time: 4 presets + "do zero", R1.*), `GradeRoster` (grade com contador `X/53`,
 * item distinto por instância, aviso de teto, R2.*) e `ItemRoster` (cartão
 * arrastável que abre a ficha, R2.1/R4.1/R6.1). Tarefas irmãs (9.2–9.4)
 * acrescentam seus componentes a este barril.
 *
 * _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_
 */

export { SeletorOrigem } from './SeletorOrigem';
export type { SeletorOrigemProps } from './SeletorOrigem';

export { GradeRoster } from './GradeRoster';
export type { GradeRosterProps } from './GradeRoster';

export { ItemRoster } from './ItemRoster';
export type { ItemRosterProps } from './ItemRoster';
export { MeuTimeIsland } from './MeuTimeIsland';
export type { MeuTimeIslandProps } from './MeuTimeIsland';
export { EstrategiaIsland } from './EstrategiaIsland';

// Task 9.4 — barra de ações (Salvar / Exportar seed / Importar seed).
export { BarraAcoes } from './BarraAcoes';
export type { BarraAcoesProps } from './BarraAcoes';

// Task 9.2 — abas de unidade e campo de atribuição.
export { AbasUnidade } from './AbasUnidade';
export type { AbasUnidadeProps } from './AbasUnidade';

export { CampoAtribuicao } from './CampoAtribuicao';
export type { CampoAtribuicaoProps, RosterOption } from './CampoAtribuicao';

export { DicaPosicional } from './DicaPosicional';
export type { DicaPosicionalProps } from './DicaPosicional';

export { AvisoAnatomico } from './AvisoAnatomico';
export type { AvisoAnatomicoProps } from './AvisoAnatomico';

// Task 9.3 — ficha do atleta e seletores (R6, R7, R8).
export { FichaAtleta } from './FichaAtleta';
export type { FichaAtletaProps } from './FichaAtleta';

export { SeletorHabilidade } from './SeletorHabilidade';
export type { SeletorHabilidadeProps, OpcaoHabilidade } from './SeletorHabilidade';

export { SeletorGolpes, MOVE_SLOTS } from './SeletorGolpes';
export type { SeletorGolpesProps, OpcaoGolpe } from './SeletorGolpes';

export { AvisoEfeitoInerte } from './AvisoEfeitoInerte';
export type { AvisoEfeitoInerteProps } from './AvisoEfeitoInerte';
