import type {
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
} from "../../application-shell/public.js";
import { err, ok } from "../../domain/public.js";
import { withCategory } from "./category-draft.js";
import type {
  CandidateDraft,
  UnresolvedCandidateEditorPrefill,
} from "./contracts.js";
import { validateCandidateEditorPrefill } from "./pre-edit-validation.js";
import type { ManagementState } from "./state.js";

export const candidateManagementFeatureId = "candidate-management" as FeatureId;
export const openCandidateEditorTarget = "open-candidate-editor";

/** Typed navigation factory owned with the candidate editor activation contract. */
export const createCandidateEditorIntent = (
  prefill: UnresolvedCandidateEditorPrefill,
): FeatureActivationIntent => ({
  featureId: candidateManagementFeatureId,
  target: openCandidateEditorTarget,
  payload: prefill,
});

export type CandidateActivationPrefill = UnresolvedCandidateEditorPrefill;

export type CandidateActivationDiagnosticCode =
  | "prefill-invalid"
  | "project-unavailable"
  | "pending-pre-edit-unavailable"
  | "editor-mutation-disabled"
  | "editor-state-unavailable";

/** Revalidates shell-delivered unknown payloads before changing feature UI state. */
export const createCandidateActivation = (
  state: ManagementState,
  reportDiagnostic: (
    code: CandidateActivationDiagnosticCode,
  ) => void = () => {},
): FeatureActivationAdapter<CandidateActivationPrefill> => ({
  validate(intent: FeatureActivationIntent) {
    if (
      intent.featureId !== candidateManagementFeatureId ||
      intent.target !== openCandidateEditorTarget
    ) {
      reportDiagnostic("prefill-invalid");
      return err<FeatureActivationError>({
        kind: "invalid_activation",
        detail: "candidate editor prefill is invalid",
      });
    }
    const unresolved = validateCandidateEditorPrefill(intent.payload);
    if (unresolved.ok) return unresolved;
    reportDiagnostic("prefill-invalid");
    return err<FeatureActivationError>({
      kind: "invalid_activation",
      detail: "candidate editor prefill is invalid",
    });
  },

  async activate(prefill) {
    if (state.value.mutationsDisabled) {
      reportDiagnostic("editor-mutation-disabled");
      return err<FeatureActivationError>({
        kind: "activation_failed",
        detail: "candidate editor could not be opened",
        reason: "operation-blocked",
      });
    }
    const requestedProjectId = prefill.projectId;
    const projectId =
      requestedProjectId ??
      state.value.selectedProjectId ??
      state.value.projects[0]?.id;
    if (projectId === undefined && state.value.projects.length === 0) {
      state.holdPendingPreEdit(prefill);
      if (state.value.pendingPreEdit !== null) return ok(undefined);
      reportDiagnostic("pending-pre-edit-unavailable");
    }
    if (
      projectId === undefined ||
      !state.value.projects.some((project) => project.id === projectId)
    ) {
      reportDiagnostic("project-unavailable");
      return err<FeatureActivationError>({
        kind: "activation_failed",
        detail: "project does not exist",
        reason: "target-data-unavailable",
      });
    }
    await state.selectProject(projectId);
    const resolvedDraft: CandidateDraft = { ...prefill.draft, projectId };
    /**
     * Apply the suggestion only when the draft carries no confirmed category,
     * so an existing formal category always wins over a hint. The seeded draft
     * is unsaved editor state, ratified by the user on save.
     */
    const initialDraft =
      prefill.categoryHint !== undefined &&
      resolvedDraft.category === "uncategorized"
        ? withCategory(resolvedDraft, prefill.categoryHint)
        : resolvedDraft;
    state.beginCreate(initialDraft, prefill.captureDiagnostics);
    /**
     * The editor stays closed when the shell forbids mutations, so reporting
     * success would tell an upstream capture feature that an editor it cannot
     * see is open.
     */
    if (state.value.editor === null) {
      reportDiagnostic(
        state.value.mutationsDisabled
          ? "editor-mutation-disabled"
          : "editor-state-unavailable",
      );
      return err<FeatureActivationError>({
        kind: "activation_failed",
        detail: "candidate editor could not be opened",
        reason: state.value.mutationsDisabled
          ? "operation-blocked"
          : "target-state-unavailable",
      });
    }
    state.clearPendingPreEditForActivation();
    return ok(undefined);
  },
});
