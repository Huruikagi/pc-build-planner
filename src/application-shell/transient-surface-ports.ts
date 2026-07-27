import { err, ok, type Result } from "../domain/public.js";
import type { FeatureActivationIntent, FeatureId } from "./contracts.js";

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
  | "persistent-selected";

export type TransientSurfaceError =
  | { readonly kind: "not-started" }
  | { readonly kind: "invalid-request" }
  | { readonly kind: "surface-unavailable"; readonly surfaceId: FeatureId }
  | { readonly kind: "transition-failed" };

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
