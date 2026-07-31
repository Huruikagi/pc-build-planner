import type {
  FeatureCompositionContext,
  FeatureContribution,
  TransientSurfaceLifecyclePort,
} from "../../application-shell/public.js";
import type { CandidateManagementPublicApi } from "../candidate-management/public.js";
import {
  type CaptureRuntimePort,
  createCaptureCoordinator,
} from "./coordinator.js";
import { createCandidateEditorHandoff } from "./editor-handoff.js";
import { createCaptureNormalizer } from "./normalizer.js";
import { createPagePriceExtractionAdapter } from "./page-price-extraction.js";
import {
  createProductCapturePublicApi,
  type ProductCapturePublicApi,
} from "./public.js";
import { createCandidateRanker } from "./ranker.js";
import { createProductCaptureFeatureRegistration } from "./registration.js";
import { createCaptureState } from "./state.js";

export {
  type ChromeScriptingApi,
  type ChromeTabsApi,
  createChromeCaptureRuntimePort,
} from "./chrome-runtime-port.js";
export type { CaptureRuntimePort } from "./coordinator.js";

export const productCaptureContributionKey = "productCapture";
export type ProductCaptureContribution = FeatureContribution<
  typeof productCaptureContributionKey,
  ProductCapturePublicApi,
  unknown
>;

export interface ProductCaptureContributionDependencies {
  readonly runtime: CaptureRuntimePort;
  readonly transientSurface: TransientSurfaceLifecyclePort;
  readonly createCandidateEditorIntent: CandidateManagementPublicApi["createCandidateEditorIntent"];
}

export const createProductCaptureContribution = (
  _context: FeatureCompositionContext,
  dependencies: ProductCaptureContributionDependencies,
): ProductCaptureContribution => {
  const normalizer = createCaptureNormalizer();
  const ranker = createCandidateRanker();
  const coordinator = createCaptureCoordinator({
    runtime: dependencies.runtime,
    normalizer,
    ranker,
  });
  const pagePriceExtraction = createPagePriceExtractionAdapter({
    runtime: dependencies.runtime,
    normalizer,
    ranker,
  });
  const publicApi = createProductCapturePublicApi({ pagePriceExtraction });
  const handoff = createCandidateEditorHandoff({
    createCandidateEditorIntent: dependencies.createCandidateEditorIntent,
    conclude: (activationId, intent) =>
      dependencies.transientSurface.conclude(activationId, intent),
  });
  const state = createCaptureState({
    coordinator,
    isCurrent: (activationId) =>
      dependencies.transientSurface.isCurrent(activationId),
    handoff,
  });
  return {
    key: productCaptureContributionKey,
    registration: createProductCaptureFeatureRegistration({ state, publicApi }),
  };
};
