import type {
  MoneyValue,
  ProjectId,
  RequestId,
  SourcedValue,
  UtcTimestamp,
} from "../../domain/public.js";

/** Where a candidate value was read from on the page, in fixed priority order. */
export type ExtractionSource =
  | "json-ld"
  | "meta"
  | "heading"
  | "breadcrumb"
  | "table"
  | "definition-list";

export const CAPTURE_CORE_FIELDS = [
  "name",
  "category",
  "manufacturer",
  "modelNumber",
  "price",
  "url",
] as const;

/** Core capture item; `spec:<key>` carries a page-specific specification value. */
export type CaptureCoreField = (typeof CAPTURE_CORE_FIELDS)[number];

export type CaptureField = CaptureCoreField | `spec:${string}`;

/**
 * A single value read from the page before any validation or normalization.
 * The extractor never returns DOM nodes or raw HTML, only this string form.
 */
export interface ExtractionCandidate {
  readonly field: CaptureField;
  readonly rawValue: string;
  readonly source: ExtractionSource;
  readonly sourceLabel: string;
}

/**
 * The untrusted message returned by the injected page function. It must be
 * re-validated at the runtime boundary before any field is treated as
 * `ExtractionCandidate[]`.
 */
export type RawCapturePayload = unknown;

/**
 * The shape `RawCapturePayload` must decode to before its fields are trusted.
 * `requestId`/`tabId`/`pageUrl` are echoed back so the coordinator can detect
 * a stale response from a tab that navigated or closed mid-capture.
 */
export interface CapturePagePayload {
  readonly requestId: string;
  readonly tabId: number;
  readonly pageUrl: string;
  readonly candidates: readonly ExtractionCandidate[];
}

/** A capture item after acceptance, keeping the original wording alongside any user edit. */
export interface CaptureSessionField {
  readonly field: CaptureField;
  readonly value: SourcedValue<string>;
  readonly source: ExtractionSource;
  readonly sourceLabel: string;
}

export type CaptureFieldRejectionReason =
  | "empty"
  | "too-long"
  | "control-characters"
  | "invalid-format"
  | "unresolvable";

/** A candidate value that was read but could not be promoted to a confirmed value. */
export interface CaptureFieldRejection {
  readonly field: CaptureField;
  readonly reason: CaptureFieldRejectionReason;
}

/** `price` normalizes to a separable amount/currency pair; every other field stays a string. */
export type CaptureNormalizedValue = string | MoneyValue;

/** A candidate that passed validation; still unconfirmed by the user until adopted into a session. */
export interface NormalizedField {
  readonly field: CaptureField;
  readonly normalizedValue: CaptureNormalizedValue;
  readonly rawValue: string;
  readonly source: ExtractionSource;
  readonly sourceLabel: string;
}

/**
 * One winning candidate per field, chosen by fixed source priority (ties broken
 * by document order). `missingCoreFields` lists known items with no accepted
 * candidate at all; `spec:*` items have no fixed expected set, so they are
 * never reported as missing.
 */
export interface CaptureDraftFields {
  readonly fields: readonly NormalizedField[];
  readonly missingCoreFields: readonly CaptureCoreField[];
}

/** The coordinator's successful output; not yet a session and never persisted. */
export interface CaptureResult {
  readonly requestId: RequestId;
  readonly tabId: number;
  readonly pageUrl: string;
  readonly capturedAt: UtcTimestamp;
  readonly draft: CaptureDraftFields;
  readonly rejectedFields: readonly CaptureFieldRejection[];
}

/**
 * The temporary, side-panel-only review model for one capture attempt.
 * Nothing here is persisted until a `CandidateDraft` is derived from it.
 */
export interface CaptureSession {
  readonly requestId: RequestId;
  readonly tabId: number;
  readonly pageUrl: string;
  readonly capturedAt: UtcTimestamp;
  readonly fields: readonly CaptureSessionField[];
  readonly rejectedFields: readonly CaptureFieldRejection[];
  readonly userCorrections: Readonly<Partial<Record<CaptureField, string>>>;
  readonly projectId?: ProjectId;
}

/** Distinguishable capture and save failures; each keeps prior state recoverable. */
export type CaptureError =
  | { readonly kind: "permission-lost" }
  | { readonly kind: "restricted-page" }
  | { readonly kind: "tab-changed" }
  | { readonly kind: "injection-failed" }
  | { readonly kind: "invalid-payload" }
  | { readonly kind: "no-candidate" }
  | {
      readonly kind: "validation";
      readonly fields: Readonly<Record<string, string>>;
    }
  | { readonly kind: "project-required" }
  | { readonly kind: "navigation" }
  | { readonly kind: "maintenance" }
  | { readonly kind: "storage" }
  | { readonly kind: "quota" }
  | { readonly kind: "unsupported-data" };
