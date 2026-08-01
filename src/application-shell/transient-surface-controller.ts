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
    request: TransientActivationRequest,
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
  selectPersistent(
    target: FeatureId,
  ): Promise<Result<void, TransientSurfaceError>>;
  retryDismiss(): Promise<Result<void, TransientSurfaceError>>;
  getSnapshot(): TransientSurfaceState;
  subscribe(listener: (state: TransientSurfaceState) => void): () => void;
  stop(): Promise<void>;
}

export function createTransientSurfaceController(options: {
  readonly host: TransientSurfaceHost;
}): TransientSurfaceController {
  let started = false;
  let state: TransientSurfaceState = { kind: "inactive" };
  let disabledActivationId: ActivationId | undefined;
  let commandEpoch = 0;
  let acceptedActivation:
    | {
        readonly activationId: ActivationId;
        readonly surfaceId: FeatureId;
        readonly returnTo: FeatureId | null;
      }
    | undefined;
  let transition: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(state: TransientSurfaceState) => void>();
  const readinessWaiters = new Map<
    ActivationId,
    Set<(ready: boolean) => void>
  >();
  const settleReadiness = (
    activationId: ActivationId,
    ready: boolean,
  ): void => {
    const waiters = readinessWaiters.get(activationId);
    if (waiters === undefined) return;
    readinessWaiters.delete(activationId);
    for (const resolve of waiters) resolve(ready);
  };
  const terminate = (activationId: ActivationId): void => {
    settleReadiness(activationId, false);
  };

  const publish = (next: TransientSurfaceState): void => {
    state = next;
    if (next.kind === "active") settleReadiness(next.activationId, true);
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
    state.kind === "active" &&
    state.activationId === activationId &&
    disabledActivationId !== activationId;

  type ClosingState = Extract<
    TransientSurfaceState,
    { readonly kind: "closing" }
  >;
  const beginDismiss = (
    retained: {
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly returnTo: FeatureId | null;
    },
    target: FeatureId | null,
    reason: TransientDismissReason,
  ): ClosingState => {
    disabledActivationId = retained.activationId;
    const closing: ClosingState = {
      kind: "closing",
      activationId: retained.activationId,
      surfaceId: retained.surfaceId,
      returnTo: retained.returnTo,
      target,
      reason,
    };
    publish(closing);
    return closing;
  };

  const performDismiss = async (
    closing: ClosingState,
    epoch: number,
  ): Promise<Result<void, TransientSurfaceError>> => {
    const restored = await options.host.restorePersistent(
      closing.target,
      closing.reason,
    );
    if (!restored.ok) {
      if (epoch === commandEpoch)
        publish({
          kind: "dismiss-failed",
          activationId: closing.activationId,
          surfaceId: closing.surfaceId,
          returnTo: closing.returnTo,
          target: closing.target,
          reason: closing.reason,
        });
      return err({ kind: "transition-failed" });
    }
    if (epoch === commandEpoch) publish({ kind: "inactive" });
    return ok(undefined);
  };

  return {
    async start() {
      started = true;
      return ok(undefined);
    },
    request(value) {
      if (!started)
        return enqueue(async () => err({ kind: "not-started" as const }));
      const epoch = ++commandEpoch;
      if (acceptedActivation !== undefined)
        terminate(acceptedActivation.activationId);
      if (state.kind === "active" && state.activationId !== value.activationId)
        terminate(state.activationId);
      const returnTo =
        state.kind === "inactive" ? options.host.getSelected() : state.returnTo;
      acceptedActivation = {
        activationId: value.activationId,
        surfaceId: value.surfaceId,
        returnTo,
      };
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (epoch !== commandEpoch) return ok(undefined);
        const releasePending = (): void => {
          if (
            epoch === commandEpoch &&
            acceptedActivation?.activationId === value.activationId
          )
            acceptedActivation = undefined;
          terminate(value.activationId);
        };
        if (!options.host.isTransientAvailable(value.surfaceId)) {
          releasePending();
          return err({
            kind: "surface-unavailable",
            surfaceId: value.surfaceId,
          });
        }
        let shown: Result<void, TransientSurfaceError>;
        try {
          shown = await options.host.showTransient(value);
        } catch {
          releasePending();
          return err({ kind: "transition-failed" });
        }
        if (!shown.ok) {
          releasePending();
          return shown;
        }
        if (epoch !== commandEpoch) return ok(undefined);
        disabledActivationId = undefined;
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
      const retained = state;
      const pending = acceptedActivation;
      const candidate =
        (retained.kind === "active" || retained.kind === "dismiss-failed") &&
        retained.activationId === activationId
          ? retained
          : pending?.activationId === activationId
            ? pending
            : undefined;
      const eligible =
        started &&
        candidate !== undefined &&
        (candidate !== retained ||
          retained.kind !== "dismiss-failed" ||
          retained.reason === reason);
      const closing = eligible
        ? beginDismiss(
            candidate,
            candidate === retained && retained.kind === "dismiss-failed"
              ? retained.target
              : candidate.returnTo,
            reason,
          )
        : undefined;
      const epoch = closing === undefined ? commandEpoch : ++commandEpoch;
      if (closing !== undefined) acceptedActivation = undefined;
      if (closing !== undefined) terminate(closing.activationId);
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (closing === undefined || epoch !== commandEpoch)
          return ok(undefined);
        return performDismiss(closing, epoch);
      });
    },
    selectPersistent(target) {
      const retained = state;
      const pending = acceptedActivation;
      const closing =
        started &&
        (retained.kind === "active" || retained.kind === "dismiss-failed")
          ? beginDismiss(retained, target, "persistent-selected")
          : started && pending !== undefined
            ? beginDismiss(pending, target, "persistent-selected")
            : undefined;
      const epoch = ++commandEpoch;
      acceptedActivation = undefined;
      if (closing !== undefined) terminate(closing.activationId);
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (closing !== undefined)
          return epoch === commandEpoch
            ? performDismiss(closing, epoch)
            : ok(undefined);
        if (epoch !== commandEpoch) return ok(undefined);
        if (state.kind === "inactive") {
          const selected = await options.host.restorePersistent(
            target,
            "persistent-selected",
          );
          return selected.ok
            ? ok(undefined)
            : err({ kind: "transition-failed" });
        }
        return ok(undefined);
      });
    },
    retryDismiss() {
      const retained = state;
      const closing =
        started && retained.kind === "dismiss-failed"
          ? beginDismiss(retained, retained.target, retained.reason)
          : undefined;
      const epoch = closing === undefined ? commandEpoch : ++commandEpoch;
      if (closing !== undefined) acceptedActivation = undefined;
      if (closing !== undefined) terminate(closing.activationId);
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (closing === undefined || epoch !== commandEpoch)
          return ok(undefined);
        return performDismiss(closing, epoch);
      });
    },
    conclude(activationId, handoff) {
      const accepted = current(activationId);
      const pending =
        started &&
        !accepted &&
        acceptedActivation?.activationId === activationId;
      if (accepted) disabledActivationId = activationId;
      if (accepted || pending) {
        acceptedActivation = undefined;
        terminate(activationId);
      }
      const epoch = accepted || pending ? ++commandEpoch : commandEpoch;
      return enqueue(async () => {
        if (!started) return err({ kind: "not-started" });
        if (!accepted || epoch !== commandEpoch) return ok(undefined);
        const activated = await options.host.activate(handoff);
        if (!activated.ok) {
          if (
            activated.error.kind === "transition-failed" &&
            activated.error.reason === "rollback-failed"
          ) {
            if (epoch === commandEpoch) {
              acceptedActivation = undefined;
              publish({ kind: "inactive" });
            }
            return err(activated.error);
          }
          if (
            epoch === commandEpoch &&
            state.kind === "active" &&
            state.activationId === activationId
          )
            disabledActivationId = undefined;
          return err(activated.error);
        }
        if (epoch === commandEpoch) {
          acceptedActivation = undefined;
          publish({ kind: "inactive" });
        }
        return ok(undefined);
      });
    },
    isCurrent: current,
    waitUntilCurrent(activationId) {
      if (current(activationId)) return Promise.resolve(true);
      if (!started || acceptedActivation?.activationId !== activationId)
        return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const waiters = readinessWaiters.get(activationId) ?? new Set();
        waiters.add(resolve);
        readinessWaiters.set(activationId, waiters);
      });
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async stop() {
      started = false;
      commandEpoch += 1;
      acceptedActivation = undefined;
      for (const activationId of [...readinessWaiters.keys()])
        terminate(activationId);
      await transition.catch(() => undefined);
      disabledActivationId = undefined;
      publish({ kind: "inactive" });
    },
  };
}
