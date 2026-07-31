import type {
  ActivationId,
  FeatureActivationError,
  FeatureActivationIntent,
  TargetTabId,
} from "../../application-shell/public.js";
import { err, ok, type Result } from "../../domain/public.js";

export interface CaptureTransientActivation {
  readonly activationId: ActivationId;
  readonly tabId: TargetTabId;
}

export const validateCaptureActivation = (
  intent: FeatureActivationIntent,
): Result<CaptureTransientActivation, FeatureActivationError> => {
  const payload = intent.payload;
  if (
    intent.target !== "capture" ||
    typeof payload !== "object" ||
    payload === null ||
    !("activationId" in payload) ||
    !("tabId" in payload) ||
    typeof payload.activationId !== "string" ||
    payload.activationId.length === 0 ||
    typeof payload.tabId !== "number" ||
    !Number.isSafeInteger(payload.tabId) ||
    payload.tabId <= 0
  )
    return err({
      kind: "invalid_activation",
      detail: "invalid product capture activation",
    });
  return ok({
    activationId: payload.activationId as ActivationId,
    tabId: payload.tabId as TargetTabId,
  });
};
