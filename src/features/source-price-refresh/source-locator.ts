import {
  type AppDataError,
  err,
  ok,
  type Result,
} from "../../domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceReference,
} from "../candidate-management/public.js";
import type {
  MatchedCandidateSource,
  MatchStoredSourceInput,
  NormalizedSourcePageUrl,
  SourcePriceRefreshError,
} from "./contracts.js";
import { sourcePriceRefreshDataError } from "./data-error.js";
import { normalizeSourcePageUrl } from "./url-identity.js";

export interface StoredSourceLocatorDependencies {
  readonly catalog: CandidateSourceCatalogPort;
}

export interface StoredSourceLocator {
  /**
   * Resolves the single stored source that identifies the observed page inside
   * the requested scope.
   */
  matchStoredSource(
    input: MatchStoredSourceInput,
  ): Promise<Result<MatchedCandidateSource, SourcePriceRefreshError>>;
}

const noMatch: SourcePriceRefreshError = { kind: "no-match" };
const ambiguousMatch: SourcePriceRefreshError = { kind: "ambiguous-match" };
const ineligibleSource: SourcePriceRefreshError = { kind: "ineligible-source" };

/**
 * A missing candidate is indistinguishable from a candidate without a matching
 * source for this read-only use case, so it stays a `no-match` instead of
 * leaking an upstream entity error. Every other management error is preserved.
 */
const readError = (error: AppDataError): SourcePriceRefreshError =>
  error.code === "validation" && error.reason === "entity-not-found"
    ? noMatch
    : sourcePriceRefreshDataError(error);

/** Only an explicit retail source may have its captured price refreshed. */
const isRetail = (reference: CandidateSourceReference): boolean =>
  reference.kind === "retail";

/**
 * Stored sources without a page URL, or with a URL this feature refuses to
 * accept, can never identify the observed page and are dropped before counting
 * matches so they cannot turn a unique match into an ambiguous one.
 */
const matchesPage = (
  reference: CandidateSourceReference,
  observed: NormalizedSourcePageUrl,
): boolean => {
  const { pageUrl } = reference;
  if (pageUrl === undefined) return false;
  const stored = normalizeSourcePageUrl(pageUrl);
  return stored.ok && stored.value === observed;
};

const target = (
  reference: CandidateSourceReference,
  normalizedPageUrl: NormalizedSourcePageUrl,
): MatchedCandidateSource => ({
  candidateId: reference.candidateId,
  sourceId: reference.sourceId,
  normalizedPageUrl,
  isPrimary: reference.isPrimary,
});

export const createStoredSourceLocator = (
  dependencies: StoredSourceLocatorDependencies,
): StoredSourceLocator => ({
  async matchStoredSource(input) {
    const observed = normalizeSourcePageUrl(input.pageUrl);
    if (!observed.ok) return err(observed.error);

    const { scope } = input;
    const references = await dependencies.catalog.listSourceReferences(
      scope.kind === "candidate" ? { candidateId: scope.candidateId } : {},
    );
    if (!references.ok) return err(readError(references.error));

    const matched = references.value.filter((reference) =>
      matchesPage(reference, observed.value),
    );
    // Uniqueness is decided before the retail constraint so no primary flag or
    // array position can silently pick one of several matching sources.
    if (matched.length === 0) return err(noMatch);
    if (matched.length > 1) return err(ambiguousMatch);

    const [only] = matched;
    if (only === undefined) return err(noMatch);
    if (!isRetail(only)) return err(ineligibleSource);
    return ok(target(only, observed.value));
  },
});
