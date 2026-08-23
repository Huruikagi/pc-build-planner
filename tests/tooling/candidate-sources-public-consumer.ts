import {
  type AddCandidateSourceInput,
  type CandidatePartId,
  type CandidateSourceId,
  type CandidateSourceKind,
  type CandidateSourceReference,
  type CandidateSourceScope,
  candidateSourcePolicy,
  type RemoveCandidateSourceInput,
  type SourceMatchResult,
  type UpdateCandidateSourceInput,
} from "../../src/candidate-sources/public.js";

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
