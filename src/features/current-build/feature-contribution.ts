import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type { CandidateQuery } from "../candidate-management/public.js";
import { createCategoryPolicy } from "./category-policy.js";
import type { CurrentBuildPublicApi } from "./public.js";
import { createCurrentBuildQuery } from "./query.js";
import { createCurrentBuildFeatureRegistration } from "./registration.js";
import { createBuildService } from "./service.js";
import { createBuildState } from "./state.js";

export const currentBuildContributionKey = "currentBuild";

export type CurrentBuildContribution = FeatureContribution<
  typeof currentBuildContributionKey,
  CurrentBuildPublicApi
>;

export interface CurrentBuildContributionDependencies {
  /** Project-candidate-management's public query — never a deep import of its internals. */
  readonly candidates: CandidateQuery;
}

/**
 * Assembles the feature from the shell-provided composition context and the
 * upstream candidate query only. Persistence is reached exclusively through
 * the injected scoped data port.
 */
export const createCurrentBuildContribution = (
  context: FeatureCompositionContext,
  dependencies: CurrentBuildContributionDependencies,
): CurrentBuildContribution => {
  const policy = createCategoryPolicy();
  const query = createCurrentBuildQuery({ data: context.data, policy });
  const service = createBuildService({
    data: context.data,
    policy,
    candidates: dependencies.candidates,
    query,
  });
  const state = createBuildState({
    candidates: dependencies.candidates,
    query,
    service,
    policy,
  });
  const registration = createCurrentBuildFeatureRegistration({
    query,
    state,
  });

  return { key: currentBuildContributionKey, registration };
};
