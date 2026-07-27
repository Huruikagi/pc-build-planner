import type { FeatureId } from "../application-shell/contracts.js";
import type {
  ActivationId,
  TargetTabId,
} from "../application-shell/transient-surface-ports.js";
import type { ActivationFailureSignal } from "./activation-failure-signal.js";
import type { ChromeSidePanelOpenApi } from "./open-side-panel.js";
import type { TransientActivationScheduler } from "./transient-activation-store.js";

export type CanonicalGestureIngress = (
  surfaceId: FeatureId,
  tabId: TargetTabId,
) => void;

export const createCanonicalGestureIngress = (options: {
  readonly scheduler: TransientActivationScheduler;
  readonly sidePanel: ChromeSidePanelOpenApi;
  readonly failureSignal: ActivationFailureSignal;
  createActivationId(): ActivationId;
  reportDiagnostic?(code: string): void;
}): CanonicalGestureIngress => {
  const report = options.reportDiagnostic ?? (() => {});
  return (surfaceId, tabId) => {
    const persisted = options.scheduler.put({
      activationId: options.createActivationId(),
      surfaceId,
      tabId,
    });
    void options.scheduler.enqueue(async () => {
      const result = await persisted;
      const signaled = result.ok
        ? await options.failureSignal.onDurablePutSucceeded()
        : await options.failureSignal.publish();
      if (!signaled.ok) report(signaled.error.kind);
    });
    void options.sidePanel
      .open({ tabId })
      .catch(() => report("side-panel-open-failed"));
  };
};
