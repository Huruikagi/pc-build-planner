import type {
  CandidatePartV2,
  CurrentBuild,
  LocalDataRootV2,
  Project,
  Result,
  UtcTimestamp,
} from "../../domain/public.js";
import { err, isUtcTimestamp, schemaV2Validator } from "../../domain/public.js";
import { migrateCandidateSourcesV1ToV2 } from "../../persistence/public.js";
import {
  BACKUP_PRODUCT_ID,
  type CurrentBackupEnvelope,
  type ExchangeValidationError,
} from "./contracts.js";
import { exchangeMapper, exchangeValidator } from "./exchange.js";

export interface BackupEnvelopeV2 {
  readonly product: typeof BACKUP_PRODUCT_ID;
  readonly formatVersion: 2;
  readonly createdAt: UtcTimestamp;
  readonly data: {
    readonly projects: readonly Project[];
    readonly parts: readonly CandidatePartV2[];
    readonly currentBuilds: readonly CurrentBuild[];
  };
}

const invalid = (path: string): Result<never, ExchangeValidationError> =>
  err({ code: "invalid-structure", path });
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const importV1 = (
  input: unknown,
): Result<LocalDataRootV2, ExchangeValidationError> => {
  const validated = exchangeValidator.validate(input);
  if (!validated.ok) return validated;
  const root = exchangeMapper.toRoot(validated.value);
  if (!root.ok) return invalid(root.error.path);
  const migrated = migrateCandidateSourcesV1ToV2.migrate(root.value);
  if (!migrated.ok) return invalid("$.data.parts");
  const checked = schemaV2Validator.validateRoot(migrated.value);
  return checked.ok ? checked : invalid(checked.error.path);
};

const importV2 = (
  input: unknown,
): Result<LocalDataRootV2, ExchangeValidationError> => {
  if (
    !record(input) ||
    input.product !== BACKUP_PRODUCT_ID ||
    input.formatVersion !== 2 ||
    !isUtcTimestamp(input.createdAt) ||
    !record(input.data)
  )
    return invalid("$");
  const data = input.data;
  if (
    !Array.isArray(data.projects) ||
    !Array.isArray(data.parts) ||
    !Array.isArray(data.currentBuilds)
  )
    return invalid("$.data");
  const candidate = {
    schemaVersion: 2,
    revision: 0,
    projects: data.projects,
    candidateParts: data.parts,
    currentBuilds: data.currentBuilds,
    requestDedupe: [],
    maintenance: { generation: 0, active: false },
  };
  const validated = schemaV2Validator.validateRoot(candidate);
  return validated.ok
    ? validated
    : invalid(validated.error.path.replace("$.candidateParts", "$.data.parts"));
};

export const backupExchangeV2 = {
  exportRoot(root: LocalDataRootV2, createdAt: UtcTimestamp): BackupEnvelopeV2 {
    return {
      product: BACKUP_PRODUCT_ID,
      formatVersion: 2,
      createdAt,
      data: {
        projects: root.projects,
        parts: root.candidateParts,
        currentBuilds: root.currentBuilds,
      },
    };
  },
  importEnvelope(
    input: unknown,
  ): Result<LocalDataRootV2, ExchangeValidationError> {
    if (!record(input)) return invalid("$");
    if (input.formatVersion === 1)
      return importV1(input as unknown as CurrentBackupEnvelope);
    if (input.formatVersion === 2) return importV2(input);
    return invalid("$.formatVersion");
  },
};
