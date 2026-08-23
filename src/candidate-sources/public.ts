export type {
  CandidatePartId,
  CandidateSourceId,
  CandidateSourceKind,
} from "../domain/public.js";
export type {
  CandidateSourceDataError,
  CandidateSourceNotFoundError,
  CandidateSourcePublicError,
  CandidateSourceValidationError,
  PrimarySourceRequiredError,
  SourceIdentityError,
  SourcePatchPreconditionError,
} from "./app-data-error-projection.js";
export { projectAppDataError } from "./app-data-error-projection.js";
export type {
  CandidateSourceCatalogDependencies,
  CandidateSourceCatalogPort,
  CandidateSourceCatalogSnapshotPort,
} from "./catalog.js";
export { createCandidateSourceCatalog } from "./catalog.js";
export type {
  CandidateSourceMatcherPort,
  CandidateSourceReferenceSnapshotPort,
} from "./matcher.js";
export { createCandidateSourceMatcher } from "./matcher.js";
export type {
  AddCandidateSourceInput,
  CandidateSourceEntity,
  CandidateSourceEntityInput,
  CandidateSourceMutationResult,
  CandidateSourcePolicyError,
  CandidateSourcePolicyResult,
  CandidateSourceProjection,
  CandidateSourceReference,
  CandidateSourceScope,
  PatchCandidateSourcePriceInput,
  RemoveCandidateSourceInput,
  SetPrimarySourceInput,
  SourceMatchResult,
  UpdateCandidateSourceInput,
} from "./model.js";
export type {
  CandidateSourceMutationDependencies,
  CandidateSourceMutationPort,
} from "./mutations.js";
export { createCandidateSourceMutationService } from "./mutations.js";
export { candidateSourcePolicy } from "./policy.js";
export type { CandidateSourceUrlIdentity } from "./url-identity.js";
export { identifyCandidateSourceUrl } from "./url-identity.js";
