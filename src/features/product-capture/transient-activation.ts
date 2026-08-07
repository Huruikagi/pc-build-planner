import type {
  ActivationId,
  FeatureActivationError,
  FeatureActivationIntent,
  TargetTabId,
} from "../../application-shell/public.js";
import { err, ok, type Result } from "../../domain/public.js";
import {
  decodeWithProfile,
  plainObject,
  positiveInteger,
  tagged,
  z,
} from "../../domain/runtime-schema/public.js";

export interface CaptureTransientActivation {
  readonly activationId: ActivationId;
  readonly tabId: TargetTabId;
}

const invalidActivation = {
  kind: "invalid_activation",
  detail: "invalid product capture activation",
} as const;
const invalid = <S extends Parameters<typeof tagged>[0]>(schema: S): S =>
  tagged(schema, "invalid_activation");
const captureActivationSchema = plainObject({
  activationId: invalid(
    z.custom<ActivationId>(
      (value) => typeof value === "string" && value.length > 0,
    ),
  ),
  tabId: invalid(positiveInteger<TargetTabId>()),
});

export const validateCaptureActivation = (
  intent: FeatureActivationIntent,
): Result<CaptureTransientActivation, FeatureActivationError> => {
  if (intent.target !== "capture") return err(invalidActivation);
  const decoded = decodeWithProfile(captureActivationSchema, intent.payload, {
    toError: () => invalidActivation,
  });
  return decoded.ok ? ok(decoded.value) : decoded;
};
