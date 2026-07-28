import {
  err,
  type MoneyValue,
  ok,
  type Result,
  type SourcedValue,
} from "../../domain/public.js";
import type { CaptureCandidatePort } from "../candidate-management/contracts.js";
import type {
  CaptureCoreField,
  CaptureError,
  CaptureSession,
  ConfirmedCaptureSession,
} from "./contracts.js";
import { createCaptureNormalizer } from "./normalizer.js";

const normalizer = createCaptureNormalizer();
type CandidateDraft = Parameters<CaptureCandidatePort["createCandidate"]>[0];

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

  const sourceSnapshot = Object.fromEntries(
    session.fields.map((field) => [field.field, field.value.original]),
  );
  const manufacturer = sourcedText(session, "manufacturer");
  const modelNumber = sourcedText(session, "modelNumber");
  const price = sourcedPrice(session);

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
      ...(price === undefined ? {} : { price }),
    },
    sourceInfo: { pageUrl: session.pageUrl, capturedAt: session.capturedAt },
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
export const createCaptureDraftMapper = (): CaptureDraftMapper => ({
  toCandidateDraft(session) {
    return toCandidateDraft(session);
  },
});
