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
import { createCaptureNormalizer } from "./normalizer.js";
import type { ProductCapturePublicApi } from "./public.js";
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
  ProductCapturePublicApi
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
  const coordinator = createCaptureCoordinator({
    runtime: dependencies.runtime,
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
  });
  const state = createCaptureState({
    coordinator,
    isCurrent: (activationId) =>
      dependencies.transientSurface.isCurrent(activationId),
  });
  return {
    key: productCaptureContributionKey,
    registration: createProductCaptureFeatureRegistration({ state }),
  };
};
