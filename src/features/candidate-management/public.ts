import type {
  FeatureActivationError,
  ShellNavigator,
} from "../../application-shell/public.js";
import { err } from "../../domain/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import {
  type CandidateEditorPrefill,
  candidateManagementFeatureId,
  openCandidateEditorTarget,
} from "./activation.js";
import type { CandidateQuery, CaptureCandidatePort } from "./contracts.js";

export type {
  CandidateDraft,
  CandidateListQuery,
  CandidateManagementService,
  CandidateQuery,
  CandidateSummary,
  CaptureCandidatePort,
  CreateProjectInput,
  ManagementError,
  MutationContext,
  ProjectSummary,
  RenameProjectInput,
  UnresolvedCandidateDraft,
  UnresolvedCandidateEditorPrefill,
  UpdateCandidateInput,
} from "./contracts.js";
export type {
  CandidateEditorPrefillError,
  PreEditDraftError,
} from "./pre-edit-validation.js";
export {
  validateCandidateEditorPrefill,
  validatePreEditDraft,
} from "./pre-edit-validation.js";

/** Feature-local public boundary for downstream candidate-management contracts. */
export interface CandidateManagementPublicApi {
  readonly query: CandidateQuery;
  readonly capture: CaptureCandidatePort;
  openCandidateEditor(
    prefill: CandidateEditorPrefill,
  ): Promise<
    import("../../domain/public.js").Result<void, FeatureActivationError>
  >;
}

export interface CandidateManagementPublicDependencies {
  readonly data: FoundationScopedDataPort;
  readonly query: CandidateQuery;
  readonly capture: CaptureCandidatePort;
  readonly navigator?: ShellNavigator;
}

export const createCandidateManagementPublicApi = (
  dependencies: CandidateManagementPublicDependencies,
): CandidateManagementPublicApi => {
  if (dependencies.query === undefined || dependencies.capture === undefined) {
    throw new TypeError(
      "Candidate management public API requires query and capture dependencies.",
    );
  }
  return Object.freeze({
    query: dependencies.query,
    capture: dependencies.capture,
    openCandidateEditor(prefill: CandidateEditorPrefill) {
      if (dependencies.navigator === undefined) {
        return Promise.resolve(
          err<FeatureActivationError>({
            kind: "invalid_activation",
            detail: "navigator unavailable",
          }),
        );
      }
      return dependencies.navigator.activate({
        featureId: candidateManagementFeatureId,
        target: openCandidateEditorTarget,
        payload: prefill,
      });
    },
  });
};

export type { CandidateEditorPrefill } from "./activation.js";
