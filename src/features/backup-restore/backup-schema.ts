import type {
  CandidatePartId,
  CurrentBuildId,
  PositiveInteger,
  ProjectId,
  Result,
  UtcTimestamp,
} from "../../domain/public.js";
import {
  decodeWithProfile,
  plainObject,
  positiveInteger,
  safeString,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "../../domain/runtime-schema/public.js";
import type {
  BackupCurrentBuild,
  BackupProject,
  ExchangeValidationError,
} from "./contracts.js";
import {
  BACKUP_PRODUCT_ID,
  CURRENT_BACKUP_FORMAT_VERSION,
} from "./contracts.js";

const invalid = <T>(schema: T): T =>
  tagged(schema as never, "invalid-structure") as T;
const profile = {
  toError: (_issue: unknown, path: string): ExchangeValidationError => ({
    code: "invalid-structure",
    path,
  }),
};

export const backupProjectSchema = plainObject(
  {
    id: invalid(uuid<ProjectId>()),
    name: invalid(safeString()),
    createdAt: invalid(utcTimestamp<UtcTimestamp>()),
    updatedAt: invalid(utcTimestamp<UtcTimestamp>()),
  },
  { nonObjectTag: "invalid-structure", unsafeObjectTag: "invalid-structure" },
);

const backupBuildItemSchema = plainObject(
  {
    candidatePartId: invalid(uuid<CandidatePartId>()),
    quantity: invalid(positiveInteger<PositiveInteger>()),
  },
  { nonObjectTag: "invalid-structure", unsafeObjectTag: "invalid-structure" },
);

export const backupCurrentBuildSchema = plainObject(
  {
    id: invalid(uuid<CurrentBuildId>()),
    projectId: invalid(uuid<ProjectId>()),
    items: invalid(z.array(backupBuildItemSchema)),
    updatedAt: invalid(utcTimestamp<UtcTimestamp>()),
  },
  { nonObjectTag: "invalid-structure", unsafeObjectTag: "invalid-structure" },
);

export const backupEnvelopeShapeSchema = plainObject(
  {
    product: invalid(z.literal(BACKUP_PRODUCT_ID)),
    formatVersion: invalid(z.literal(CURRENT_BACKUP_FORMAT_VERSION)),
    createdAt: invalid(utcTimestamp<UtcTimestamp>()),
    data: plainObject(
      {
        projects: invalid(z.array(backupProjectSchema)),
        parts: invalid(z.array(z.unknown())),
        currentBuilds: invalid(z.array(backupCurrentBuildSchema)),
      },
      {
        nonObjectTag: "invalid-structure",
        unsafeObjectTag: "invalid-structure",
      },
    ),
  },
  { nonObjectTag: "invalid-structure", unsafeObjectTag: "invalid-structure" },
);

export const decodeBackupEnvelopeShape = (
  input: unknown,
): Result<
  {
    readonly product: typeof BACKUP_PRODUCT_ID;
    readonly formatVersion: typeof CURRENT_BACKUP_FORMAT_VERSION;
    readonly createdAt: UtcTimestamp;
    readonly data: {
      readonly projects: readonly BackupProject[];
      readonly parts: readonly unknown[];
      readonly currentBuilds: readonly BackupCurrentBuild[];
    };
  },
  ExchangeValidationError
> => decodeWithProfile(backupEnvelopeShapeSchema, input, profile);
