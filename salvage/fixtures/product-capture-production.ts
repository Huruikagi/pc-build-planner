import type { TargetTabId } from "../../src/application-shell/public.js";
import type { ChromeCaptureRuntimeDependencies } from "../../src/features/product-capture/chrome-runtime-port.js";

interface ProductionCaptureFixtureOptions {
  readonly grantedTabId: TargetTabId | null;
  readonly pageUrl: string;
  readonly candidates?: readonly unknown[];
  /**
   * The URL the injected page reports for itself. Defaults to `pageUrl`, so a
   * page that navigated between the tab lookup and the injection is expressed
   * by setting this to a different fictional URL.
   */
  readonly pagePayloadUrl?: string;
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
            ? [
                {
                  result: {
                    pageUrl: options.pagePayloadUrl ?? options.pageUrl,
                    candidates: options.candidates ?? [],
                  },
                },
              ]
            : [{}];
        },
      },
    },
  };
};
