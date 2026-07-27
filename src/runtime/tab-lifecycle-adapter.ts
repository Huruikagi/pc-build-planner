import type {
  ActivationId,
  TargetTabId,
  TransientDismissReason,
} from "../application-shell/transient-surface-ports.js";

type TabEndReason = Extract<TransientDismissReason, "navigated" | "tab-closed">;

export interface ChromeTabEvent<T extends unknown[]> {
  addListener(listener: (...args: T) => void): void;
  removeListener(listener: (...args: T) => void): void;
}

export interface ChromeTabLifecycleApi {
  readonly onUpdated: ChromeTabEvent<
    [tabId: number, changeInfo: { readonly status?: string }]
  >;
  readonly onRemoved: ChromeTabEvent<[tabId: number]>;
}

export interface TabLifecyclePort {
  watch(
    activationId: ActivationId,
    tabId: TargetTabId,
    onEnded: (activationId: ActivationId, reason: TabEndReason) => void,
  ): () => void;
}

export const createChromeTabLifecycleAdapter = (
  tabs: ChromeTabLifecycleApi,
): TabLifecyclePort => ({
  watch(activationId, tabId, onEnded) {
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      tabs.onUpdated.removeListener(onUpdated);
      tabs.onRemoved.removeListener(onRemoved);
    };
    const end = (reason: TabEndReason) => {
      if (!active) return;
      cleanup();
      onEnded(activationId, reason);
    };
    const onUpdated = (
      candidateTabId: number,
      changeInfo: { status?: string },
    ) => {
      if (candidateTabId === tabId && changeInfo.status === "loading")
        end("navigated");
    };
    const onRemoved = (candidateTabId: number) => {
      if (candidateTabId === tabId) end("tab-closed");
    };
    tabs.onUpdated.addListener(onUpdated);
    tabs.onRemoved.addListener(onRemoved);
    return cleanup;
  },
});
