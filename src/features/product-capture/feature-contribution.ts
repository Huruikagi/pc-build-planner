import type {
  FeatureActivationError,
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type { Result } from "../../domain/public.js";
import type {
  CandidateEditorPrefill,
  CaptureCandidatePort,
} from "../candidate-management/public.js";
import {
  type CaptureRuntimePort,
  createCaptureCoordinator,
} from "./coordinator.js";
import { createCaptureDraftMapper } from "./draft-mapper.js";
import { createCandidateEditorNavigation } from "./editor-navigation.js";
import { createCaptureNormalizer } from "./normalizer.js";
import type { ProductCapturePublicApi } from "./public.js";
import { createCandidateRanker } from "./ranker.js";
import { createProductCaptureFeatureRegistration } from "./registration.js";
import { createCaptureState } from "./state.js";
import { createSubmitCaptureDraft } from "./submit-draft.js";
import type { CaptureProjectOption } from "./view.js";
import { createCaptureWorkerRegistration } from "./worker-registration.js";

export const productCaptureContributionKey = "productCapture";

export type ProductCaptureContribution = FeatureContribution<
  typeof productCaptureContributionKey,
  ProductCapturePublicApi
>;

/**
 * `runtime` (the `chrome.tabs`/`chrome.scripting`-backed adapter) has no
 * production implementation yet; that Chrome-facing wiring, plus registering
 * this contribution into the real side panel catalog, is tracked as task 6.3
 * so shipping an untestable-in-this-environment adapter isn't done silently.
 */
export interface ProductCaptureContributionDependencies {
  readonly runtime: CaptureRuntimePort;
  readonly capture: CaptureCandidatePort;
  readonly openCandidateEditor: (
    prefill: CandidateEditorPrefill,
  ) => Promise<Result<void, FeatureActivationError>>;
  readonly projects: readonly CaptureProjectOption[];
}

/**
 * Assembles the feature from composition-supplied dependencies only. `state`
 * is a single instance shared by the mounted view and the worker's action
 * handler, so a capture session survives a detail-edit round trip without any
 * snapshot/restore machinery: switching the side panel away only unmounts the
 * React root, it never discards this instance.
 */
export const createProductCaptureContribution = (
  _context: FeatureCompositionContext,
  dependencies: ProductCaptureContributionDependencies,
): ProductCaptureContribution => {
  const coordinator = createCaptureCoordinator({
    runtime: dependencies.runtime,
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
  });
  const submitDraft = createSubmitCaptureDraft({
    draftMapper: createCaptureDraftMapper(),
    capturePort: dependencies.capture,
  });
  const state = createCaptureState({ coordinator, submitDraft });
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: dependencies.openCandidateEditor,
  });

  const registration = createProductCaptureFeatureRegistration({
    state,
    projects: dependencies.projects,
    onOpenDetailEdit: (manualName) => {
      if (manualName !== undefined) {
        const projectId = dependencies.projects[0]?.id;
        if (projectId !== undefined)
          void navigation.openManualEntry(manualName, projectId);
        return;
      }
      const value = state.value;
      const session =
        value.status === "review"
          ? value.session
          : value.status === "failed"
            ? value.draft
            : undefined;
      if (session !== undefined) void navigation.open(session);
    },
  });

  return {
    key: productCaptureContributionKey,
    registration,
    workerRegistration: createCaptureWorkerRegistration({ state }),
  };
};
