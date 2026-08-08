import type { TargetTabId } from "../../application-shell/public.js";
import { err, ok } from "../../domain/public.js";
import type {
  CaptureInjectionFailure,
  CaptureRuntimePort,
} from "./coordinator.js";

const DEFAULT_CONTENT_SCRIPT_FILE = "content-script.js";
const DEFAULT_INJECTION_TIMEOUT_MS = 10_000;

/** Stable code for an unresponsive page-side call; never carries page-derived detail. */
const CAPTURE_TIMEOUT_CODE = "capture-injection-timeout";

/**
 * One-shot cancelable timer. Injectable so the unresponsive-page paths can be
 * driven deterministically in tests instead of racing real wall-clock delays.
 */
export interface CaptureTimeoutScheduler {
  schedule(onTimeout: () => void, delayMs: number): () => void;
}

const systemTimeoutScheduler: CaptureTimeoutScheduler = {
  schedule(onTimeout, delayMs) {
    const timer = setTimeout(onTimeout, delayMs);
    return () => clearTimeout(timer);
  },
};

export interface CaptureTimeoutPolicy {
  runWithin<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Bounds one page-side Chrome call. Each call gets its own budget, so the
 * injection and the result read are separately finite. A value that arrives
 * after the budget elapsed is discarded instead of applied, keeping a late page
 * response out of the current and any later activation.
 */
export const createCaptureTimeoutPolicy = (
  timeoutMs: number = DEFAULT_INJECTION_TIMEOUT_MS,
  scheduler: CaptureTimeoutScheduler = systemTimeoutScheduler,
): CaptureTimeoutPolicy => {
  const budgetMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_INJECTION_TIMEOUT_MS;
  return {
    async runWithin<T>(operation: () => Promise<T>): Promise<T> {
      let settled = false;
      let cancel: (() => void) | undefined;
      try {
        return await new Promise<T>((resolve, reject) => {
          cancel = scheduler.schedule(() => {
            if (settled) return;
            settled = true;
            reject(new Error(CAPTURE_TIMEOUT_CODE));
          }, budgetMs);
          operation().then(
            (value) => {
              if (settled) return;
              settled = true;
              resolve(value);
            },
            (error: unknown) => {
              if (settled) return;
              settled = true;
              reject(error);
            },
          );
        });
      } finally {
        cancel?.();
      }
    },
  };
};

export interface ChromeTabsApi {
  get(tabId: number): Promise<{ readonly id?: number; readonly url?: string }>;
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
  /** Maximum time allowed for one Chrome script injection operation. */
  readonly injectionTimeoutMs?: number;
  /** Timer source behind that budget; overridden only by deterministic tests. */
  readonly timeoutScheduler?: CaptureTimeoutScheduler;
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
  /** Forwarded untouched; the coordinator's decoder is what validates it. */
  readonly siteName?: unknown;
}

const decodePageExtractionResult = (
  value: unknown,
): PageExtractionResult | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { pageUrl, candidates, siteName } = value as {
    readonly pageUrl?: unknown;
    readonly candidates?: unknown;
    readonly siteName?: unknown;
  };
  if (typeof pageUrl !== "string" || !Array.isArray(candidates))
    return undefined;
  return {
    pageUrl,
    candidates,
    ...(siteName === undefined ? {} : { siteName }),
  };
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
  const timeoutPolicy = createCaptureTimeoutPolicy(
    dependencies.injectionTimeoutMs ?? DEFAULT_INJECTION_TIMEOUT_MS,
    dependencies.timeoutScheduler ?? systemTimeoutScheduler,
  );
  const executeScript = (injection: ChromeScriptingInjection) =>
    timeoutPolicy.runWithin(() =>
      dependencies.scripting.executeScript(injection),
    );

  return {
    async getTab(tabId: TargetTabId) {
      let tab: { readonly id?: number; readonly url?: string };
      try {
        tab = await dependencies.tabs.get(tabId);
      } catch {
        return err({ kind: "tab-unavailable" } as const);
      }
      if (tab.id !== tabId) return err({ kind: "tab-unavailable" } as const);
      if (typeof tab.url !== "string" || tab.url.length === 0)
        return err({ kind: "url-unavailable" } as const);
      return ok({ tabId, url: tab.url });
    },

    async inject(target, requestId) {
      try {
        await executeScript({
          target: { tabId: target.tabId },
          files: [contentScriptFile],
        });
        const [injected] = await executeScript({
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
          ...(extraction.siteName === undefined
            ? {}
            : { siteName: extraction.siteName }),
        });
      } catch (error) {
        return err(classifyInjectionFailure(error));
      }
    },
  };
};
