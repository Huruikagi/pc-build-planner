import {
  createRequestId,
  createUtcTimestamp,
  err,
  ok,
  type RequestId,
  type Result,
  type UtcTimestamp,
} from "../../domain/public.js";
import type {
  CaptureError,
  CapturePagePayload,
  CaptureResult,
  ExtractionCandidate,
  ExtractionSource,
  RawCapturePayload,
} from "./contracts.js";
import type { CaptureNormalizer } from "./normalizer.js";
import type { CandidateRanker } from "./ranker.js";

export interface CaptureCoordinator {
  captureCurrentTab(): Promise<Result<CaptureResult, CaptureError>>;
}

export interface ActiveTabInfo {
  readonly tabId: number;
  readonly url: string;
}

/** Distinguishes a lost `activeTab` grant from any other injection failure. */
export type CaptureInjectionFailure = "permission" | "unknown";

/**
 * The Chrome-facing capability the coordinator needs. Kept as a small,
 * injectable port so `captureCurrentTab` stays deterministic and testable;
 * the real `chrome.tabs`/`chrome.scripting`-backed implementation is wired at
 * composition time.
 */
export interface CaptureRuntimePort {
  getActiveTab(): Promise<ActiveTabInfo | undefined>;
  inject(
    target: ActiveTabInfo,
    requestId: RequestId,
  ): Promise<Result<RawCapturePayload, CaptureInjectionFailure>>;
}

export interface CaptureCoordinatorDependencies {
  readonly runtime: CaptureRuntimePort;
  readonly normalizer: CaptureNormalizer;
  readonly ranker: CandidateRanker;
  readonly createRequestId?: () => RequestId;
  readonly now?: () => UtcTimestamp;
  readonly isRestrictedUrl?: (url: string) => boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EXTRACTION_SOURCES: ReadonlySet<ExtractionSource> = new Set([
  "json-ld",
  "meta",
  "heading",
  "breadcrumb",
  "table",
  "definition-list",
]);

const isExtractionCandidate = (value: unknown): value is ExtractionCandidate =>
  isRecord(value) &&
  typeof value.field === "string" &&
  value.field.length > 0 &&
  typeof value.rawValue === "string" &&
  typeof value.source === "string" &&
  EXTRACTION_SOURCES.has(value.source as ExtractionSource) &&
  typeof value.sourceLabel === "string";

const decodeCapturePagePayload = (
  value: RawCapturePayload,
): CapturePagePayload | undefined => {
  if (!isRecord(value)) return undefined;
  const { requestId, tabId, pageUrl, candidates } = value;
  if (
    typeof requestId !== "string" ||
    requestId.length === 0 ||
    typeof tabId !== "number" ||
    typeof pageUrl !== "string" ||
    !Array.isArray(candidates) ||
    !candidates.every(isExtractionCandidate)
  ) {
    return undefined;
  }
  return { requestId, tabId, pageUrl, candidates };
};

const defaultIsRestrictedUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
};

export const createCaptureCoordinator = (
  dependencies: CaptureCoordinatorDependencies,
): CaptureCoordinator => {
  const nextRequestId = dependencies.createRequestId ?? createRequestId;
  const now = dependencies.now ?? createUtcTimestamp;
  const isRestrictedUrl =
    dependencies.isRestrictedUrl ?? defaultIsRestrictedUrl;

  return {
    async captureCurrentTab() {
      const requestId = nextRequestId();

      const tab = await dependencies.runtime.getActiveTab();
      if (tab === undefined) return err({ kind: "permission-lost" });
      if (isRestrictedUrl(tab.url)) return err({ kind: "restricted-page" });

      let injected: Result<RawCapturePayload, CaptureInjectionFailure>;
      try {
        injected = await dependencies.runtime.inject(tab, requestId);
      } catch {
        return err({ kind: "injection-failed" });
      }
      if (!injected.ok) {
        return err({
          kind:
            injected.error === "permission"
              ? "permission-lost"
              : "injection-failed",
        });
      }

      const payload = decodeCapturePagePayload(injected.value);
      if (payload === undefined) return err({ kind: "invalid-payload" });
      if (
        payload.requestId !== requestId ||
        payload.tabId !== tab.tabId ||
        payload.pageUrl !== tab.url
      ) {
        return err({ kind: "tab-changed" });
      }
      if (payload.candidates.length === 0) return err({ kind: "no-candidate" });

      const fields = [];
      const rejectedFields = [];
      for (const candidate of payload.candidates) {
        const normalized = dependencies.normalizer.normalize(candidate);
        if (normalized.ok) fields.push(normalized.value);
        else rejectedFields.push(normalized.error);
      }

      const draft = dependencies.ranker.select(fields);

      return ok({
        requestId,
        tabId: tab.tabId,
        pageUrl: tab.url,
        capturedAt: now(),
        draft,
        rejectedFields,
      });
    },
  };
};
