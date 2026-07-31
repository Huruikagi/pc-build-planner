import {
  type CandidateSource,
  err,
  type MoneyValue,
  ok,
  type Result,
  type SourcedValue,
} from "../../domain/public.js";
import type {
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  CandidateSourceReference,
  ManagementError,
} from "../candidate-management/public.js";
import type {
  MatchedCandidateSource,
  MatchStoredSourceInput,
  NormalizedSourcePageUrl,
  RefreshCapturedPriceInput,
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
  SourcePriceRefreshReceipt,
} from "./contracts.js";
import { createStoredSourceLocator } from "./source-locator.js";
import { normalizeSourcePageUrl } from "./url-identity.js";

export interface SourcePriceRefreshServiceDependencies {
  /**
   * Read side of the candidate aggregate. `CandidateSourceReference` is a
   * deliberately narrow projection, so the fields this use case must preserve
   * (`siteName` above all) are only reachable through `getCandidateDraft`.
   */
  readonly query: CandidateQuery;
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
}

const priceUnavailable: SourcePriceRefreshError = { kind: "price-unavailable" };
const staleTarget: SourcePriceRefreshError = { kind: "stale-target" };
const noMatch: SourcePriceRefreshError = { kind: "no-match" };

/**
 * `not-found` is not a member of `SourcePriceRefreshError`: from this use case a
 * candidate or source that no longer exists is simply a target that can no
 * longer be identified, so it stays `no-match`, exactly as the locator maps its
 * own read failures. Every other management error is preserved unchanged so the
 * recovery guidance stays stable.
 */
const managementError = (error: ManagementError): SourcePriceRefreshError =>
  error.kind === "not-found" ? noMatch : error;

/**
 * A price is usable only when the observation carries a confirmed amount and
 * currency. The values arrive from an injected page, so the shape is re-checked
 * at this boundary instead of trusted from the static type.
 */
const hasConfirmedMoney = (price: SourcedValue<MoneyValue>): boolean => {
  const confirmed = price.confirmed;
  if (confirmed === undefined) return false;
  const { amount, currency } = confirmed;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return false;
  return typeof currency === "string" && currency.trim() !== "";
};

/** A re-read reference that still designates the retail source that was matched. */
type CurrentTarget = CandidateSourceReference & {
  readonly pageUrl: string;
  readonly kind: "retail";
};

/**
 * Requirement 4.5 lists the URL, the kind, the owning candidate and the
 * identifier as the four ways a target can drift between matching and commit,
 * and asks for a retryable conflict rather than an overwrite, so all four
 * mismatches settle as `stale-target`.
 */
const stillTargets = (
  reference: CandidateSourceReference,
  target: RefreshCapturedPriceInput["target"],
  observed: NormalizedSourcePageUrl,
): reference is CurrentTarget => {
  if (reference.candidateId !== target.candidateId) return false;
  if (reference.sourceId !== target.sourceId) return false;
  if (reference.kind !== "retail") return false;
  const { pageUrl } = reference;
  if (pageUrl === undefined) return false;
  const stored = normalizeSourcePageUrl(pageUrl);
  return stored.ok && stored.value === observed;
};

/**
 * Rebuilds the stored entry with a new captured price. The stored source read
 * from the candidate draft is spread verbatim, so the identifier, URL, site
 * name, kind and any field added upstream later survive the update untouched;
 * only `price` and `capturedAt` are replaced.
 */
const updatedSource = (
  stored: CandidateSource,
  input: RefreshCapturedPriceInput,
  price: SourcedValue<MoneyValue>,
): CandidateSource => ({
  ...stored,
  price,
  capturedAt: input.capturedAt,
});

/**
 * The atomic half of the refresh workflow: it validates the observation, proves
 * the stored target is still the one that was matched, and commits the new price
 * through the upstream candidate aggregate in a single mutation. Any failure
 * returns before `updateSource` is called, or is reported without retrying, so
 * the previously stored price and `capturedAt` always survive.
 *
 * Port calls are not wrapped in `try`: both upstream ports are contracted to
 * settle with a typed `Result`, and the error union has no member that could
 * honestly describe a thrown value. Reusing an unrelated kind would misreport
 * the cause and, since most kinds are user-retryable, invite endless retries of
 * a deterministic defect.
 */
export const createSourcePriceRefreshService = (
  dependencies: SourcePriceRefreshServiceDependencies,
): SourcePriceRefreshPort => {
  const locator = createStoredSourceLocator({ catalog: dependencies.catalog });
  return {
    async matchSource(
      input: MatchStoredSourceInput,
    ): Promise<Result<MatchedCandidateSource, SourcePriceRefreshError>> {
      return locator.matchStoredSource(input);
    },

    async refreshCapturedPrice(
      input: RefreshCapturedPriceInput,
    ): Promise<Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>> {
      const { price } = input;
      if (price === undefined || !hasConfirmedMoney(price))
        return err(priceUnavailable);

      const observed = normalizeSourcePageUrl(input.observedPageUrl);
      if (!observed.ok) return err(observed.error);

      // The full stored entry, needed so the update can preserve every field it
      // must not touch. A candidate or source that cannot be read here is a
      // target that can no longer be identified, hence `no-match`.
      const draft = await dependencies.query.getCandidateDraft(
        input.target.candidateId,
      );
      if (!draft.ok) return err(managementError(draft.error));

      const stored = draft.value.sources?.find(
        (source) => source.id === input.target.sourceId,
      );
      if (stored === undefined) return err(noMatch);

      // Re-read immediately before the mutation: an earlier match may have been
      // taken against state that has since changed.
      const current = await dependencies.catalog.getSourceReference({
        candidateId: input.target.candidateId,
        sourceId: input.target.sourceId,
      });
      if (!current.ok) return err(managementError(current.error));

      const reference = current.value;
      if (!stillTargets(reference, input.target, observed.value))
        return err(staleTarget);

      const updated = await dependencies.mutations.updateSource({
        candidateId: reference.candidateId,
        source: updatedSource(stored, input, price),
      });
      if (!updated.ok) return err(managementError(updated.error));

      return ok({
        candidateId: reference.candidateId,
        sourceId: reference.sourceId,
        price,
        capturedAt: input.capturedAt,
        isPrimary: reference.isPrimary,
      });
    },
  };
};
