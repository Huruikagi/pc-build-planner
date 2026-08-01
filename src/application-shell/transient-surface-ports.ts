import { err, ok, type Result } from "../domain/public.js";
import type {
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
} from "./contracts.js";

export type TargetTabId = number & { readonly __brand: "TargetTabId" };
export type ActivationId = string & { readonly __brand: "ActivationId" };

export type TargetTabIdValidationError = {
  readonly kind: "invalid-target-tab";
};

export function parseTargetTabId(
  value: unknown,
): Result<TargetTabId, TargetTabIdValidationError> {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? ok(value as TargetTabId)
    : err({ kind: "invalid-target-tab" });
}

export interface TransientActivationRequest {
  readonly activationId: ActivationId;
  readonly surfaceId: FeatureId;
  readonly tabId: TargetTabId;
}

export type TransientDismissReason =
  | "navigated"
  | "tab-closed"
  | "capture-invalidated"
  | "persistent-selected";

export type TransientSurfaceError =
  | { readonly kind: "not-started" }
  | { readonly kind: "invalid-request" }
  | { readonly kind: "surface-unavailable"; readonly surfaceId: FeatureId }
  | {
      readonly kind: "transition-failed";
      readonly reason?: TransientTransitionFailureReason;
    };

export type TransientTransitionFailureReason =
  | "host-unavailable"
  | "target-not-found"
  | "target-unavailable"
  | "invalid-handoff"
  | "target-mount-failed"
  | "target-activation-failed"
  | "operation-blocked"
  | "target-data-unavailable"
  | "target-state-unavailable"
  | "rollback-failed";

/** Converts a typed shell activation failure into a safe, user-identifiable handoff reason. */
export const transientHandoffFailure = (
  error: FeatureActivationError | undefined,
): Extract<TransientSurfaceError, { readonly kind: "transition-failed" }> => {
  if (error === undefined)
    return { kind: "transition-failed", reason: "host-unavailable" };
  switch (error.kind) {
    case "feature_not_found":
      return { kind: "transition-failed", reason: "target-not-found" };
    case "feature_unavailable":
      return { kind: "transition-failed", reason: "target-unavailable" };
    case "invalid_activation":
      return { kind: "transition-failed", reason: "invalid-handoff" };
    case "mount_failed":
      return { kind: "transition-failed", reason: "target-mount-failed" };
    case "activation_failed":
      return {
        kind: "transition-failed",
        reason: error.reason ?? "target-activation-failed",
      };
  }
};

export type TransientSurfaceState =
  | { readonly kind: "inactive" }
  | {
      readonly kind: "active";
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly tabId: TargetTabId;
      readonly returnTo: FeatureId | null;
    }
  | {
      readonly kind: "dismiss-failed";
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly returnTo: FeatureId | null;
      readonly target: FeatureId | null;
      readonly reason: TransientDismissReason;
    }
  | {
      readonly kind: "closing";
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly returnTo: FeatureId | null;
      readonly target: FeatureId | null;
      readonly reason: TransientDismissReason;
    };

export interface TransientSurfaceLifecyclePort {
  isCurrent(activationId: ActivationId): boolean;
  waitUntilCurrent(activationId: ActivationId): Promise<boolean>;
  dismiss(
    activationId: ActivationId,
    reason: TransientDismissReason,
  ): Promise<Result<void, TransientSurfaceError>>;
  conclude(
    activationId: ActivationId,
    handoff: FeatureActivationIntent,
  ): Promise<Result<void, TransientSurfaceError>>;
}

export type TransientGestureRegistrationError =
  | { readonly kind: "invalid-source" }
  | { readonly kind: "duplicate-source" }
  | { readonly kind: "source-start-failed" }
  | { readonly kind: "not-started" };

export interface TransientGestureSource {
  readonly id: string;
  readonly surfaceId: FeatureId;
  start(
    emit: (tabId: TargetTabId) => void,
  ): Result<() => void, TransientGestureRegistrationError>;
}

export interface TransientGestureRegistrationPort {
  register(
    source: TransientGestureSource,
  ): Result<() => void, TransientGestureRegistrationError>;
}

export interface TransientMenuItemProperties {
  readonly id: string;
  readonly title: string;
  readonly contexts: readonly string[];
  readonly documentUrlPatterns: readonly string[];
}

export type TransientMenuClickListener = (info: unknown, tab?: unknown) => void;

export interface TransientMenuClickEvent {
  addListener(listener: TransientMenuClickListener): void;
  removeListener(listener: TransientMenuClickListener): void;
}

/**
 * The slice of a browser context-menu API a worker-safe gesture source needs.
 * The shell owns the port shape so the worker catalog can type a feature-owned
 * adapter without importing browser typings or the feature's adapter module;
 * `info` and `tab` stay `unknown` so every payload is validated at the adapter.
 */
export interface TransientMenuApi {
  create(
    properties: TransientMenuItemProperties,
    callback?: () => void,
  ): unknown;
  remove(menuItemId: string, callback?: () => void): unknown;
  readonly onClicked: TransientMenuClickEvent;
}

export interface TransientMenuGestureDependencies {
  readonly contextMenus: TransientMenuApi;
  /** Resolved menu label. The message catalog owns the wording, not the adapter. */
  readonly title: string;
  /**
   * Reads the runtime's last asynchronous error inside a menu callback. Menu
   * APIs report failures there instead of throwing, and an unread error makes
   * the browser log a warning.
   */
  readonly readLastError?: () => unknown;
}
