import {
  err,
  isUtcTimestamp,
  isUuid,
  ok,
  type Result,
} from "../../domain/public.js";
import type { CandidateManagementPublicApi } from "../candidate-management/public.js";
import type {
  CaptureError,
  CaptureResult,
  NormalizedField,
} from "./contracts.js";
import { CAPTURE_CORE_FIELDS } from "./contracts.js";

type CandidateEditorIntentFactory =
  CandidateManagementPublicApi["createCandidateEditorIntent"];
type UnresolvedCandidateDraft =
  Parameters<CandidateEditorIntentFactory>[0]["draft"];
export const createCaptureDraftMapper = (): UnresolvedCaptureDraftMapper => ({
  toUnresolvedDraft(value) {
    const result = decodeCaptureResult(value);
    return result === undefined
      ? err({ kind: "invalid-payload" })
      : ok(unresolvedDraftFromFields(result.draft.fields));
  },
  toManualDraft() {
    return unresolvedDraftFromFields([]);
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const coreFields = new Set<string>(CAPTURE_CORE_FIELDS);
const extractionSources = new Set([
  "json-ld",
  "meta",
  "heading",
  "breadcrumb",
  "table",
  "definition-list",
  "domain-map",
]);
const rejectionReasons = new Set([
  "empty",
  "too-long",
  "control-characters",
  "invalid-format",
  "unresolvable",
]);

const isNormalizedField = (value: unknown): value is NormalizedField =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    "field",
    "normalizedValue",
    "rawValue",
    "source",
    "sourceLabel",
  ]) &&
  typeof value.field === "string" &&
  (coreFields.has(value.field) || value.field.startsWith("spec:")) &&
  (typeof value.normalizedValue === "string" ||
    (isRecord(value.normalizedValue) &&
      hasOnlyKeys(value.normalizedValue, ["amount", "currency"]) &&
      typeof value.normalizedValue.amount === "number" &&
      Number.isFinite(value.normalizedValue.amount) &&
      typeof value.normalizedValue.currency === "string")) &&
  typeof value.rawValue === "string" &&
  typeof value.source === "string" &&
  extractionSources.has(value.source) &&
  typeof value.sourceLabel === "string";

const isRejectedField = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKeys(value, ["field", "reason"]) &&
  typeof value.field === "string" &&
  (coreFields.has(value.field) || value.field.startsWith("spec:")) &&
  typeof value.reason === "string" &&
  rejectionReasons.has(value.reason);

const decodeCaptureResult = (value: unknown): CaptureResult | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "requestId",
      "tabId",
      "pageUrl",
      "capturedAt",
      "draft",
      "rejectedFields",
    ]) ||
    !isUuid(value.requestId) ||
    typeof value.tabId !== "number" ||
    !Number.isSafeInteger(value.tabId) ||
    value.tabId < 0 ||
    typeof value.pageUrl !== "string" ||
    !isUtcTimestamp(value.capturedAt) ||
    !isRecord(value.draft) ||
    !hasOnlyKeys(value.draft, ["fields", "missingCoreFields"]) ||
    !Array.isArray(value.draft.fields) ||
    !value.draft.fields.every(isNormalizedField) ||
    !Array.isArray(value.draft.missingCoreFields) ||
    !value.draft.missingCoreFields.every(
      (field) => typeof field === "string" && coreFields.has(field),
    ) ||
    !Array.isArray(value.rejectedFields) ||
    !value.rejectedFields.every(isRejectedField)
  )
    return undefined;
  return value as unknown as CaptureResult;
};

const unresolvedDraftFromFields = (
  fields: readonly NormalizedField[],
): UnresolvedCandidateDraft => {
  const find = (field: "name" | "manufacturer" | "modelNumber" | "price") =>
    fields.find((candidate) => candidate.field === field);
  const name = find("name");
  const manufacturer = find("manufacturer");
  const modelNumber = find("modelNumber");
  const price = find("price");
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
      ...(price !== undefined && typeof price.normalizedValue === "object"
        ? {
            price: {
              original: price.rawValue,
              confirmed: price.normalizedValue,
            },
          }
        : {}),
    },
    normalizedAttributes: { category: "uncategorized" },
  };
};

export interface UnresolvedCaptureDraftMapper {
  toUnresolvedDraft(
    result: unknown,
  ): Result<UnresolvedCandidateDraft, CaptureError>;
  toManualDraft(): UnresolvedCandidateDraft;
}

/** Converts the validated extraction boundary into a project-free, minimal pre-edit draft. */
