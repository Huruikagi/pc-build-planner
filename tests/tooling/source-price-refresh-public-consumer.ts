import type {
  TransientGestureRegistrationError,
  TransientGestureRegistrationPort,
  TransientGestureSource,
} from "../../src/application-shell/public.js";
import type {
  CandidatePartId,
  MoneyValue,
  Result,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../../src/features/candidate-management/public.js";
import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";
import {
  candidateSourceMatchScope,
  catalogSourceMatchScope,
  createSourcePriceRefreshUpstreamPorts,
  type MatchedCandidateSource,
  type MatchStoredSourceInput,
  type NormalizedSourcePageUrl,
  normalizeSourcePageUrl,
  type RefreshCapturedPriceInput,
  type SourcePriceRefreshError,
  type SourcePriceRefreshPort,
  type SourcePriceRefreshPublicApi,
  type SourcePriceRefreshReceipt,
  type SourcePriceRefreshStorageError,
  type SourcePriceRefreshUpstreamPorts,
  type SourceUrlIdentityError,
  sameSourcePageUrl,
} from "../../src/features/source-price-refresh/public.js";

/**
 * Upstream ports this feature is allowed to consume, spelled out against the
 * producer-owned public entries so a deep import cannot satisfy the seam.
 */
export interface SourcePriceRefreshConsumerPorts {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
  readonly pagePriceExtraction: PagePriceExtractionPort;
  readonly gestures: TransientGestureRegistrationPort;
}

export interface SourcePriceRefreshPublicConsumer {
  readonly ports: SourcePriceRefreshUpstreamPorts;
  catalogRequest(pageUrl: string): MatchStoredSourceInput;
  candidateRequest(
    candidateId: CandidatePartId,
    pageUrl: string,
  ): MatchStoredSourceInput;
  registerGesture(
    source: TransientGestureSource,
  ): Result<() => void, TransientGestureRegistrationError>;
}

/** Public-entry consumer seam: assembles every upstream port without deep imports. */
export const createSourcePriceRefreshPublicConsumer = (
  dependencies: SourcePriceRefreshConsumerPorts,
): SourcePriceRefreshPublicConsumer => {
  const ports = createSourcePriceRefreshUpstreamPorts(dependencies);
  return {
    ports,
    catalogRequest: (pageUrl) => ({
      scope: catalogSourceMatchScope(),
      pageUrl,
    }),
    candidateRequest: (candidateId, pageUrl) => ({
      scope: candidateSourceMatchScope(candidateId),
      pageUrl,
    }),
    registerGesture: (source) => ports.gestures.register(source),
  };
};

/**
 * Adjacent consumers reuse the feature's URL identity through the public entry
 * before asking for a match, so a re-captured page cannot reach the workflow
 * with a scheme the feature refuses.
 */
export const normalizedCatalogRequest = (
  pageUrl: string,
): Result<MatchStoredSourceInput, SourceUrlIdentityError> => {
  const normalized = normalizeSourcePageUrl(pageUrl);
  return normalized.ok
    ? {
        ok: true,
        value: { scope: catalogSourceMatchScope(), pageUrl: normalized.value },
      }
    : { ok: false, error: normalized.error };
};

/** Same-URL re-capture check that must not add a source when it holds. */
export const isSameStoredSourcePage = (
  matched: MatchedCandidateSource,
  observedPageUrl: string,
): boolean => sameSourcePageUrl(matched.normalizedPageUrl, observedPageUrl);

/** Price observation a consumer hands to the public refresh use case. */
export interface ConsumerPriceObservation {
  readonly capturedAt: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
}

export type SourcePriceRefreshRecovery =
  | "retry-context-menu"
  | "review-stored-sources"
  | "deduplicate-sources"
  | "use-retail-source"
  | "check-page-price"
  | "reload-candidate"
  | "retry-after-maintenance"
  | "check-storage";

export type SourcePriceRefreshOutcome =
  | {
      readonly kind: "refreshed";
      readonly matchedPageUrl: NormalizedSourcePageUrl;
      readonly receipt: SourcePriceRefreshReceipt;
    }
  | {
      readonly kind: "failed";
      readonly error: SourcePriceRefreshError;
      readonly recovery: SourcePriceRefreshRecovery;
    };

const urlIdentityRecovery = (
  _error: SourceUrlIdentityError,
): SourcePriceRefreshRecovery => "review-stored-sources";

const storageRecovery = (
  error: SourcePriceRefreshStorageError,
): SourcePriceRefreshRecovery => {
  switch (error.kind) {
    case "validation":
    case "unsupported-data":
      return "review-stored-sources";
    case "conflict":
      return "reload-candidate";
    case "maintenance":
      return "retry-after-maintenance";
    case "storage":
    case "quota":
      return "check-storage";
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
};

/**
 * Discriminates the whole public error union. Adding or dropping a member of
 * `SourcePriceRefreshError` breaks this consumer at compile time.
 */
export const sourcePriceRefreshRecovery = (
  error: SourcePriceRefreshError,
): SourcePriceRefreshRecovery => {
  switch (error.kind) {
    case "invalid-url":
      return urlIdentityRecovery(error);
    case "no-match":
      return "review-stored-sources";
    case "ambiguous-match":
      return "deduplicate-sources";
    case "ineligible-source":
      return "use-retail-source";
    case "price-unavailable":
      return "check-page-price";
    case "stale-activation":
    case "tab-unavailable":
    case "permission-lost":
    case "restricted-page":
    case "tab-changed":
    case "injection-failed":
    case "invalid-payload":
      return "retry-context-menu";
    case "stale-target":
      return "reload-candidate";
    case "validation":
    case "conflict":
    case "maintenance":
    case "storage":
    case "quota":
    case "unsupported-data":
      return storageRecovery(error);
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
};

/** Builds the atomic update request from a matched target without touching internals. */
export const capturedPriceRequest = (
  matched: MatchedCandidateSource,
  observation: ConsumerPriceObservation,
): RefreshCapturedPriceInput => {
  const target: Pick<MatchedCandidateSource, "candidateId" | "sourceId"> = {
    candidateId: matched.candidateId,
    sourceId: matched.sourceId,
  };
  const observedPageUrl: NormalizedSourcePageUrl = matched.normalizedPageUrl;
  return observation.price === undefined
    ? { target, observedPageUrl, capturedAt: observation.capturedAt }
    : {
        target,
        observedPageUrl,
        capturedAt: observation.capturedAt,
        price: observation.price,
      };
};

/** Match then atomically refresh, using only the feature's public port contract. */
export const refreshMatchedSourcePrice = async (
  refresh: SourcePriceRefreshPort,
  request: MatchStoredSourceInput,
  observation: ConsumerPriceObservation,
): Promise<SourcePriceRefreshOutcome> => {
  const matched = await refresh.matchSource(request);
  if (!matched.ok)
    return {
      kind: "failed",
      error: matched.error,
      recovery: sourcePriceRefreshRecovery(matched.error),
    };
  const refreshed = await refresh.refreshCapturedPrice(
    capturedPriceRequest(matched.value, observation),
  );
  return refreshed.ok
    ? {
        kind: "refreshed",
        matchedPageUrl: matched.value.normalizedPageUrl,
        receipt: refreshed.value,
      }
    : {
        kind: "failed",
        error: refreshed.error,
        recovery: sourcePriceRefreshRecovery(refreshed.error),
      };
};

/**
 * Adjacent consumers (same-URL re-capture) reach the use case through the
 * feature-owned public API facade instead of adding a new source.
 */
export const refreshThroughPublicApi = async (
  api: SourcePriceRefreshPublicApi,
  request: MatchStoredSourceInput,
  observation: ConsumerPriceObservation,
): Promise<SourcePriceRefreshOutcome> =>
  refreshMatchedSourcePrice(api.refresh, request, observation);
