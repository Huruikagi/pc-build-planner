import type { CandidatePartId } from "../../src/domain/public.js";
import {
  candidateSourceMatchScope,
  type RefreshCapturedPriceInput,
  type SourcePriceRefreshError,
  type SourcePriceRefreshPublicApi,
  type SourcePriceRefreshReceipt,
} from "../../src/features/source-price-refresh/public.js";

export interface DuplicateProductPriceObservation {
  readonly pageUrl: string;
  readonly capturedAt: RefreshCapturedPriceInput["capturedAt"];
  readonly price?: RefreshCapturedPriceInput["price"];
}

export type DuplicateProductPriceRefreshOutcome =
  | { readonly kind: "refreshed"; readonly receipt: SourcePriceRefreshReceipt }
  | { readonly kind: "failed"; readonly error: SourcePriceRefreshError };

/** Compile-time exhaustive consumer of the public failure union. */
export const duplicateProductMergeFailureKind = (
  error: SourcePriceRefreshError,
): SourcePriceRefreshError["kind"] => {
  switch (error.kind) {
    case "invalid-url":
    case "no-match":
    case "ambiguous-match":
    case "ineligible-source":
    case "price-unavailable":
    case "stale-activation":
    case "stale-target":
    case "tab-unavailable":
    case "permission-lost":
    case "restricted-page":
    case "tab-changed":
    case "injection-failed":
    case "invalid-payload":
    case "validation":
    case "conflict":
    case "maintenance":
    case "storage":
    case "quota":
    case "unsupported-data":
    case "unexpected":
      return error.kind;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
};

/**
 * duplicate-product-merge fixture: an already stored same-URL source is
 * refreshed through the feature public API. No source-add capability is
 * accepted by this consumer.
 */
export const refreshDuplicateProductSourcePrice = async (
  api: SourcePriceRefreshPublicApi,
  candidateId: CandidatePartId,
  observation: DuplicateProductPriceObservation,
): Promise<DuplicateProductPriceRefreshOutcome> => {
  const matched = await api.refresh.matchSource({
    scope: candidateSourceMatchScope(candidateId),
    pageUrl: observation.pageUrl,
  });
  if (!matched.ok) {
    duplicateProductMergeFailureKind(matched.error);
    return { kind: "failed", error: matched.error };
  }

  const input: RefreshCapturedPriceInput = {
    target: {
      candidateId: matched.value.candidateId,
      sourceId: matched.value.sourceId,
    },
    observedPageUrl: observation.pageUrl,
    capturedAt: observation.capturedAt,
    ...(observation.price === undefined ? {} : { price: observation.price }),
  };
  const refreshed = await api.refresh.refreshCapturedPrice(input);
  if (!refreshed.ok) {
    duplicateProductMergeFailureKind(refreshed.error);
    return { kind: "failed", error: refreshed.error };
  }
  return { kind: "refreshed", receipt: refreshed.value };
};
