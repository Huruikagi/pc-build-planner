import { err, ok, type Result } from "../domain/public.js";
import {
  type FoundationScopedDataPort,
  initializeProductionFoundationRuntimeContribution,
} from "../persistence/public.js";
import {
  type ApplicationShellIntegration,
  createApplicationShellIntegration,
} from "./application-shell-integration.js";
import type {
  CompositionFeature,
  CompositionRootApi,
} from "./composition-root.js";
import type {
  ApplicationCompositionRoot,
  ApplicationWorkerRegistration,
  CompositionError,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
  FeatureRegistry,
  MaintenanceSnapshotSource,
  ShellNavigator,
  ShellViewState,
  WorkerRegistrationContext,
} from "./contracts.js";
import type { FeatureCompositionContext } from "./feature-contribution-catalog.js";
import { getSidePanelContributions } from "./feature-contribution-catalog.js";
import { createFeatureRegistry } from "./feature-registry.js";
import { createPublicApiRegistry } from "./public-api-registry.js";
import type {
  ShellPresentationAdapter,
  ShellPresentationHandle,
} from "./shell-presentation.js";
import { createShellPresentation } from "./shell-presentation.js";
import {
  createSidePanelFeatureContributions,
  type SidePanelFeatureContributions,
} from "./side-panel-contributions.js";
import { composeWorkerContributions } from "./worker-composition.js";

export interface ProductionFoundationHandle {
  readonly maintenanceSource: MaintenanceSnapshotSource;
  readonly workerRegistrations: readonly ApplicationWorkerRegistration[];
  /** Scoped query and atomic root mutation port handed to feature composition. */
  readonly dataPort: FoundationScopedDataPort;
  dispose(): void | Promise<void>;
}

export interface ApplicationRuntimeContributions<
  TFeatures extends readonly CompositionFeature[],
> {
  readonly features: TFeatures;
  readonly workerRegistrations: readonly ApplicationWorkerRegistration[];
}

export interface ProductionApplicationCompositionOptions<
  TFeatures extends readonly CompositionFeature[],
> {
  readonly shellContainer: HTMLElement;
  readonly initializeFoundation: () => Promise<
    Result<ProductionFoundationHandle, { readonly code: string }>
  >;
  /** Features are built after the foundation resolves, from the composed context. */
  readonly createContributions: (
    context: FeatureCompositionContext,
  ) => ApplicationRuntimeContributions<TFeatures>;
  readonly presentation: ShellPresentationAdapter;
  readonly workerContext: WorkerRegistrationContext;
  readonly reportError: (message: string) => void;
}

const STARTUP_ERROR = "アプリケーションを開始できませんでした";

export function createProductionSidePanelComposition(
  shellContainer: HTMLElement,
): ApplicationCompositionRoot<
  CompositionRootApi<SidePanelFeatureContributions>
> {
  return createProductionApplicationComposition({
    shellContainer,
    initializeFoundation: async () => {
      const initialized =
        await initializeProductionFoundationRuntimeContribution();
      if (!initialized.ok) return initialized;
      return ok({
        maintenanceSource: initialized.value.maintenanceSource,
        workerRegistrations: [],
        dataPort: initialized.value.dataPort,
        dispose: () => initialized.value.dispose(),
      });
    },
    createContributions: (context) => ({
      features: getSidePanelContributions(
        createSidePanelFeatureContributions(
          context,
          typeof chrome !== "undefined" && chrome.tabs && chrome.scripting
            ? { tabs: chrome.tabs, scripting: chrome.scripting }
            : undefined,
        ),
      ) as unknown as SidePanelFeatureContributions,
      workerRegistrations: [],
    }),
    presentation: createShellPresentation(),
    workerContext: {
      addActionHandler() {
        throw new Error("Side panel does not own worker handlers.");
      },
      reportError: (message) => console.error(message),
    },
    reportError: (message) => console.error(message),
  });
}

function validateFoundationHandle(
  value: unknown,
): ProductionFoundationHandle | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const candidate = value as Record<string, unknown>;
    const maintenance = candidate.maintenanceSource;
    if (
      typeof maintenance !== "object" ||
      maintenance === null ||
      typeof (maintenance as Record<string, unknown>).getSnapshot !==
        "function" ||
      typeof (maintenance as Record<string, unknown>).subscribe !==
        "function" ||
      !Array.isArray(candidate.workerRegistrations) ||
      !candidate.workerRegistrations.every(
        (registration) =>
          typeof registration === "object" &&
          registration !== null &&
          typeof (registration as Record<string, unknown>).id === "string" &&
          typeof (registration as Record<string, unknown>).register ===
            "function",
      ) ||
      typeof candidate.dispose !== "function"
    )
      return undefined;
    const dataPort = candidate.dataPort;
    if (
      typeof dataPort !== "object" ||
      dataPort === null ||
      typeof (dataPort as Record<string, unknown>).query !== "function" ||
      typeof (dataPort as Record<string, unknown>).mutate !== "function"
    )
      return undefined;
    return value as ProductionFoundationHandle;
  } catch {
    return undefined;
  }
}

export function createProductionApplicationComposition<
  const TFeatures extends readonly CompositionFeature[],
>(
  options: ProductionApplicationCompositionOptions<TFeatures>,
): ApplicationCompositionRoot<CompositionRootApi<TFeatures>> {
  type RootApi = CompositionRootApi<TFeatures>;
  let foundation: ProductionFoundationHandle | undefined;
  let presentation: ShellPresentationHandle | undefined;
  let integration: ApplicationShellIntegration | undefined;
  let registry: FeatureRegistry | undefined;
  let navigationTarget: ApplicationShellIntegration | undefined;
  let presentationMountRejected = false;
  let stopWorkers: (() => void) | undefined;
  let api: RootApi | undefined;
  let startPromise:
    | Promise<Result<{ readonly api: RootApi }, CompositionError>>
    | undefined;
  let stopPromise: Promise<void> | undefined;
  let lifecycleEpoch = 0;
  let cleanupRequired = false;

  const diagnose = (message: string): void => {
    try {
      options.reportError(`application-composition: ${message}`);
    } catch {
      // Diagnostics are best-effort at the runtime boundary.
    }
  };

  /**
   * Features receive activation through this late-bound navigator so their
   * public API can be composed before the shell integration exists.
   */
  const shellNavigator: ShellNavigator = {
    activate(intent: FeatureActivationIntent) {
      if (!integration?.activate)
        return Promise.resolve(
          err<FeatureActivationError>({
            kind: "activation_failed",
            detail: "application shell is not started",
          }),
        );
      return integration.activate(intent);
    },
  };

  const cleanup = async (): Promise<void> => {
    const failures: unknown[] = [];
    if (stopWorkers) {
      const owned = stopWorkers;
      try {
        owned();
        if (stopWorkers === owned) stopWorkers = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (integration) {
      const owned = integration;
      try {
        await owned.stop();
        if (integration === owned) integration = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (registry) {
      const owned = registry;
      try {
        owned.dispose?.();
        if (registry === owned) registry = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (presentation) {
      const owned = presentation;
      try {
        owned.stop();
        if (presentation === owned) presentation = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (foundation) {
      const owned = foundation;
      try {
        await owned.dispose();
        if (foundation === owned) foundation = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    api = undefined;
    cleanupRequired = failures.length > 0;
    if (failures.length)
      throw new AggregateError(
        failures,
        "Production composition cleanup failed",
      );
  };

  const publishError = (): void => {
    try {
      presentation?.publish(
        { kind: "error", message: STARTUP_ERROR, recoverable: false },
        [],
      );
    } catch {
      diagnose("startup error presentation failed");
    }
  };

  const mountPresentationUnchecked = (): boolean => {
    if (presentation) return true;
    if (presentationMountRejected) return false;
    const mounted = options.presentation.mount({
      shellContainer: options.shellContainer,
      onNavigate(id: FeatureId) {
        void navigationTarget?.select(id);
      },
      onRetry() {
        void navigationTarget?.start();
      },
    });
    if (!mounted.ok) {
      presentationMountRejected = true;
      return false;
    }
    presentation = mounted.value;
    if (presentation.featureContainer === options.shellContainer) {
      presentationMountRejected = true;
      const rejected = presentation;
      try {
        rejected.stop();
        if (presentation === rejected) presentation = undefined;
      } catch {
        diagnose("rejected presentation cleanup failed");
      }
      return false;
    }
    return true;
  };

  const mountPresentation = (): boolean => {
    try {
      return mountPresentationUnchecked();
    } catch {
      presentationMountRejected = true;
      const rejected = presentation;
      if (rejected) {
        try {
          rejected.stop();
          if (presentation === rejected) presentation = undefined;
        } catch {
          diagnose("rejected presentation cleanup failed");
        }
      }
      return false;
    }
  };

  const hasOwnedCleanup = (): boolean =>
    cleanupRequired &&
    (foundation !== undefined ||
      registry !== undefined ||
      presentation !== undefined ||
      integration !== undefined ||
      stopWorkers !== undefined);

  const start = async (
    epoch: number,
  ): Promise<Result<{ readonly api: RootApi }, CompositionError>> => {
    const stale = (): boolean => epoch !== lifecycleEpoch;
    const rollbackStaleStart = async (): Promise<
      Result<{ readonly api: RootApi }, CompositionError>
    > => {
      await cleanup().catch(() => diagnose("stale startup rollback failed"));
      return err({ kind: "startup_failed", message: STARTUP_ERROR });
    };
    let initialized: Awaited<ReturnType<typeof options.initializeFoundation>>;
    try {
      initialized = await options.initializeFoundation();
    } catch {
      initialized = err({ code: "initializer_threw" });
    }
    let initializedOk = false;
    try {
      initializedOk =
        typeof initialized === "object" &&
        initialized !== null &&
        initialized.ok === true;
    } catch {
      initializedOk = false;
    }
    if (!initializedOk) {
      if (stale()) return rollbackStaleStart();
      if (mountPresentation()) publishError();
      return err({ kind: "startup_failed", message: STARTUP_ERROR });
    }
    let rawFoundation: unknown;
    try {
      rawFoundation = (initialized as { readonly value: unknown }).value;
    } catch {
      return err({ kind: "startup_failed", message: STARTUP_ERROR });
    }
    const validatedFoundation = validateFoundationHandle(rawFoundation);
    if (!validatedFoundation) {
      try {
        const disposer = (
          rawFoundation as { readonly dispose?: unknown } | null
        )?.dispose;
        if (typeof disposer === "function") await disposer.call(rawFoundation);
      } catch {
        diagnose("invalid foundation cleanup failed");
      }
      return err({ kind: "startup_failed", message: STARTUP_ERROR });
    }
    foundation = validatedFoundation;
    if (stale()) return rollbackStaleStart();
    try {
      const compositionContext: FeatureCompositionContext = {
        data: validatedFoundation.dataPort,
        navigator: shellNavigator,
      };
      let contributions: ApplicationRuntimeContributions<TFeatures>;
      try {
        contributions = options.createContributions(compositionContext);
      } catch {
        publishError();
        await cleanup().catch(() =>
          diagnose("feature composition rollback failed"),
        );
        return err({ kind: "startup_failed", message: STARTUP_ERROR });
      }
      const createdRegistry = createFeatureRegistry();
      registry = createdRegistry;
      for (const contribution of contributions.features) {
        const registered = createdRegistry.register(contribution.registration);
        if (!registered.ok) {
          createdRegistry.dispose?.();
          registry = undefined;
          await cleanup().catch(() => diagnose("registration rollback failed"));
          return err({ kind: "startup_failed", message: STARTUP_ERROR });
        }
      }
      const composed = createPublicApiRegistry().composeEntries(
        contributions.features.map(({ key, registration }) => ({
          key,
          publicApi: registration.publicApi,
        })),
      );
      if (!composed.ok || !mountPresentation() || !presentation) {
        createdRegistry.dispose?.();
        registry = undefined;
        await cleanup().catch(() => diagnose("presentation rollback failed"));
        return err({ kind: "startup_failed", message: STARTUP_ERROR });
      }

      const publish = (state: ShellViewState): void => {
        const navigation = createdRegistry.snapshot().map((feature) => ({
          id: feature.id,
          label: feature.navigation.label,
          ...(feature.navigation.icon === undefined
            ? {}
            : { icon: feature.navigation.icon }),
          available: feature.getAvailability().status === "available",
          selected:
            (state.kind === "ready" || state.kind === "maintenance") &&
            state.selected === feature.id,
        }));
        presentation?.publish(state, navigation);
      };
      integration = createApplicationShellIntegration({
        registry: createdRegistry,
        container: presentation.featureContainer,
        maintenanceSource: foundation.maintenanceSource,
        onStateChange: publish,
        reportError: options.reportError,
      });
      navigationTarget = integration;
      const hostStarted = await integration.start();
      if (stale()) return rollbackStaleStart();
      if (!hostStarted.ok) {
        publishError();
        await cleanup().catch(() => diagnose("host rollback failed"));
        return err({ kind: "startup_failed", message: STARTUP_ERROR });
      }
      const workers = composeWorkerContributions(
        [
          ...foundation.workerRegistrations,
          ...contributions.workerRegistrations,
        ],
        options.workerContext,
      );
      if (!workers.ok) {
        publishError();
        await cleanup().catch(() => diagnose("worker rollback failed"));
        return err({ kind: "startup_failed", message: STARTUP_ERROR });
      }
      stopWorkers = workers.value;
      api = composed.value as RootApi;
      return ok({ api });
    } catch {
      publishError();
      await cleanup().catch(() =>
        diagnose("startup exception rollback failed"),
      );
      return err({ kind: "startup_failed", message: STARTUP_ERROR });
    }
  };

  return {
    start() {
      if (stopPromise) {
        return stopPromise.then(
          () => this.start(),
          () => err({ kind: "startup_failed", message: STARTUP_ERROR }),
        );
      }
      if (api) return Promise.resolve(ok({ api }));
      if (startPromise) return startPromise;
      if (hasOwnedCleanup()) {
        return Promise.resolve(
          err({ kind: "startup_failed", message: STARTUP_ERROR }),
        );
      }
      const pending = start(++lifecycleEpoch);
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
        await startPromise?.catch(() => undefined);
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
