import type {
  CandidatePart,
  CandidatePartId,
  Result,
} from "../../domain/public.js";
import type { SourcePriceRefreshReceipt } from "../source-price-refresh/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  ManagementError,
  MutationContext,
} from "./contracts.js";
import type {
  DuplicateCandidateMatch,
  DuplicateCandidateMatcher,
} from "./duplicate-matcher.js";
import type {
  DuplicateUrlRouteError,
  DuplicateUrlRouter,
} from "./duplicate-url-router.js";

export type DuplicateSaveDecision =
  | { readonly kind: "save-new" }
  | { readonly kind: "merge"; readonly candidateId: CandidatePartId };

export type DuplicateEvaluation =
  | { readonly kind: "saved-new"; readonly candidate: CandidatePart }
  | {
      readonly kind: "decision-required";
      readonly matches: readonly DuplicateCandidateMatch[];
    };

export type DuplicateCommitReceipt =
  | { readonly kind: "saved-new"; readonly candidate: CandidatePart }
  | { readonly kind: "source-added"; readonly candidateId: CandidatePartId }
  | {
      readonly kind: "price-refreshed";
      readonly receipt: SourcePriceRefreshReceipt;
    };

type SavedNewReceipt = Extract<DuplicateCommitReceipt, { kind: "saved-new" }>;

export type DuplicateMergeError =
  | { readonly kind: "management"; readonly cause: ManagementError }
  | { readonly kind: "source-route"; readonly cause: DuplicateUrlRouteError }
  | { readonly kind: "stale-decision" };

export interface DuplicateMergeCoordinator {
  evaluate(
    draft: CandidateDraft,
    context: MutationContext,
  ): Promise<Result<DuplicateEvaluation, DuplicateMergeError>>;
  complete(
    draft: CandidateDraft,
    matches: readonly DuplicateCandidateMatch[],
    decision: DuplicateSaveDecision,
    context: MutationContext,
  ): Promise<Result<DuplicateCommitReceipt, DuplicateMergeError>>;
}

export interface DuplicateMergeCoordinatorDependencies {
  readonly query: CandidateQuery;
  readonly matcher: DuplicateCandidateMatcher;
  readonly router: DuplicateUrlRouter;
  readonly createCandidate: CandidateManagementService["createCandidate"];
}

const managementFailure = (cause: ManagementError) => ({
  ok: false as const,
  error: { kind: "management" as const, cause },
});

const createNew = async (
  dependencies: DuplicateMergeCoordinatorDependencies,
  draft: CandidateDraft,
  context: MutationContext,
): Promise<Result<SavedNewReceipt, DuplicateMergeError>> => {
  const created = await dependencies.createCandidate(draft, context);
  return created.ok
    ? {
        ok: true,
        value: { kind: "saved-new", candidate: created.value },
      }
    : managementFailure(created.error);
};

export const createDuplicateMergeCoordinator = (
  dependencies: DuplicateMergeCoordinatorDependencies,
): DuplicateMergeCoordinator => ({
  async evaluate(draft, context) {
    const listed = await dependencies.query.listCandidates({
      projectId: draft.projectId,
    });
    if (!listed.ok) return managementFailure(listed.error);
    if (
      listed.value.some((candidate) => candidate.projectId !== draft.projectId)
    )
      return managementFailure({ kind: "unsupported-data" });

    const matches = dependencies.matcher.match(draft, listed.value);
    if (matches.length > 0)
      return {
        ok: true,
        value: { kind: "decision-required", matches },
      };
    return createNew(dependencies, draft, context);
  },

  async complete(draft, matches, decision, context) {
    if (decision.kind === "save-new")
      return createNew(dependencies, draft, context);
    if (!matches.some((match) => match.candidateId === decision.candidateId))
      return { ok: false, error: { kind: "stale-decision" } };

    const listed = await dependencies.query.listCandidates({
      projectId: draft.projectId,
    });
    if (!listed.ok) return managementFailure(listed.error);
    if (
      listed.value.some((candidate) => candidate.projectId !== draft.projectId)
    )
      return managementFailure({ kind: "unsupported-data" });
    const currentMatches = dependencies.matcher.match(draft, listed.value);
    if (
      !currentMatches.some(
        (match) => match.candidateId === decision.candidateId,
      )
    )
      return { ok: false, error: { kind: "stale-decision" } };

    const source = draft.sources?.[0];
    if (source?.pageUrl === undefined)
      return {
        ok: false,
        error: {
          kind: "source-route",
          cause: {
            kind: "source-add",
            cause: {
              kind: "validation",
              fields: { source: "invalid-source" },
            },
          },
        },
      };
    const routed = await dependencies.router.route(decision.candidateId, {
      candidateId: decision.candidateId,
      source: { ...source, pageUrl: source.pageUrl },
    });
    return routed.ok
      ? routed
      : {
          ok: false,
          error: { kind: "source-route", cause: routed.error },
        };
  },
});
