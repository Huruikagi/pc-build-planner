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
  create?(details: { readonly url: string }): Promise<unknown>;
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
 *
 * Both injections run in the extension's isolated world, so the hook is only
 * ever the one `content-script.ts` installed; page script cannot define or
 * observe it. A navigation between the two calls tears that world down and
 * leaves the hook undefined, which surfaces below as an injection failure.
 */
const readExtractionResult = (): unknown =>
  (
    globalThis as typeof globalThis & {
      __pcbpExtract?: () => unknown;
    }
  ).__pcbpExtract?.();

interface PageExtractionResult {
  readonly pageUrl: string;
  readonly candidates: readonly unknown[];
}

const decodePageExtractionResult = (
  value: unknown,
): PageExtractionResult | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { pageUrl, candidates } = value as {
    readonly pageUrl?: unknown;
    readonly candidates?: unknown;
  };
  if (typeof pageUrl !== "string" || !Array.isArray(candidates))
    return undefined;
  return { pageUrl, candidates };
};

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
        const extraction = decodePageExtractionResult(injected?.result);
        if (extraction === undefined) return err("unknown");
        /**
         * `pageUrl` must come from the page, never from `target.url`: it is the
         * only field that can disagree with what the capture asked for, and the
         * coordinator's stale-response check is what makes that disagreement a
         * `tab-changed` failure instead of silently mismatched candidate data.
         * `tabId` is Chrome's own injection target and `requestId` is not
         * page-derivable, so both stay runtime-supplied.
         */
        return ok({
          requestId,
          tabId: target.tabId,
          pageUrl: extraction.pageUrl,
          candidates: extraction.candidates,
        });
      } catch (error) {
        return err(classifyInjectionFailure(error));
      }
    },
  };
};
