import type {
  FeatureContribution,
  TransientSurfaceLifecyclePort,
} from "../../application-shell/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../candidate-management/public.js";
import type { PagePriceExtractionPort } from "../product-capture/public.js";
import type { SourcePriceRefreshPublicApi } from "./contracts.js";
import { createSourcePriceRefreshFeatureRegistration } from "./registration.js";
import {
  createSourcePriceRefreshService,
  createSourcePriceRefreshWorkflow,
} from "./service.js";
import { createSourcePriceRefreshState } from "./state.js";

export const sourcePriceRefreshContributionKey = "sourcePriceRefresh";

export type SourcePriceRefreshContribution = FeatureContribution<
  typeof sourcePriceRefreshContributionKey,
  SourcePriceRefreshPublicApi
>;

export interface SourcePriceRefreshContributionDependencies {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
  readonly pagePriceExtraction: PagePriceExtractionPort;
  readonly transientSurface: TransientSurfaceLifecyclePort;
}

export const createSourcePriceRefreshContribution = (
  dependencies: SourcePriceRefreshContributionDependencies,
): SourcePriceRefreshContribution => {
  const refresh = createSourcePriceRefreshService({
    catalog: dependencies.catalog,
    mutations: dependencies.mutations,
  });
  const isCurrent = (
    activationId: Parameters<TransientSurfaceLifecyclePort["isCurrent"]>[0],
  ) => dependencies.transientSurface.isCurrent(activationId);
  const runRefresh = createSourcePriceRefreshWorkflow({
    refresh,
    pagePriceExtraction: dependencies.pagePriceExtraction,
    isCurrent,
  });
  return {
    key: sourcePriceRefreshContributionKey,
    registration: createSourcePriceRefreshFeatureRegistration({
      publicApi: { refresh },
      createState: () =>
        createSourcePriceRefreshState({ runRefresh, isCurrent }),
    }),
  };
};
