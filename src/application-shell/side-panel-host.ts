import { err, ok, type Result } from "../domain/public.js";
import { message } from "../ui-messages/public.js";
import { createActivationRouter } from "./activation-router.js";
import type {
  ApplicationFeatureRegistration,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
  FeatureMountHandle,
  FeatureRegistry,
  OperationPolicy,
  SelectionError,
  ShellViewState,
  SidePanelHost,
} from "./contracts.js";
import { isPersistent } from "./contracts.js";

export interface SidePanelHostOptions {
  readonly registry: FeatureRegistry;
  readonly container: HTMLElement;
  readonly operationPolicy: OperationPolicy;
  readonly onStateChange: (state: ShellViewState) => void;
  readonly reportError: (message: string) => void;
}

export function createSidePanelHost(
  options: SidePanelHostOptions,
): SidePanelHost {
  let started = false;
  let stopped = false;
  let selected: FeatureId | null = null;
  let mounted: FeatureMountHandle | undefined;
  let unsubscribeRegistry: (() => void) | undefined;
  let lifecycleEpoch = 0;
  let transition: Promise<unknown> = Promise.resolve();

  const publish = (state: ShellViewState): void => {
    try {
      options.onStateChange(state);
    } catch {
      reportDiagnostic("state-observer-failed");
    }
  };

  /** Diagnostics carry only a stable code and, where relevant, a feature id — never display text or a feature-declared reason. */
  const reportDiagnostic = (code: string, featureId?: FeatureId): void => {
    try {
      options.reportError(
        `side-panel-host: ${code}${featureId === undefined ? "" : ` featureId=${featureId}`}`,
      );
    } catch {
      // A diagnostic sink is an external runtime boundary.
    }
  };

  const find = (id: FeatureId): ApplicationFeatureRegistration | undefined =>
    options.registry.snapshot().find((feature) => feature.id === id);

  const firstAvailable = (
    excluded?: FeatureId,
  ): ApplicationFeatureRegistration | undefined =>
    options.registry
      .snapshot()
      .find(
        (feature) =>
          isPersistent(feature) &&
          feature.id !== excluded &&
          feature.getAvailability().status === "available",
      );

  async function unmountCurrent(): Promise<Result<void, SelectionError>> {
    const handle = mounted;
    const previous = selected;
    if (handle === undefined) return ok(undefined);
    try {
      await handle.unmount();
      mounted = undefined;
      selected = null;
      return ok(undefined);
    } catch {
      const id = previous ?? ("unknown" as FeatureId);
      reportDiagnostic("feature-unmount-failed", id);
      const descriptor = message("shell.featureUnmountFailed", {
        featureId: id,
      });
      publish({ kind: "error", message: descriptor, recoverable: true });
      return err({ kind: "mount_failed", message: descriptor });
    }
  }

  async function performSelect(
    id: FeatureId,
  ): Promise<Result<void, SelectionError>> {
    if (stopped) {
      return err({
        kind: "unavailable",
        message: message("shell.hostStopped"),
      });
    }
    const feature = find(id);
    if (feature === undefined) {
      return err({
        kind: "unavailable",
        message: message("shell.featureNotRegistered", { featureId: id }),
      });
    }
    if (!isPersistent(feature)) {
      return err({
        kind: "unavailable",
        message: message("shell.featureNotRegistered", { featureId: id }),
      });
    }
    const availability = feature.getAvailability();
    if (availability.status === "unavailable") {
      reportDiagnostic("feature-unavailable", id);
      return err({
        kind: "unavailable",
        message: message("shell.featureUnavailable", {
          featureId: id,
          reason: availability.reason,
        }),
      });
    }
    if (selected === id && mounted !== undefined) return ok(undefined);

    const unmounted = await unmountCurrent();
    if (!unmounted.ok) return unmounted;
    const mountEpoch = lifecycleEpoch;
    try {
      const handle = await feature.mount({
        container: options.container,
        operationPolicy: options.operationPolicy,
        reportError: (featureMessage) =>
          options.reportError(
            `side-panel-host: feature ${id}: ${featureMessage}`,
          ),
      });
      const currentAvailability = feature.getAvailability();
      if (
        stopped ||
        mountEpoch !== lifecycleEpoch ||
        currentAvailability.status === "unavailable"
      ) {
        try {
          await handle.unmount();
        } catch {
          reportDiagnostic("stale-feature-unmount-failed", id);
        }
        return err({
          kind: "unavailable",
          message:
            currentAvailability.status === "unavailable"
              ? message("shell.featureUnavailable", {
                  featureId: id,
                  reason: currentAvailability.reason,
                })
              : message("shell.featureRequestInvalidated", { featureId: id }),
        });
      }
      mounted = handle;
      selected = id;
      publish({ kind: "ready", selected: id });
      return ok(undefined);
    } catch {
      reportDiagnostic("feature-mount-failed", id);
      const descriptor = message("shell.featureMountFailed", { featureId: id });
      publish({ kind: "error", message: descriptor, recoverable: true });
      return err({ kind: "mount_failed", message: descriptor });
    }
  }

  const enqueueSelect = (
    id: FeatureId,
  ): Promise<Result<void, SelectionError>> => {
    const next = transition.then(
      () => performSelect(id),
      () => performSelect(id),
    );
    transition = next;
    return next;
  };

  const mountFeature = async (
    feature: ApplicationFeatureRegistration,
    restoredState?: unknown,
    restoring = false,
  ): Promise<Result<void, FeatureActivationError>> => {
    const mountEpoch = lifecycleEpoch;
    try {
      const handle = await feature.mount({
        container: options.container,
        operationPolicy: options.operationPolicy,
        reportError: (featureMessage) =>
          options.reportError(
            `side-panel-host: feature ${feature.id}: ${featureMessage}`,
          ),
        ...(restoring ? { restoredState } : {}),
      });
      const availability = feature.getAvailability();
      if (
        stopped ||
        mountEpoch !== lifecycleEpoch ||
        availability.status === "unavailable"
      ) {
        try {
          await handle.unmount();
        } catch {
          // A stale target still owns the slot until its handle is released.
          mounted = handle;
          selected = feature.id;
          reportDiagnostic("stale-feature-unmount-failed", feature.id);
          publish({
            kind: "error",
            message: message("shell.featureUnmountFailed", {
              featureId: feature.id,
            }),
            recoverable: true,
          });
          return err({
            kind: "activation_failed",
            detail: "stale feature cleanup failed",
          });
        }
        return err({
          kind: "mount_failed",
          featureId: feature.id,
        });
      }
      mounted = handle;
      selected = feature.id;
      publish({ kind: "ready", selected: feature.id });
      return ok(undefined);
    } catch {
      reportDiagnostic("feature-mount-failed", feature.id);
      publish({
        kind: "error",
        message: message("shell.featureMountFailed", {
          featureId: feature.id,
        }),
        recoverable: true,
      });
      return err({ kind: "mount_failed", featureId: feature.id });
    }
  };

  const restorePrevious = async (
    previous: ApplicationFeatureRegistration | undefined,
    snapshot: unknown,
  ): Promise<void> => {
    if (previous === undefined) return;
    const restored = await mountFeature(previous, snapshot, true);
    if (!restored.ok) reportDiagnostic("feature-restore-failed", previous.id);
  };

  const capturePreviousState = async (
    feature: ApplicationFeatureRegistration | undefined,
    handle: FeatureMountHandle | undefined,
  ): Promise<Result<unknown, FeatureActivationError>> => {
    if (feature === undefined || handle?.captureState === undefined)
      return err({
        kind: "activation_failed",
        detail: "source feature does not provide an activation snapshot",
      });
    try {
      const captured = await handle.captureState();
      if (!captured || typeof captured !== "object" || !("ok" in captured))
        return err({
          kind: "activation_failed",
          detail: "source feature returned an invalid activation snapshot",
        });
      if (!captured.ok) return err(captured.error);
      return ok(captured.value);
    } catch {
      return err({
        kind: "activation_failed",
        detail: "source feature rejected activation snapshot",
      });
    }
  };

  const performActivation = async (
    intent: FeatureActivationIntent,
  ): Promise<Result<void, FeatureActivationError>> => {
    if (stopped)
      return err({
        kind: "activation_failed",
        detail: "side panel host is stopped",
      });
    const prepared = createActivationRouter({
      registry: options.registry,
    }).prepare(intent);
    if (!prepared.ok) return err(prepared.error);

    if (selected === prepared.value.feature.id && mounted !== undefined)
      return prepared.value.activate();

    const previous = selected === null ? undefined : find(selected);
    const snapshot =
      previous === undefined
        ? ok<unknown>(undefined)
        : await capturePreviousState(previous, mounted);
    if (!snapshot.ok) return snapshot;
    const unmounted = await unmountCurrent();
    if (!unmounted.ok)
      return err({ kind: "mount_failed", featureId: intent.featureId });

    const mountedTarget = await mountFeature(prepared.value.feature);
    if (!mountedTarget.ok) {
      // A failed stale cleanup retains the target handle; never remount source.
      if (mounted === undefined)
        await restorePrevious(previous, snapshot.value);
      return mountedTarget;
    }
    const applied = await prepared.value.activate();
    if (applied.ok) return applied;

    const released = await unmountCurrent();
    if (!released.ok) {
      reportDiagnostic("activation-unmount-failed", intent.featureId);
      return err({ kind: "mount_failed", featureId: intent.featureId });
    }
    await restorePrevious(previous, snapshot.value);
    return applied;
  };

  const enqueueActivation = (
    intent: FeatureActivationIntent,
  ): Promise<Result<void, FeatureActivationError>> => {
    const next = transition.then(
      () => performActivation(intent),
      () => performActivation(intent),
    );
    transition = next;
    return next;
  };

  const reconcileAvailability = async (): Promise<void> => {
    if (!started || stopped) return;
    if (selected === null) {
      const fallback = firstAvailable();
      if (fallback !== undefined) await enqueueSelect(fallback.id);
      else publish({ kind: "ready", selected: null });
      return;
    }
    const current = find(selected);
    const availability = current?.getAvailability();
    if (availability?.status === "available") return;

    const previous = selected;
    reportDiagnostic("feature-unavailable", previous);
    const fallback = firstAvailable(previous);
    if (fallback !== undefined) {
      await enqueueSelect(fallback.id);
      return;
    }
    const result = await unmountCurrent();
    if (result.ok) {
      publish({
        kind: "error",
        message:
          availability?.status === "unavailable"
            ? message("shell.featureUnavailable", {
                featureId: previous,
                reason: availability.reason,
              })
            : message("shell.featureUnregistered", { featureId: previous }),
        recoverable: true,
      });
    }
  };

  return {
    async start() {
      if (started) return ok(undefined);
      started = true;
      stopped = false;
      publish({ kind: "loading" });
      unsubscribeRegistry = options.registry.subscribe(() => {
        lifecycleEpoch += 1;
        void reconcileAvailability().catch(() => {
          reportDiagnostic("availability-reconciliation-failed");
        });
      });
      const initial = firstAvailable();
      if (initial === undefined) {
        publish({ kind: "ready", selected: null });
        return ok(undefined);
      }
      await enqueueSelect(initial.id);
      return ok(undefined);
    },
    select(id) {
      return enqueueSelect(id);
    },
    activate(intent) {
      return enqueueActivation(intent);
    },
    async stop() {
      if (stopped && unsubscribeRegistry === undefined && mounted === undefined)
        return;
      stopped = true;
      lifecycleEpoch += 1;
      started = false;
      const failures: unknown[] = [];
      const unsubscribe = unsubscribeRegistry;
      unsubscribeRegistry = undefined;
      if (unsubscribe !== undefined) {
        try {
          unsubscribe();
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      await transition.catch((error: unknown) => failures.push(error));
      const handle = mounted;
      if (handle !== undefined) {
        try {
          await handle.unmount();
          if (mounted === handle) {
            mounted = undefined;
            selected = null;
          }
        } catch (error: unknown) {
          failures.push(error);
          reportDiagnostic("host-stop-unmount-failed");
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Side panel host cleanup failed");
      }
    },
  };
}
