import type {
  FeatureId,
  WorkerRegistrationContext,
} from "../application-shell/contracts.js";
import type { FeatureContribution } from "../application-shell/feature-contribution-catalog.js";
import { featureContributionCatalog } from "../application-shell/feature-contribution-catalog.js";
import {
  createDefaultProductionWorkerComposition,
  type ProductionFoundationInitializer,
  type ProductionWorkerComposition,
} from "../application-shell/production-worker-composition.js";
import {
  type ActivationId,
  parseTargetTabId,
} from "../application-shell/transient-surface-ports.js";
import {
  type ActivationFailureSignal,
  createChromeActivationFailureSignal,
} from "./activation-failure-signal.js";
import {
  createChromeFoundationMessageTarget,
  type FoundationMessageRuntime,
} from "./foundation-message-target.js";
import {
  type ChromeSidePanelOpenApi,
  createOpenSidePanelGestureHandler,
} from "./open-side-panel.js";
import {
  type ChromeSessionArea,
  createChromeTransientSessionStorage,
  createTransientActivationScheduler,
  createTransientActivationStore,
  type TransientActivationScheduler,
} from "./transient-activation-store.js";
import { registerTransientWatchReadyListener } from "./transient-activation-transport.js";

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
  catalog: readonly FeatureContribution[] = featureContributionCatalog,
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
  createActivationId(): ActivationId;
  reportDiagnostic?(code: string): void;
}

export const createTransientWorkerRuntimeBootstrap = (
  dependencies: TransientWorkerRuntimeDependencies,
): (() => void) => {
  let active = true;
  const report = dependencies.reportDiagnostic ?? (() => {});
  const onClicked = (tab: { readonly id?: number }) => {
    if (!active) return;
    if (dependencies.surfaceId === undefined) return;
    const parsed = parseTargetTabId(tab.id);
    if (!parsed.ok) return;
    const activationId = dependencies.createActivationId();
    const persisted = dependencies.scheduler.put({
      activationId,
      surfaceId: dependencies.surfaceId,
      tabId: parsed.value,
    });
    void dependencies.scheduler.enqueue(async () => {
      const result = await persisted;
      const signaled = result.ok
        ? await dependencies.failureSignal.onDurablePutSucceeded()
        : await dependencies.failureSignal.publish();
      if (!signaled.ok) report(signaled.error.kind);
    });
    void dependencies.sidePanel
      .open({ tabId: parsed.value })
      .catch(() => report("side-panel-open-failed"));
  };
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
  if (dependencies.surfaceId !== undefined)
    dependencies.action.onClicked.addListener(onClicked);
  dependencies.tabs.onUpdated.addListener(onUpdated);
  dependencies.tabs.onRemoved.addListener(onRemoved);
  return () => {
    if (!active) return;
    active = false;
    if (dependencies.surfaceId !== undefined)
      dependencies.action.onClicked.removeListener(onClicked);
    dependencies.tabs.onUpdated.removeListener(onUpdated);
    dependencies.tabs.onRemoved.removeListener(onRemoved);
  };
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
  catalog: readonly FeatureContribution[] = featureContributionCatalog,
): {
  readonly scheduler: TransientActivationScheduler;
  readonly hasTransientGesture: boolean;
  cleanup(): void;
} => {
  const scheduler = createTransientWorkerScheduler(chromeApis.storage.session);
  const cleanups = [
    registerProductionTransientWatchReady(
      runtime,
      chromeApis.storage.session,
      scheduler,
    ),
  ];
  const transient = catalog.find(
    ({ registration }) => registration.presentation === "transient",
  );
  cleanups.push(
    createTransientWorkerRuntimeBootstrap({
      scheduler,
      action: chromeApis.action,
      tabs: chromeApis.tabs,
      sidePanel: chromeApis.sidePanel,
      failureSignal: createChromeActivationFailureSignal({
        action: chromeApis.action,
        runtime,
      }),
      ...(transient === undefined
        ? {}
        : { surfaceId: transient.registration.id }),
      createActivationId: () => crypto.randomUUID() as ActivationId,
      reportDiagnostic: (code) => console.error(`transient-runtime: ${code}`),
    }),
  );
  let active = true;
  return {
    scheduler,
    hasTransientGesture: transient !== undefined,
    cleanup() {
      if (!active) return;
      active = false;
      for (const cleanup of [...cleanups].reverse()) cleanup();
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
    chrome.storage?.session &&
    typeof chrome.storage.session.get === "function" &&
    typeof chrome.storage.session.set === "function" &&
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
      createProductionTransientRuntimeBootstrap(runtime, {
        storage: { session: chrome.storage.session },
        action: chrome.action,
        tabs: chrome.tabs,
        sidePanel: chrome.sidePanel,
      }).hasTransientGesture;
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
