import type { CandidatePartId, Result } from "../../domain/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
  SourcePriceRefreshReceipt,
} from "../source-price-refresh/public.js";
import { candidateSourceMatchScope } from "../source-price-refresh/public.js";
import type {
  AddCandidateSourceInput,
  CandidateSourceMutationPort,
  ManagementError,
} from "./contracts.js";

export type DuplicateUrlRouteReceipt =
  | { readonly kind: "source-added"; readonly candidateId: CandidatePartId }
  | {
      readonly kind: "price-refreshed";
      readonly receipt: SourcePriceRefreshReceipt;
    };

export type DuplicateUrlRouteError =
  | {
      readonly kind: "source-refresh";
      readonly cause: SourcePriceRefreshError;
    }
  | { readonly kind: "source-add"; readonly cause: ManagementError };

export interface DuplicateUrlRouter {
  route(
    targetCandidateId: CandidatePartId,
    input: AddCandidateSourceInput,
  ): Promise<Result<DuplicateUrlRouteReceipt, DuplicateUrlRouteError>>;
}

export interface DuplicateUrlRouterDependencies {
  readonly refresh: SourcePriceRefreshPort;
  readonly sourceMutations: CandidateSourceMutationPort;
}

const refreshFailure = (cause: SourcePriceRefreshError) => ({
  ok: false as const,
  error: { kind: "source-refresh" as const, cause },
});

export const createDuplicateUrlRouter = (
  dependencies: DuplicateUrlRouterDependencies,
): DuplicateUrlRouter => ({
  async route(targetCandidateId, input) {
    const matched = await dependencies.refresh.matchSource({
      scope: candidateSourceMatchScope(targetCandidateId),
      pageUrl: input.source.pageUrl,
    });
    if (!matched.ok) {
      if (matched.error.kind !== "no-match")
        return refreshFailure(matched.error);

      const added = await dependencies.sourceMutations.addSource({
        ...input,
        candidateId: targetCandidateId,
      });
      return added.ok
        ? {
            ok: true,
            value: { kind: "source-added", candidateId: targetCandidateId },
          }
        : {
            ok: false,
            error: { kind: "source-add", cause: added.error },
          };
    }

    if (input.source.price === undefined)
      return refreshFailure({ kind: "price-unavailable" });
    if (input.source.capturedAt === undefined)
      return refreshFailure({ kind: "ineligible-source" });

    const refreshed = await dependencies.refresh.refreshCapturedPrice({
      target: {
        candidateId: matched.value.candidateId,
        sourceId: matched.value.sourceId,
      },
      observedPageUrl: input.source.pageUrl,
      capturedAt: input.source.capturedAt,
      price: input.source.price,
    });
    return refreshed.ok
      ? {
          ok: true,
          value: { kind: "price-refreshed", receipt: refreshed.value },
        }
      : refreshFailure(refreshed.error);
  },
});
