import { err, ok, type Result } from "../domain/public.js";
import {
  decodeWithProfile,
  optionalField,
  plainObject,
  safeString,
  tagged,
  z,
} from "../domain/runtime-schema/public.js";
import type {
  ActivationRouter,
  ApplicationFeatureRegistration,
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureRegistry,
  PreparedFeatureActivation,
} from "./contracts.js";

const invalid = <S extends Parameters<typeof tagged>[0]>(schema: S): S =>
  tagged(schema, "invalid-activation-result");
const successResultSchema = invalid(
  z.custom((value) =>
    isStrictRecordWithKeys(value, ["ok", "value"])
      ? value.ok === true && "value" in value
      : false,
  ),
);
const failureResultSchema = plainObject({
  ok: invalid(z.literal(false)),
  error: invalid(z.unknown()),
});
const featureErrorSchema = (
  kind: "feature_not_found" | "feature_unavailable" | "mount_failed",
) =>
  plainObject({
    kind: invalid(z.literal(kind)),
    featureId: invalid(safeString()),
  });
const invalidActivationErrorSchema = plainObject({
  kind: invalid(z.literal("invalid_activation")),
  detail: invalid(safeString()),
});
const activationFailureReasons = new Set([
  "operation-blocked",
  "target-data-unavailable",
  "target-state-unavailable",
  "rollback-failed",
]);
const activationFailedErrorSchema = plainObject({
  kind: invalid(z.literal("activation_failed")),
  detail: invalid(safeString()),
  reason: optionalField(
    invalid(
      z.custom((value) =>
        typeof value === "string" ? activationFailureReasons.has(value) : false,
      ),
    ),
  ),
});
const schemaAccepts = <S extends Parameters<typeof decodeWithProfile>[0]>(
  schema: S,
  value: unknown,
): boolean =>
  decodeWithProfile(schema, value, {
    toError: () => ({ kind: "invalid_activation" as const }),
  }).ok;

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
  if (!isRecord(value)) return false;
  if (value.ok === true) return schemaAccepts(successResultSchema, value);
  return (
    value.ok === false &&
    schemaAccepts(failureResultSchema, value) &&
    isActivationError(value.error)
  );
}

function isActivationError(value: unknown): value is FeatureActivationError {
  if (!isRecord(value)) return false;
  if (
    value.kind === "feature_not_found" ||
    value.kind === "feature_unavailable" ||
    value.kind === "mount_failed"
  )
    return schemaAccepts(featureErrorSchema(value.kind), value);
  if (value.kind === "invalid_activation")
    return schemaAccepts(invalidActivationErrorSchema, value);
  return (
    value.kind === "activation_failed" &&
    schemaAccepts(activationFailedErrorSchema, value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictRecordWithKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    !Object.getOwnPropertySymbols(value).some((symbol) =>
      Object.prototype.propertyIsEnumerable.call(value, symbol),
    )
  );
}
