import { err, ok, type Result } from "../domain/public.js";
import type { FeatureActivationIntent, FeatureId } from "./contracts.js";
import type {
  ActivationId,
  TransientActivationRequest,
  TransientDismissReason,
  TransientSurfaceError,
  TransientSurfaceLifecyclePort,
  TransientSurfaceState,
} from "./transient-surface-ports.js";

export interface TransientSurfaceHost {
  getSelected(): FeatureId | null;
  isTransientAvailable(surfaceId: FeatureId): boolean;
  showTransient(
    surfaceId: FeatureId,
  ): Promise<Result<void, TransientSurfaceError>>;
  restorePersistent(
    preferred: FeatureId | null,
    reason: TransientDismissReason,
  ): Promise<Result<void, TransientSurfaceError>>;
  activate(
    intent: FeatureActivationIntent,
  ): Promise<Result<void, TransientSurfaceError>>;
}

export interface TransientSurfaceController
  extends TransientSurfaceLifecyclePort {
  start(): Promise<Result<void, TransientSurfaceError>>;
  request(
    value: TransientActivationRequest,
  ): Promise<Result<void, TransientSurfaceError>>;
  dismiss(
    activationId: ActivationId,
    reason: TransientDismissReason,
  ): Promise<Result<void, TransientSurfaceError>>;
  getSnapshot(): TransientSurfaceState;
  subscribe(listener: (state: TransientSurfaceState) => void): () => void;
  stop(): Promise<void>;
}

export function createTransientSurfaceController(options: {
  readonly host: TransientSurfaceHost;
}): TransientSurfaceController {
  let started = false;
  let state: TransientSurfaceState = { kind: "inactive" };
  let transition: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(state: TransientSurfaceState) => void>();

  const publish = (next: TransientSurfaceState): void => {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // Snapshot observers cannot break lifecycle serialization.
      }
    }
  };
  const enqueue = <T>(command: () => Promise<T>): Promise<T> => {
    const next = transition.then(command, command);
    transition = next;
    return next;
  };
  const current = (activationId: ActivationId): boolean =>
    state.kind !== "inactive" && state.activationId === activationId;

  return {
    async start() {
      started = true;
      return ok(undefined);
    },
    request(value) {
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (!options.host.isTransientAvailable(value.surfaceId))
          return err({
            kind: "surface-unavailable",
            surfaceId: value.surfaceId,
          });
        const returnTo =
          state.kind === "inactive"
            ? options.host.getSelected()
            : state.returnTo;
        const shown = await options.host.showTransient(value.surfaceId);
        if (!shown.ok) return shown;
        publish({
          kind: "active",
          activationId: value.activationId,
          surfaceId: value.surfaceId,
          tabId: value.tabId,
          returnTo,
        });
        return ok(undefined);
      });
    },
    dismiss(activationId, reason) {
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (!current(activationId)) return ok(undefined);
        if (state.kind === "inactive") return ok(undefined);
        const retained = state;
        const restored = await options.host.restorePersistent(
          retained.returnTo,
          reason,
        );
        if (!restored.ok) {
          publish({
            kind: "dismiss-failed",
            activationId: retained.activationId,
            surfaceId: retained.surfaceId,
            returnTo: retained.returnTo,
          });
          return err({ kind: "transition-failed" });
        }
        publish({ kind: "inactive" });
        return ok(undefined);
      });
    },
    conclude(activationId, handoff) {
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (!current(activationId)) return ok(undefined);
        const activated = await options.host.activate(handoff);
        if (!activated.ok) return err({ kind: "transition-failed" });
        publish({ kind: "inactive" });
        return ok(undefined);
      });
    },
    isCurrent: current,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async stop() {
      started = false;
      await transition.catch(() => undefined);
      publish({ kind: "inactive" });
    },
  };
}
