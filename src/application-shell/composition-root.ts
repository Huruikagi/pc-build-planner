import { err, ok, type Result } from "../domain/public.js";
import { type MessageDescriptor, message } from "../ui-messages/public.js";
import {
  type ApplicationShellIntegration,
  createApplicationShellIntegration,
} from "./application-shell-integration.js";
import type {
  ApplicationCompositionRoot,
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  CompositionError,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureRegistry,
  MaintenanceSnapshotSource,
  ShellViewState,
  WorkerRegistrationContext,
} from "./contracts.js";
import { createFeatureRegistry } from "./feature-registry.js";
import { createPublicApiRegistry } from "./public-api-registry.js";

export interface FoundationCompositionHandle {
  readonly maintenanceSource: MaintenanceSnapshotSource;
  dispose?(): void | Promise<void>;
}

export interface CompositionFeature<
  TKey extends string = string,
  TPublic extends object = object,
  TActivation = unknown,
> {
  readonly key: TKey;
  readonly registration: ApplicationFeatureRegistration<TPublic, TActivation>;
}

export interface CompositionFeatureRegistry extends FeatureRegistry {
  dispose(): void;
}

export interface CompositionRootOptions<
  TFeatures extends readonly CompositionFeature[],
> {
  readonly initializeFoundation: () => Promise<
    Result<FoundationCompositionHandle, { readonly message?: string }>
  >;
  readonly features: TFeatures;
  readonly workerRegistrations?: readonly ApplicationWorkerRegistration[];
  readonly workerContext?: WorkerRegistrationContext;
  readonly container: HTMLElement;
  readonly onStateChange: (state: ShellViewState) => void;
  readonly reportError: (message: string) => void;
  readonly createRegistry?: () => CompositionFeatureRegistry;
  readonly createIntegration?: (options: {
    readonly registry: FeatureRegistry;
    readonly container: HTMLElement;
    readonly maintenanceSource: MaintenanceSnapshotSource;
    readonly onStateChange: (state: ShellViewState) => void;
    readonly reportError: (message: string) => void;
  }) => ApplicationShellIntegration;
}

export type CompositionRootApi<T extends readonly CompositionFeature[]> =
  Readonly<{
    [TFeature in T[number] as TFeature["key"]]: TFeature["registration"]["publicApi"];
  }>;

const STARTUP_FAILED = message("shell.startupFailed");
const MISSING_DEPENDENCY = message("shell.missingDependency");

export function createCompositionRoot<
  const TFeatures extends readonly CompositionFeature[],
>(
  options: CompositionRootOptions<TFeatures>,
): ApplicationCompositionRoot<CompositionRootApi<TFeatures>> {
  type RootApi = CompositionRootApi<TFeatures>;
  let foundation: FoundationCompositionHandle | undefined;
  let registry: CompositionFeatureRegistry | undefined;
  let integration: ApplicationShellIntegration | undefined;
  const workerHandles: Array<() => void> = [];
  let api: RootApi | undefined;
  let startPromise:
    | Promise<Result<{ readonly api: RootApi }, CompositionError>>
    | undefined;
  let stopPromise: Promise<void> | undefined;
  let lifecycleEpoch = 0;

  const diagnose = (detail: string): void => {
    try {
      options.reportError(`composition-root: ${detail}`);
    } catch {
      // Diagnostics never interrupt lifecycle cleanup.
    }
  };

  const presentStartupError = (message: MessageDescriptor): void => {
    try {
      options.onStateChange({ kind: "error", message, recoverable: false });
    } catch {
      diagnose("state observer failed");
    }
  };

  const cleanup = async (): Promise<void> => {
    const failures: unknown[] = [];
    const ownedIntegration = integration;
    if (ownedIntegration) {
      try {
        await ownedIntegration.stop();
        if (integration === ownedIntegration) integration = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    for (let index = workerHandles.length - 1; index >= 0; index -= 1) {
      const remove = workerHandles[index];
      if (!remove) continue;
      try {
        remove();
        workerHandles.splice(index, 1);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    const ownedRegistry = registry;
    if (ownedRegistry) {
      try {
        ownedRegistry.dispose();
        if (registry === ownedRegistry) registry = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    const ownedFoundation = foundation;
    if (ownedFoundation) {
      try {
        await ownedFoundation.dispose?.();
        if (foundation === ownedFoundation) foundation = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    api = undefined;
    if (failures.length > 0) {
      throw new AggregateError(failures, "Composition root cleanup failed");
    }
  };

  const fail = async (
    kind: CompositionError["kind"],
    descriptor: MessageDescriptor,
  ): Promise<Result<{ readonly api: RootApi }, CompositionError>> => {
    presentStartupError(descriptor);
    try {
      await cleanup();
    } catch {
      diagnose("startup rollback failed; cleanup remains owned");
    }
    return err({ kind, message: descriptor });
  };

  const runStart = async (
    epoch: number,
  ): Promise<Result<{ readonly api: RootApi }, CompositionError>> => {
    const cancelled = (): boolean => epoch !== lifecycleEpoch;
    if (
      typeof options.initializeFoundation !== "function" ||
      !options.container ||
      !Array.isArray(options.features)
    ) {
      return fail("missing_dependency", MISSING_DEPENDENCY);
    }
    let initialized: Awaited<ReturnType<typeof options.initializeFoundation>>;
    try {
      initialized = await options.initializeFoundation();
    } catch {
      return fail("startup_failed", STARTUP_FAILED);
    }
    if (!initialized.ok) return fail("startup_failed", STARTUP_FAILED);
    if (!isFoundationHandle(initialized.value)) {
      return fail("missing_dependency", MISSING_DEPENDENCY);
    }
    foundation = initialized.value;
    if (cancelled()) return fail("startup_failed", STARTUP_FAILED);

    let candidateRegistry: unknown;
    try {
      candidateRegistry = (options.createRegistry ?? createFeatureRegistry)();
    } catch {
      return fail("missing_dependency", MISSING_DEPENDENCY);
    }
    if (!isCompositionFeatureRegistry(candidateRegistry)) {
      return fail("missing_dependency", MISSING_DEPENDENCY);
    }
    registry = candidateRegistry;
    for (const feature of options.features) {
      const registered = registry.register(feature.registration);
      if (!registered.ok) return fail("missing_dependency", MISSING_DEPENDENCY);
    }
    if (cancelled()) return fail("startup_failed", STARTUP_FAILED);

    const workers = options.workerRegistrations ?? [];
    if (workers.length > 0 && !options.workerContext) {
      return fail("missing_dependency", MISSING_DEPENDENCY);
    }
    const workerIds = new Set<string>();
    for (const worker of workers) {
      if (!worker?.id || workerIds.has(worker.id)) {
        return fail("missing_dependency", MISSING_DEPENDENCY);
      }
      workerIds.add(worker.id);
      let registered: ReturnType<ApplicationWorkerRegistration["register"]>;
      try {
        registered = worker.register(
          options.workerContext as WorkerRegistrationContext,
        );
      } catch {
        return fail("startup_failed", STARTUP_FAILED);
      }
      if (!registered.ok || typeof registered.value !== "function") {
        return fail("startup_failed", STARTUP_FAILED);
      }
      workerHandles.push(registered.value);
    }
    if (cancelled()) return fail("startup_failed", STARTUP_FAILED);

    const composed = createPublicApiRegistry().composeEntries(
      options.features.map(({ key, registration }) => ({
        key,
        publicApi: registration.publicApi,
      })),
    );
    if (!composed.ok) return fail("missing_dependency", MISSING_DEPENDENCY);
    api = composed.value as RootApi;
    if (cancelled()) return fail("startup_failed", STARTUP_FAILED);

    try {
      integration = (
        options.createIntegration ?? createApplicationShellIntegration
      )({
        registry,
        container: options.container,
        maintenanceSource: foundation.maintenanceSource,
        onStateChange: options.onStateChange,
        reportError: options.reportError,
      });
      const started = await integration.start();
      if (!started.ok) return fail("startup_failed", STARTUP_FAILED);
      if (cancelled()) return fail("startup_failed", STARTUP_FAILED);
    } catch {
      return fail("startup_failed", STARTUP_FAILED);
    }
    return ok({ api });
  };

  return {
    start() {
      if (stopPromise) {
        return stopPromise.then(
          () => this.start(),
          () =>
            err({
              kind: "startup_failed",
              message: STARTUP_FAILED,
            }),
        );
      }
      if (api && integration) return Promise.resolve(ok({ api }));
      if (startPromise) return startPromise;
      if (foundation || registry || integration || workerHandles.length > 0) {
        return Promise.resolve(
          err({ kind: "startup_failed", message: STARTUP_FAILED }),
        );
      }
      const pending = runStart(++lifecycleEpoch).catch(() =>
        fail("startup_failed", STARTUP_FAILED),
      );
      startPromise = pending;
      void pending.then(
        () => {
          if (startPromise === pending) startPromise = undefined;
        },
        () => {
          if (startPromise === pending) startPromise = undefined;
        },
      );
      return pending;
    },

    activate(
      intent: FeatureActivationIntent,
    ): Promise<Result<void, FeatureActivationError>> {
      if (!integration)
        return Promise.resolve(
          err({
            kind: "activation_failed",
            detail: "application shell is not started",
          }),
        );
      if (!integration.activate)
        return Promise.resolve(
          err({
            kind: "activation_failed",
            detail: "activation is unavailable",
          }),
        );
      return integration.activate(intent);
    },

    stop() {
      if (stopPromise) return stopPromise;
      lifecycleEpoch += 1;
      const pending = (async () => {
        const starting = startPromise;
        if (starting) await starting.catch(() => undefined);
        await cleanup();
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
    },
  };
}

function isFoundationHandle(
  value: unknown,
): value is FoundationCompositionHandle {
  if (typeof value !== "object" || value === null) return false;
  const source = (value as { maintenanceSource?: unknown }).maintenanceSource;
  if (typeof source !== "object" || source === null) return false;
  const candidate = source as Partial<MaintenanceSnapshotSource>;
  return (
    typeof candidate.getSnapshot === "function" &&
    typeof candidate.subscribe === "function" &&
    (!("dispose" in value) ||
      typeof (value as { dispose?: unknown }).dispose === "function")
  );
}

function isCompositionFeatureRegistry(
  value: unknown,
): value is CompositionFeatureRegistry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FeatureRegistry>;
  return (
    typeof candidate.register === "function" &&
    typeof candidate.snapshot === "function" &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.dispose === "function"
  );
}
