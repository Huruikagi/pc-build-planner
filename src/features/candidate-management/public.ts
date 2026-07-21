import type { FoundationDataPort } from "../../persistence/public.js";
import type { CandidateQuery, CaptureCandidatePort } from "./contracts.js";

export type {
  CandidateDraft,
  CandidateListQuery,
  CandidateManagementService,
  CandidateQuery,
  CandidateSummary,
  CaptureCandidatePort,
  CreateProjectInput,
  ManagementError,
  MutationContext,
  ProjectSummary,
  RenameProjectInput,
  UpdateCandidateInput,
} from "./contracts.js";

/** Feature-local public boundary for downstream candidate-management contracts. */
export interface CandidateManagementPublicApi {
  readonly query: CandidateQuery;
  readonly capture: CaptureCandidatePort;
}

export interface CandidateManagementPublicDependencies {
  readonly data: FoundationDataPort;
  readonly query: CandidateQuery;
  readonly capture: CaptureCandidatePort;
}

export const createCandidateManagementPublicApi = (
  dependencies: CandidateManagementPublicDependencies,
): CandidateManagementPublicApi => {
  if (dependencies.query === undefined || dependencies.capture === undefined) {
    throw new TypeError(
      "Candidate management public API requires query and capture dependencies.",
    );
  }
  return Object.freeze({
    query: dependencies.query,
    capture: dependencies.capture,
  });
};
