import {
  err,
  isUtcTimestamp,
  isUuid,
  ok,
  PART_CATEGORIES,
  type PartCategory,
  type Result,
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

const isSourcedValue = (
  value: unknown,
  isConfirmed: (confirmed: unknown) => boolean,
): boolean =>
  isRecord(value) &&
  hasOnlyKeys(value, ["original", "confirmed"]) &&
  (typeof value.original === "string" || value.original === null) &&
  (value.confirmed === undefined || isConfirmed(value.confirmed));

const isString = (value: unknown): boolean => typeof value === "string";
const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every(isString);
const isMoney = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKeys(value, ["amount", "currency"]) &&
  typeof value.amount === "number" &&
  Number.isFinite(value.amount) &&
  typeof value.currency === "string";

const isProduct = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "name",
      "manufacturer",
      "modelNumber",
      "price",
      "notes",
    ]) ||
    !isSourcedValue(value.name, isString)
  )
    return false;
  return (
    (value.manufacturer === undefined ||
      isSourcedValue(value.manufacturer, isString)) &&
    (value.modelNumber === undefined ||
      isSourcedValue(value.modelNumber, isString)) &&
    (value.price === undefined || isSourcedValue(value.price, isMoney)) &&
    (value.notes === undefined || isSourcedValue(value.notes, isString))
  );
};

const attributeFields: Readonly<
  Record<PartCategory, Readonly<Record<string, "string" | "strings">>>
> = {
  cpu: { socket: "string" },
  "cpu-cooler": { supportedSockets: "strings" },
  motherboard: {
    socket: "string",
    memoryStandard: "string",
    formFactor: "string",
  },
  memory: { memoryStandard: "string" },
  gpu: {},
  storage: {},
  "power-supply": { formFactor: "string" },
  case: {
    supportedMotherboardFormFactors: "strings",
    supportedPowerSupplyFormFactors: "strings",
  },
  "case-fan": {},
  "expansion-card": {},
  other: {},
  uncategorized: {},
};

const isAttributes = (
  value: unknown,
  category: PartCategory,
): "valid" | "mismatch" | "invalid" => {
  if (!isRecord(value)) return "invalid";
  if (value.category !== category) return "mismatch";
  const fields = attributeFields[category];
  if (!hasOnlyKeys(value, ["category", ...Object.keys(fields)]))
    return "invalid";
  for (const [key, kind] of Object.entries(fields)) {
    const field = value[key];
    if (field === undefined) continue;
    if (!isSourcedValue(field, kind === "string" ? isString : isStringArray))
      return "invalid";
    const confirmed = (field as Record<string, unknown>).confirmed;
    if (
      confirmed !== undefined &&
      (kind === "string"
        ? typeof confirmed !== "string"
        : !Array.isArray(confirmed) ||
          !confirmed.every((item) => typeof item === "string"))
    )
      return "invalid";
  }
  return "valid";
};

const isHttpUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const isSourceInfo = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKeys(value, ["pageUrl", "siteName", "capturedAt"]) &&
  (value.pageUrl === undefined || isHttpUrl(value.pageUrl)) &&
  (value.siteName === undefined || typeof value.siteName === "string") &&
  (value.capturedAt === undefined || isUtcTimestamp(value.capturedAt));

const isSourceSnapshot = (value: unknown): boolean =>
  isRecord(value) &&
  Object.values(value).every(
    (item) => item === null || typeof item === "string",
  );

export const validatePreEditDraft = (
  draft: unknown,
): Result<UnresolvedCandidateDraft, PreEditDraftError> => {
  if (
    !isRecord(draft) ||
    !hasOnlyKeys(draft, [
      "category",
      "product",
      "normalizedAttributes",
      "sourceInfo",
      "sourceSnapshot",
    ]) ||
    !("category" in draft) ||
    !("product" in draft) ||
    !("normalizedAttributes" in draft)
  )
    return err({ kind: "invalid-draft-shape" });
  if (!isPartCategory(draft.category)) return err({ kind: "invalid-category" });
  const attributes = isAttributes(draft.normalizedAttributes, draft.category);
  if (attributes === "mismatch") return err({ kind: "category-mismatch" });
  if (
    attributes === "invalid" ||
    !isProduct(draft.product) ||
    (draft.sourceInfo !== undefined && !isSourceInfo(draft.sourceInfo)) ||
    (draft.sourceSnapshot !== undefined &&
      !isSourceSnapshot(draft.sourceSnapshot))
  )
    return err({ kind: "invalid-draft-shape" });
  return ok(draft as UnresolvedCandidateDraft);
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
