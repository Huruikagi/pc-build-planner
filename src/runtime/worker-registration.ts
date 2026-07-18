import type { Result } from "../domain/result.js";
import type {
  DataCommand,
  SchemaValidator,
  ValidationError,
} from "../domain/validation.js";
import type { StoragePort } from "../persistence/repository.js";

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
) => Promise<Result<unknown, WorkerMessageError | { readonly code: string }>>;

export type RegistrationDisposer = () => void;

export interface WorkerMessageTarget {
  addHandler(handler: WorkerMessageHandler): RegistrationDisposer;
}

export interface DataCommandAuthority {
  handle(
    command: DataCommand,
  ): Promise<Result<unknown, { readonly code: string }>>;
}

export interface DataAuthorityDependencies {
  readonly storage: Pick<StoragePort, "restrictToTrustedContexts">;
  readonly validator: Pick<SchemaValidator, "validateCommand">;
  readonly authorize: (
    caller: CallerClassification,
    command: DataCommand,
  ) => boolean | Promise<boolean>;
  readonly authority: DataCommandAuthority;
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

const classifyCaller = (
  input: unknown,
): Result<CallerClassification, { readonly code: "invalid-caller" }> => {
  if (!isRecord(input) || Object.keys(input).length !== 1)
    return { ok: false, error: { code: "invalid-caller" } };
  switch (input.kind) {
    case "trusted-extension":
    case "content-script":
    case "web-page":
      return { ok: true, value: input as CallerClassification };
    default:
      return { ok: false, error: { code: "invalid-caller" } };
  }
};

const isTarget = (input: WorkerMessageTarget): boolean =>
  isRecord(input) && typeof input.addHandler === "function";

const invalidMessage = (
  _issue: ValidationError,
): Result<never, WorkerMessageError> => ({
  ok: false,
  error: { code: "invalid-message" },
});

export const createDataWorkerRegistration = (
  dependencies: DataAuthorityDependencies,
): DataWorkerRegistration => ({
  async register(target) {
    if (!isTarget(target))
      return { ok: false, error: { code: "invalid-target" } };

    const restricted = await dependencies.storage.restrictToTrustedContexts();
    if (!restricted.ok) return restricted;

    const handler: WorkerMessageHandler = async (message, callerInput) => {
      const command = dependencies.validator.validateCommand(message);
      if (!command.ok) return invalidMessage(command.error);

      const caller = classifyCaller(callerInput);
      if (!caller.ok) return caller;

      let allowed = false;
      try {
        allowed = await dependencies.authorize(caller.value, command.value);
      } catch {
        allowed = false;
      }
      if (!allowed) return { ok: false, error: { code: "caller-denied" } };

      return dependencies.authority.handle(command.value);
    };

    return { ok: true, value: target.addHandler(handler) };
  },
});
