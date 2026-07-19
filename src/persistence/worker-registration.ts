import type { LocalDataRoot } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { ValidationError } from "../domain/validation.js";
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
  | { readonly kind: "mutate-root"; readonly command: RootMutationCommand }
  | { readonly kind: "assess-replacement"; readonly candidate: unknown }
  | { readonly kind: "replace-root"; readonly command: ReplacementCommand }
  | { readonly kind: "run-maintenance"; readonly command: MaintenanceCommand };

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
  readonly decoder: FoundationCommandDecoder;
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
        return data.mutate(command.command);
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
        const command = dependencies.decoder.decode(message);
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
