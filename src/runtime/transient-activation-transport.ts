import type { ActivationId } from "../application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../domain/public.js";
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
): TransientWatchReadyRequest | undefined =>
  isRecord(value) &&
  value.version === 1 &&
  value.kind === "transient-watch-ready" &&
  typeof value.activationId === "string" &&
  value.activationId.length > 0
    ? (value as unknown as TransientWatchReadyRequest)
    : undefined;

const isRecordShape = (value: unknown): value is TransientActivationRecord =>
  isRecord(value) &&
  typeof value.activationId === "string" &&
  typeof value.surfaceId === "string" &&
  typeof value.tabId === "number" &&
  Number.isSafeInteger(value.tabId) &&
  value.tabId > 0 &&
  typeof value.seq === "number" &&
  Number.isSafeInteger(value.seq) &&
  value.seq >= 0 &&
  ["pending", "received", "activated", "invalidated"].includes(
    String(value.stage),
  );

const parseResponse = (
  value: unknown,
): TransientWatchReadyResponse | undefined => {
  if (!isRecord(value) || value.version !== 1 || typeof value.ok !== "boolean")
    return undefined;
  if (value.ok) {
    if (!isRecord(value.decision)) return undefined;
    const kind = value.decision.kind;
    if (
      (kind !== "authorized" && kind !== "invalidated") ||
      !isRecordShape(value.decision.record) ||
      (kind === "authorized" && value.decision.record.stage !== "received") ||
      (kind === "invalidated" && value.decision.record.stage !== "invalidated")
    )
      return undefined;
    return value as unknown as TransientWatchReadyResponse;
  }
  return [
    "invalid-message",
    "store-unavailable",
    "capacity-exceeded",
    "not-started",
  ].includes(String(value.code))
    ? (value as unknown as TransientWatchReadyResponse)
    : undefined;
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
    const stageRequest =
      isRecord(message) &&
      message.version === 1 &&
      message.kind === "transient-stage-advance" &&
      typeof message.activationId === "string" &&
      message.stage === "activated"
        ? (message as unknown as {
            readonly activationId: ActivationId;
            readonly stage: "activated";
          })
        : undefined;
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
) => ({
  async advance(activationId: ActivationId, stage: "activated") {
    try {
      const response = await runtime.sendMessage({
        version: 1,
        kind: "transient-stage-advance",
        activationId,
        stage,
      });
      return isRecord(response) &&
        response.version === 1 &&
        response.ok === true
        ? ok(undefined)
        : err({ kind: "storage-unavailable" as const });
    } catch {
      return err({ kind: "storage-unavailable" as const });
    }
  },
});
