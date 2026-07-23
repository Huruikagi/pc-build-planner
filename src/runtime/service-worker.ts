import type { WorkerRegistrationContext } from "../application-shell/contracts.js";
import type { FeatureContribution } from "../application-shell/feature-contribution-catalog.js";
import { featureContributionCatalog } from "../application-shell/feature-contribution-catalog.js";
import {
  createDefaultProductionWorkerComposition,
  type ProductionFoundationInitializer,
  type ProductionWorkerComposition,
} from "../application-shell/production-worker-composition.js";
import {
  createChromeFoundationMessageTarget,
  type FoundationMessageRuntime,
} from "./foundation-message-target.js";
import {
  type ChromeSidePanelOpenApi,
  createOpenSidePanelGestureHandler,
} from "./open-side-panel.js";

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
if (
  runtime &&
  typeof runtime.id === "string" &&
  runtime.id.length > 0 &&
  typeof runtime.getURL === "function" &&
  runtime.onMessage &&
  typeof runtime.onMessage.addListener === "function" &&
  typeof runtime.onMessage.removeListener === "function"
) {
  void createProductionServiceWorkerBootstrap(runtime).start();
}

if (
  typeof chrome !== "undefined" &&
  chrome.action &&
  typeof chrome.action.onClicked?.addListener === "function" &&
  chrome.sidePanel &&
  typeof chrome.sidePanel.open === "function"
) {
  createActionClickSidePanelBootstrap(chrome, (message) =>
    console.error(message),
  );
}
