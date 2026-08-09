import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type { ProjectId } from "../../domain/public.js";
import type { ProjectContextReadPort } from "../../project-context/public.js";
import type { CandidateQuery } from "../candidate-management/public.js";
import type { CurrentBuildQuery } from "../current-build/public.js";
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
  /** Resolves the project to evaluate; project selection is owned outside this spec. */
  readonly getProjectId?: () => ProjectId | null | Promise<ProjectId | null>;
}

const projectAvailability = (read: ProjectContextReadPort) => () =>
  read.getSnapshot().status === "ready"
    ? { status: "available" as const }
    : { status: "unavailable" as const, reason: "project-context" };

const subscribeProjectAvailability =
  (read: ProjectContextReadPort) =>
  (
    listener: Parameters<
      NonNullable<
        Parameters<
          typeof createCompatibilityFeatureRegistration
        >[0]["subscribeAvailability"]
      >
    >[0],
  ) =>
    read.subscribe(() => listener(projectAvailability(read)()));

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
  const state = createCompatibilityState({ query: service });
  const projectContext = context.projectContext;
  const registration = createCompatibilityFeatureRegistration({
    query: service,
    state,
    ...(projectContext === undefined
      ? {}
      : {
          getAvailability: projectAvailability(projectContext),
          subscribeAvailability: subscribeProjectAvailability(projectContext),
          getProjectId: () => {
            const snapshot = projectContext.getSnapshot();
            return snapshot.status === "ready"
              ? snapshot.selectedProjectId
              : null;
          },
        }),
    ...(dependencies.getProjectId === undefined
      ? {}
      : { getProjectId: dependencies.getProjectId }),
  });

  return { key: compatibilityContributionKey, registration };
};
