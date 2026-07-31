import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
  TransientSurfaceError,
  TransientSurfaceLifecyclePort,
} from "../../application-shell/public.js";
import type {
  MoneyValue,
  RequestId,
  UtcTimestamp,
} from "../../domain/public.js";

import type { CaptureTransientActivation } from "./transient-activation.js";

/**
 * Consumer-only seam for the upstream transient surface contract. Capture
 * depends on the public lifecycle port and never on the shell controller.
 */
export interface ProductCaptureTransientConsumerContract {
  readonly activation: CaptureTransientActivation;
  readonly lifecycle: TransientSurfaceLifecyclePort;
}

/** Where a candidate value was read from on the page, in fixed priority order. */
export type ExtractionSource =
  | "json-ld"
  | "meta"
  | "heading"
  | "breadcrumb"
  | "table"
  | "definition-list"
  | "domain-map";

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
  readonly documentOrder: number;
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
  readonly documentOrder: number;
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

export type CaptureFailure =
  | {
      readonly kind: "execution";
      readonly error: CaptureError;
      readonly recoverable: boolean;
    }
  | {
      readonly kind: "handoff";
      readonly error: TransientSurfaceError;
      readonly retainedIntent: FeatureActivationIntent;
    };

/** Activation-scoped transient execution state. */
export type CaptureSessionState =
  | {
      readonly status: "idle";
      readonly activationId: ActivationId;
      readonly tabId: TargetTabId;
    }
  | {
      readonly status: "extracting";
      readonly activationId: ActivationId;
      readonly tabId: TargetTabId;
      readonly requestId: string;
    }
  | {
      readonly status: "failed";
      readonly activationId: ActivationId;
      readonly tabId: TargetTabId;
      readonly failure: CaptureFailure;
    };

/** Distinguishable capture execution failures. */
export type CaptureError =
  | { readonly kind: "permission-lost" }
  | { readonly kind: "restricted-page" }
  | { readonly kind: "tab-changed" }
  | { readonly kind: "injection-failed" }
  | { readonly kind: "invalid-payload" }
  | { readonly kind: "no-candidate" };
