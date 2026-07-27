import type { MessageDescriptor } from "../ui-messages/public.js";
import type { ShellViewState } from "./contracts.js";

export type TransientNoticeEvent =
  | {
      readonly kind: "session-read-failed";
      readonly message: MessageDescriptor;
    }
  | { readonly kind: "session-read-succeeded" }
  | { readonly kind: "activation-accepted" }
  | { readonly kind: "panel-opened" };

export function projectTransientNotice(
  state: ShellViewState,
  event: TransientNoticeEvent,
): ShellViewState {
  if (state.kind !== "ready" && state.kind !== "maintenance") return state;
  if (event.kind === "session-read-failed") {
    return {
      ...state,
      transientNotice: { message: event.message, recoverable: true },
    };
  }
  if (
    event.kind !== "session-read-succeeded" &&
    event.kind !== "activation-accepted"
  )
    return state;
  const { transientNotice: _notice, ...cleared } = state;
  return cleared;
}
