import { err, ok, type Result } from "../domain/public.js";
import type {
  FeatureId,
  FeatureRegistry,
  MaintenanceProjection,
  MaintenanceSnapshotSource,
  MutationGate,
  SelectionError,
  ShellViewState,
  SidePanelHost,
  StartupError,
} from "./contracts.js";
import { createMaintenanceProjection } from "./maintenance-projection.js";
import { createMutationGate } from "./mutation-gate.js";
import { createSidePanelHost } from "./side-panel-host.js";

export interface ApplicationShellIntegrationOptions {
  readonly registry: FeatureRegistry;
  readonly container: HTMLElement;
  readonly maintenanceSource: MaintenanceSnapshotSource;
  readonly onStateChange: (state: ShellViewState) => void;
  readonly reportError: (message: string) => void;
}

export interface ApplicationShellIntegration extends SidePanelHost {
  readonly operationPolicy: MutationGate;
}

const STARTUP_FAILURE_MESSAGE = "メンテナンス状態を取得できませんでした";

export function createApplicationShellIntegration(
  options: ApplicationShellIntegrationOptions,
): ApplicationShellIntegration {
  const projection = createMaintenanceProjection();
  const operationPolicy = createMutationGate(projection);
  let hostState: ShellViewState = { kind: "loading" };
  let unsubscribeSource: (() => void) | undefined;
  let hostOwned = false;
  let started = false;
  let stopped = true;
  let lifecycleEpoch = 0;
  let startPromise: Promise<Result<void, StartupError>> | undefined;
  let stopPromise: Promise<void> | undefined;

  const reportDiagnostic = (message: string): void => {
    try {
      options.reportError(`application-shell-integration: ${message}`);
    } catch {
      // Diagnostics are a best-effort runtime boundary.
    }
  };

  const present = (state: ShellViewState): void => {
    try {
      options.onStateChange(state);
    } catch {
      reportDiagnostic("state observer failed");
    }
  };

  const projectedState = (): ShellViewState => {
    const maintenance = projection.getSnapshot();
    if (
      maintenance.status === "active" &&
      (hostState.kind === "ready" || hostState.kind === "maintenance")
    ) {
      return {
        kind: "maintenance",
        selected: hostState.selected,
        message: maintenance.message,
      };
    }
    if (hostState.kind === "maintenance") {
      return { kind: "ready", selected: hostState.selected };
    }
    return hostState;
  };

  const host = createSidePanelHost({
    registry: options.registry,
    container: options.container,
    operationPolicy,
    onStateChange(state) {
      hostState = state;
      present(projectedState());
    },
    reportError: reportDiagnostic,
  });

  const acceptNotification = (
    snapshot: Parameters<MaintenanceProjection["accept"]>[0],
  ): void => {
    try {
      const outcome = projection.accept(snapshot);
      if (outcome === "stale_ignored") {
        reportDiagnostic("stale maintenance notification ignored");
      } else if (started) {
        present(projectedState());
      }
    } catch {
      reportDiagnostic("invalid maintenance notification ignored");
    }
  };

  const startupFailure = (): Result<void, StartupError> =>
    err({ kind: "startup_failed", message: STARTUP_FAILURE_MESSAGE });

  const isCurrent = (epoch: number): boolean =>
    !stopped && epoch === lifecycleEpoch;

  const cleanupOwned = async (): Promise<void> => {
    const failures: unknown[] = [];
    const unsubscribe = unsubscribeSource;
    if (unsubscribe !== undefined) {
      try {
        unsubscribe();
        if (unsubscribeSource === unsubscribe) unsubscribeSource = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (hostOwned) {
      try {
        await host.stop();
        hostOwned = false;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Application shell integration cleanup failed",
      );
    }
  };

  const rollbackFailedStart = async (): Promise<void> => {
    try {
      await cleanupOwned();
    } catch {
      reportDiagnostic("startup rollback failed; cleanup remains owned");
    }
  };

  const runStart = async (
    epoch: number,
  ): Promise<Result<void, StartupError>> => {
    let initial: Awaited<ReturnType<MaintenanceSnapshotSource["getSnapshot"]>>;
    try {
      initial = await options.maintenanceSource.getSnapshot();
    } catch {
      if (isCurrent(epoch)) {
        present({
          kind: "error",
          message: STARTUP_FAILURE_MESSAGE,
          recoverable: false,
        });
      }
      return startupFailure();
    }
    if (!isCurrent(epoch)) return startupFailure();
    if (!initial.ok) {
      present({
        kind: "error",
        message: STARTUP_FAILURE_MESSAGE,
        recoverable: false,
      });
      return startupFailure();
    }
    acceptNotification(initial.value);
    if (!isCurrent(epoch)) return startupFailure();
    try {
      const unsubscribe = options.maintenanceSource.subscribe((snapshot) => {
        if (!isCurrent(epoch)) return;
        acceptNotification(snapshot);
      });
      if (typeof unsubscribe !== "function") {
        throw new TypeError("maintenance subscription cleanup is required");
      }
      unsubscribeSource = unsubscribe;
    } catch {
      present({
        kind: "error",
        message: STARTUP_FAILURE_MESSAGE,
        recoverable: false,
      });
      return startupFailure();
    }
    if (!isCurrent(epoch)) return startupFailure();
    started = true;
    hostOwned = true;
    let result: Result<void, StartupError>;
    try {
      result = await host.start();
    } catch {
      started = false;
      if (isCurrent(epoch)) {
        present({
          kind: "error",
          message: STARTUP_FAILURE_MESSAGE,
          recoverable: false,
        });
      }
      await rollbackFailedStart();
      return startupFailure();
    }
    if (!result.ok) {
      started = false;
      await rollbackFailedStart();
      return result;
    }
    if (!isCurrent(epoch)) {
      started = false;
    }
    return result;
  };

  const startIntegration = (): Promise<Result<void, StartupError>> => {
    if (startPromise !== undefined) return startPromise;
    if (started) return Promise.resolve(ok(undefined));
    if (stopPromise !== undefined) {
      return stopPromise.then(startIntegration, () => startupFailure());
    }
    if (unsubscribeSource !== undefined || hostOwned) {
      return Promise.resolve(startupFailure());
    }
    stopped = false;
    const epoch = ++lifecycleEpoch;
    const pending = runStart(epoch);
    startPromise = pending;
    void pending.finally(() => {
      if (startPromise === pending) startPromise = undefined;
    });
    return pending;
  };

  const stopIntegration = (): Promise<void> => {
    if (stopPromise !== undefined) return stopPromise;
    if (
      stopped &&
      startPromise === undefined &&
      unsubscribeSource === undefined &&
      !hostOwned
    ) {
      return Promise.resolve();
    }
    stopped = true;
    started = false;
    lifecycleEpoch += 1;
    const pending = (async () => {
      const starting = startPromise;
      if (starting !== undefined) await starting.catch(() => undefined);
      await cleanupOwned();
    })();
    stopPromise = pending;
    void pending.then(
      () => {
        if (stopPromise === pending) stopPromise = undefined;
      },
      () => {
        if (stopPromise === pending) stopPromise = undefined;
      },
    );
    return pending;
  };

  return {
    operationPolicy,

    start: startIntegration,

    select(id: FeatureId): Promise<Result<void, SelectionError>> {
      return host.select(id);
    },

    stop: stopIntegration,
  };
}
