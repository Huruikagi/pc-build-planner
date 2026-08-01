import type { CandidatePartId } from "../../domain/public.js";
import type { ProductIdentityNormalizer } from "../product-capture/public.js";
import type { CandidateDraft, CandidateSummary } from "./contracts.js";

export type DuplicateMatchConfidence = "high" | "supporting";

export type DuplicateMatchEvidence =
  | { readonly kind: "model-number" }
  | { readonly kind: "manufacturer-name" };

export interface DuplicateCandidateMatch {
  readonly candidateId: CandidatePartId;
  readonly confidence: DuplicateMatchConfidence;
  readonly evidence: DuplicateMatchEvidence;
  readonly summary: CandidateSummary;
}

export interface DuplicateCandidateMatcher {
  match(
    draft: CandidateDraft,
    candidates: readonly CandidateSummary[],
  ): readonly DuplicateCandidateMatch[];
}

const isCategoryCompatible = (
  draft: CandidateDraft,
  candidate: CandidateSummary,
): boolean =>
  draft.category === "uncategorized" ||
  candidate.category === "uncategorized" ||
  draft.category === candidate.category;

const compareMatches = (
  left: DuplicateCandidateMatch,
  right: DuplicateCandidateMatch,
): number => {
  if (left.confidence !== right.confidence)
    return left.confidence === "high" ? -1 : 1;
  const leftId = left.candidateId as string;
  const rightId = right.candidateId as string;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
};

export const createDuplicateCandidateMatcher = (
  normalizer: ProductIdentityNormalizer,
): DuplicateCandidateMatcher => ({
  match(draft, candidates) {
    const draftModel = normalizer.normalize(
      "model-number",
      draft.product.modelNumber,
    );
    const draftManufacturer = normalizer.normalize(
      "manufacturer",
      draft.product.manufacturer,
    );
    const draftName = normalizer.normalize("name", draft.product.name);
    const matches: DuplicateCandidateMatch[] = [];

    for (const summary of candidates) {
      if (!isCategoryCompatible(draft, summary)) continue;
      const candidateModel = normalizer.normalize(
        "model-number",
        summary.modelNumber,
      );
      if (draftModel !== undefined && candidateModel !== undefined) {
        if (draftModel !== candidateModel) continue;
        matches.push({
          candidateId: summary.id,
          confidence: "high",
          evidence: { kind: "model-number" },
          summary,
        });
        continue;
      }

      const candidateManufacturer = normalizer.normalize(
        "manufacturer",
        summary.manufacturer,
      );
      const candidateName = normalizer.normalize("name", summary.name);
      if (
        draftManufacturer !== undefined &&
        draftName !== undefined &&
        draftManufacturer === candidateManufacturer &&
        draftName === candidateName
      )
        matches.push({
          candidateId: summary.id,
          confidence: "supporting",
          evidence: { kind: "manufacturer-name" },
          summary,
        });
    }
    return matches.sort(compareMatches);
  },
});
