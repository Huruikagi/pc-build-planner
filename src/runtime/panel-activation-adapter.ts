import type {
  ActivationId,
  TransientDismissReason,
} from "../application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../domain/public.js";
import type { TabLifecyclePort } from "./tab-lifecycle-adapter.js";
import type {
  ActivationAuthorization,
  ActivationStoreError,
  TransientActivationRecord,
} from "./transient-activation-store.js";
import type {
  ActivationTransportError,
  TransientActivationPort,
} from "./transient-activation-transport.js";

type TabEndReason = Extract<TransientDismissReason, "navigated" | "tab-closed">;

export type PanelActivationOutcome =
  | { readonly kind: "authorized"; readonly record: TransientActivationRecord }
  | { readonly kind: "invalidated"; readonly record: TransientActivationRecord }
  | { readonly kind: "error"; readonly error: ActivationTransportError }
  | {
      readonly kind: "ended";
      readonly activationId: ActivationId;
      readonly reason: TabEndReason;
    };

export interface PanelActivationReadPort {
  read(): Promise<
    Result<TransientActivationRecord | undefined, ActivationStoreError>
  >;
  subscribe(
    listener: (record: TransientActivationRecord | undefined) => void,
  ): () => void;
}

export type PanelActivationAdapterError =
  | { readonly kind: "store-unavailable" }
  | { readonly kind: "not-started" };

export interface PanelActivationAdapter {
  start(
    listener: (outcome: PanelActivationOutcome) => void | Promise<void>,
  ): Promise<Result<() => void, PanelActivationAdapterError>>;
}

export const createPanelActivationAdapter = (options: {
  readonly store: PanelActivationReadPort;
  readonly lifecycle: TabLifecyclePort;
  readonly activation: TransientActivationPort;
}): PanelActivationAdapter => ({
  async start(listener) {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const watches = new Map<ActivationId, () => void>();
    const handled = new Set<ActivationId>();
    const ended = new Set<ActivationId>();
    const cleanup = () => {
      if (!active) return;
      active = false;
      for (const unwatch of watches.values()) unwatch();
      watches.clear();
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const consume = async (record: TransientActivationRecord | undefined) => {
      if (
        !active ||
        record === undefined ||
        record.stage === "invalidated" ||
        handled.has(record.activationId)
      )
        return;
      handled.add(record.activationId);
      const unwatch = options.lifecycle.watch(
        record.activationId,
        record.tabId,
        (activationId, reason) => {
          if (!active) return;
          ended.add(activationId);
          watches.delete(activationId);
          void listener({ kind: "ended", activationId, reason });
        },
      );
      watches.set(record.activationId, unwatch);
      const authorization = await options.activation.authorizeAfterWatchReady(
        record.activationId,
      );
      if (!active || ended.has(record.activationId)) return;
      if (!authorization.ok) {
        const stopWatch = watches.get(record.activationId);
        watches.delete(record.activationId);
        stopWatch?.();
        await listener({ kind: "error", error: authorization.error });
        return;
      }
      const decision: ActivationAuthorization = authorization.value;
      if (decision.kind === "invalidated") {
        const stopWatch = watches.get(record.activationId);
        watches.delete(record.activationId);
        stopWatch?.();
        await listener({ kind: "invalidated", record: decision.record });
        return;
      }
      await listener({ kind: "authorized", record: decision.record });
    };

    try {
      unsubscribe = options.store.subscribe((record) => void consume(record));
      const initial = await options.store.read();
      if (!initial.ok) {
        cleanup();
        return err({ kind: "store-unavailable" });
      }
      await consume(initial.value);
      return ok(cleanup);
    } catch {
      cleanup();
      return err({ kind: "not-started" });
    }
  },
});
