import type { FeatureId } from "../application-shell/contracts.js";
import type {
  TargetTabId,
  TransientGestureRegistrationError,
  TransientGestureRegistrationPort,
  TransientGestureSource,
} from "../application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../domain/public.js";

export interface TransientGestureRegistrar
  extends TransientGestureRegistrationPort {
  start(): void;
  stop(): void;
}

const isValidSource = (source: TransientGestureSource): boolean =>
  typeof source === "object" &&
  source !== null &&
  typeof source.id === "string" &&
  source.id.trim().length > 0 &&
  typeof source.surfaceId === "string" &&
  source.surfaceId.trim().length > 0 &&
  typeof source.start === "function";

export const createTransientGestureRegistrar = (options: {
  readonly ingress: (surfaceId: FeatureId, tabId: TargetTabId) => void;
}): TransientGestureRegistrar => {
  let started = false;
  const registrations = new Map<string, () => void>();
  return {
    start() {
      started = true;
    },
    register(source): Result<() => void, TransientGestureRegistrationError> {
      if (!started) return err({ kind: "not-started" });
      if (!isValidSource(source)) return err({ kind: "invalid-source" });
      if (registrations.has(source.id))
        return err({ kind: "duplicate-source" });
      let sourceCleanup: Result<() => void, TransientGestureRegistrationError>;
      let registrationActive = true;
      try {
        sourceCleanup = source.start((tabId) => {
          if (started && registrationActive)
            options.ingress(source.surfaceId, tabId);
        });
      } catch {
        return err({ kind: "source-start-failed" });
      }
      if (!sourceCleanup.ok || typeof sourceCleanup.value !== "function")
        return err({ kind: "source-start-failed" });
      const cleanup = () => {
        if (!registrationActive) return;
        registrationActive = false;
        registrations.delete(source.id);
        sourceCleanup.value();
      };
      registrations.set(source.id, cleanup);
      return ok(cleanup);
    },
    stop() {
      if (!started) return;
      for (const cleanup of [...registrations.values()].reverse()) cleanup();
      started = false;
    },
  };
};
