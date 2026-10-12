/**
 * API pública do módulo de seed (`.pflseed.json`): serialização canônica,
 * cálculo do Checksum_Seed, validação estrutural e verificação de integridade.
 *
 * _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6_
 */

export {
  SEED_CHECKSUM_FIELD,
  SEED_REQUIRED_FIELDS,
  SEED_FORBIDDEN_FIELDS,
  canonicalizeSeedForChecksum,
  computeSeedChecksum,
  validateSeedStructure,
  verifySeedChecksum,
} from './checksum';

export type {
  JsonValue,
  JsonObject,
  SeedDocument,
  SeedRequiredField,
  SeedForbiddenField,
  SeedStructureResult,
  SeedChecksumVerification,
} from './checksum';

export { importSeed } from './import';

export type {
  ImportResult,
  ImportRejection,
  ImportStep,
} from './import';
