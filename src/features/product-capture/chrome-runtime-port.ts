import { err, ok } from "../../domain/public.js";
import type {
  ActiveTabInfo,
  CaptureInjectionFailure,
  CaptureRuntimePort,
} from "./coordinator.js";

const DEFAULT_CONTENT_SCRIPT_FILE = "content-script.js";

export interface ChromeTabsApi {
  query(queryInfo: {
    readonly active: true;
    readonly currentWindow: true;
  }): Promise<ReadonlyArray<{ readonly id?: number; readonly url?: string }>>;
}

export interface ChromeScriptingInjection {
  readonly target: { readonly tabId: number };
  readonly files?: readonly string[];
  readonly func?: () => unknown;
}

export interface ChromeScriptingApi {
  executeScript(
    injection: ChromeScriptingInjection,
  ): Promise<ReadonlyArray<{ readonly result?: unknown }>>;
}

export interface ChromeCaptureRuntimeDependencies {
  readonly tabs: ChromeTabsApi;
  readonly scripting: ChromeScriptingApi;
  /** The bundled content-script entry that defines the page-side extraction hook. */
  readonly contentScriptFile?: string;
}

/**
 * The injected content script cannot return its extraction result through
 * `files`-based completion values reliably, so it stashes the result on a
 * well-known global and this reads it back through a second, self-contained
 * `func` call — `func` results are Chrome's only well-documented return path.
 */
const readExtractionResult = (): unknown =>
  (
    globalThis as typeof globalThis & {
      __pcbpExtract?: () => unknown;
    }
  ).__pcbpExtract?.();

const PERMISSION_FAILURE_PATTERN =
  /activeTab|cannot access|missing host permission|the extensions gallery/i;

const classifyInjectionFailure = (error: unknown): CaptureInjectionFailure => {
  const message = error instanceof Error ? error.message : String(error);
  return PERMISSION_FAILURE_PATTERN.test(message) ? "permission" : "unknown";
};

/** Real `chrome.tabs`/`chrome.scripting`-backed `CaptureRuntimePort`, safe to construct in any extension page context that holds `activeTab`+`scripting`. */
export const createChromeCaptureRuntimePort = (
  dependencies: ChromeCaptureRuntimeDependencies,
): CaptureRuntimePort => {
  const contentScriptFile =
    dependencies.contentScriptFile ?? DEFAULT_CONTENT_SCRIPT_FILE;

  return {
    async getActiveTab(): Promise<ActiveTabInfo | undefined> {
      let tabs: ReadonlyArray<{ readonly id?: number; readonly url?: string }>;
      try {
        tabs = await dependencies.tabs.query({
          active: true,
          currentWindow: true,
        });
      } catch {
        return undefined;
      }
      const tab = tabs[0];
      if (
        tab === undefined ||
        typeof tab.id !== "number" ||
        typeof tab.url !== "string"
      )
        return undefined;
      return { tabId: tab.id, url: tab.url };
    },

    async inject(target, requestId) {
      try {
        await dependencies.scripting.executeScript({
          target: { tabId: target.tabId },
          files: [contentScriptFile],
        });
        const [injected] = await dependencies.scripting.executeScript({
          target: { tabId: target.tabId },
          func: readExtractionResult,
        });
        const candidates = injected?.result;
        if (!Array.isArray(candidates)) return err("unknown");
        return ok({
          requestId,
          tabId: target.tabId,
          pageUrl: target.url,
          candidates,
        });
      } catch (error) {
        return err(classifyInjectionFailure(error));
      }
    },
  };
};
