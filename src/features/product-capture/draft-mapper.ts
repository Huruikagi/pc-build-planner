import {
  type CandidateSourceId,
  createUuid,
  err,
  isUtcTimestamp,
  isUuid,
  type MoneyValue,
  ok,
  type Result,
  type SourcedValue,
} from "../../domain/public.js";
import type {
  CandidateSourceDraft,
  UnresolvedCandidateDraft,
} from "../candidate-management/contracts.js";
import type {
  CaptureCoreField,
  CaptureError,
  CaptureResult,
  CaptureSession,
  ConfirmedCaptureSession,
  NormalizedField,
} from "./contracts.js";
import { CAPTURE_CORE_FIELDS } from "./contracts.js";
import { createCaptureNormalizer } from "./normalizer.js";

const normalizer = createCaptureNormalizer();
type CandidateDraft = CandidateSourceDraft;

const fieldEntry = (session: CaptureSession, field: CaptureCoreField) =>
  session.fields.find((candidate) => candidate.field === field);

const resolvedName = (session: CaptureSession): string => {
  const corrected = session.userCorrections.name;
  if (corrected !== undefined) return corrected.trim();
  const confirmed = fieldEntry(session, "name")?.value.confirmed;
  return typeof confirmed === "string" ? confirmed.trim() : "";
};

/** A user text edit takes precedence over the normalizer's suggestion; both keep the raw original. */
const sourcedText = (
  session: CaptureSession,
  field: CaptureCoreField,
): SourcedValue<string> | undefined => {
  const entry = fieldEntry(session, field);
  const original = entry?.value.original ?? null;
  const corrected = session.userCorrections[field];
  if (corrected !== undefined) {
    const trimmed = corrected.trim();
    if (trimmed.length > 0) return { original, confirmed: trimmed };
    return original === null ? undefined : { original };
  }
  if (entry === undefined) return undefined;
  return typeof entry.value.confirmed === "string"
    ? { original, confirmed: entry.value.confirmed }
    : { original };
};

/** A price correction is re-parsed with the same rules as extraction; unparsable text keeps only the original. */
const sourcedPrice = (
  session: CaptureSession,
): SourcedValue<MoneyValue> | undefined => {
  const entry = fieldEntry(session, "price");
  const original = entry?.value.original ?? null;
  const corrected = session.userCorrections.price;
  if (corrected !== undefined) {
    const parsed = normalizer.normalize({
      field: "price",
      rawValue: corrected,
      source: "meta",
      sourceLabel: "user-correction",
    });
    if (parsed.ok) {
      return {
        original,
        confirmed: parsed.value.normalizedValue as MoneyValue,
      };
    }
    return original === null ? undefined : { original };
  }
  if (entry === undefined) return undefined;
  return typeof entry.value.confirmed === "object"
    ? { original, confirmed: entry.value.confirmed }
    : { original };
};

/**
 * Shared by `CandidateEditorNavigation` and the upstream `CaptureDraftMapper`
 * (task 5.1): both must build the identical `CandidateDraft` from a session.
 * Category stays `uncategorized`; page-derived fields with no home in the
 * upstream contract (e.g. `url`, `category`) are excluded from `product`, per
 * Requirement 5.3's "surplus page values are excluded".
 */
export const toCandidateDraft = (
  session: CaptureSession,
): Result<CandidateDraft, CaptureError> => {
  if (session.projectId === undefined) return err({ kind: "project-required" });

  const name = resolvedName(session);
  if (name.length === 0) {
    return err({ kind: "validation", fields: { name: "required" } });
  }

  const manufacturer = sourcedText(session, "manufacturer");
  const modelNumber = sourcedText(session, "modelNumber");
  const price = sourcedPrice(session);
  const sourceId = createUuid() as CandidateSourceId;
  const sourceSnapshot = Object.fromEntries(
    session.fields.map((field) => [field.field, field.value.original]),
  );

  return ok({
    projectId: session.projectId,
    category: "uncategorized",
    product: {
      name: {
        original: fieldEntry(session, "name")?.value.original ?? null,
        confirmed: name,
      },
      ...(manufacturer === undefined ? {} : { manufacturer }),
      ...(modelNumber === undefined ? {} : { modelNumber }),
    },
    sources: [
      {
        id: sourceId,
        pageUrl: session.pageUrl,
        capturedAt: session.capturedAt,
        ...(price === undefined ? {} : { price }),
      },
    ],
    primarySourceId: sourceId,
    sourceSnapshot,
    normalizedAttributes: { category: "uncategorized" },
  });
};

export interface CaptureDraftMapper {
  toCandidateDraft(
    session: ConfirmedCaptureSession,
  ): Result<CandidateDraft, CaptureError>;
}

/** Delegates to the same rules `CandidateEditorNavigation.open` uses, so both stay in sync. */
export const createCaptureDraftMapper = (): CaptureDraftMapper &
  UnresolvedCaptureDraftMapper => ({
  toCandidateDraft(session) {
    return toCandidateDraft(session);
  },
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
