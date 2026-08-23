import type { AppDataError } from "../domain/public.js";

export interface CandidateSourceDataError {
  readonly kind: "data";
  readonly error: AppDataError;
}

export type CandidateSourceValidationError = {
  readonly kind: "source-validation";
  readonly path: string;
  readonly reason: string;
};

export type CandidateSourceNotFoundError =
  | { readonly kind: "not-found"; readonly entity: "candidate" }
  | { readonly kind: "not-found"; readonly entity: "source" };

export type PrimarySourceRequiredError = {
  readonly kind: "primary-required";
};

export type SourcePatchPreconditionError = {
  readonly kind: "precondition-failed";
};

export type SourceIdentityError = {
  readonly kind: "source-identity-failure";
  readonly reason: "missing-url" | "invalid-url" | "unsafe-scheme";
};

export type CandidateSourcePublicError =
  | CandidateSourceDataError
  | CandidateSourceValidationError
  | CandidateSourceNotFoundError
  | PrimarySourceRequiredError
  | SourcePatchPreconditionError
  | SourceIdentityError;

export const projectAppDataError = (
  error: AppDataError,
): CandidateSourceDataError => {
  switch (error.code) {
    case "validation":
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
    case "repair-failed":
    case "revision-conflict":
    case "request-conflict":
    case "maintenance-active":
    case "recovery-active":
    case "stale-recovery-state":
    case "stale-fence":
    case "stale-assessment":
    case "precommit-cleanup-pending":
    case "quota-exceeded":
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { kind: "data", error };
    default:
      return error satisfies never;
  }
};
