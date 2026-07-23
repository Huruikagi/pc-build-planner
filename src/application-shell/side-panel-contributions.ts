import {
  type CandidateManagementContribution,
  createCandidateManagementContribution,
} from "../features/candidate-management/feature-contribution.js";
import {
  type CurrentBuildContribution,
  createCurrentBuildContribution,
} from "../features/current-build/feature-contribution.js";
import type { FeatureCompositionContext } from "./feature-contribution-catalog.js";

/**
 * The only module that knows the concrete side panel features.
 * Feature UI pulls React in, so the service worker must never reach this graph.
 */
export type SidePanelFeatureContributions = readonly [
  CandidateManagementContribution,
  CurrentBuildContribution,
];

/**
 * current-build depends on candidate-management's public query, so
 * contributions are built in dependency order rather than as a uniform list.
 */
export const createSidePanelFeatureContributions = (
  context: FeatureCompositionContext,
): SidePanelFeatureContributions => {
  const candidateManagement = createCandidateManagementContribution(context);
  const currentBuild = createCurrentBuildContribution(context, {
    candidates: candidateManagement.registration.publicApi.query,
  });
  return [candidateManagement, currentBuild];
};
