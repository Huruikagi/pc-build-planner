import type {
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
} from "../../application-shell/public.js";
import { err, ok, type ProjectId, type Result } from "../../domain/public.js";
import { resolvePreEditDraft } from "./category-draft.js";
import type { UnresolvedCandidateEditorPrefill } from "./contracts.js";
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
  | "pending-pre-edit-unavailable"
  | "editor-mutation-disabled"
  | "editor-state-unavailable";

/**
 * How a validated pre-edit was accepted. Both outcomes are successes for the
 * upstream transient surface: the capture may end once either is reported.
 */
export type CandidateActivationAcceptance =
  | { readonly kind: "bound"; readonly projectId: ProjectId }
  | { readonly kind: "pending" };

/**
 * Accepts a validated pre-edit against the current context only. The payload,
 * the screen snapshot, and the project catalog are never consulted for the
 * save target, and the current context itself is left unchanged.
 */
export const acceptCandidatePreEdit = async (
  state: ManagementState,
  prefill: CandidateActivationPrefill,
  reportDiagnostic: (
    code: CandidateActivationDiagnosticCode,
  ) => void = () => {},
): Promise<Result<CandidateActivationAcceptance, FeatureActivationError>> => {
  if (state.value.mutationsDisabled) {
    reportDiagnostic("editor-mutation-disabled");
    return err<FeatureActivationError>({
      kind: "activation_failed",
      detail: "candidate editor could not be opened",
      reason: "operation-blocked",
    });
  }
  const resolution = state.resolveCurrentProject();
  if (resolution.status !== "resolved") {
    /**
     * An unselected or unavailable current context is not a failure: the
     * pre-edit is held so an explicit choice or a context recovery can resume
     * it later, and no project is invented in the meantime.
     */
    state.holdPendingPreEdit(prefill);
    if (state.value.pendingPreEdit !== null) return ok({ kind: "pending" });
    reportDiagnostic("pending-pre-edit-unavailable");
    return err<FeatureActivationError>({
      kind: "activation_failed",
      detail: "candidate editor could not be opened",
      reason: "target-state-unavailable",
    });
  }
  const projectId = resolution.projectId;
  await state.selectProject(projectId);
  state.beginCreate(
    resolvePreEditDraft(prefill, projectId),
    prefill.captureDiagnostics,
  );
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
  return ok({ kind: "bound", projectId });
};

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
    const accepted = await acceptCandidatePreEdit(
      state,
      prefill,
      reportDiagnostic,
    );
    return accepted.ok ? ok(undefined) : accepted;
  },
});
