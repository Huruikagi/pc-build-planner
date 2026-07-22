import {
  type CandidateManagementContribution,
  createCandidateManagementContribution,
} from "../features/candidate-management/feature-contribution.js";
import type {
  FeatureCompositionContext,
  FeatureContributionFactory,
} from "./feature-contribution-catalog.js";

/**
 * The only module that knows the concrete side panel features.
 * Feature UI pulls React in, so the service worker must never reach this graph.
 */
export type SidePanelFeatureContributions = readonly [
  CandidateManagementContribution,
];

/** Every side panel feature participates through this factory contract. */
const factories = [
  createCandidateManagementContribution,
] as const satisfies readonly FeatureContributionFactory[];

export const createSidePanelFeatureContributions = (
  context: FeatureCompositionContext,
): SidePanelFeatureContributions => [factories[0](context)];
