import type { WorkerRegistrationContext } from "../application-shell/contracts.js";
import type { FeatureContribution } from "../application-shell/feature-contribution-catalog.js";
import { featureContributionCatalog } from "../application-shell/feature-contribution-catalog.js";
import {
  createProductionWorkerComposition,
  type ProductionWorkerComposition,
  type ProductionWorkerCompositionOptions,
} from "../application-shell/production-worker-composition.js";
import { initializeProductionFoundationRuntimeContribution } from "../persistence/public.js";
import {
  createChromeFoundationMessageTarget,
  type FoundationMessageRuntime,
} from "./foundation-message-target.js";

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
  initializeFoundation: ProductionWorkerCompositionOptions["initializeFoundation"] = initializeProductionFoundationRuntimeContribution,
): ProductionWorkerComposition =>
  createProductionWorkerComposition({
    initializeFoundation,
    foundationTarget: createChromeFoundationMessageTarget(runtime),
    catalog,
    workerContext: createChromeWorkerRegistrationContext(runtime),
  });

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
