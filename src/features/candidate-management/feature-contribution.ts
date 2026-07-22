import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import { createUuid, type RequestId } from "../../domain/public.js";
import type { MutationContext } from "./contracts.js";
import type { CandidateManagementPublicApi } from "./public.js";
import { createCandidateFeatureRegistration } from "./registration.js";
import { createCandidateManagementService } from "./service.js";
import { createManagementState } from "./state.js";

export const candidateManagementContributionKey = "candidateManagement";

export type CandidateManagementContribution = FeatureContribution<
  typeof candidateManagementContributionKey,
  CandidateManagementPublicApi
>;

/**
 * Assembles the feature from the shell-provided composition context only.
 * Persistence is reached exclusively through the injected scoped data port.
 */
export const createCandidateManagementContribution = (
  context: FeatureCompositionContext,
): CandidateManagementContribution => {
  const service = createCandidateManagementService({ data: context.data });

  /**
   * The expected revision is read per mutation, so a concurrent writer in
   * another MV3 context surfaces as a typed conflict instead of a lost update.
   */
  const createMutationContext = async (): Promise<MutationContext> => {
    const revision = await context.data.query((root) => root.revision);
    return {
      requestId: createUuid() as RequestId,
      expectedRevision: revision.ok ? revision.value : 0,
    };
  };

  const state = createManagementState({
    query: service,
    service,
    createMutationContext,
  });

  const registration = createCandidateFeatureRegistration({
    data: context.data,
    query: service,
    /** Adjacent capture features do not own revisions, so the feature supplies one. */
    capture: {
      async createCandidate(input) {
        return service.createCandidate(input, await createMutationContext());
      },
    },
    navigator: context.navigator,
    state,
  });

  return { key: candidateManagementContributionKey, registration };
};
