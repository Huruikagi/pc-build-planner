import {
  err,
  isUuid,
  ok,
  PART_CATEGORIES,
  type PartCategory,
  type Result,
  validateCandidatePartDraft,
} from "../../domain/public.js";
import type {
  UnresolvedCandidateDraft,
  UnresolvedCandidateEditorPrefill,
} from "./contracts.js";

export type PreEditDraftError =
  | { readonly kind: "invalid-draft-shape" }
  | { readonly kind: "invalid-category" }
  | { readonly kind: "category-mismatch" };

export type CandidateEditorPrefillError =
  | PreEditDraftError
  | { readonly kind: "invalid-project-id" }
  | { readonly kind: "invalid-category-hint" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const isPartCategory = (value: unknown): value is PartCategory =>
  typeof value === "string" &&
  (PART_CATEGORIES as readonly string[]).includes(value);

export const validatePreEditDraft = (
  draft: unknown,
): Result<UnresolvedCandidateDraft, PreEditDraftError> => {
  const result = validateCandidatePartDraft(draft);
  if (result.ok) return ok(result.value as UnresolvedCandidateDraft);
  if (result.error.code === "category-mismatch")
    return err({
      kind:
        result.error.path === "$.category"
          ? "invalid-category"
          : "category-mismatch",
    });
  return err({ kind: "invalid-draft-shape" });
};

export const validateCandidateEditorPrefill = (
  value: unknown,
): Result<UnresolvedCandidateEditorPrefill, CandidateEditorPrefillError> => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["draft", "projectId", "categoryHint"]) ||
    !("draft" in value)
  )
    return err({ kind: "invalid-draft-shape" });
  if (value.projectId !== undefined && !isUuid(value.projectId))
    return err({ kind: "invalid-project-id" });
  if (value.categoryHint !== undefined && !isPartCategory(value.categoryHint))
    return err({ kind: "invalid-category-hint" });
  const draft = validatePreEditDraft(value.draft);
  if (!draft.ok) return draft;
  const projectId = value.projectId as
    | UnresolvedCandidateEditorPrefill["projectId"]
    | undefined;
  const categoryHint = value.categoryHint as PartCategory | undefined;
  if (projectId !== undefined && categoryHint !== undefined)
    return ok({ draft: draft.value, projectId, categoryHint });
  if (projectId !== undefined) return ok({ draft: draft.value, projectId });
  if (categoryHint !== undefined)
    return ok({ draft: draft.value, categoryHint });
  return ok({ draft: draft.value });
};
