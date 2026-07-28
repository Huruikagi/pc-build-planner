import type { FeatureActivationError } from "../../application-shell/public.js";
import { err, ok, type ProjectId, type Result } from "../../domain/public.js";
import type { ResolvedCandidateEditorPrefill } from "../candidate-management/public.js";
import { inferCategoryHint } from "./category-hint.js";
import type { CaptureError, CaptureSession } from "./contracts.js";
import { toCandidateDraft } from "./draft-mapper.js";

/** The current category label a user would see: their edit, else the extracted value. */
const resolvedCategoryText = (session: CaptureSession): string | undefined => {
  const corrected = session.userCorrections.category;
  if (corrected !== undefined) return corrected;
  const entry = session.fields.find((field) => field.field === "category");
  if (entry === undefined) return undefined;
  return typeof entry.value.confirmed === "string"
    ? entry.value.confirmed
    : (entry.value.original ?? undefined);
};

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
    prefill: ResolvedCandidateEditorPrefill,
  ) => Promise<Result<void, FeatureActivationError>>;
}

/**
 * `CaptureError`'s `navigation` variant carries no detail (the UI shows one
 * fixed message for every cause), so the underlying reason would otherwise be
 * lost the moment this conversion happens. Logging it here — the last point
 * where it's still available — is the only way to diagnose *why* a detail
 * transition failed, since `side-panel-host` treats an activation failure as
 * a normal `Result` and never reports it as a diagnostic itself.
 */
const toNavigationError = (error: FeatureActivationError): CaptureError => {
  console.error("product-capture: detail edit activation failed", error);
  return { kind: "navigation" };
};

export const createCandidateEditorNavigation = (
  dependencies: CandidateEditorNavigationDependencies,
): CandidateEditorNavigation => ({
  async open(session) {
    const draft = toCandidateDraft(session);
    if (!draft.ok) return draft;

    const categoryHint = inferCategoryHint(resolvedCategoryText(session));
    const result = await dependencies.openCandidateEditor({
      projectId: draft.value.projectId,
      draft: draft.value,
      ...(categoryHint === undefined ? {} : { categoryHint }),
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
        sources: [],
        normalizedAttributes: { category: "uncategorized" },
      },
    });
    return result.ok ? ok(undefined) : err(toNavigationError(result.error));
  },
});
