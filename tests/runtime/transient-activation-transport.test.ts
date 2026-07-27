import assert from "node:assert/strict";
import test from "node:test";

import type { ActivationId } from "../../src/application-shell/transient-surface-ports.js";
import { ok } from "../../src/domain/public.js";
import type { RuntimeMessageListener } from "../../src/runtime/foundation-message-target.js";
import type { ActivationAuthorization } from "../../src/runtime/transient-activation-store.js";
import {
  createTransientActivationPanelPort,
  registerTransientWatchReadyListener,
} from "../../src/runtime/transient-activation-transport.js";

const id = "activation-1" as ActivationId;
const decision: ActivationAuthorization = {
  kind: "authorized",
  record: {
    activationId: id,
    surfaceId: "capture" as never,
    tabId: 7 as never,
    seq: 1 as never,
    stage: "activated",
  },
};

const fixture = () => {
  let listener: RuntimeMessageListener | undefined;
  const runtime = {
    id: "extension-id",
    getURL: (path: string) => `chrome-extension://extension-id/${path}`,
    onMessage: {
      addListener(value: RuntimeMessageListener) {
        listener = value;
      },
      removeListener(value: RuntimeMessageListener) {
        if (listener === value) listener = undefined;
      },
    },
  };
  return { runtime, getListener: () => listener };
};

test("worker transport preserves authorized decisions for trusted extension panels", async () => {
  const { runtime, getListener } = fixture();
  registerTransientWatchReadyListener(runtime, {
    authorizeAfterWatchReady: async () => ok(decision),
  });
  const response = await new Promise<unknown>((resolve) => {
    assert.equal(
      getListener()?.(
        { version: 1, kind: "transient-watch-ready", activationId: id },
        { id: runtime.id, url: runtime.getURL("side-panel.html") },
        resolve,
      ),
      true,
    );
  });
  assert.deepEqual(response, { version: 1, ok: true, decision });
});

test("worker transport rejects untrusted senders and malformed requests", async () => {
  const { runtime, getListener } = fixture();
  let calls = 0;
  registerTransientWatchReadyListener(runtime, {
    authorizeAfterWatchReady: async () => {
      calls += 1;
      return ok(decision);
    },
  });
  const invoke = (message: unknown, sender: unknown) =>
    new Promise<unknown>((resolve) =>
      getListener()?.(message, sender, resolve),
    );
  assert.deepEqual(
    await invoke(
      { version: 1, kind: "transient-watch-ready", activationId: id },
      { id: runtime.id, tab: { id: 7 }, url: runtime.getURL("content.js") },
    ),
    { version: 1, ok: false, code: "invalid-message" },
  );
  assert.deepEqual(
    await invoke(
      { version: 2, kind: "transient-watch-ready", activationId: id },
      { id: runtime.id, url: runtime.getURL("side-panel.html") },
    ),
    { version: 1, ok: false, code: "invalid-message" },
  );
  assert.deepEqual(
    await invoke(
      { version: 1, kind: "transient-watch-ready", activationId: id },
      { id: runtime.id, url: runtime.getURL("options.html") },
    ),
    { version: 1, ok: false, code: "invalid-message" },
  );
  assert.equal(calls, 0);
});

test("worker maps store failures to stable public codes", async () => {
  for (const [kind, code] of [
    ["storage-unavailable", "store-unavailable"],
    ["capacity-exceeded", "capacity-exceeded"],
    ["activation-not-found", "not-started"],
    ["unsupported-version", "not-started"],
    ["corrupt-envelope", "not-started"],
    ["invalid-stage-transition", "not-started"],
  ] as const) {
    const { runtime, getListener } = fixture();
    registerTransientWatchReadyListener(runtime, {
      authorizeAfterWatchReady: async () => ({ ok: false, error: { kind } }),
    });
    const response = await new Promise<unknown>((resolve) =>
      getListener()?.(
        { version: 1, kind: "transient-watch-ready", activationId: id },
        { id: runtime.id, url: runtime.getURL("side-panel.html") },
        resolve,
      ),
    );
    assert.deepEqual(response, { version: 1, ok: false, code });
  }
});

test("panel transport validates unknown responses and preserves invalidated", async () => {
  const invalidated = {
    ...decision,
    kind: "invalidated" as const,
    record: { ...decision.record, stage: "invalidated" as const },
  };
  const panel = createTransientActivationPanelPort({
    sendMessage: async () => ({ version: 1, ok: true, decision: invalidated }),
  });
  assert.deepEqual(await panel.authorizeAfterWatchReady(id), ok(invalidated));

  const malformed = createTransientActivationPanelPort({
    sendMessage: async () => ({ ok: true }),
  });
  assert.deepEqual(await malformed.authorizeAfterWatchReady(id), {
    ok: false,
    error: { kind: "invalid-message" },
  });

  const contradictory = createTransientActivationPanelPort({
    sendMessage: async () => ({
      version: 1,
      ok: true,
      decision: { kind: "authorized", record: invalidated.record },
    }),
  });
  assert.deepEqual(await contradictory.authorizeAfterWatchReady(id), {
    ok: false,
    error: { kind: "invalid-message" },
  });

  const rejected = createTransientActivationPanelPort({
    sendMessage: async () => Promise.reject(new Error("unavailable")),
  });
  assert.deepEqual(await rejected.authorizeAfterWatchReady(id), {
    ok: false,
    error: { kind: "store-unavailable" },
  });
});
