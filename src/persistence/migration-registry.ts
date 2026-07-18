import type { LocalDataRoot } from "../domain/model.js";
import type { Result } from "../domain/result.js";
import type { SchemaValidator, ValidationError } from "../domain/validation.js";

export interface MigrationStep<
  From extends number = number,
  To extends number = number,
> {
  readonly from: From;
  readonly to: To;
  migrate(input: unknown): Result<unknown, MigrationError>;
}

export type MigrationError =
  | { readonly code: "unsupported-version"; readonly version: number }
  | {
      readonly code: "migration-path-missing";
      readonly from: number;
      readonly target: number;
    }
  | {
      readonly code: "migration-failed";
      readonly from: number;
      readonly to: number;
      readonly cause?: MigrationError;
    }
  | {
      readonly code: "validation";
      readonly version?: number;
      readonly issue: ValidationError;
    };

export interface MigrationRegistry {
  toCurrent(input: unknown): Result<LocalDataRoot, MigrationError>;
}

export const createMigrationRegistry = (
  currentVersion: number,
  steps: readonly MigrationStep[],
  validator: SchemaValidator,
): MigrationRegistry => {
  if (!Number.isSafeInteger(currentVersion))
    throw new TypeError("currentVersion must be a safe integer");

  const stepsByVersion = new Map<number, MigrationStep>();
  for (const step of steps) {
    if (
      !Number.isSafeInteger(step.from) ||
      !Number.isSafeInteger(step.to) ||
      step.to !== step.from + 1
    )
      throw new TypeError("migration steps must be N to N+1");
    if (stepsByVersion.has(step.from))
      throw new TypeError(`duplicate migration step from ${step.from}`);
    stepsByVersion.set(step.from, step);
  }

  return {
    toCurrent(input) {
      const version = readSchemaVersion(input);
      if (version === undefined)
        return {
          ok: false,
          error: {
            code: "validation",
            issue: { code: "unsupported-schema", path: "$.schemaVersion" },
          },
        };
      if (version > currentVersion)
        return { ok: false, error: { code: "unsupported-version", version } };

      let working: unknown = structuredClone(input);
      let workingVersion = version;
      while (workingVersion < currentVersion) {
        const step = stepsByVersion.get(workingVersion);
        if (!step)
          return {
            ok: false,
            error: {
              code: "migration-path-missing",
              from: workingVersion,
              target: currentVersion,
            },
          };
        const migrated = step.migrate(working);
        if (!migrated.ok)
          return {
            ok: false,
            error: {
              code: "migration-failed",
              from: step.from,
              to: step.to,
              cause: migrated.error,
            },
          };
        if (readSchemaVersion(migrated.value) !== step.to)
          return {
            ok: false,
            error: {
              code: "validation",
              version: step.to,
              issue: { code: "unsupported-schema", path: "$.schemaVersion" },
            },
          };
        working = migrated.value;
        workingVersion = step.to;
      }

      const validated = validator.validateRoot(working);
      return validated.ok
        ? validated
        : {
            ok: false,
            error: {
              code: "validation",
              version: currentVersion,
              issue: validated.error,
            },
          };
    },
  };
};

const readSchemaVersion = (input: unknown): number | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return undefined;
  const version = Reflect.get(input, "schemaVersion");
  return Number.isSafeInteger(version) ? (version as number) : undefined;
};
