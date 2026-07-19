import type { Result } from "../domain/public.js";
import { err, ok } from "../domain/public.js";
import type {
  ApplicationWorkerRegistration,
  FeatureId,
  RegistrationError,
  WorkerRegistrationContext,
} from "./contracts.js";

type RegisteredWorker = {
  readonly id: FeatureId;
  readonly remove: () => void;
};

export function composeWorkerContributions(
  registrations: readonly ApplicationWorkerRegistration[],
  context: WorkerRegistrationContext,
): Result<() => void, RegistrationError> {
  const validation = validateRegistrations(registrations);
  if (!validation.ok) return validation;

  const registered: RegisteredWorker[] = [];
  for (const registration of registrations) {
    let result: ReturnType<ApplicationWorkerRegistration["register"]>;
    try {
      result = registration.register(context);
    } catch {
      cleanupWorkers(registered, context);
      return err({
        kind: "invalid_registration",
        detail: "worker.register: registration rejected",
      });
    }

    if (!result.ok) {
      cleanupWorkers(registered, context);
      return result;
    }
    if (typeof result.value !== "function") {
      cleanupWorkers(registered, context);
      return err({
        kind: "invalid_registration",
        detail: "worker.register: cleanup function is required",
      });
    }
    registered.push({ id: registration.id, remove: result.value });
  }

  let stopped = false;
  return ok(() => {
    if (stopped) return;
    stopped = true;
    cleanupWorkers(registered, context);
  });
}

function validateRegistrations(
  registrations: readonly ApplicationWorkerRegistration[],
): Result<void, RegistrationError> {
  const ids = new Set<FeatureId>();
  for (const registration of registrations) {
    if (registration.id.trim().length === 0) {
      return err({
        kind: "invalid_registration",
        detail: "worker.id: non-empty feature id is required",
      });
    }
    if (ids.has(registration.id)) {
      return err({ kind: "duplicate_feature_id", id: registration.id });
    }
    ids.add(registration.id);
  }
  return ok(undefined);
}

function cleanupWorkers(
  registered: readonly RegisteredWorker[],
  context: WorkerRegistrationContext,
): void {
  for (let index = registered.length - 1; index >= 0; index -= 1) {
    const worker = registered[index];
    if (!worker) continue;
    try {
      worker.remove();
    } catch {
      try {
        context.reportError(`worker.cleanup[${worker.id}]: cleanup rejected`);
      } catch {
        // Diagnostic failures must not prevent the remaining cleanup.
      }
    }
  }
}
