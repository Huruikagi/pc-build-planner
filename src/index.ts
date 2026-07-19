import {
  featureContributionCatalog,
  getPublicApiContributions,
} from "./application-shell/feature-contribution-catalog.js";
import { createPublicApiRegistry } from "./application-shell/public-api-registry.js";

const composed = createPublicApiRegistry().composeEntries(
  getPublicApiContributions(featureContributionCatalog),
);

if (!composed.ok) {
  throw new Error("Application public API catalog is invalid.");
}

export type ApplicationApi = typeof composed.value;
export const applicationApi: ApplicationApi = composed.value;
