import type {
  ActivationId,
  FeatureActivationIntent,
  TransientSurfaceError,
} from "../../application-shell/public.js";
import { ok, type Result } from "../../domain/public.js";
import type { CandidateManagementPublicApi } from "../candidate-management/public.js";
import type { CaptureError, CaptureResult } from "./contracts.js";
import { createCaptureDraftMapper } from "./draft-mapper.js";

export interface CandidateEditorHandoff {
  prepare(result: CaptureResult): Result<FeatureActivationIntent, CaptureError>;
  prepareManual(): FeatureActivationIntent;
  conclude(
    activationId: ActivationId,
    intent: FeatureActivationIntent,
  ): Promise<Result<void, TransientSurfaceError>>;
  retry(
    activationId: ActivationId,
    retainedIntent: FeatureActivationIntent,
  ): Promise<Result<void, TransientSurfaceError>>;
}

export const createCandidateEditorHandoff = (dependencies: {
  readonly createCandidateEditorIntent: CandidateManagementPublicApi["createCandidateEditorIntent"];
  readonly conclude: CandidateEditorHandoff["conclude"];
}): CandidateEditorHandoff => {
  const mapper = createCaptureDraftMapper();
  const conclude = dependencies.conclude;
  return {
    prepare(result) {
      const mapped = mapper.toEditorPrefill(result);
      return mapped.ok
        ? ok(dependencies.createCandidateEditorIntent(mapped.value))
        : mapped;
    },
    prepareManual: () =>
      dependencies.createCandidateEditorIntent({
        draft: mapper.toManualDraft(),
      }),
    conclude,
    retry: conclude,
  };
};
