import assert from "node:assert/strict";
import test from "node:test";
import { createProductionTransientPanelIntegration } from "../../src/runtime/production-transient-panel.js";
import { TRANSIENT_ACTIVATION_STORAGE_KEY } from "../../src/runtime/transient-activation-store.js";

test("production panelはsession変更を一度だけ購読しstop/restartで対称に解放する", async () => {
  const listeners = new Set<(changes: unknown, area: string) => void>();
  const tabUpdated = new Set<
    (tabId: number, change: { readonly status?: string }) => void
  >();
  const tabRemoved = new Set<(tabId: number) => void>();
  let envelope: unknown;
  const integration = createProductionTransientPanelIntegration({
    session: {
      async get() {
        return { [TRANSIENT_ACTIVATION_STORAGE_KEY]: envelope };
      },
      async set(items) {
        envelope = items[TRANSIENT_ACTIVATION_STORAGE_KEY];
      },
    },
    changes: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
    tabs: {
      onUpdated: {
        addListener: (listener) => tabUpdated.add(listener),
        removeListener: (listener) => tabUpdated.delete(listener),
      },
      onRemoved: {
        addListener: (listener) => tabRemoved.add(listener),
        removeListener: (listener) => tabRemoved.delete(listener),
      },
    },
    runtime: {
      async sendMessage() {
        throw new Error("unused");
      },
    },
    controller: {
      async request() {
        return { ok: true, value: undefined };
      },
      async dismiss() {
        return { ok: true, value: undefined };
      },
    },
  });

  assert.equal((await integration.start()).ok, true);
  assert.equal(listeners.size, 1);
  integration.stop();
  assert.equal(listeners.size, 0);
  assert.equal((await integration.start()).ok, true);
  assert.equal(listeners.size, 1);
  integration.stop();
  assert.equal(listeners.size, 0);
  assert.equal(tabUpdated.size, 0);
  assert.equal(tabRemoved.size, 0);
});

test("production panelはsession read障害時にlistenerを残さない", async () => {
  const listeners = new Set<(changes: unknown, area: string) => void>();
  let failures = 0;
  const integration = createProductionTransientPanelIntegration({
    session: {
      async get() {
        throw new Error("storage unavailable");
      },
      async set() {},
    },
    changes: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      onRemoved: { addListener() {}, removeListener() {} },
    },
    runtime: {
      async sendMessage() {
        return undefined;
      },
    },
    controller: {
      async request() {
        return { ok: true, value: undefined };
      },
      async dismiss() {
        return { ok: true, value: undefined };
      },
    },
    onSessionReadFailed: () => {
      failures += 1;
    },
  });
  assert.equal((await integration.start()).ok, true);
  assert.ok(failures > 0);
  assert.equal(listeners.size, 0);
});
