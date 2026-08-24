import type { TargetTabId } from "../../application-shell/public.js";
import {
  createRequestId,
  createUtcTimestamp,
  err,
  ok,
  type RequestId,
  type UtcTimestamp,
} from "../../domain/public.js";
import {
  type CaptureRuntimePort,
  decodeCapturePagePayload,
  isRestrictedCaptureUrl,
} from "./coordinator.js";
import type { CaptureNormalizer } from "./normalizer.js";
import type {
  PagePriceExtractionError,
  PagePriceExtractionPort,
} from "./public.js";
import type { CandidateRanker } from "./ranker.js";

export interface PagePriceExtractionDependencies {
  readonly runtime: CaptureRuntimePort;
  readonly normalizer: CaptureNormalizer;
  readonly ranker: CandidateRanker;
  readonly createRequestId?: () => RequestId;
  readonly now?: () => UtcTimestamp;
  readonly isRestrictedUrl?: (url: string) => boolean;
}

const failure = (
  kind: PagePriceExtractionError["kind"],
): ReturnType<typeof err<PagePriceExtractionError>> => err({ kind });

export const createPagePriceExtractionAdapter = (
  dependencies: PagePriceExtractionDependencies,
): PagePriceExtractionPort => {
  const nextRequestId = dependencies.createRequestId ?? createRequestId;
  const now = dependencies.now ?? createUtcTimestamp;
  const isRestrictedUrl =
    dependencies.isRestrictedUrl ?? isRestrictedCaptureUrl;

  return {
    async extractPrice(tabId: TargetTabId) {
      const requestId = nextRequestId();
      let tabResult: Awaited<ReturnType<CaptureRuntimePort["getTab"]>>;
      try {
        tabResult = await dependencies.runtime.getTab(tabId);
      } catch {
        return failure("tab-unavailable");
      }
      if (!tabResult.ok) {
        return failure(
          tabResult.error.kind === "url-unavailable"
            ? "permission-lost"
            : "tab-unavailable",
        );
      }
      const tab = tabResult.value;
      if (tab.tabId !== tabId) return failure("tab-changed");
      if (isRestrictedUrl(tab.url)) return failure("restricted-page");

      let injected: Awaited<ReturnType<CaptureRuntimePort["inject"]>>;
      try {
        injected = await dependencies.runtime.inject(tab, requestId);
      } catch {
        return failure("injection-failed");
      }
      if (!injected.ok) {
        return failure(
          injected.error === "permission"
            ? "permission-lost"
            : "injection-failed",
        );
      }

      const payload = decodeCapturePagePayload(injected.value);
      if (payload === undefined) return failure("invalid-payload");
      if (
        payload.requestId !== requestId ||
        payload.tabId !== tab.tabId ||
        payload.pageUrl !== tab.url
      ) {
        return failure("tab-changed");
      }

      const normalizedPrices = payload.candidates
        .filter((candidate) => candidate.field === "price")
        .map((candidate) => dependencies.normalizer.normalize(candidate))
        .filter((result) => result.ok)
        .map((result) => result.value);
      const selected = dependencies.ranker
        .select(normalizedPrices)
        .fields.find((field) => field.field === "price");
      const capturedAt = now();
      if (
        selected === undefined ||
        typeof selected.normalizedValue === "string"
      ) {
        return ok({ pageUrl: payload.pageUrl, capturedAt });
      }
      return ok({
        pageUrl: payload.pageUrl,
        capturedAt,
        price: {
          original: selected.rawValue,
          confirmed: selected.normalizedValue,
        },
      });
    },
  };
};
