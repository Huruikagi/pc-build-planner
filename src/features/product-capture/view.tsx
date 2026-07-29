import { useSyncExternalStore } from "react";
import type { MessageKey } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import type { CaptureError } from "./contracts.js";
import type { CaptureState } from "./state.js";

export interface CaptureViewProps {
  readonly state: CaptureState;
}

const errorMessageKeys = {
  "permission-lost": "capture.errors.permission-lost",
  "restricted-page": "capture.errors.restricted-page",
  "tab-changed": "capture.errors.tab-changed",
  "injection-failed": "capture.errors.injection-failed",
  "invalid-payload": "capture.errors.invalid-payload",
  "no-candidate": "capture.errors.no-candidate",
} as const satisfies Record<CaptureError["kind"], MessageKey>;

export function CaptureView({ state }: CaptureViewProps) {
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
  const messages = useMessages();
  const value = state.value;
  if (value === null) return null;
  if (value.status === "idle") {
    return (
      <section aria-label={messages("capture.idleTitle")}>
        <p>{messages("capture.idleInstruction")}</p>
        <button
          data-capture-start
          onClick={() => void state.startCapture()}
          type="button"
        >
          {messages("capture.startAction")}
        </button>
      </section>
    );
  }
  if (value.status === "extracting") {
    return (
      <section
        aria-busy="true"
        aria-label={messages("capture.extractingTitle")}
      >
        <p>{messages("capture.extractingStatus")}</p>
      </section>
    );
  }
  const executionError =
    value.failure.kind === "execution" ? value.failure.error : null;
  const handoffReason =
    value.failure.kind === "handoff" &&
    value.failure.error.kind === "transition-failed"
      ? value.failure.error.reason
      : undefined;
  return (
    <section aria-label={messages("capture.failedTitle")}>
      <p role="alert">
        {executionError === null
          ? messages("capture.errors.navigation")
          : messages(errorMessageKeys[executionError.kind])}
      </p>
      {handoffReason === undefined ? null : (
        <p data-capture-handoff-reason>
          {messages("capture.errors.handoffDiagnostic", {
            reason: handoffReason,
          })}
        </p>
      )}
      {value.failure.kind === "handoff" || value.failure.recoverable ? (
        <button
          data-capture-retry
          onClick={() => void state.startCapture()}
          type="button"
        >
          {messages("capture.retryAction")}
        </button>
      ) : null}
      {executionError?.kind === "no-candidate" ? (
        <button
          data-capture-manual
          onClick={() => void state.startManualEntry()}
          type="button"
        >
          {messages("capture.manualEntryAction")}
        </button>
      ) : null}
    </section>
  );
}
