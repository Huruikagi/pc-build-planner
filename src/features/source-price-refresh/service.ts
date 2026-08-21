import type { ActivationId } from "../../application-shell/public.js";
import {
  type AppDataError,
  err,
  type MoneyValue,
  ok,
  type Result,
  type SourcedValue,
} from "../../domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  CandidateSourceReference,
} from "../candidate-management/public.js";
import type {
  PagePriceExtractionPort,
  PagePriceObservation,
} from "../product-capture/public.js";
import type {
  MatchedCandidateSource,
  MatchStoredSourceInput,
  NormalizedSourcePageUrl,
  RefreshCapturedPriceInput,
  SourceMatchScope,
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
  SourcePriceRefreshReceipt,
} from "./contracts.js";
import { sourcePriceRefreshDataError } from "./data-error.js";
import { createStoredSourceLocator } from "./source-locator.js";
// Type-only: the workflow implements `SourcePriceRefreshStateDependencies.
// runRefresh`, so it reuses that contract's input shape rather than restating
// it. No runtime edge is created, and the runtime direction stays state →
// service exactly as the design's dependency order requires.
import type { SourcePriceRefreshWorkflowInput } from "./state.js";
import { normalizeSourcePageUrl } from "./url-identity.js";

export interface SourcePriceRefreshServiceDependencies {
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
const operationError = (
  error:
    | AppDataError
    | { readonly kind: "candidate-validation" }
    | { readonly kind: "precondition-failed" },
): SourcePriceRefreshError => {
  if ("kind" in error)
    return error.kind === "precondition-failed"
      ? staleTarget
      : { kind: "validation" };
  return error.code === "validation" && error.reason === "entity-not-found"
    ? noMatch
    : sourcePriceRefreshDataError(error);
};

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
 * The atomic half of the refresh workflow: it validates the observation, proves
 * the stored target is still the one that was matched, and commits the new price
 * through the upstream candidate aggregate in a single mutation. Any failure
 * returns before `patchSourcePrice` is called, or is reported without retrying, so
 * the previously stored price and `capturedAt` always survive.
 *
 * Port calls are not wrapped in `try` here. Both upstream ports are contracted
 * to settle with a typed `Result`, and a violation of that contract is
 * contained once, at the workflow that owns the whole run, rather than at every
 * intermediate layer; catching here as well would only duplicate the same
 * `unexpected` verdict at a boundary that has less of the run in view.
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

      // Re-read immediately before the mutation: an earlier match may have been
      // taken against state that has since changed.
      const current = await dependencies.catalog.getSourceReference({
        candidateId: input.target.candidateId,
        sourceId: input.target.sourceId,
      });
      if (!current.ok) return err(operationError(current.error));

      const reference = current.value;
      if (!stillTargets(reference, input.target, observed.value))
        return err(staleTarget);

      const updated = await dependencies.mutations.patchSourcePrice({
        candidateId: reference.candidateId,
        sourceId: reference.sourceId,
        expectedPageUrl: reference.pageUrl,
        expectedKind: reference.kind,
        price,
        capturedAt: input.capturedAt,
      });
      if (!updated.ok)
        return err(
          "kind" in updated.error &&
            updated.error.kind === "precondition-failed"
            ? staleTarget
            : operationError(updated.error),
        );

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

const staleActivation: SourcePriceRefreshError = { kind: "stale-activation" };
const unexpected: SourcePriceRefreshError = { kind: "unexpected" };

/**
 * The context menu path always matches against every stored source: the gesture
 * carries a tab, not a candidate. Candidate-scoped matching stays available on
 * the public port for the adjacent same-URL re-capture consumer.
 */
const catalogScope: SourceMatchScope = Object.freeze({ kind: "catalog" });

export interface SourcePriceRefreshWorkflowDependencies {
  /** The atomic half of the use case: conservative matching plus the update. */
  readonly refresh: SourcePriceRefreshPort;
  readonly pagePriceExtraction: PagePriceExtractionPort;
  /**
   * Upstream generation check. Only the activation that is still current may
   * touch the page or the displayed result.
   */
  readonly isCurrent: (activationId: ActivationId) => boolean;
}

const observedInput = (
  target: MatchedCandidateSource,
  observation: PagePriceObservation,
): RefreshCapturedPriceInput => {
  const base = {
    target,
    observedPageUrl: observation.pageUrl,
    capturedAt: observation.capturedAt,
  };
  // The key is omitted rather than set to `undefined`: a missing price must stay
  // distinguishable so the update half rejects it before any mutation.
  return observation.price === undefined
    ? base
    : { ...base, price: observation.price };
};

/**
 * One context menu activation, start to finish. It pins the tab that the gesture
 * supplied, takes a price-only observation from that tab, and drives the match
 * and the atomic update, gating on the activation generation at each of the
 * three points the design prescribes:
 *
 * 1. before extraction, so a superseded activation never touches a page;
 * 2. after extraction, so a stale observation reaches neither the match nor the
 *    mutation;
 * 3. after the mutation, where a committed update is deliberately left in place
 *    and only its display is suppressed — the write was valid when it happened,
 *    and a compensating write would be a second, unrequested mutation.
 *
 * Every branch returns a typed `Result`, so the state layer never has to invent
 * an error kind. All three ports are contracted to settle with a typed `Result`,
 * but a port that breaks that contract by throwing must not escape either: the
 * state awaits this function and would be left showing progress forever, with
 * no reason and no way forward. The whole run is therefore contained and
 * reported as `unexpected`, the one member that claims nothing about the cause.
 * The `catch` takes no binding on purpose, so the thrown value cannot be
 * captured, logged or surfaced (requirement 5.6).
 *
 * Containment adds no compensation. A throw from the mutation path leaves
 * whatever the upstream aggregate did in place, exactly as a superseded
 * generation does: a rollback would be a second, unrequested mutation issued on
 * the strength of a cause this code cannot know.
 */
export const createSourcePriceRefreshWorkflow = (
  dependencies: SourcePriceRefreshWorkflowDependencies,
): ((
  input: SourcePriceRefreshWorkflowInput,
) => Promise<Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>>) => {
  const { refresh, pagePriceExtraction, isCurrent } = dependencies;
  return async ({ activationId, tabId }) => {
    try {
      if (!isCurrent(activationId)) return err(staleActivation);

      const extracted = await pagePriceExtraction.extractPrice(tabId);
      // Checked before the result is inspected: a superseded generation's
      // failure is not the current generation's failure either.
      if (!isCurrent(activationId)) return err(staleActivation);
      if (!extracted.ok) return err(extracted.error);

      const observation = extracted.value;
      const matched = await refresh.matchSource({
        scope: catalogScope,
        pageUrl: observation.pageUrl,
      });
      if (!matched.ok) return err(matched.error);

      const updated = await refresh.refreshCapturedPrice(
        observedInput(matched.value, observation),
      );
      if (!isCurrent(activationId)) return err(staleActivation);
      return updated;
    } catch {
      return err(unexpected);
    }
  };
};
