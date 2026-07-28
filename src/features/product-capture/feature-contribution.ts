import type {
  FeatureActivationError,
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type { Result } from "../../domain/public.js";
import type { LegacyCandidateEditorPrefill as CandidateEditorPrefill } from "../candidate-management/activation.js";
import type { CaptureCandidatePort } from "../candidate-management/contracts.js";
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

export {
  type ChromeScriptingApi,
  type ChromeTabsApi,
  createChromeCaptureRuntimePort,
} from "./chrome-runtime-port.js";
/**
 * Re-exported so `application-shell/side-panel-contributions.ts` (the only
 * caller allowed to construct a real Chrome-backed runtime for this feature)
 * never needs a deep import into `chrome-runtime-port.ts`/`coordinator.ts` —
 * `feature-contribution.ts` is this feature's other allowed shell entry point.
 */
export type { CaptureRuntimePort } from "./coordinator.js";

export const productCaptureContributionKey = "productCapture";

export type ProductCaptureContribution = FeatureContribution<
  typeof productCaptureContributionKey,
  ProductCapturePublicApi
>;

export interface ProductCaptureContributionDependencies {
  readonly runtime: CaptureRuntimePort;
  readonly capture: CaptureCandidatePort;
  readonly openCandidateEditor: (
    prefill: CandidateEditorPrefill,
  ) => Promise<Result<void, FeatureActivationError>>;
  /** Resolved fresh on every mount; see `registration.ts`'s `listProjects`. */
  readonly listProjects: () => Promise<readonly CaptureProjectOption[]>;
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

  /** Manual-entry project resolution needs the latest list even though it runs outside `mount()`'s own async fetch. */
  let latestProjects: readonly CaptureProjectOption[] = [];
  const listProjects = async (): Promise<readonly CaptureProjectOption[]> => {
    latestProjects = await dependencies.listProjects();
    return latestProjects;
  };

  const registration = createProductCaptureFeatureRegistration({
    state,
    listProjects,
    onOpenDetailEdit: (manualName) => {
      if (manualName !== undefined) {
        const projectId = latestProjects[0]?.id;
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
      if (session === undefined) return;
      void navigation.open(session).then((result) => {
        if (!result.ok) state.reportDetailEditFailure(result.error);
      });
    },
  });

  return {
    key: productCaptureContributionKey,
    registration,
    workerRegistration: createCaptureWorkerRegistration({ state }),
  };
};
