import { err, type FoundationError, ok, type Result } from "./result.js";

export type AppDataError = FoundationError extends infer Error
  ? Error extends FoundationError
    ? Readonly<Error>
    : never
  : never;

export type AppDataErrorValidationFailure = {
  readonly code: "invalid-app-data-error";
  readonly reason:
    | "not-object"
    | "unknown-code"
    | "invalid-payload"
    | "unexpected-field";
  readonly path: "$" | "$.code" | "$.message" | "$.reason";
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unmapped FoundationError: ${String(value)}`);
};

export const mapFoundationError = (error: FoundationError): AppDataError => {
  switch (error.code) {
    case "validation":
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
    case "repair-failed":
    case "revision-conflict":
    case "request-conflict":
    case "maintenance-active":
    case "recovery-active":
    case "stale-recovery-state":
    case "stale-fence":
    case "stale-assessment":
    case "precommit-cleanup-pending":
    case "quota-exceeded":
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return error;
    default:
      return assertNever(error);
  }
};

const ERROR_CODES = new Set<FoundationError["code"]>([
  "validation",
  "corrupt-data",
  "unsupported-version",
  "migration-failed",
  "repair-failed",
  "revision-conflict",
  "request-conflict",
  "maintenance-active",
  "recovery-active",
  "stale-recovery-state",
  "stale-fence",
  "stale-assessment",
  "precommit-cleanup-pending",
  "quota-exceeded",
  "access-denied",
  "lock-unavailable",
  "storage-unavailable",
]);

const failure = (
  reason: AppDataErrorValidationFailure["reason"],
  path: AppDataErrorValidationFailure["path"],
): Result<never, AppDataErrorValidationFailure> =>
  err({ code: "invalid-app-data-error", reason, path });

const validateAppDataErrorValue = (
  input: unknown,
): Result<AppDataError, AppDataErrorValidationFailure> => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return failure("not-object", "$");
  const value = input as Record<string, unknown>;
  if (
    typeof value.code !== "string" ||
    !ERROR_CODES.has(value.code as FoundationError["code"])
  )
    return failure("unknown-code", "$.code");
  if (value.message !== undefined && typeof value.message !== "string")
    return failure("invalid-payload", "$.message");
  const allowed =
    value.code === "validation"
      ? new Set(["code", "message", "reason"])
      : new Set(["code", "message"]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    return failure("unexpected-field", "$");
  if (value.code === "validation") {
    if (
      value.reason !== undefined &&
      value.reason !== "entity-already-exists" &&
      value.reason !== "entity-not-found"
    )
      return failure("invalid-payload", "$.reason");
  }
  return ok(mapFoundationError(value as FoundationError));
};

export const validateAppDataError = (
  input: unknown,
): Result<AppDataError, AppDataErrorValidationFailure> => {
  try {
    return validateAppDataErrorValue(input);
  } catch {
    return failure("invalid-payload", "$");
  }
};
