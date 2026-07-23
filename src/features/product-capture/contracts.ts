import type {
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

/** Core capture item; `spec:<key>` carries a page-specific specification value. */
export type CaptureCoreField =
  | "name"
  | "category"
  | "manufacturer"
  | "modelNumber"
  | "price"
  | "url";

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
