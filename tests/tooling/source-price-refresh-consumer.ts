import type {
  CandidateSourceCatalogPort,
  CandidateSourceReference,
  ManagementError,
} from "../../src/features/candidate-management/public.js";

type CatalogFailure = Exclude<ManagementError, { readonly kind: "not-found" }>;

export type RefreshTargetListResult =
  | {
      readonly kind: "ready";
      readonly references: readonly CandidateSourceReference[];
    }
  | { readonly kind: "candidate-not-found" }
  | { readonly kind: "catalog-unavailable"; readonly error: CatalogFailure };

export const listRefreshTargets = async (
  catalog: CandidateSourceCatalogPort,
  candidateId?: Parameters<
    CandidateSourceCatalogPort["listSourceReferences"]
  >[0]["candidateId"],
): Promise<RefreshTargetListResult> => {
  const result = await catalog.listSourceReferences(
    candidateId === undefined ? {} : { candidateId },
  );
  if (result.ok) return { kind: "ready", references: result.value };
  if (result.error.kind === "not-found") return { kind: "candidate-not-found" };
  return { kind: "catalog-unavailable", error: result.error };
};

export type RefreshTargetMatch =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly reference: CandidateSourceReference }
  | {
      readonly kind: "ambiguous";
      readonly references: readonly CandidateSourceReference[];
    }
  | Exclude<RefreshTargetListResult, { readonly kind: "ready" }>;

export const findRefreshTargets = async (
  catalog: CandidateSourceCatalogPort,
  pageUrl: string,
  candidateId?: Parameters<
    CandidateSourceCatalogPort["listSourceReferences"]
  >[0]["candidateId"],
): Promise<RefreshTargetMatch> => {
  const listed = await listRefreshTargets(catalog, candidateId);
  if (listed.kind !== "ready") return listed;
  const matches = listed.references.filter(
    (reference) => reference.pageUrl === pageUrl,
  );
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1)
    return {
      kind: "single",
      reference: matches[0] as CandidateSourceReference,
    };
  return { kind: "ambiguous", references: matches };
};

export type RefreshTargetResult =
  | { readonly kind: "ready"; readonly reference: CandidateSourceReference }
  | { readonly kind: "stale-target" }
  | { readonly kind: "catalog-unavailable"; readonly error: CatalogFailure };

export const resolveRefreshTarget = async (
  catalog: CandidateSourceCatalogPort,
  target: Parameters<CandidateSourceCatalogPort["getSourceReference"]>[0],
): Promise<RefreshTargetResult> => {
  const result = await catalog.getSourceReference(target);
  if (result.ok) return { kind: "ready", reference: result.value };
  if (result.error.kind === "not-found") return { kind: "stale-target" };
  return { kind: "catalog-unavailable", error: result.error };
};
