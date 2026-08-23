import {
  type AddCandidateSourceInput,
  type CandidatePartId,
  type CandidateSourceId,
  type CandidateSourceKind,
  type CandidateSourcePublicError,
  type CandidateSourceReference,
  type CandidateSourceScope,
  type CandidateSourceUrlIdentity,
  candidateSourcePolicy,
  identifyCandidateSourceUrl,
  projectAppDataError,
  type RemoveCandidateSourceInput,
  type SourceMatchResult,
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
