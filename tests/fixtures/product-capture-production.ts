import type { TargetTabId } from "../../src/application-shell/public.js";
import type { ChromeCaptureRuntimeDependencies } from "../../src/features/product-capture/chrome-runtime-port.js";

interface ProductionCaptureFixtureOptions {
  readonly grantedTabId: TargetTabId | null;
  readonly pageUrl: string;
}

/** Chrome-shaped fixture for the production activeTab + scripting contract. */
export const createProductionCaptureChromeFixture = (
  options: ProductionCaptureFixtureOptions,
): {
  readonly chrome: ChromeCaptureRuntimeDependencies;
  readonly observedTabsGet: number[];
  readonly observedInjectionTabs: number[];
} => {
  const observedTabsGet: number[] = [];
  const observedInjectionTabs: number[] = [];
  return {
    observedTabsGet,
    observedInjectionTabs,
    chrome: {
      tabs: {
        async get(tabId) {
          observedTabsGet.push(tabId);
          return {
            id: tabId,
            ...(tabId === options.grantedTabId ? { url: options.pageUrl } : {}),
          };
        },
      },
      scripting: {
        async executeScript(injection) {
          observedInjectionTabs.push(injection.target.tabId);
          return injection.files === undefined
            ? [{ result: { pageUrl: options.pageUrl, candidates: [] } }]
            : [{}];
        },
      },
    },
  };
};
