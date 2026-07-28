import type {
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
} from "../../application-shell/public.js";
import {
  err,
  ok,
  PART_CATEGORIES,
  type PartCategory,
  type ProjectId,
  validateCandidatePartContent,
  validateCandidatePartV2Value,
} from "../../domain/public.js";
import { withCategory } from "./category-draft.js";
import type { CandidateDraft, CandidateSourceDraft } from "./contracts.js";
import type { ManagementState } from "./state.js";

export const candidateManagementFeatureId = "candidate-management" as FeatureId;
export const openCandidateEditorTarget = "open-candidate-editor";

export interface CandidateEditorPrefill {
  readonly projectId: ProjectId;
  readonly draft: CandidateSourceDraft;
  /**
   * A non-binding category suggestion (e.g. inferred from a captured page's
   * category label). It seeds the editor's default selection only when the
   * draft has no confirmed category; the user still ratifies it by saving.
   */
  readonly categoryHint?: PartCategory;
}

export interface LegacyCandidateEditorPrefill {
  readonly projectId: ProjectId;
  readonly draft: CandidateDraft;
  readonly categoryHint?: PartCategory;
}

/** Typed navigation factory owned with the candidate editor activation contract. */
export const createCandidateEditorIntent = (
  prefill: CandidateEditorPrefill,
): FeatureActivationIntent => ({
  featureId: candidateManagementFeatureId,
  target: openCandidateEditorTarget,
  payload: prefill,
});

const isPartCategory = (value: unknown): value is PartCategory =>
  typeof value === "string" &&
  (PART_CATEGORIES as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const isSourceDraft = (value: unknown): value is CandidateSourceDraft => {
  if (
    !isRecord(value) ||
    !hasAllowedKeys(value, [
      "projectId",
      "category",
      "product",
      "normalizedAttributes",
      "sources",
      "primarySourceId",
      "sourceSnapshot",
    ]) ||
    !isRecord(value.product) ||
    !isRecord(value.product.name)
  )
    return false;
  const name = value.product.name;
  if (
    !hasAllowedKeys(name, ["original", "confirmed"]) ||
    !(
      (typeof name.original === "string" && name.original.trim().length > 0) ||
      (typeof name.confirmed === "string" && name.confirmed.trim().length > 0)
    )
  )
    return false;
  return validateCandidatePartV2Value({
    ...value,
    id: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }).ok;
};

type CandidateActivationPrefill =
  | CandidateEditorPrefill
  | LegacyCandidateEditorPrefill;

const isCandidateEditorPrefill = (
  payload: unknown,
): payload is CandidateActivationPrefill =>
  isRecord(payload) &&
  hasAllowedKeys(payload, ["projectId", "draft", "categoryHint"]) &&
  typeof payload.projectId === "string" &&
  (isDraft(payload.draft) || isSourceDraft(payload.draft)) &&
  payload.draft.projectId === payload.projectId &&
  (payload.categoryHint === undefined || isPartCategory(payload.categoryHint));

/** Revalidates shell-delivered unknown payloads before changing feature UI state. */
export const createCandidateActivation = (
  state: ManagementState,
): FeatureActivationAdapter<CandidateActivationPrefill> => ({
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
    /**
     * Apply the suggestion only when the draft carries no confirmed category,
     * so an existing formal category always wins over a hint. The seeded draft
     * is unsaved editor state, ratified by the user on save.
     */
    const initialDraft =
      prefill.categoryHint !== undefined &&
      prefill.draft.category === "uncategorized"
        ? withCategory(prefill.draft, prefill.categoryHint)
        : prefill.draft;
    state.beginCreate(initialDraft);
    /**
     * The editor stays closed when the shell forbids mutations, so reporting
     * success would tell an upstream capture feature that an editor it cannot
     * see is open.
     */
    if (state.value.editor === null) {
      return err<FeatureActivationError>({
        kind: "activation_failed",
        detail: "candidate editor could not be opened",
      });
    }
    return ok(undefined);
  },
});
