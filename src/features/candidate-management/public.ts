import type { FoundationDataPort } from "../../persistence/public.js";

/** Feature-local public boundary for downstream candidate-management contracts. */
export interface CandidateManagementPublicApi {
}

export interface CandidateManagementPublicDependencies {
  readonly data: FoundationDataPort;
}

export const createCandidateManagementPublicApi = (
  _dependencies: CandidateManagementPublicDependencies,
): CandidateManagementPublicApi => Object.freeze({});
