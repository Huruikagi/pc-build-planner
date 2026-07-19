import type { LocalDataRoot } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { ValidationError } from "../domain/validation.js";
import {
  schemaValidator,
  validateCandidatePartValue,
  validateSerializablePayload,
} from "../domain/validation.js";
import type { RootOperation } from "./mutation-pipeline.js";
import type { ReplacementAssessment } from "./replacement.js";
import type {
  MaintenanceCommand,
  MaintenanceReceipt,
  ReplacementCommand,
  ReplacementReceipt,
} from "./root-transaction-runner.js";
import type {
  FoundationDataPort,
  MutationReceipt,
  RootMutationCommand,
} from "./write-authority.js";

export type FoundationCommand =
  | { readonly kind: "query-root" }
  | { readonly kind: "mutate-root"; readonly command: WireRootMutationCommand }
  | { readonly kind: "assess-replacement"; readonly candidate: unknown }
  | { readonly kind: "replace-root"; readonly command: ReplacementCommand }
  | { readonly kind: "run-maintenance"; readonly command: MaintenanceCommand };

/** Message-boundary representation. Unlike RootOperation, this is JSON-only. */
export type WireRootOperation = RootOperation;
export interface WireRootMutationCommand {
  readonly requestId: RootMutationCommand["requestId"];
  readonly expectedRevision: RootMutationCommand["expectedRevision"];
  readonly operation: WireRootOperation;
  readonly maintenance?: RootMutationCommand["maintenance"];
}

export type FoundationCommandReceipt =
  | LocalDataRoot
  | MutationReceipt
  | ReplacementAssessment
  | ReplacementReceipt
  | MaintenanceReceipt;

export type CallerClassification =
  | { readonly kind: "trusted-extension" }
  | { readonly kind: "content-script" }
  | { readonly kind: "web-page" };

export type WorkerMessageError =
  | { readonly code: "invalid-message" }
  | { readonly code: "invalid-caller" }
  | { readonly code: "caller-denied" };

export type WorkerMessageHandler = (
  message: unknown,
  caller: unknown,
) => Promise<
  Result<FoundationCommandReceipt, WorkerMessageError | FoundationError>
>;
export type RegistrationDisposer = () => void;
export interface WorkerMessageTarget {
  addHandler(handler: WorkerMessageHandler): RegistrationDisposer;
}

export interface FoundationCommandDecoder {
  decode(input: unknown): Result<FoundationCommand, ValidationError>;
}

export interface DataWorkerRegistrationDependencies {
  readonly restrictAccess: () => Promise<
    Result<
      void,
      Extract<
        FoundationError,
        {
          readonly code:
            | "access-denied"
            | "quota-exceeded"
            | "storage-unavailable";
        }
      >
    >
  >;
  /** Test hook. Production composition uses the canonical decoder by default. */
  readonly decoder?: FoundationCommandDecoder;
  readonly authorize: (
    caller: CallerClassification,
    command: FoundationCommand,
  ) => boolean | Promise<boolean>;
  readonly data: FoundationDataPort;
}

export type RegistrationError =
  | { readonly code: "invalid-target" }
  | { readonly code: "access-denied" }
  | { readonly code: "quota-exceeded" }
  | { readonly code: "storage-unavailable" };
export interface DataWorkerRegistration {
  register(
    target: WorkerMessageTarget,
  ): Promise<Result<RegistrationDisposer, RegistrationError>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (
  path: string,
  code: ValidationError["code"] = "unexpected-field",
) => ({ ok: false, error: { code, path } }) as const;
const exact = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  for (const key of required)
    if (!(key in value)) return invalid(`$.${key}`, "missing-field");
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  return extra ? invalid(`$.${extra}`) : undefined;
};
const fence = (value: unknown): boolean =>
  isRecord(value) &&
  !exact(value, ["generation", "ownerId", "revision"]) &&
  Number.isSafeInteger(value.generation) &&
  (value.generation as number) >= 0 &&
  UUID.test(value.ownerId as string) &&
  Number.isSafeInteger(value.revision) &&
  (value.revision as number) >= 0;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const validEntityValue = (entity: unknown, value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const timestamps = (keys: readonly string[]) =>
    keys.every(
      (key) =>
        typeof value[key] === "string" &&
        UTC.test(value[key] as string) &&
        Number.isFinite(Date.parse(value[key] as string)),
    );
  if (entity === "project")
    return (
      !exact(value, ["id", "name", "createdAt", "updatedAt"]) &&
      UUID.test(value.id as string) &&
      typeof value.name === "string" &&
      timestamps(["createdAt", "updatedAt"])
    );
  if (entity === "candidatePart") {
    return validateCandidatePartValue(value).ok;
  }
  if (entity === "currentBuild") {
    if (exact(value, ["id", "projectId", "items", "updatedAt"])) return false;
    return (
      UUID.test(value.id as string) &&
      UUID.test(value.projectId as string) &&
      timestamps(["updatedAt"]) &&
      Array.isArray(value.items) &&
      value.items.every(
        (item) =>
          isRecord(item) &&
          !exact(item, ["candidatePartId", "quantity"]) &&
          UUID.test(item.candidatePartId as string) &&
          Number.isSafeInteger(item.quantity) &&
          (item.quantity as number) > 0,
      )
    );
  }
  return false;
};
const nonNegative = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export const decodeFoundationCommand = (
  input: unknown,
): Result<FoundationCommand, ValidationError> => {
  if (!isRecord(input) || typeof input.kind !== "string")
    return invalid("$", "invalid-string");
  const safe = validateSerializablePayload(input);
  if (!safe.ok) return safe;
  if (input.kind === "query-root")
    return (
      exact(input, ["kind"]) ?? { ok: true, value: input as FoundationCommand }
    );
  if (input.kind === "assess-replacement") {
    const issue = exact(input, ["kind", "candidate"]);
    if (issue) return issue;
    const candidate = schemaValidator.validateReplacement(input.candidate);
    return candidate.ok
      ? { ok: true, value: input as FoundationCommand }
      : candidate;
  }
  if (input.kind === "mutate-root") {
    const outer = exact(input, ["kind", "command"]);
    if (outer) return outer;
    if (!isRecord(input.command)) return invalid("$.command", "invalid-string");
    const commandIssue = exact(
      input.command,
      ["requestId", "expectedRevision", "operation"],
      ["maintenance"],
    );
    if (commandIssue) return commandIssue;
    if (!UUID.test(input.command.requestId as string))
      return invalid("$.command.requestId", "invalid-uuid");
    if (
      !Number.isSafeInteger(input.command.expectedRevision) ||
      (input.command.expectedRevision as number) < 0
    )
      return invalid("$.command.expectedRevision", "invalid-integer");
    if ("maintenance" in input.command && !fence(input.command.maintenance))
      return invalid("$.command.maintenance", "invalid-string");
    const operation = input.command.operation;
    if (!isRecord(operation))
      return invalid("$.command.operation", "invalid-string");
    if (
      operation.kind !== "create" &&
      operation.kind !== "update" &&
      operation.kind !== "delete"
    )
      return invalid("$.command.operation.kind", "invalid-string");
    if (
      operation.entity !== "project" &&
      operation.entity !== "candidatePart" &&
      operation.entity !== "currentBuild"
    )
      return invalid("$.command.operation.entity", "invalid-string");
    const operationIssue = exact(operation, [
      "kind",
      "entity",
      operation.kind === "delete" ? "id" : "value",
    ]);
    if (operationIssue) return operationIssue;
    if (operation.kind === "delete" && !UUID.test(operation.id as string))
      return invalid("$.command.operation.id", "invalid-uuid");
    if (
      operation.kind !== "delete" &&
      !validEntityValue(operation.entity, operation.value)
    )
      return invalid("$.command.operation.value", "invalid-string");
    return { ok: true, value: input as FoundationCommand };
  }
  if (input.kind === "run-maintenance") {
    const outer = exact(input, ["kind", "command"]);
    if (outer) return outer;
    if (!isRecord(input.command) || typeof input.command.type !== "string")
      return invalid("$.command", "invalid-string");
    const type = input.command.type;
    if (type === "acquire") {
      const issue = exact(input.command, ["type", "ownerId", "leaseMs"]);
      if (issue) return issue;
      if (!UUID.test(input.command.ownerId as string))
        return invalid("$.command.ownerId", "invalid-uuid");
      if (
        !Number.isSafeInteger(input.command.leaseMs) ||
        (input.command.leaseMs as number) <= 0
      )
        return invalid("$.command.leaseMs", "invalid-positive-integer");
    } else if (type === "renew") {
      const issue = exact(input.command, ["type", "fence", "leaseMs"]);
      if (issue) return issue;
      if (!fence(input.command.fence))
        return invalid("$.command.fence", "invalid-string");
      if (
        !Number.isSafeInteger(input.command.leaseMs) ||
        (input.command.leaseMs as number) <= 0
      )
        return invalid("$.command.leaseMs", "invalid-positive-integer");
    } else if (type === "release" || type === "abort") {
      const issue = exact(input.command, ["type", "fence"]);
      if (issue) return issue;
      if (!fence(input.command.fence))
        return invalid("$.command.fence", "invalid-string");
    } else return invalid("$.command.type", "invalid-string");
    return { ok: true, value: input as FoundationCommand };
  }
  if (input.kind === "replace-root") {
    const outer = exact(input, ["kind", "command"]);
    if (outer) return outer;
    if (!isRecord(input.command)) return invalid("$.command", "invalid-string");
    const issue = exact(input.command, ["candidate", "assessment", "fence"]);
    if (issue) return issue;
    if (
      !schemaValidator.validateReplacement(input.command.candidate).ok ||
      !isRecord(input.command.assessment) ||
      !fence(input.command.fence)
    )
      return invalid("$.command", "invalid-string");
    const assessment = input.command.assessment;
    const assessmentIssue = exact(assessment, [
      "token",
      "candidateDigest",
      "sourceSchemaVersion",
      "targetSchemaVersion",
      "beforeBytes",
      "requiredBytes",
      "warnings",
      "cursor",
    ]);
    if (assessmentIssue) return assessmentIssue;
    if (
      typeof assessment.token !== "string" ||
      assessment.token.length === 0 ||
      typeof assessment.candidateDigest !== "string" ||
      !/^[0-9a-f]{64}$/i.test(assessment.candidateDigest) ||
      !nonNegative(assessment.sourceSchemaVersion) ||
      !nonNegative(assessment.targetSchemaVersion) ||
      !nonNegative(assessment.beforeBytes) ||
      !nonNegative(assessment.requiredBytes) ||
      !Array.isArray(assessment.warnings) ||
      !assessment.warnings.every(
        (warning) =>
          isRecord(warning) &&
          !exact(warning, ["code", "thresholdBytes"]) &&
          warning.code === "capacity-warning" &&
          nonNegative(warning.thresholdBytes),
      ) ||
      !isRecord(assessment.cursor) ||
      exact(assessment.cursor, [
        "sourceSchemaVersion",
        "targetSchemaVersion",
        "requiredBytes",
        "revision",
      ]) ||
      !nonNegative(assessment.cursor.sourceSchemaVersion) ||
      !nonNegative(assessment.cursor.targetSchemaVersion) ||
      !nonNegative(assessment.cursor.requiredBytes) ||
      !nonNegative(assessment.cursor.revision)
    )
      return invalid("$.command.assessment", "invalid-string");
    return { ok: true, value: input as FoundationCommand };
  }
  return invalid("$.kind", "invalid-string");
};

export const foundationCommandDecoder: FoundationCommandDecoder = {
  decode: decodeFoundationCommand,
};
const classifyCaller = (
  input: unknown,
): Result<CallerClassification, { readonly code: "invalid-caller" }> => {
  if (!isRecord(input) || Object.keys(input).length !== 1)
    return { ok: false, error: { code: "invalid-caller" } };
  if (
    input.kind === "trusted-extension" ||
    input.kind === "content-script" ||
    input.kind === "web-page"
  )
    return { ok: true, value: input as CallerClassification };
  return { ok: false, error: { code: "invalid-caller" } };
};

export const createFoundationCommandRouter = (data: FoundationDataPort) => ({
  handle(
    command: FoundationCommand,
  ): Promise<Result<FoundationCommandReceipt, FoundationError>> {
    switch (command.kind) {
      case "query-root":
        return data.query((root) => root);
      case "mutate-root":
        return data.mutate({
          requestId: command.command.requestId,
          expectedRevision: command.command.expectedRevision,
          operation: command.command.operation as RootOperation,
          ...(command.command.maintenance === undefined
            ? {}
            : { maintenance: command.command.maintenance }),
        });
      case "assess-replacement":
        return data.assessReplacement(command.candidate);
      case "replace-root":
        return data.replaceRoot(command.command);
      case "run-maintenance":
        return data.runMaintenance(command.command);
    }
  },
});

export const createDataWorkerRegistration = (
  dependencies: DataWorkerRegistrationDependencies,
): DataWorkerRegistration => ({
  async register(target) {
    if (!isRecord(target) || typeof target.addHandler !== "function")
      return { ok: false, error: { code: "invalid-target" } };
    const restricted = await dependencies.restrictAccess();
    if (!restricted.ok) return restricted;
    const router = createFoundationCommandRouter(dependencies.data);
    return {
      ok: true,
      value: target.addHandler(async (message, callerInput) => {
        const command = (
          dependencies.decoder ?? foundationCommandDecoder
        ).decode(message);
        if (!command.ok)
          return { ok: false, error: { code: "invalid-message" } };
        const caller = classifyCaller(callerInput);
        if (!caller.ok) return caller;
        let allowed = false;
        try {
          allowed = await dependencies.authorize(caller.value, command.value);
        } catch {
          allowed = false;
        }
        if (!allowed) return { ok: false, error: { code: "caller-denied" } };
        return router.handle(command.value);
      }),
    };
  },
});
