import { err, ok, type Result } from "../domain/public.js";
import type {
  ActivationRouter,
  ApplicationFeatureRegistration,
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureRegistry,
  PreparedFeatureActivation,
} from "./contracts.js";

export interface ActivationRouterOptions {
  readonly registry: FeatureRegistry;
}

export function createActivationRouter(
  options: ActivationRouterOptions,
): ActivationRouter {
  return {
    prepare: (intent) => prepareActivation(options.registry, intent),
  };
}

function prepareActivation(
  registry: FeatureRegistry,
  intent: FeatureActivationIntent,
): Result<PreparedFeatureActivation, FeatureActivationError> {
  const feature = registry
    .snapshot()
    .find((entry) => entry.id === intent.featureId);
  if (!feature)
    return err<FeatureActivationError>({
      kind: "feature_not_found",
      featureId: intent.featureId,
    });
  if (feature.getAvailability().status === "unavailable")
    return err<FeatureActivationError>({
      kind: "feature_unavailable",
      featureId: intent.featureId,
    });
  const adapter = feature.activation as
    | FeatureActivationAdapter<unknown>
    | undefined;
  if (!adapter)
    return err<FeatureActivationError>({
      kind: "invalid_activation",
      detail: "feature does not support activation",
    });

  let validation: Result<unknown, FeatureActivationError>;
  try {
    validation = adapter.validate(intent);
  } catch {
    return err<FeatureActivationError>({
      kind: "invalid_activation",
      detail: "activation validation rejected",
    });
  }
  if (!isActivationResult(validation))
    return err<FeatureActivationError>({
      kind: "invalid_activation",
      detail: "activation validation returned an invalid result",
    });
  if (!validation.ok) return err(validation.error);

  return ok(createPreparedActivation(feature, adapter, validation.value));
}

function createPreparedActivation(
  feature: ApplicationFeatureRegistration,
  adapter: FeatureActivationAdapter<unknown>,
  input: unknown,
): PreparedFeatureActivation {
  let delivered = false;
  return Object.freeze({
    feature,
    async activate() {
      if (delivered)
        return err<FeatureActivationError>({
          kind: "activation_failed",
          detail: "activation was already delivered",
        });
      delivered = true;
      try {
        const result = await adapter.activate(input);
        if (!isActivationResult(result))
          return err<FeatureActivationError>({
            kind: "activation_failed",
            detail: "activation returned an invalid result",
          });
        return result;
      } catch {
        return err<FeatureActivationError>({
          kind: "activation_failed",
          detail: "activation rejected",
        });
      }
    },
  });
}

function isActivationResult(
  value: unknown,
): value is Result<unknown, FeatureActivationError> {
  if (!isRecord(value) || !("ok" in value)) return false;
  if (value.ok === true) return "value" in value;
  return value.ok === false && isActivationError(value.error);
}

function isActivationError(value: unknown): value is FeatureActivationError {
  if (!isRecord(value) || !("kind" in value)) return false;
  if (
    value.kind === "feature_not_found" ||
    value.kind === "feature_unavailable"
  )
    return "featureId" in value && typeof value.featureId === "string";
  if (value.kind === "invalid_activation" || value.kind === "activation_failed")
    return "detail" in value && typeof value.detail === "string";
  return (
    value.kind === "mount_failed" &&
    "featureId" in value &&
    typeof value.featureId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
