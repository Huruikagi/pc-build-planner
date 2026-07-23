import type {
  CandidatePartId,
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
 * `pageUrl` is the URL the extraction actually ran against, so comparing it to
 * the URL the capture targeted is what detects a tab that navigated mid-capture.
 * `requestId` and `tabId` identify the request the runtime issued.
 */
export interface CapturePagePayload {
  readonly requestId: string;
  readonly tabId: number;
  readonly pageUrl: string;
  readonly candidates: readonly ExtractionCandidate[];
}

/**
 * A capture item after acceptance. `value.original` keeps the raw page wording;
 * `value.confirmed` starts as the normalizer's suggestion and is never itself
 * mutated — a user edit is tracked separately in `CaptureSession.userCorrections`
 * so the two stay distinguishable per Requirement 3.5.
 */
export interface CaptureSessionField {
  readonly field: CaptureField;
  readonly value: SourcedValue<CaptureNormalizedValue>;
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
  readonly missingCoreFields: readonly CaptureCoreField[];
  readonly userCorrections: Readonly<Partial<Record<CaptureField, string>>>;
  readonly projectId?: ProjectId;
}

/** A session with the project selected; required before a `CandidateDraft` can be built. */
export interface ConfirmedCaptureSession extends CaptureSession {
  readonly projectId: ProjectId;
}

/** The side-panel-only lifecycle; nothing here is persisted until `saved`. */
export type CaptureSessionState =
  | { readonly status: "idle" }
  | { readonly status: "extracting"; readonly requestId: string }
  | { readonly status: "review"; readonly session: CaptureSession }
  | { readonly status: "submitting"; readonly session: ConfirmedCaptureSession }
  | {
      readonly status: "saved";
      readonly candidateId: CandidatePartId;
      readonly projectId: ProjectId;
    }
  | {
      readonly status: "failed";
      readonly recoverable: boolean;
      readonly draft?: CaptureSession;
      readonly error: CaptureError;
    };

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
