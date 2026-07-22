import type {
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
} from "../../application-shell/public.js";
import {
  err,
  ok,
  type ProjectId,
  validateCandidatePartContent,
} from "../../domain/public.js";
import type { CandidateDraft } from "./contracts.js";
import type { ManagementState } from "./state.js";

export const candidateManagementFeatureId = "candidate-management" as FeatureId;
export const openCandidateEditorTarget = "open-candidate-editor";

export interface CandidateEditorPrefill {
  readonly projectId: ProjectId;
  readonly draft: CandidateDraft;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.every((key) => key in value);

const hasAllowedKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
) => Object.keys(value).every((key) => keys.includes(key));

const isDraft = (value: unknown): value is CandidateDraft => {
  if (
    !isRecord(value) ||
    !hasAllowedKeys(value, [
      "projectId",
      "category",
      "product",
      "normalizedAttributes",
      "sourceInfo",
      "sourceSnapshot",
    ]) ||
    typeof value.projectId !== "string" ||
    typeof value.category !== "string" ||
    !isRecord(value.product) ||
    !isRecord(value.product.name)
  ) {
    return false;
  }
  const name = value.product.name;
  if (
    !hasAllowedKeys(name, ["original", "confirmed"]) ||
    !(
      (typeof name.original === "string" && name.original.trim().length > 0) ||
      (typeof name.confirmed === "string" && name.confirmed.trim().length > 0)
    )
  ) {
    return false;
  }
  /**
   * Validates the draft itself. Fabricating a LocalDataRoot here would couple
   * candidate management to CurrentBuild, maintenance and request dedupe,
   * none of which this feature owns.
   */
  return validateCandidatePartContent(value).ok;
};

const isCandidateEditorPrefill = (
  payload: unknown,
): payload is CandidateEditorPrefill =>
  isRecord(payload) &&
  hasOnlyKeys(payload, ["projectId", "draft"]) &&
  typeof payload.projectId === "string" &&
  isDraft(payload.draft) &&
  payload.draft.projectId === payload.projectId;

/** Revalidates shell-delivered unknown payloads before changing feature UI state. */
export const createCandidateActivation = (
  state: ManagementState,
): FeatureActivationAdapter<CandidateEditorPrefill> => ({
  validate(intent: FeatureActivationIntent) {
    if (
      intent.featureId !== candidateManagementFeatureId ||
      intent.target !== openCandidateEditorTarget ||
      !isCandidateEditorPrefill(intent.payload)
    ) {
      return err<FeatureActivationError>({
        kind: "invalid_activation",
        detail: "candidate editor prefill is invalid",
      });
    }
    return ok(intent.payload);
  },

  async activate(prefill) {
    if (
      !state.value.projects.some((project) => project.id === prefill.projectId)
    ) {
      return err<FeatureActivationError>({
        kind: "activation_failed",
        detail: "project does not exist",
      });
    }
    await state.selectProject(prefill.projectId);
    state.beginCreate(prefill.draft);
    return ok(undefined);
  },
});
