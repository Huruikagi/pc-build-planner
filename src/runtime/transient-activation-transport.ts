import type { ActivationId } from "../application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../domain/public.js";
import {
  decodeWithProfile,
  plainObject,
  positiveInteger,
  revision,
  safeString,
  tagged,
  z,
} from "../domain/runtime-schema/public.js";
import type {
  FoundationMessageRuntime,
  RuntimeMessageListener,
} from "./foundation-message-target.js";
import type {
  ActivationAuthorization,
  ActivationStoreError,
  TransientActivationRecord,
} from "./transient-activation-store.js";

export interface TransientWatchReadyRequest {
  readonly version: 1;
  readonly kind: "transient-watch-ready";
  readonly activationId: ActivationId;
}

export type TransientWatchReadyErrorCode =
  | "invalid-message"
  | "store-unavailable"
  | "capacity-exceeded"
  | "not-started";

export type TransientWatchReadyResponse =
  | {
      readonly version: 1;
      readonly ok: true;
      readonly decision: ActivationAuthorization;
    }
  | {
      readonly version: 1;
      readonly ok: false;
      readonly code: TransientWatchReadyErrorCode;
    };

export type ActivationTransportError = {
  readonly kind: TransientWatchReadyErrorCode;
};

export interface TransientActivationPort {
  authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationTransportError>>;
}

export interface WatchReadyScheduler {
  authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationStoreError>>;
  advance?(
    activationId: ActivationId,
    stage: "activated",
  ): Promise<Result<void, ActivationStoreError>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = <S extends Parameters<typeof tagged>[0]>(schema: S): S =>
  tagged(schema, "invalid-message");
const nonEmptyString = <T extends string>() =>
  z.custom<T>((value) => typeof value === "string" && value.length > 0);
const decode = <S extends Parameters<typeof decodeWithProfile>[0]>(
  schema: S,
  value: unknown,
) =>
  decodeWithProfile(schema, value, {
    toError: () => ({ kind: "invalid-message" as const }),
  });

const watchReadyRequestSchema = plainObject({
  version: invalid(z.literal(1)),
  kind: invalid(z.literal("transient-watch-ready")),
  activationId: invalid(nonEmptyString<ActivationId>()),
});
const stageAdvanceRequestSchema = plainObject({
  version: invalid(z.literal(1)),
  kind: invalid(z.literal("transient-stage-advance")),
  activationId: invalid(nonEmptyString<ActivationId>()),
  stage: invalid(z.literal("activated")),
});
const recordBase = {
  activationId: invalid(safeString<ActivationId>()),
  surfaceId: invalid(safeString<TransientActivationRecord["surfaceId"]>()),
  tabId: invalid(positiveInteger<TransientActivationRecord["tabId"]>()),
  seq: invalid(revision<TransientActivationRecord["seq"]>()),
};
const authorizedDecisionSchema = plainObject({
  kind: invalid(z.literal("authorized")),
  record: invalid(
    plainObject({ ...recordBase, stage: invalid(z.literal("received")) }),
  ),
});
const invalidatedDecisionSchema = plainObject({
  kind: invalid(z.literal("invalidated")),
  record: invalid(
    plainObject({ ...recordBase, stage: invalid(z.literal("invalidated")) }),
  ),
});
const successResponse = (
  decision: typeof authorizedDecisionSchema | typeof invalidatedDecisionSchema,
) =>
  plainObject({
    version: invalid(z.literal(1)),
    ok: invalid(z.literal(true)),
    decision: invalid(decision),
  });
const errorCodeSchema = invalid(
  z.custom<TransientWatchReadyErrorCode>((value) =>
    [
      "invalid-message",
      "store-unavailable",
      "capacity-exceeded",
      "not-started",
    ].includes(String(value)),
  ),
);
const errorResponseSchema = plainObject({
  version: invalid(z.literal(1)),
  ok: invalid(z.literal(false)),
  code: errorCodeSchema,
});
const stageSuccessResponseSchema = plainObject({
  version: invalid(z.literal(1)),
  ok: invalid(z.literal(true)),
});

const isTrustedSidePanelSender = (
  runtime: FoundationMessageRuntime,
  sender: unknown,
): boolean => {
  try {
    return (
      isRecord(sender) &&
      sender.id === runtime.id &&
      sender.url === runtime.getURL("side-panel.html")
    );
  } catch {
    return false;
  }
};

const parseRequest = (
  value: unknown,
): TransientWatchReadyRequest | undefined => {
  const result = decode(watchReadyRequestSchema, value);
  return result.ok ? result.value : undefined;
};

const parseResponse = (
  value: unknown,
): TransientWatchReadyResponse | undefined => {
  if (!isRecord(value) || value.version !== 1 || typeof value.ok !== "boolean")
    return undefined;
  if (value.ok) {
    if (!isRecord(value.decision)) return undefined;
    const schema =
      value.decision.kind === "authorized"
        ? successResponse(authorizedDecisionSchema)
        : value.decision.kind === "invalidated"
          ? successResponse(invalidatedDecisionSchema)
          : undefined;
    if (schema === undefined) return undefined;
    const result = decode(schema, value);
    return result.ok ? result.value : undefined;
  }
  const result = decode(errorResponseSchema, value);
  return result.ok ? result.value : undefined;
};

const publicCode = (
  error: ActivationStoreError,
): TransientWatchReadyErrorCode => {
  if (error.kind === "storage-unavailable") return "store-unavailable";
  if (error.kind === "capacity-exceeded") return "capacity-exceeded";
  return "not-started";
};

export const registerTransientWatchReadyListener = (
  runtime: FoundationMessageRuntime,
  scheduler: WatchReadyScheduler,
): (() => void) => {
  const listener: RuntimeMessageListener = (message, sender, sendResponse) => {
    const request = parseRequest(message);
    const stageDecoded = decode(stageAdvanceRequestSchema, message);
    const stageRequest = stageDecoded.ok ? stageDecoded.value : undefined;
    const trustedPanel = isTrustedSidePanelSender(runtime, sender);
    if (
      (request === undefined && stageRequest === undefined) ||
      !trustedPanel
    ) {
      sendResponse({ version: 1, ok: false, code: "invalid-message" });
      return true;
    }
    void (async () => {
      try {
        if (stageRequest) {
          const result = scheduler.advance
            ? await scheduler.advance(
                stageRequest.activationId,
                stageRequest.stage,
              )
            : err<ActivationStoreError>({ kind: "storage-unavailable" });
          sendResponse(
            result.ok
              ? { version: 1, ok: true }
              : { version: 1, ok: false, code: publicCode(result.error) },
          );
          return;
        }
        if (!request) return;
        const result = await scheduler.authorizeAfterWatchReady(
          request.activationId,
        );
        sendResponse(
          result.ok
            ? { version: 1, ok: true, decision: result.value }
            : { version: 1, ok: false, code: publicCode(result.error) },
        );
      } catch {
        sendResponse({ version: 1, ok: false, code: "store-unavailable" });
      }
    })();
    return true;
  };
  runtime.onMessage.addListener(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    runtime.onMessage.removeListener(listener);
  };
};

export interface PanelMessageRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

export interface TransientStageAdvancePort {
  advance(
    activationId: ActivationId,
    stage: "activated",
  ): Promise<Result<void, ActivationTransportError | ActivationStoreError>>;
}

export const createTransientActivationPanelPort = (
  runtime: PanelMessageRuntime,
): TransientActivationPort => ({
  async authorizeAfterWatchReady(activationId) {
    let raw: unknown;
    try {
      raw = await runtime.sendMessage({
        version: 1,
        kind: "transient-watch-ready",
        activationId,
      } satisfies TransientWatchReadyRequest);
    } catch {
      return err({ kind: "store-unavailable" });
    }
    const response = parseResponse(raw);
    if (response === undefined) return err({ kind: "invalid-message" });
    return response.ok ? ok(response.decision) : err({ kind: response.code });
  },
});

export const createTransientStagePanelPort = (
  runtime: PanelMessageRuntime,
): TransientStageAdvancePort => ({
  async advance(activationId: ActivationId, stage: "activated") {
    try {
      const response = await runtime.sendMessage({
        version: 1,
        kind: "transient-stage-advance",
        activationId,
        stage,
      });
      const success = decode(stageSuccessResponseSchema, response);
      if (success.ok) return ok(undefined);
      const failure = decode(errorResponseSchema, response);
      return failure.ok
        ? err({ kind: failure.value.code })
        : err({ kind: "invalid-message" as const });
    } catch {
      return err({ kind: "storage-unavailable" as const });
    }
  },
});
