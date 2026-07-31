import type { TransientSurfaceController } from "../application-shell/transient-surface-controller.js";
import { createPanelActivationAdapter } from "./panel-activation-adapter.js";
import { createProductionMonitoringIntegration } from "./production-monitoring-integration.js";
import {
  type ChromeTabLifecycleApi,
  createChromeTabLifecycleAdapter,
} from "./tab-lifecycle-adapter.js";
import {
  type ChromeSessionArea,
  type ChromeStorageChanges,
  createChromeTransientSessionStorage,
  createTransientActivationStore,
} from "./transient-activation-store.js";
import {
  createTransientActivationPanelPort,
  createTransientStagePanelPort,
  type PanelMessageRuntime,
} from "./transient-activation-transport.js";

export const createProductionTransientPanelIntegration = (options: {
  readonly session: ChromeSessionArea;
  readonly changes: ChromeStorageChanges;
  readonly tabs: ChromeTabLifecycleApi;
  readonly runtime: PanelMessageRuntime;
  readonly controller: Pick<TransientSurfaceController, "request" | "dismiss">;
  readonly reportError?: (code: string) => void;
  readonly onSessionReadFailed?: () => void;
  readonly onSessionReadSucceeded?: () => void;
  readonly onActivationAccepted?: () => void;
  readonly onActivationExpired?: () => void;
}) => {
  const store = createTransientActivationStore(
    createChromeTransientSessionStorage(options.session),
  );
  const readPort = {
    async read() {
      const result = await store.read();
      if (result.ok) options.onSessionReadSucceeded?.();
      else options.onSessionReadFailed?.();
      return result;
    },
    subscribe(listener: Parameters<typeof store.subscribe>[0]) {
      let active = true;
      const onChanged = (_changes: unknown, areaName: string) => {
        if (!active || areaName !== "session") return;
        void store.read().then((result) => {
          if (!active) return;
          if (result.ok) {
            options.onSessionReadSucceeded?.();
            listener(result.value);
          } else options.onSessionReadFailed?.();
        });
      };
      options.changes.addListener(onChanged);
      return () => {
        if (!active) return;
        active = false;
        options.changes.removeListener(onChanged);
      };
    },
  };
  const integration = createProductionMonitoringIntegration({
    adapter: createPanelActivationAdapter({
      store: readPort,
      lifecycle: createChromeTabLifecycleAdapter(options.tabs),
      activation: createTransientActivationPanelPort(options.runtime),
    }),
    controller: options.controller,
    stages: createTransientStagePanelPort(options.runtime),
    reportError: (error) => options.reportError?.(error.kind),
    ...(options.onActivationAccepted === undefined
      ? {}
      : { onActivationAccepted: options.onActivationAccepted }),
    ...(options.onActivationExpired === undefined
      ? {}
      : { onActivationExpired: options.onActivationExpired }),
  });
  return {
    async start() {
      const result = await integration.start();
      if (!result.ok) options.onSessionReadFailed?.();
      // A transient transport failure must not take down persistent features.
      return { ok: true as const, value: undefined };
    },
    stop: () => integration.stop(),
  };
};
