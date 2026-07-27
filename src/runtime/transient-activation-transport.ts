import type { ActivationId } from "../application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../domain/public.js";
import {
  classifyCaller,
  type FoundationMessageRuntime,
  type RuntimeMessageListener,
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
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    const trustedPanel =
      classifyCaller(runtime, sender).kind === "trusted-extension" &&
      isRecord(sender) &&
      sender.url === runtime.getURL("side-panel.html");
    if (request === undefined || !trustedPanel) {
      sendResponse({ version: 1, ok: false, code: "invalid-message" });
      return true;
    }
    void Promise.resolve()
      .then(() => scheduler.authorizeAfterWatchReady(request.activationId))
      .then(
        (result) =>
          sendResponse(
            result.ok
              ? { version: 1, ok: true, decision: result.value }
              : { version: 1, ok: false, code: publicCode(result.error) },
          ),
        () =>
          sendResponse({ version: 1, ok: false, code: "store-unavailable" }),
      );
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
