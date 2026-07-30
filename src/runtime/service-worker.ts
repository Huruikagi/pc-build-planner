import type {
  FeatureId,
  WorkerRegistrationContext,
} from "../application-shell/contracts.js";
import type { WorkerFeatureContribution } from "../application-shell/feature-contribution-catalog.js";
import { featureContributionCatalog } from "../application-shell/feature-contribution-catalog.js";
import {
  createDefaultProductionWorkerComposition,
  type ProductionFoundationInitializer,
  type ProductionWorkerComposition,
} from "../application-shell/production-worker-composition.js";
import {
  type ActivationId,
  parseTargetTabId,
  type TransientGestureRegistrationPort,
  type TransientGestureSource,
} from "../application-shell/transient-surface-ports.js";
import {
  type ActivationFailureSignal,
  createChromeActivationFailureSignal,
} from "./activation-failure-signal.js";
import { createCanonicalGestureIngress } from "./canonical-gesture-ingress.js";
import {
  createChromeFoundationMessageTarget,
  type FoundationMessageRuntime,
} from "./foundation-message-target.js";
import {
  type ChromeSidePanelOpenApi,
  createOpenSidePanelGestureHandler,
} from "./open-side-panel.js";
import { createActionGestureSource } from "./transient-action-gesture-source.js";
import {
  type ChromeSessionArea,
  createChromeTransientSessionStorage,
  createTransientActivationScheduler,
  createTransientActivationStore,
  resolveChromeTransientWorkerSession,
  type TransientActivationScheduler,
} from "./transient-activation-store.js";
import { registerTransientWatchReadyListener } from "./transient-activation-transport.js";
import { createTransientGestureRegistrar } from "./transient-gesture-registration.js";

const isActionMessage = (value: unknown, actionId: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  Object.hasOwn(value, "actionId") &&
  (value as { readonly actionId?: unknown }).actionId === actionId;

export const createChromeWorkerRegistrationContext = (
  runtime: FoundationMessageRuntime,
): WorkerRegistrationContext => ({
  addActionHandler(id, handler) {
    const listener = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (!isActionMessage(message, id)) return undefined;
      void Promise.resolve()
        .then(handler)
        .then(
          () => sendResponse({ ok: true }),
          () => sendResponse({ ok: false }),
        );
      return true as const;
    };
    runtime.onMessage.addListener(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      runtime.onMessage.removeListener(listener);
    };
  },
  reportError(message) {
    console.error(message);
  },
});

export const createProductionServiceWorkerBootstrap = (
  runtime: FoundationMessageRuntime,
  catalog: readonly WorkerFeatureContribution[] = featureContributionCatalog,
  initializeFoundation?: ProductionFoundationInitializer,
): ProductionWorkerComposition =>
  createDefaultProductionWorkerComposition({
    foundationTarget: createChromeFoundationMessageTarget(runtime),
    catalog,
    workerContext: createChromeWorkerRegistrationContext(runtime),
    ...(initializeFoundation ? { initializeFoundation } : {}),
  });

export const createTransientWorkerScheduler = (
  session: ChromeSessionArea,
): TransientActivationScheduler =>
  createTransientActivationScheduler(
    createTransientActivationStore(
      createChromeTransientSessionStorage(session),
    ),
  );

export const registerProductionTransientWatchReady = (
  runtime: FoundationMessageRuntime,
  session: ChromeSessionArea,
  scheduler: TransientActivationScheduler = createTransientWorkerScheduler(
    session,
  ),
): (() => void) => registerTransientWatchReadyListener(runtime, scheduler);

interface ChromeListenerEvent<T extends unknown[]> {
  addListener(listener: (...args: T) => void): void;
  removeListener(listener: (...args: T) => void): void;
}

export interface TransientWorkerRuntimeDependencies {
  readonly scheduler: TransientActivationScheduler;
  readonly action: {
    readonly onClicked: ChromeListenerEvent<[tab: { readonly id?: number }]>;
  };
  readonly tabs: {
    readonly onUpdated: ChromeListenerEvent<
      [tabId: number, changeInfo: { readonly status?: string }]
    >;
    readonly onRemoved: ChromeListenerEvent<[tabId: number]>;
  };
  readonly sidePanel: ChromeSidePanelOpenApi;
  readonly failureSignal: ActivationFailureSignal;
  readonly surfaceId?: FeatureId;
  readonly gestureSources?: readonly TransientGestureSource[];
  createActivationId(): ActivationId;
  reportDiagnostic?(code: string): void;
}

export const createTransientWorkerRuntimeBootstrap = (
  dependencies: TransientWorkerRuntimeDependencies,
): (() => Promise<void>) & {
  readonly gestureRegistration: TransientGestureRegistrationPort;
} => {
  let active = true;
  const report = dependencies.reportDiagnostic ?? (() => {});
  const registrar = createTransientGestureRegistrar({
    ingress: createCanonicalGestureIngress({
      scheduler: dependencies.scheduler,
      sidePanel: dependencies.sidePanel,
      failureSignal: dependencies.failureSignal,
      createActivationId: dependencies.createActivationId,
      reportDiagnostic: report,
    }),
  });
  registrar.start();
  const sources = [
    ...(dependencies.surfaceId === undefined
      ? []
      : [
          createActionGestureSource({
            action: dependencies.action,
            surfaceId: dependencies.surfaceId,
          }),
        ]),
    ...(dependencies.gestureSources ?? []),
  ];
  for (const source of sources) {
    const registered = registrar.register(source);
    if (!registered.ok) report(registered.error.kind);
  }
  const invalidate = (tabId: number) => {
    if (!active) return;
    const parsed = parseTargetTabId(tabId);
    if (!parsed.ok) return;
    void dependencies.scheduler.invalidate(parsed.value).then((result) => {
      if (!result.ok) report(result.error.kind);
    });
  };
  const onUpdated = (
    tabId: number,
    changeInfo: { readonly status?: string },
  ) => {
    if (changeInfo.status === "loading") invalidate(tabId);
  };
  const onRemoved = (tabId: number) => invalidate(tabId);
  dependencies.tabs.onUpdated.addListener(onUpdated);
  dependencies.tabs.onRemoved.addListener(onRemoved);
  const cleanup = async () => {
    if (!active) return;
    active = false;
    const errors: unknown[] = [];
    const release = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        errors.push(error);
      }
    };
    release(() => registrar.stop());
    release(() => dependencies.tabs.onUpdated.removeListener(onUpdated));
    release(() => dependencies.tabs.onRemoved.removeListener(onRemoved));
    try {
      await dependencies.scheduler.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0)
      throw new AggregateError(errors, "transient worker cleanup failed");
  };
  return Object.assign(cleanup, { gestureRegistration: registrar });
};

export interface ChromeProductionTransientRuntime
  extends FoundationMessageRuntime {
  getManifest(): {
    readonly name?: string;
    readonly action?: { readonly default_title?: string };
  };
}

export interface ChromeProductionTransientApis {
  readonly storage: { readonly session: ChromeSessionArea };
  readonly action: TransientWorkerRuntimeDependencies["action"] &
    Parameters<typeof createChromeActivationFailureSignal>[0]["action"];
  readonly tabs: TransientWorkerRuntimeDependencies["tabs"];
  readonly sidePanel: ChromeSidePanelOpenApi;
}

export const createProductionTransientRuntimeBootstrap = (
  runtime: ChromeProductionTransientRuntime,
  chromeApis: ChromeProductionTransientApis,
  catalog: readonly WorkerFeatureContribution[] = featureContributionCatalog,
): {
  readonly scheduler: TransientActivationScheduler;
  readonly gestureRegistration: TransientGestureRegistrationPort;
  readonly hasTransientGesture: boolean;
  cleanup(): Promise<void>;
} => {
  const scheduler = createTransientWorkerScheduler(chromeApis.storage.session);
  const watchReadyCleanup = registerProductionTransientWatchReady(
    runtime,
    chromeApis.storage.session,
    scheduler,
  );
  const surfaceId = catalog.find(
    ({ transientSurfaceId }) => transientSurfaceId !== undefined,
  )?.transientSurfaceId;
  const runtimeBootstrap = createTransientWorkerRuntimeBootstrap({
    scheduler,
    action: chromeApis.action,
    tabs: chromeApis.tabs,
    sidePanel: chromeApis.sidePanel,
    failureSignal: createChromeActivationFailureSignal({
      action: chromeApis.action,
      runtime,
    }),
    ...(surfaceId === undefined ? {} : { surfaceId }),
    createActivationId: () => crypto.randomUUID() as ActivationId,
    reportDiagnostic: (code) => console.error(`transient-runtime: ${code}`),
  });
  let active = true;
  return {
    scheduler,
    gestureRegistration: runtimeBootstrap.gestureRegistration,
    hasTransientGesture: surfaceId !== undefined,
    async cleanup() {
      if (!active) return;
      active = false;
      const errors: unknown[] = [];
      for (const cleanup of [watchReadyCleanup, runtimeBootstrap]) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0)
        throw new AggregateError(
          errors,
          "production transient runtime cleanup failed",
        );
    },
  };
};

export interface ChromeActionClickRuntime {
  readonly action: {
    readonly onClicked: {
      addListener(listener: (tab: { readonly id?: number }) => void): void;
    };
  };
  readonly sidePanel: ChromeSidePanelOpenApi;
}

/**
 * Product capture's own retrigger is a normal in-panel button in the same
 * document (`data-capture-start`); this listener's only job is to get the
 * side panel open for the clicked tab under `activeTab`'s user-gesture
 * requirement. It must call `sidePanel.open` synchronously within the click,
 * per `createOpenSidePanelGestureHandler`'s own contract.
 */
export const createActionClickSidePanelBootstrap = (
  runtime: ChromeActionClickRuntime,
  reportError: (message: string) => void = () => {},
): void => {
  const openSidePanel = createOpenSidePanelGestureHandler(runtime.sidePanel);
  runtime.action.onClicked.addListener((tab) => {
    if (typeof tab.id !== "number") return;
    void openSidePanel({ tabId: tab.id }).then((result) => {
      if (!result.ok) reportError(result.error.message);
    });
  });
};

const runtime = typeof chrome !== "undefined" ? chrome.runtime : undefined;
const transientWorkerSession = resolveChromeTransientWorkerSession();
let productionTransientGestureRegistered = false;
if (
  runtime &&
  typeof runtime.id === "string" &&
  runtime.id.length > 0 &&
  typeof runtime.getURL === "function" &&
  runtime.onMessage &&
  typeof runtime.onMessage.addListener === "function" &&
  typeof runtime.onMessage.removeListener === "function"
) {
  if (
    typeof chrome !== "undefined" &&
    transientWorkerSession &&
    chrome.action &&
    typeof chrome.action.onClicked?.addListener === "function" &&
    typeof chrome.action.onClicked?.removeListener === "function" &&
    typeof chrome.action.setBadgeText === "function" &&
    typeof chrome.action.setTitle === "function" &&
    chrome.tabs &&
    typeof chrome.tabs.onUpdated?.addListener === "function" &&
    typeof chrome.tabs.onUpdated?.removeListener === "function" &&
    typeof chrome.tabs.onRemoved?.addListener === "function" &&
    typeof chrome.tabs.onRemoved?.removeListener === "function" &&
    chrome.sidePanel &&
    typeof chrome.sidePanel.open === "function" &&
    typeof runtime.getManifest === "function"
  ) {
    productionTransientGestureRegistered =
      createProductionTransientRuntimeBootstrap(
        runtime,
        {
          storage: { session: transientWorkerSession },
          action: chrome.action,
          tabs: chrome.tabs,
          sidePanel: chrome.sidePanel,
        },
        featureContributionCatalog,
      ).hasTransientGesture;
  }
  void createProductionServiceWorkerBootstrap(runtime).start();
}

if (
  typeof chrome !== "undefined" &&
  !productionTransientGestureRegistered &&
  chrome.action &&
  typeof chrome.action.onClicked?.addListener === "function" &&
  chrome.sidePanel &&
  typeof chrome.sidePanel.open === "function"
) {
  createActionClickSidePanelBootstrap(chrome, (message) =>
    console.error(message),
  );
}
