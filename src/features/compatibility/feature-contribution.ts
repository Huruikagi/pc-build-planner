import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type { ProjectContextReadPort } from "../../project-context/public.js";
import type { CandidateQuery } from "../candidate-management/public.js";
import type { CurrentBuildQuery } from "../current-build/public.js";
import { createCompatibilityProjectContextAdapter } from "./project-context-adapter.js";
import type { CompatibilityPublicApi } from "./public.js";
import { createCompatibilityFeatureRegistration } from "./registration.js";
import { createCompatibilityService } from "./service.js";
import { createCompatibilityState } from "./state.js";

export const compatibilityContributionKey = "compatibility";

export type CompatibilityContribution = FeatureContribution<
  typeof compatibilityContributionKey,
  CompatibilityPublicApi
>;

export interface CompatibilityContributionDependencies {
  /** current-build-management's public query — never a deep import of its internals. */
  readonly currentBuildQuery: CurrentBuildQuery;
  /** project-candidate-management's public query — never a deep import of its internals. */
  readonly candidateQuery: CandidateQuery;
  /** Shell-owned authoritative current-project read port. */
  readonly projectContext?: ProjectContextReadPort;
}

/**
 * Assembles the feature from the shell-provided composition context and the
 * upstream current-build/candidate queries only. This feature never reaches
 * `context.data` directly — it only reads through the injected upstream ports.
 */
export const createCompatibilityContribution = (
  context: FeatureCompositionContext,
  dependencies: CompatibilityContributionDependencies,
): CompatibilityContribution => {
  const service = createCompatibilityService({
    currentBuildQuery: dependencies.currentBuildQuery,
    candidateQuery: dependencies.candidateQuery,
  });
  const projectContextRead =
    dependencies.projectContext ?? context.projectContext;
  const projectContext =
    projectContextRead === undefined
      ? undefined
      : createCompatibilityProjectContextAdapter(projectContextRead);
  const state = createCompatibilityState({
    query: service,
    ...(projectContext === undefined ? {} : { projectContext }),
  });
  const registration = createCompatibilityFeatureRegistration({
    query: service,
    state,
  });

  return { key: compatibilityContributionKey, registration };
};
