import type {
  RegistrationError,
  WorkerRegistrationContext,
} from "../application-shell/contracts.js";
import type { FeatureContribution } from "../application-shell/feature-contribution-catalog.js";
import {
  featureContributionCatalog,
  getWorkerContributions,
} from "../application-shell/feature-contribution-catalog.js";
import { composeWorkerContributions } from "../application-shell/worker-composition.js";
import type { Result } from "../domain/public.js";

export interface CatalogWorkerBootstrap {
  start(): Promise<Result<void, RegistrationError>>;
  stop(): Promise<void>;
}

export function createCatalogWorkerBootstrap<
  const TCatalog extends readonly FeatureContribution[],
>(
  catalog: TCatalog,
  context: WorkerRegistrationContext,
): CatalogWorkerBootstrap {
  let startPromise: Promise<Result<void, RegistrationError>> | undefined;
  let stopPromise: Promise<void> | undefined;
  let remove: (() => void) | undefined;

  return {
    start() {
      startPromise ??= Promise.resolve().then(() => {
        const composed = composeWorkerContributions(
          getWorkerContributions(catalog),
          context,
        );
        if (!composed.ok) return composed;
        remove = composed.value;
        return { ok: true, value: undefined };
      });
      return startPromise;
    },
    stop() {
      stopPromise ??= Promise.resolve().then(() => {
        remove?.();
        remove = undefined;
      });
      return stopPromise;
    },
  };
}

function isActionMessage(value: unknown, actionId: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "actionId") &&
    (value as { readonly actionId?: unknown }).actionId === actionId
  );
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const bootstrap = createCatalogWorkerBootstrap(featureContributionCatalog, {
    addActionHandler(id, handler) {
      const listener = (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ): boolean | undefined => {
        if (!isActionMessage(message, id)) return undefined;
        void handler().then(
          () => sendResponse({ ok: true }),
          () => sendResponse({ ok: false }),
        );
        return true;
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    },
    reportError(message) {
      console.error(message);
    },
  });
  void bootstrap.start();
}
