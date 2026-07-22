import type { PublicApiCompositionError } from "./application-shell/contracts.js";
import type {
  FeatureCompositionContext,
  FeaturePublicApiContribution,
} from "./application-shell/feature-contribution-catalog.js";
import { getPublicApiContributions } from "./application-shell/feature-contribution-catalog.js";
import { createPublicApiRegistry } from "./application-shell/public-api-registry.js";
import type { SidePanelFeatureContributions } from "./application-shell/side-panel-contributions.js";
import { createSidePanelFeatureContributions } from "./application-shell/side-panel-contributions.js";
import type { Result } from "./domain/public.js";

export type { FeatureCompositionContext };

type SidePanelPublicApiEntries = readonly FeaturePublicApiContribution<
  SidePanelFeatureContributions[number]
>[];

/** Root public contract derived from the side panel contribution catalog. */
export type ApplicationApi = Readonly<{
  [TEntry in SidePanelPublicApiEntries[number] as TEntry["key"]]: TEntry["publicApi"];
}>;

/**
 * Real features need a foundation data port, so the root barrel composes on
 * demand from the same context production composition resolves.
 */
export const composeApplicationApi = (
  context: FeatureCompositionContext,
): Result<ApplicationApi, PublicApiCompositionError> =>
  createPublicApiRegistry().composeEntries(
    getPublicApiContributions(createSidePanelFeatureContributions(context)),
  ) as Result<ApplicationApi, PublicApiCompositionError>;
