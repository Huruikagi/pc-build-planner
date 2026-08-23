import type {
  CandidateSourceMatcherPort,
  CandidateSourceScope,
  PatchCandidateSourcePriceInput,
  SourcePricePatchContract,
} from "../../src/candidate-sources/public.js";

export const patchMatchedRetailSource = async (
  matcher: CandidateSourceMatcherPort,
  patches: SourcePricePatchContract,
  scope: CandidateSourceScope,
  input: Omit<PatchCandidateSourcePriceInput, "candidateId" | "sourceId">,
) => {
  const match = await matcher.matchByPageUrl({
    scope,
    pageUrl: input.expectedPageUrl,
  });
  if (!match.ok || match.value.kind !== "unique") return match;
  return patches.patchSourcePrice({
    ...input,
    candidateId: match.value.reference.candidateId,
    sourceId: match.value.reference.sourceId,
  });
};
