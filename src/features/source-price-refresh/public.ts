import type { FeatureId } from "../../application-shell/public.js";
import type { CandidatePartId } from "../../domain/public.js";
import type {
  SourceMatchScope,
  SourcePriceRefreshUpstreamPorts,
} from "./contracts.js";

export type {
  MatchedCandidateSource,
  MatchStoredSourceInput,
  NormalizedSourcePageUrl,
  RefreshCapturedPriceInput,
  SourceMatchScope,
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
  SourcePriceRefreshPublicApi,
  SourcePriceRefreshReceipt,
  SourcePriceRefreshStorageError,
  SourcePriceRefreshUpstreamPorts,
  SourceUrlIdentityError,
} from "./contracts.js";
export {
  normalizeSourcePageUrl,
  sameSourcePageUrl,
} from "./url-identity.js";

export const sourcePriceRefreshFeatureId = "source-price-refresh" as FeatureId;

const catalogScope: SourceMatchScope = Object.freeze({
  kind: "catalog" as const,
});

/** Matches the observed page against every stored source in the catalog. */
export const catalogSourceMatchScope = (): SourceMatchScope => catalogScope;

/** Restricts matching to the sources of a single stored candidate. */
export const candidateSourceMatchScope = (
  candidateId: CandidatePartId,
): SourceMatchScope =>
  Object.freeze({ kind: "candidate" as const, candidateId });

/**
 * Pins the feature's consumer contract to the approved upstream public entries.
 * Rejects any dependency object that cannot serve the operations this feature
 * uses, so a partially shaped bypass cannot reach the refresh workflow.
 */
export const createSourcePriceRefreshUpstreamPorts = (
  dependencies: SourcePriceRefreshUpstreamPorts,
): SourcePriceRefreshUpstreamPorts => {
  const catalog = dependencies?.catalog;
  const mutations = dependencies?.mutations;
  const pagePriceExtraction = dependencies?.pagePriceExtraction;
  const gestures = dependencies?.gestures;
  if (
    typeof catalog?.listSourceReferences !== "function" ||
    typeof catalog.getSourceReference !== "function" ||
    typeof mutations?.updateSource !== "function" ||
    typeof pagePriceExtraction?.extractPrice !== "function" ||
    typeof gestures?.register !== "function"
  )
    throw new TypeError(
      "Source price refresh requires the candidate source catalog, source mutation, page price extraction and transient gesture registration ports.",
    );
  return Object.freeze({
    catalog,
    mutations,
    pagePriceExtraction,
    gestures,
  });
};
