import { err, ok, type Result } from "../domain/public.js";
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
      reportDiagnostic("state observer failed");
    }
  };

  const reportDiagnostic = (message: string): void => {
    try {
      options.reportError(`side-panel-host: ${message}`);
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
      const message = `feature ${id} の表示終了に失敗しました`;
      reportDiagnostic(message);
      publish({ kind: "error", message, recoverable: true });
      return err({ kind: "mount_failed", message });
    }
  }

  async function performSelect(
    id: FeatureId,
  ): Promise<Result<void, SelectionError>> {
    if (stopped) {
      return err({
        kind: "unavailable",
        message: "side panel host は停止しています",
      });
    }
    const feature = find(id);
    if (feature === undefined) {
      return err({
        kind: "unavailable",
        message: `feature ${id} は未登録です`,
      });
    }
    const availability = feature.getAvailability();
    if (availability.status === "unavailable") {
      const message = `feature ${id} は利用できません: ${availability.reason}`;
      reportDiagnostic(message);
      return err({ kind: "unavailable", message });
    }
    if (selected === id && mounted !== undefined) return ok(undefined);

    const unmounted = await unmountCurrent();
    if (!unmounted.ok) return unmounted;
    const mountEpoch = lifecycleEpoch;
    try {
      const handle = await feature.mount({
        container: options.container,
        operationPolicy: options.operationPolicy,
        reportError: (message) => reportDiagnostic(`feature ${id}: ${message}`),
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
          reportDiagnostic(`stale feature ${id} の表示終了に失敗しました`);
        }
        return err({
          kind: "unavailable",
          message:
            currentAvailability.status === "unavailable"
              ? `feature ${id} は利用できません: ${currentAvailability.reason}`
              : `feature ${id} の表示要求は無効になりました`,
        });
      }
      mounted = handle;
      selected = id;
      publish({ kind: "ready", selected: id });
      return ok(undefined);
    } catch {
      const message = `feature ${id} の表示開始に失敗しました`;
      reportDiagnostic(message);
      publish({ kind: "error", message, recoverable: true });
      return err({ kind: "mount_failed", message });
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
        reportError: (message) =>
          reportDiagnostic(`feature ${feature.id}: ${message}`),
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
          const message = `stale feature ${feature.id} の表示終了に失敗しました`;
          reportDiagnostic(message);
          publish({ kind: "error", message, recoverable: true });
          return err({ kind: "activation_failed", detail: message });
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
      const message = `feature ${feature.id} の表示開始に失敗しました`;
      reportDiagnostic(message);
      publish({ kind: "error", message, recoverable: true });
      return err({ kind: "mount_failed", featureId: feature.id });
    }
  };

  const restorePrevious = async (
    previous: ApplicationFeatureRegistration | undefined,
    snapshot: unknown,
  ): Promise<void> => {
    if (previous === undefined) return;
    const restored = await mountFeature(previous, snapshot, true);
    if (!restored.ok)
      reportDiagnostic(`feature ${previous.id} の表示復旧に失敗しました`);
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
      reportDiagnostic(
        `activation失敗後のfeature ${intent.featureId} の表示終了に失敗しました`,
      );
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

    const reason =
      availability?.status === "unavailable"
        ? availability.reason
        : "登録が解除されました";
    const previous = selected;
    const unavailableMessage = `feature ${previous} は利用できません: ${reason}`;
    reportDiagnostic(unavailableMessage);
    const fallback = firstAvailable(previous);
    if (fallback !== undefined) {
      await enqueueSelect(fallback.id);
      return;
    }
    const result = await unmountCurrent();
    if (result.ok) {
      publish({
        kind: "error",
        message: unavailableMessage,
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
          reportDiagnostic("availability reconciliation failed");
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
          reportDiagnostic("停止時のfeature表示終了に失敗しました");
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Side panel host cleanup failed");
      }
    },
  };
}
