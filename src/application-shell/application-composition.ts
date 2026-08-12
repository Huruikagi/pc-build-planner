import { err, ok, type Result } from "../domain/public.js";
import {
  type BackupRestoreDataPort,
  type FoundationScopedDataPort,
  initializeProductionFoundationRuntimeContribution,
} from "../persistence/public.js";
import type {
  ProjectCatalogSource,
  ProjectContextCommandPort,
  ProjectContextPublicApi,
  ProjectContextReadPort,
  ProjectContextReplacementGuardPort,
} from "../project-context/public.js";
import { createProductionProjectContext } from "../project-context/runtime.js";
import { message } from "../ui-messages/public.js";
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
import { isPersistent } from "./contracts.js";
import type { FeatureCompositionContext } from "./feature-contribution-catalog.js";
import { createFeatureRegistry } from "./feature-registry.js";
import { createLateBoundLifecycle } from "./late-bound-lifecycle.js";
import { createMonotonicProjectReadBinding } from "./monotonic-project-read-binding.js";
import {
  createProjectContextShellAdapter,
  type ProjectContextShellHandle,
} from "./project-context-shell-adapter.js";
import { createPublicApiRegistry } from "./public-api-registry.js";
import type {
  ShellPresentationAdapter,
  ShellPresentationHandle,
} from "./shell-presentation.js";
import { createShellPresentation } from "./shell-presentation.js";
import {
  createSidePanelFeatureContributions,
  projectCatalogSourceFromSidePanelContributions,
  type SidePanelFeatureContributions,
} from "./side-panel-contributions.js";
import {
  createTransientSurfaceController,
  type TransientSurfaceController,
} from "./transient-surface-controller.js";
import { projectTransientNotice } from "./transient-surface-notice.js";
import { transientHandoffFailure } from "./transient-surface-ports.js";
import { composeWorkerContributions } from "./worker-composition.js";

export interface ProductionFoundationHandle {
  readonly maintenanceSource: MaintenanceSnapshotSource;
  readonly workerRegistrations: readonly ApplicationWorkerRegistration[];
  /** Scoped query and atomic root mutation port handed to feature composition. */
  readonly dataPort: FoundationScopedDataPort;
  /** backup/restore compositionだけへ供給する用途限定port。 */
  readonly backupRestoreDataPort: BackupRestoreDataPort;
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
    dependencies: {
      readonly backupRestoreData: BackupRestoreDataPort;
      readonly projectReplacementGuard: ProjectContextReplacementGuardPort;
      readonly projectRefresh: Pick<ProjectContextCommandPort, "refresh">;
      readonly projectGuards: ProjectContextPublicApi["guards"];
      readonly transientSurface: ReturnType<
        typeof createLateBoundLifecycle
      >["port"];
    },
  ) => ApplicationRuntimeContributions<TFeatures>;
  /** Owner-provided typed catalog source; composition never inspects feature APIs. */
  readonly createProjectCatalogSource?: (
    features: TFeatures,
  ) => ProjectCatalogSource;
  readonly presentation: ShellPresentationAdapter;
  readonly workerContext: WorkerRegistrationContext;
  readonly reportError: (message: string) => void;
  readonly createProjectContextAdapter?: typeof createProjectContextShellAdapter;
  readonly createTransientMonitoring?: (
    controller: Pick<
      TransientSurfaceController,
      "request" | "dismiss" | "getSnapshot"
    >,
    notices: {
      sessionReadFailed(): void;
      sessionReadSucceeded(): void;
      activationAccepted(): void;
      activationExpired(): void;
    },
  ) => {
    start(): Promise<Result<void, { readonly kind: string }>>;
    stop(): void;
  };
}

export type ApplicationContributionDependencies = Parameters<
  ProductionApplicationCompositionOptions<
    readonly CompositionFeature[]
  >["createContributions"]
>[1];

const STARTUP_ERROR = message("shell.startupFailed");

export function createProductionSidePanelComposition(
  shellContainer: HTMLElement,
  extensions: Pick<
    ProductionApplicationCompositionOptions<SidePanelFeatureContributions>,
    "createTransientMonitoring"
  > = {},
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
        backupRestoreDataPort: initialized.value.backupRestoreDataPort,
        dispose: () => initialized.value.dispose(),
      });
    },
    createContributions: (context, dependencies) => ({
      features: createSidePanelFeatureContributions(
        context,
        dependencies,
        typeof chrome !== "undefined" && chrome.tabs && chrome.scripting
          ? { tabs: chrome.tabs, scripting: chrome.scripting }
          : undefined,
      ) as unknown as SidePanelFeatureContributions,
      workerRegistrations: [],
    }),
    createProjectCatalogSource: projectCatalogSourceFromSidePanelContributions,
    presentation: createShellPresentation(),
    workerContext: {
      addActionHandler() {
        throw new Error("Side panel does not own worker handlers.");
      },
      reportError: (message) => console.error(message),
    },
    reportError: (message) => console.error(message),
    ...extensions,
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
    const backupRestoreDataPort = candidate.backupRestoreDataPort;
    if (
      typeof backupRestoreDataPort !== "object" ||
      backupRestoreDataPort === null ||
      typeof (backupRestoreDataPort as Record<string, unknown>)
        .assessReplacement !== "function" ||
      typeof (backupRestoreDataPort as Record<string, unknown>)
        .assessRecovery !== "function" ||
      typeof (backupRestoreDataPort as Record<string, unknown>).commit !==
        "function" ||
      typeof (backupRestoreDataPort as Record<string, unknown>)
        .findPendingFinalization !== "function" ||
      typeof (backupRestoreDataPort as Record<string, unknown>).finalize !==
        "function"
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
  const lateBoundLifecycle = createLateBoundLifecycle();
  let transientController: TransientSurfaceController | undefined;
  let projectContextHandle: ProjectContextShellHandle | undefined;
  let transientMonitoring:
    | ReturnType<NonNullable<typeof options.createTransientMonitoring>>
    | undefined;
  let latestShellState: ShellViewState | undefined;
  let transientNotice: "activation-failed" | "activation-expired" | undefined;
  let retryStartup: () => void = () => undefined;
  const unavailableProjectSnapshot: ReturnType<
    ProjectContextReadPort["getSnapshot"]
  > = {
    status: "unavailable",
    generation: 0,
    selectedProjectId: null,
    reason: "not-initialized",
  };
  const projectReadBinding = createMonotonicProjectReadBinding(
    unavailableProjectSnapshot,
  );
  const projectRead = projectReadBinding.read;

  /**
   * Feature contributions are composed before project-context exists, and the
   * project surface can stay unmounted entirely. Backup/restore therefore
   * receives late-bound replacement and refresh capabilities: once bound they
   * delegate to the real ports, and while unbound they report that there is no
   * draft owner to protect and no selection to re-validate. That keeps the
   * settings section mountable, and recovery restores runnable, even when the
   * current project is unavailable.
   */
  let boundReplacementGuard: ProjectContextReplacementGuardPort | undefined;
  let boundProjectCommands: ProjectContextCommandPort | undefined;
  let boundProjectGuards: ProjectContextPublicApi["guards"] | undefined;
  let detachedPermitSerial = 0;
  const projectReplacementGuard: ProjectContextReplacementGuardPort = {
    prepare: () =>
      boundReplacementGuard?.prepare() ??
      Promise.resolve(
        ok({
          kind: "permitted" as const,
          permit: {
            id: `detached-replacement-${++detachedPermitSerial}`,
            baseGeneration: 0,
            registryRevision: 0,
          },
        }),
      ),
    confirm: (confirmationId) =>
      boundReplacementGuard?.confirm(confirmationId) ??
      Promise.resolve(err({ kind: "confirmation-stale" as const })),
    cancel: (confirmationId) =>
      boundReplacementGuard?.cancel(confirmationId) ??
      err({ kind: "confirmation-stale" as const }),
    begin: (permitId) =>
      boundReplacementGuard?.begin(permitId) ?? ok(undefined),
    complete: (permitId, outcome) =>
      boundReplacementGuard?.complete(permitId, outcome) ??
      Promise.resolve(ok(undefined)),
  };
  const projectRefresh: Pick<ProjectContextCommandPort, "refresh"> = {
    refresh: () =>
      boundProjectCommands?.refresh() ??
      Promise.resolve(err({ kind: "context-unavailable" as const })),
  };
  const projectGuards: ProjectContextPublicApi["guards"] = {
    register: (guard) =>
      boundProjectGuards?.register(guard) ?? err({ kind: "duplicate-guard" }),
  };
  const bindProjectCommands = (
    api: Pick<
      ProjectContextPublicApi,
      "commands" | "guards" | "replacementGuard"
    >,
  ): void => {
    boundProjectCommands = api.commands;
    boundReplacementGuard = api.replacementGuard;
    boundProjectGuards = api.guards;
  };
  const unbindProjectCommands = (): void => {
    boundProjectCommands = undefined;
    boundReplacementGuard = undefined;
    boundProjectGuards = undefined;
  };

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
    if (transientMonitoring) {
      const owned = transientMonitoring;
      try {
        owned.stop();
        if (transientMonitoring === owned) transientMonitoring = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (stopWorkers) {
      const owned = stopWorkers;
      try {
        owned();
        if (stopWorkers === owned) stopWorkers = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (transientController) {
      const owned = transientController;
      try {
        await owned.stop();
        if (transientController === owned) transientController = undefined;
      } catch (error: unknown) {
        failures.push(error);
      } finally {
        lateBoundLifecycle.unbind();
      }
    } else {
      lateBoundLifecycle.unbind();
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
    if (projectContextHandle) {
      const owned = projectContextHandle;
      try {
        await owned.stop();
        if (projectContextHandle === owned) projectContextHandle = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    try {
      projectReadBinding.unbind();
    } catch (error: unknown) {
      failures.push(error);
    }
    unbindProjectCommands();
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
        { kind: "error", message: STARTUP_ERROR, recoverable: true },
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
        const controller = transientController;
        if (controller) {
          void controller.selectPersistent(id);
          return;
        }
        void navigationTarget?.select(id);
      },
      onRetry() {
        if (transientController?.getSnapshot().kind === "dismiss-failed") {
          void transientController.retryDismiss();
          return;
        }
        if (navigationTarget) {
          void navigationTarget.start();
          return;
        }
        retryStartup();
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
        projectContext: projectRead,
      };
      let contributions: ApplicationRuntimeContributions<TFeatures>;
      try {
        contributions = options.createContributions(compositionContext, {
          backupRestoreData: validatedFoundation.backupRestoreDataPort,
          projectReplacementGuard,
          projectRefresh,
          projectGuards,
          transientSurface: lateBoundLifecycle.port,
        });
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
      const projectCatalogSource = options.createProjectCatalogSource?.(
        contributions.features,
      );
      if (projectCatalogSource && presentation.projectContainer) {
        const projectContext =
          createProductionProjectContext(projectCatalogSource);
        await projectContext.initialize();
        bindProjectCommands(projectContext.api);
        const mountedProjectContext = (
          options.createProjectContextAdapter ??
          createProjectContextShellAdapter
        )().mount({
          container: presentation.projectContainer,
          read: projectContext.api.read,
          commands: projectContext.api.commands,
          presentation: projectContext.presentation,
          publishAvailability() {
            projectReadBinding.publish(projectContext.api.read.getSnapshot());
          },
        });
        if (mountedProjectContext.ok) {
          projectContextHandle = mountedProjectContext.value;
        } else {
          projectReadBinding.publish({
            status: "unavailable",
            generation: projectRead.getSnapshot().generation + 1,
            selectedProjectId: null,
            reason: "not-initialized",
          });
          diagnose("project context presentation mount failed");
        }
      }

      const publish = (state: ShellViewState): void => {
        const projectedState = transientNotice
          ? projectTransientNotice(
              state,
              transientNotice === "activation-failed"
                ? {
                    kind: "session-read-failed",
                    message: message("shell.transientActivationFailed"),
                  }
                : {
                    kind: "activation-expired",
                    message: message("shell.transientActivationExpired"),
                  },
            )
          : state;
        latestShellState = projectedState;
        const navigation = createdRegistry
          .snapshot()
          .filter(isPersistent)
          .map((feature) => ({
            id: feature.id,
            labelKey: feature.navigation.labelKey,
            ...(feature.navigation.icon === undefined
              ? {}
              : { icon: feature.navigation.icon }),
            available: feature.getAvailability().status === "available",
            selected:
              (projectedState.kind === "ready" ||
                projectedState.kind === "maintenance") &&
              projectedState.selected === feature.id,
          }));
        presentation?.publish(projectedState, navigation);
      };
      integration = createApplicationShellIntegration({
        registry: createdRegistry,
        container: presentation.featureContainer,
        maintenanceSource: foundation.maintenanceSource,
        onStateChange: publish,
        reportError: options.reportError,
      });
      navigationTarget = integration;
      const controller = createTransientSurfaceController({
        host: {
          getSelected: () => integration?.getSelected?.() ?? null,
          isTransientAvailable: (surfaceId) => {
            const feature = createdRegistry
              .snapshot()
              .find(({ id }) => id === surfaceId);
            return (
              feature !== undefined &&
              !isPersistent(feature) &&
              feature.getAvailability().status === "available"
            );
          },
          async showTransient(request) {
            const result = await integration?.showTransient?.(request);
            return result?.ok
              ? ok(undefined)
              : err({ kind: "transition-failed" });
          },
          async restorePersistent(preferred, reason) {
            const result = await integration?.restorePersistent?.(
              preferred,
              reason,
            );
            if (
              result?.ok &&
              reason === "capture-invalidated" &&
              latestShellState
            ) {
              transientNotice = "activation-expired";
              latestShellState = projectTransientNotice(latestShellState, {
                kind: "activation-expired",
                message: message("shell.transientActivationExpired"),
              });
              publish(latestShellState);
            }
            return result?.ok
              ? ok(undefined)
              : err({ kind: "transition-failed" });
          },
          async activate(intent) {
            const result = await integration?.activate?.(intent);
            return result?.ok
              ? ok(undefined)
              : err(transientHandoffFailure(result?.error));
          },
        },
      });
      transientController = controller;
      lateBoundLifecycle.bind(controller);
      const hostStarted = await integration.start();
      if (stale()) return rollbackStaleStart();
      if (!hostStarted.ok) {
        publishError();
        await cleanup().catch(() => diagnose("host rollback failed"));
        return err({ kind: "startup_failed", message: STARTUP_ERROR });
      }
      const controllerStarted = await controller.start();
      if (!controllerStarted.ok) {
        publishError();
        await cleanup().catch(() => diagnose("controller rollback failed"));
        return err({ kind: "startup_failed", message: STARTUP_ERROR });
      }
      if (options.createTransientMonitoring) {
        const projectNotice = (
          kind:
            | "session-read-failed"
            | "session-read-succeeded"
            | "activation-accepted"
            | "activation-expired",
        ) => {
          if (!latestShellState) return;
          if (kind === "session-read-failed")
            transientNotice = "activation-failed";
          else if (kind === "activation-expired")
            transientNotice = "activation-expired";
          else transientNotice = undefined;
          latestShellState = projectTransientNotice(
            latestShellState,
            kind === "session-read-failed"
              ? {
                  kind,
                  message: message("shell.transientActivationFailed"),
                }
              : kind === "activation-expired"
                ? {
                    kind,
                    message: message("shell.transientActivationExpired"),
                  }
                : { kind },
          );
          publish(latestShellState);
        };
        const monitoring = options.createTransientMonitoring(controller, {
          sessionReadFailed: () => projectNotice("session-read-failed"),
          sessionReadSucceeded: () => projectNotice("session-read-succeeded"),
          activationAccepted: () => projectNotice("activation-accepted"),
          activationExpired: () => projectNotice("activation-expired"),
        });
        transientMonitoring = monitoring;
        const monitoringStarted = await monitoring.start();
        if (!monitoringStarted.ok) {
          publishError();
          await cleanup().catch(() => diagnose("monitoring rollback failed"));
          return err({ kind: "startup_failed", message: STARTUP_ERROR });
        }
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

  const root: ApplicationCompositionRoot<RootApi> = {
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
  retryStartup = () => {
    void root.start();
  };
  return root;
}
