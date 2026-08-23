import type {
  AddCandidateSourceInput,
  CandidatePartId,
  CandidateSourceMatcherPort,
  CandidateSourceMutationPort,
  CandidateSourceReference,
  PatchCandidateSourcePriceInput,
} from "../../src/candidate-sources/public.js";

export type DuplicateSourceRoute =
  | { readonly kind: "added" }
  | { readonly kind: "mutated"; readonly reference: CandidateSourceReference }
  | {
      readonly kind: "ambiguous-no-op";
      readonly references: readonly CandidateSourceReference[];
    }
  | { readonly kind: "failed" };

export const routeDuplicateSource = async (
  ports: {
    readonly matcher: CandidateSourceMatcherPort;
    readonly mutations: CandidateSourceMutationPort;
  },
  candidateId: CandidatePartId,
  add: AddCandidateSourceInput["source"],
  patch: Omit<PatchCandidateSourcePriceInput, "candidateId" | "sourceId">,
): Promise<DuplicateSourceRoute> => {
  const matched = await ports.matcher.matchByPageUrl({
    scope: { kind: "candidate", candidateId },
    pageUrl: add.pageUrl,
  });
  if (!matched.ok) return { kind: "failed" };
  if (matched.value.kind === "no-match") {
    const result = await ports.mutations.addSource({
      candidateId,
      source: add,
    });
    return result.ok ? { kind: "added" } : { kind: "failed" };
  }
  if (matched.value.kind === "ambiguous-match")
    return { kind: "ambiguous-no-op", references: matched.value.references };

  const result = await ports.mutations.patchSourcePrice({
    ...patch,
    candidateId,
    sourceId: matched.value.reference.sourceId,
  });
  return result.ok
    ? { kind: "mutated", reference: matched.value.reference }
    : { kind: "failed" };
};

export const narrowedReadOnlyContractMustFail = (
  reference: CandidateSourceReference,
) => {
  // @ts-expect-error read-only references intentionally expose no mutation capability.
  return reference.addSource;
};
