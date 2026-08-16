import type { FoundationError, Result } from "../domain/result.js";
import type { ValidationError } from "../domain/validation.js";
import type { CapacityError } from "./capacity-policy.js";
import { currentRootStorageBytes } from "./capacity-policy.js";
import type {
  MigrationError,
  MigrationRegistry,
} from "./migration-registry.js";
import { validateRecoveryControl } from "./recovery-control.js";
import type {
  ReplacementAssessment,
  ReplacementError,
  ReplacementEvaluator,
} from "./replacement.js";
import { canonicalJson } from "./replacement.js";
import type { StoragePort } from "./repository.js";
import { CURRENT_SCHEMA_VERSION } from "./schema.js";

declare const rootFingerprintBrand: unique symbol;
export type RootFingerprint = string & {
  readonly [rootFingerprintBrand]: "RootFingerprint";
};

export type CurrentRootAnomaly =
  | { readonly code: "corrupt-data"; readonly fingerprint: RootFingerprint }
  | {
      readonly code: "unsupported-version";
      readonly version: number;
      readonly fingerprint: RootFingerprint;
    };

export interface RecoveryCursor {
  readonly current: CurrentRootAnomaly;
  readonly candidateDigest: string;
  readonly targetSchemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly requiredBytes: number;
  readonly controlGeneration: number;
}

export interface RecoveryAssessment {
  readonly cursor: RecoveryCursor;
  readonly requiredBytes: number;
  readonly replacement: ReplacementAssessment;
}
export type RecoveryAssessmentError = {
  readonly code: "recovery-candidate-rejected";
  readonly current: CurrentRootAnomaly;
  readonly candidate:
    | MigrationError
    | ValidationError
    | CapacityError
    | Extract<ReplacementError, { readonly code: "invalid-capacity-input" }>;
};

export interface RecoveryCoordinator {
  assessRecovery(
    candidate: unknown,
  ): Promise<
    Result<RecoveryAssessment, RecoveryAssessmentError | FoundationError>
  >;
  verifyRecovery(
    candidate: unknown,
    assessment: RecoveryAssessment,
  ): Promise<Result<ReplacementAssessment, FoundationError>>;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
const fingerprint = async (raw: unknown): Promise<RootFingerprint> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(raw as JsonValue)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("") as RootFingerprint;
};

const versionOf = (raw: unknown): number | undefined =>
  typeof raw === "object" &&
  raw !== null &&
  !Array.isArray(raw) &&
  Number.isSafeInteger(Reflect.get(raw, "schemaVersion"))
    ? (Reflect.get(raw, "schemaVersion") as number)
    : undefined;

const anomalyFor = async (
  raw: unknown,
  migrations: MigrationRegistry,
): Promise<CurrentRootAnomaly> => {
  const value = await fingerprint(raw);
  const migrated = migrations.toCurrent(raw);
  if (!migrated.ok && migrated.error.code === "unsupported-version")
    return {
      code: "unsupported-version",
      version: migrated.error.version,
      fingerprint: value,
    };
  const version = versionOf(raw);
  return version !== undefined && version > CURRENT_SCHEMA_VERSION
    ? { code: "unsupported-version", version, fingerprint: value }
    : { code: "corrupt-data", fingerprint: value };
};

const candidateError = (
  error: ReplacementError,
):
  | MigrationError
  | ValidationError
  | CapacityError
  | Extract<ReplacementError, { readonly code: "invalid-capacity-input" }> => {
  if (error.code === "validation") return error.issue;
  return error as
    | MigrationError
    | CapacityError
    | Extract<ReplacementError, { readonly code: "invalid-capacity-input" }>;
};

export const createRecoveryCoordinator = (
  storage: StoragePort,
  migrations: MigrationRegistry,
  replacement: ReplacementEvaluator,
): RecoveryCoordinator => ({
  async assessRecovery(candidate) {
    const raw = await storage.readRoot();
    if (!raw.ok) return raw;
    if (raw.value === undefined)
      return { ok: false, error: { code: "corrupt-data" } };
    const current = await anomalyFor(raw.value, migrations);
    const control = await storage.readRecoveryControl();
    if (!control.ok) return control;
    const decodedControl = validateRecoveryControl(control.value);
    if (!decodedControl.ok)
      return { ok: false, error: { code: "corrupt-data" } };
    const bytes = await storage.bytesInUse();
    if (!bytes.ok) return bytes;
    const assessed = await replacement.assessReplacement(candidate, {
      currentBytes: bytes.value,
      currentRootBytes: currentRootStorageBytes(bytes.value, raw.value),
      quotaBytes: storage.quotaBytes(),
      revision: 0,
      maintenance: { generation: 0 as never, active: false },
    });
    if (!assessed.ok)
      return {
        ok: false,
        error: {
          code: "recovery-candidate-rejected",
          current,
          candidate: candidateError(assessed.error),
        },
      };
    return {
      ok: true,
      value: {
        requiredBytes: assessed.value.requiredBytes,
        replacement: assessed.value,
        cursor: {
          current,
          candidateDigest: assessed.value.candidateDigest,
          targetSchemaVersion: CURRENT_SCHEMA_VERSION,
          requiredBytes: assessed.value.requiredBytes,
          controlGeneration: decodedControl.value.generation,
        },
      },
    };
  },
  async verifyRecovery(candidate, assessment) {
    const reassessed = await this.assessRecovery(candidate);
    if (!reassessed.ok)
      return {
        ok: false,
        error:
          reassessed.error.code === "recovery-candidate-rejected"
            ? { code: "stale-assessment" }
            : reassessed.error,
      };
    const current = reassessed.value;
    if (
      current.cursor.current.fingerprint !==
        assessment.cursor.current.fingerprint ||
      current.cursor.current.code !== assessment.cursor.current.code ||
      current.cursor.candidateDigest !== assessment.cursor.candidateDigest ||
      current.cursor.targetSchemaVersion !==
        assessment.cursor.targetSchemaVersion ||
      current.cursor.requiredBytes !== assessment.cursor.requiredBytes
    )
      return { ok: false, error: { code: "stale-assessment" } };
    return { ok: true, value: current.replacement };
  },
});
