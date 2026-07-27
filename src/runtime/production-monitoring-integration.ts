import type { TransientSurfaceController } from "../application-shell/transient-surface-controller.js";
import { err, ok, type Result } from "../domain/public.js";
import type {
  PanelActivationAdapter,
  PanelActivationAdapterError,
  PanelActivationOutcome,
} from "./panel-activation-adapter.js";
import type {
  ActivationStoreError,
  TransientActivationScheduler,
} from "./transient-activation-store.js";

export type MonitoringActivationAdapter = PanelActivationAdapter;

export type ProductionMonitoringError =
  | PanelActivationAdapterError
  | { readonly kind: "controller-failed" }
  | { readonly kind: "stage-advance-failed" };

export interface ProductionMonitoringIntegration {
  start(): Promise<Result<void, ProductionMonitoringError>>;
  stop(): void;
}

export const createProductionMonitoringIntegration = (options: {
  readonly adapter: MonitoringActivationAdapter;
  readonly controller: Pick<TransientSurfaceController, "request" | "dismiss">;
  readonly stages: Pick<TransientActivationScheduler, "advance">;
  readonly reportError?: (error: ProductionMonitoringError) => void;
}): ProductionMonitoringIntegration => {
  let active = false;
  let cleanup: (() => void) | undefined;
  let lifecycleEpoch = 0;
  const ended = new Set<string>();
  const report = options.reportError ?? (() => {});
  const handle = async (
    outcome: PanelActivationOutcome,
    epoch: number,
  ): Promise<void> => {
    if (!active || epoch !== lifecycleEpoch) return;
    if (outcome.kind === "ended") {
      ended.add(outcome.activationId);
      const dismissed = await options.controller.dismiss(
        outcome.activationId,
        outcome.reason,
      );
      if (!active || epoch !== lifecycleEpoch) return;
      if (!dismissed.ok) report({ kind: "controller-failed" });
      return;
    }
    if (outcome.kind !== "authorized") return;
    const { record } = outcome;
    if (ended.has(record.activationId)) return;
    const mounted = await options.controller.request({
      activationId: record.activationId,
      surfaceId: record.surfaceId,
      tabId: record.tabId,
    });
    if (!active || epoch !== lifecycleEpoch) return;
    if (!mounted.ok) {
      report({ kind: "controller-failed" });
      return;
    }
    if (ended.has(record.activationId)) return;
    const advanced: Result<void, ActivationStoreError> =
      await options.stages.advance(record.activationId, "activated");
    if (!active || epoch !== lifecycleEpoch) return;
    if (!advanced.ok) {
      report({ kind: "stage-advance-failed" });
      await options.controller.dismiss(record.activationId, "navigated");
    }
  };
  return {
    async start() {
      if (active) return ok(undefined);
      const epoch = ++lifecycleEpoch;
      active = true;
      const started = await options.adapter.start((outcome) =>
        handle(outcome, epoch),
      );
      if (!active || epoch !== lifecycleEpoch) {
        if (started.ok) started.value();
        return err({ kind: "not-started" });
      }
      if (!started.ok) {
        active = false;
        return err(started.error);
      }
      cleanup = started.value;
      return ok(undefined);
    },
    stop() {
      if (!active) return;
      lifecycleEpoch += 1;
      active = false;
      cleanup?.();
      cleanup = undefined;
      ended.clear();
    },
  };
};
