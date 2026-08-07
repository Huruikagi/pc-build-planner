import {
  err,
  ok,
  PART_CATEGORIES,
  type PartCategory,
  type Result,
  validateCandidatePartDraft,
} from "../../domain/public.js";
import {
  decodeWithProfile,
  optionalField,
  plainObject,
  tagged,
  uuid,
  z,
} from "../../domain/runtime-schema/public.js";
import type {
  CaptureDiagnosticField,
  CaptureDiagnosticReason,
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

const isPartCategory = (value: unknown): value is PartCategory =>
  typeof value === "string" &&
  (PART_CATEGORIES as readonly string[]).includes(value);

const diagnosticReasons = new Set([
  "empty",
  "too-long",
  "control-characters",
  "invalid-format",
  "unresolvable",
]);
const captureCoreFields = new Set([
  "name",
  "category",
  "manufacturer",
  "modelNumber",
  "price",
  "url",
  "specification",
]);
const isCaptureDiagnosticField = (value: unknown): boolean =>
  typeof value === "string" && captureCoreFields.has(value);

const invalid = <S extends Parameters<typeof tagged>[0]>(
  schema: S,
  tag: CandidateEditorPrefillError["kind"],
): S => tagged(schema, tag);
const captureDiagnosticSchema = plainObject({
  field: invalid(
    z.custom<CaptureDiagnosticField>(isCaptureDiagnosticField),
    "invalid-draft-shape",
  ),
  reason: invalid(
    z.custom<CaptureDiagnosticReason>(
      (value) => typeof value === "string" && diagnosticReasons.has(value),
    ),
    "invalid-draft-shape",
  ),
});
const candidateEditorPrefillSchema = plainObject({
  draft: invalid(z.unknown(), "invalid-draft-shape"),
  projectId: optionalField(
    invalid(
      uuid<NonNullable<UnresolvedCandidateEditorPrefill["projectId"]>>(),
      "invalid-project-id",
    ),
  ),
  categoryHint: optionalField(
    invalid(z.custom<PartCategory>(isPartCategory), "invalid-category-hint"),
  ),
  captureDiagnostics: optionalField(
    invalid(z.array(captureDiagnosticSchema), "invalid-draft-shape"),
  ),
});

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
  const decoded = decodeWithProfile(candidateEditorPrefillSchema, value, {
    toError: (issue): CandidateEditorPrefillError => ({
      kind:
        issue.tag === "invalid-project-id" ||
        issue.tag === "invalid-category-hint"
          ? issue.tag
          : "invalid-draft-shape",
    }),
  });
  if (!decoded.ok) return decoded;
  if (
    decoded.value.captureDiagnostics !== undefined &&
    new Set(
      decoded.value.captureDiagnostics.map(
        (diagnostic) => `${diagnostic.field}:${diagnostic.reason}`,
      ),
    ).size !== decoded.value.captureDiagnostics.length
  )
    return err({ kind: "invalid-draft-shape" });
  const draft = validatePreEditDraft(decoded.value.draft);
  if (!draft.ok) return draft;
  const validated: UnresolvedCandidateEditorPrefill = {
    draft: draft.value,
    ...(decoded.value.projectId === undefined
      ? {}
      : { projectId: decoded.value.projectId }),
    ...(decoded.value.categoryHint === undefined
      ? {}
      : { categoryHint: decoded.value.categoryHint }),
    ...(decoded.value.captureDiagnostics === undefined
      ? {}
      : { captureDiagnostics: decoded.value.captureDiagnostics }),
  };
  return ok(validated);
};
