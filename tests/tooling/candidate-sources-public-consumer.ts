import {
  type AddCandidateSourceInput,
  type CandidatePartId,
  type CandidateSourceCatalogPort,
  type CandidateSourceCatalogSnapshotPort,
  type CandidateSourceId,
  type CandidateSourceKind,
  type CandidateSourceMatcherPort,
  type CandidateSourceMutationDependencies,
  type CandidateSourcePublicError,
  type CandidateSourceReference,
  type CandidateSourceScope,
  type CandidateSourceUrlIdentity,
  candidateSourcePolicy,
  createCandidateSourceCatalog,
  createCandidateSourceMatcher,
  createCandidateSourceMutationService,
  identifyCandidateSourceUrl,
  type PatchCandidateSourcePriceInput,
  projectAppDataError,
  type RemoveCandidateSourceInput,
  type SourceMatchResult,
  type SourcePricePatchContract,
  type UpdateCandidateSourceInput,
} from "../../src/candidate-sources/public.js";
import type { AppDataError } from "../../src/domain/public.js";

declare const candidateId: CandidatePartId;
declare const sourceId: CandidateSourceId;
declare const sourceKind: CandidateSourceKind;

export const candidateScope: CandidateSourceScope = {
  kind: "candidate",
  candidateId,
};

export const sourceReference: CandidateSourceReference = {
  candidateId,
  sourceId,
  pageUrl: "https://fictional-shop.invalid/item",
  kind: sourceKind,
  isPrimary: true,
};

export const sourceMatch: SourceMatchResult = {
  kind: "unique",
  reference: sourceReference,
};

export const matcherConsumer: CandidateSourceMatcherPort =
  createCandidateSourceMatcher({
    listSourceReferences: async () => ({
      ok: true,
      value: [sourceReference],
    }),
  });

declare const catalogSnapshots: CandidateSourceCatalogSnapshotPort;
export const catalogConsumer: CandidateSourceCatalogPort =
  createCandidateSourceCatalog({ data: catalogSnapshots });
export const allCatalogReferences = catalogConsumer.listSourceReferences({
  scope: { kind: "all-candidates" },
});
export const scopedCatalogReferences = catalogConsumer.listSourceReferences({
  scope: candidateScope,
});
export const catalogReferenceById = catalogConsumer.getSourceReference({
  candidateId,
  sourceId,
});

declare const mutationDependencies: CandidateSourceMutationDependencies;
export const mutationConsumer =
  createCandidateSourceMutationService(mutationDependencies);
export const pricePatchConsumer: SourcePricePatchContract = mutationConsumer;

export const addInput: AddCandidateSourceInput = {
  candidateId,
  source: {
    id: sourceId,
    pageUrl: "https://fictional-shop.invalid/item",
  },
};

export const updateInput: UpdateCandidateSourceInput = {
  candidateId,
  source: { id: sourceId, siteName: "Fictional Shop" },
};

export const removeInput: RemoveCandidateSourceInput = {
  candidateId,
  sourceId,
};

export const patchInput: PatchCandidateSourcePriceInput = {
  candidateId,
  sourceId,
  expectedPageUrl: "https://fictional-shop.invalid/item",
  expectedKind: "retail",
  price: {
    original: "12345 JPY",
    confirmed: { amount: 12_345, currency: "JPY" },
  },
  capturedAt: "2026-08-24T01:02:03.000Z" as never,
};
export const patchedPrice = pricePatchConsumer.patchSourcePrice(patchInput);

export const policyConsumer = candidateSourcePolicy;

export const sourceUrlIdentity: CandidateSourceUrlIdentity = (() => {
  const result = identifyCandidateSourceUrl(
    "https://fictional-shop.invalid/item?sku=synthetic",
  );
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
})();

declare const appDataError: AppDataError;
export const projectedDataError: CandidateSourcePublicError =
  projectAppDataError(appDataError);

export const sourceErrors = [
  {
    kind: "source-validation",
    path: "sources[0].pageUrl",
    reason: "invalid-format",
  },
  { kind: "not-found", entity: "candidate" },
  { kind: "not-found", entity: "source" },
  { kind: "primary-required" },
  { kind: "precondition-failed" },
  { kind: "source-identity-failure", reason: "invalid-url" },
] as const satisfies readonly CandidateSourcePublicError[];
