import {
  type CandidateSourceId,
  createUuid,
  ok,
  type Result,
} from "../../domain/public.js";
import type { CandidateManagementPublicApi } from "../candidate-management/public.js";
import { decodeCaptureResult } from "./capture-schema.js";
import { inferCategoryHint } from "./category-hint.js";
import type {
  CaptureError,
  CaptureResult,
  NormalizedField,
} from "./contracts.js";

type CandidateEditorIntentFactory =
  CandidateManagementPublicApi["createCandidateEditorIntent"];
type UnresolvedCandidateDraft =
  Parameters<CandidateEditorIntentFactory>[0]["draft"];
type UnresolvedCandidateEditorPrefill =
  Parameters<CandidateEditorIntentFactory>[0];
type CaptureDiagnostic = NonNullable<
  UnresolvedCandidateEditorPrefill["captureDiagnostics"]
>[number];
export interface CaptureDraftMapperDependencies {
  readonly createSourceId?: () => CandidateSourceId;
}

export const createCaptureDraftMapper = (
  dependencies: CaptureDraftMapperDependencies = {},
): UnresolvedCaptureDraftMapper => ({
  toUnresolvedDraft(value) {
    const result = decodeCaptureResult(value);
    return !result.ok
      ? result
      : ok(
          unresolvedDraftFromResult(
            result.value,
            dependencies.createSourceId ??
              (() => createUuid() as CandidateSourceId),
          ),
        );
  },
  toEditorPrefill(value) {
    const result = decodeCaptureResult(value);
    if (!result.ok) return result;
    const category = result.value.draft.fields.find(
      (field) => field.field === "category",
    );
    const categoryHint = inferCategoryHint(
      typeof category?.normalizedValue === "string"
        ? category.normalizedValue
        : undefined,
    );
    return ok({
      draft: unresolvedDraftFromResult(
        result.value,
        dependencies.createSourceId ??
          (() => createUuid() as CandidateSourceId),
      ),
      ...(categoryHint === undefined ? {} : { categoryHint }),
      ...(result.value.rejectedFields.length === 0
        ? {}
        : {
            captureDiagnostics: projectCaptureDiagnostics(
              result.value.rejectedFields,
            ),
          }),
    });
  },
  toManualDraft() {
    return { ...unresolvedDraftFromFields([]), sources: [] };
  },
});

const unresolvedDraftFromFields = (
  fields: readonly NormalizedField[],
): UnresolvedCandidateDraft => {
  const find = (field: "name" | "manufacturer" | "modelNumber") =>
    fields.find((candidate) => candidate.field === field);
  const name = find("name");
  const manufacturer = find("manufacturer");
  const modelNumber = find("modelNumber");
  return {
    category: "uncategorized",
    product: {
      name: {
        original: name?.rawValue ?? null,
        confirmed:
          typeof name?.normalizedValue === "string" ? name.normalizedValue : "",
      },
      ...(manufacturer !== undefined &&
      typeof manufacturer.normalizedValue === "string"
        ? {
            manufacturer: {
              original: manufacturer.rawValue,
              confirmed: manufacturer.normalizedValue,
            },
          }
        : {}),
      ...(modelNumber !== undefined &&
      typeof modelNumber.normalizedValue === "string"
        ? {
            modelNumber: {
              original: modelNumber.rawValue,
              confirmed: modelNumber.normalizedValue,
            },
          }
        : {}),
    },
    sources: [],
    normalizedAttributes: { category: "uncategorized" },
  };
};

const unresolvedDraftFromResult = (
  result: CaptureResult,
  createSourceId: () => CandidateSourceId,
): UnresolvedCandidateDraft => {
  const price = result.draft.fields.find((field) => field.field === "price");
  const sourceId = createSourceId();
  return {
    ...unresolvedDraftFromFields(result.draft.fields),
    sources: [
      {
        id: sourceId,
        pageUrl: result.pageUrl,
        capturedAt: result.capturedAt,
        ...(price !== undefined && typeof price.normalizedValue === "object"
          ? {
              price: {
                original: price.rawValue,
                confirmed: price.normalizedValue,
              },
            }
          : {}),
        // Display-only: never an input to the source id, the page URL, or the kind.
        ...(result.siteName === undefined
          ? {}
          : { siteName: result.siteName.value }),
      },
    ],
    primarySourceId: sourceId,
    sourceSnapshot: Object.fromEntries([
      ...result.draft.fields.flatMap((field) => [
        [field.field, field.rawValue],
        [`${field.field}:source`, field.source],
        [`${field.field}:sourceLabel`, field.sourceLabel],
      ]),
      ...(result.siteName === undefined
        ? []
        : [
            ["siteName", result.siteName.rawValue],
            ["siteName:source", result.siteName.source],
            ["siteName:sourceLabel", result.siteName.sourceLabel],
          ]),
    ]),
  };
};

const projectCaptureDiagnostics = (
  rejectedFields: CaptureResult["rejectedFields"],
): NonNullable<UnresolvedCandidateEditorPrefill["captureDiagnostics"]> => {
  const seen = new Set<string>();
  return rejectedFields.flatMap(({ field, reason }) => {
    const projectedField: CaptureDiagnostic["field"] = field.startsWith("spec:")
      ? ("specification" as const)
      : (field as CaptureDiagnostic["field"]);
    const key = `${projectedField}:${reason}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ field: projectedField, reason }];
  });
};

export interface UnresolvedCaptureDraftMapper {
  toUnresolvedDraft(
    result: unknown,
  ): Result<UnresolvedCandidateDraft, CaptureError>;
  toEditorPrefill(
    result: unknown,
  ): Result<UnresolvedCandidateEditorPrefill, CaptureError>;
  toManualDraft(): UnresolvedCandidateDraft;
}

/** Converts the validated extraction boundary into a project-free, minimal pre-edit draft. */
