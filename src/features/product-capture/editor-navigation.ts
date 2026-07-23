import type { FeatureActivationError } from "../../application-shell/public.js";
import { err, ok, type ProjectId, type Result } from "../../domain/public.js";
import type { CandidateEditorPrefill } from "../candidate-management/public.js";
import type { CaptureError, CaptureSession } from "./contracts.js";
import { toCandidateDraft } from "./draft-mapper.js";

export interface CandidateEditorNavigation {
  /** Requires a non-empty resolved name and a selected project; never invents a prefill. */
  open(session: CaptureSession): Promise<Result<void, CaptureError>>;
  /** The Requirement 4.6 pathway: zero extraction candidates, just a typed name. */
  openManualEntry(
    name: string,
    projectId: ProjectId,
  ): Promise<Result<void, CaptureError>>;
}

export interface CandidateEditorNavigationDependencies {
  readonly openCandidateEditor: (
    prefill: CandidateEditorPrefill,
  ) => Promise<Result<void, FeatureActivationError>>;
}

const toNavigationError = (_error: FeatureActivationError): CaptureError => ({
  kind: "navigation",
});

export const createCandidateEditorNavigation = (
  dependencies: CandidateEditorNavigationDependencies,
): CandidateEditorNavigation => ({
  async open(session) {
    const draft = toCandidateDraft(session);
    if (!draft.ok) return draft;

    const result = await dependencies.openCandidateEditor({
      projectId: draft.value.projectId,
      draft: draft.value,
    });
    return result.ok ? ok(undefined) : err(toNavigationError(result.error));
  },

  async openManualEntry(name, projectId) {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return err({ kind: "validation", fields: { name: "required" } });
    }

    const result = await dependencies.openCandidateEditor({
      projectId,
      draft: {
        projectId,
        category: "uncategorized",
        product: { name: { original: null, confirmed: trimmed } },
        normalizedAttributes: { category: "uncategorized" },
      },
    });
    return result.ok ? ok(undefined) : err(toNavigationError(result.error));
  },
});
