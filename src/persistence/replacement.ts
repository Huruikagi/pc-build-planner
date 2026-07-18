import type { LocalDataRoot } from "../domain/model.js";
import type { Result } from "../domain/result.js";
import type { SchemaValidator, ValidationError } from "../domain/validation.js";
import type { CapacityWarning } from "./capacity-policy.js";
import type {
  MigrationError,
  MigrationRegistry,
} from "./migration-registry.js";

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_WARNING_RATIO = 0.8;
const STORAGE_KEY = "localDataRoot";

declare const replacementTokenBrand: unique symbol;
export type ReplacementToken = string & {
  readonly [replacementTokenBrand]: "ReplacementToken";
};

export interface ReplacementEvaluationInput {
  readonly currentBytes: number;
  readonly quotaBytes: number;
  readonly revision: number;
}

export interface ReplacementCursor {
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: number;
  readonly requiredBytes: number;
  readonly revision: number;
}

export interface ReplacementAssessment {
  readonly token: ReplacementToken;
  readonly candidateDigest: string;
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: number;
  readonly beforeBytes: number;
  readonly requiredBytes: number;
  readonly warnings: readonly CapacityWarning[];
  readonly cursor: ReplacementCursor;
}

export type ReplacementError =
  | MigrationError
  | { readonly code: "validation"; readonly issue: ValidationError }
  | { readonly code: "invalid-capacity-input" }
  | { readonly code: "quota-exceeded" };

export interface ReplacementEvaluator {
  assessReplacement(
    input: unknown,
    evaluation: ReplacementEvaluationInput,
  ): Promise<Result<ReplacementAssessment, ReplacementError>>;
}

type JsonPrimitive = null | boolean | number | string;
type CanonicalValue =
  | JsonPrimitive
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const compareCodePoints = (left: string, right: string): number => {
  const leftPoints = Array.from(
    left,
    (value) => value.codePointAt(0) as number,
  );
  const rightPoints = Array.from(
    right,
    (value) => value.codePointAt(0) as number,
  );
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
};

const canonicalize = (value: CanonicalValue): CanonicalValue => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as { readonly [key: string]: CanonicalValue };
    const sorted: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(record).sort(compareCodePoints)) {
      sorted[key] = canonicalize(record[key] as CanonicalValue);
    }
    return sorted;
  }
  return value;
};

export const canonicalJson = (value: CanonicalValue): string =>
  JSON.stringify(canonicalize(value));

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const readSourceSchemaVersion = (input: unknown): number | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return undefined;
  const value = Reflect.get(input, "schemaVersion");
  return Number.isSafeInteger(value) ? (value as number) : undefined;
};

const requiredBytes = (root: LocalDataRoot): number =>
  new TextEncoder().encode(JSON.stringify({ [STORAGE_KEY]: root })).byteLength;

const validEvaluation = (input: ReplacementEvaluationInput): boolean =>
  Number.isSafeInteger(input.currentBytes) &&
  input.currentBytes >= 0 &&
  Number.isSafeInteger(input.quotaBytes) &&
  input.quotaBytes >= 0 &&
  Number.isSafeInteger(input.revision) &&
  input.revision >= 0;

export const createReplacementCoordinator = (
  migrations: MigrationRegistry,
  validator: SchemaValidator,
  warningRatio = DEFAULT_WARNING_RATIO,
): ReplacementEvaluator => {
  if (!Number.isFinite(warningRatio) || warningRatio <= 0 || warningRatio > 1)
    throw new RangeError("warningRatio must be greater than 0 and at most 1");

  return {
    async assessReplacement(input, evaluation) {
      if (!validEvaluation(evaluation))
        return { ok: false, error: { code: "invalid-capacity-input" } };
      const sourceSchemaVersion = readSourceSchemaVersion(input);
      const migrated = migrations.toCurrent(input);
      if (!migrated.ok) return migrated;
      const validated = validator.validateReplacement(migrated.value);
      if (!validated.ok)
        return {
          ok: false,
          error: { code: "validation", issue: validated.error },
        };

      const bytes = requiredBytes(validated.value);
      if (bytes > evaluation.quotaBytes)
        return { ok: false, error: { code: "quota-exceeded" } };
      const cursor: ReplacementCursor = {
        sourceSchemaVersion:
          sourceSchemaVersion ?? validated.value.schemaVersion,
        targetSchemaVersion: CURRENT_SCHEMA_VERSION,
        requiredBytes: bytes,
        revision: evaluation.revision,
      };
      const candidateDigest = await sha256(
        canonicalJson(validated.value as unknown as CanonicalValue),
      );
      const token = (await sha256(
        canonicalJson({ candidateDigest, ...cursor }),
      )) as ReplacementToken;
      const warningThresholdBytes = evaluation.quotaBytes * warningRatio;
      return {
        ok: true,
        value: {
          token,
          candidateDigest,
          sourceSchemaVersion: cursor.sourceSchemaVersion,
          targetSchemaVersion: cursor.targetSchemaVersion,
          beforeBytes: evaluation.currentBytes,
          requiredBytes: bytes,
          warnings:
            bytes >= warningThresholdBytes
              ? [
                  {
                    code: "capacity-warning",
                    thresholdBytes: warningThresholdBytes,
                  },
                ]
              : [],
          cursor,
        },
      };
    },
  };
};
