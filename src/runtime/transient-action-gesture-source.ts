import type { FeatureId } from "../application-shell/contracts.js";
import type { TransientGestureSource } from "../application-shell/transient-surface-ports.js";
import { parseTargetTabId } from "../application-shell/transient-surface-ports.js";
import { ok } from "../domain/public.js";

export interface ChromeActionGestureEvent {
  addListener(listener: (tab: { readonly id?: number }) => void): void;
  removeListener(listener: (tab: { readonly id?: number }) => void): void;
}

export const createActionGestureSource = (options: {
  readonly action: { readonly onClicked: ChromeActionGestureEvent };
  readonly surfaceId: FeatureId;
}): TransientGestureSource => ({
  id: "chrome-action",
  surfaceId: options.surfaceId,
  start(emit) {
    const listener = (tab: { readonly id?: number }) => {
      const parsed = parseTargetTabId(tab.id);
      if (parsed.ok) emit(parsed.value);
    };
    options.action.onClicked.addListener(listener);
    return ok(() => options.action.onClicked.removeListener(listener));
  },
});
