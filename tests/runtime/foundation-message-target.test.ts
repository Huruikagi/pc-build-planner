import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkerMessageHandler } from "../../src/persistence/public.js";
import {
  createChromeFoundationMessageTarget,
  type RuntimeMessageListener,
} from "../../src/runtime/foundation-message-target.js";

const createRuntime = () => {
  const listeners: RuntimeMessageListener[] = [];
  const removed: RuntimeMessageListener[] = [];
  return {
    listeners,
    removed,
    runtime: {
      id: "extension-id",
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: {
        addListener: (listener: RuntimeMessageListener) =>
          listeners.push(listener),
        removeListener: (listener: RuntimeMessageListener) =>
          removed.push(listener),
      },
    },
  };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Chrome foundation message target", () => {
  it("routes only foundation commands and does not compete with catalog actions", async () => {
    const fixture = createRuntime();
    const calls: unknown[][] = [];
    const responses: unknown[] = [];
    const handler: WorkerMessageHandler = async (...args) => {
      calls.push(args);
      return { ok: false, error: { code: "invalid-message" } };
    };
    createChromeFoundationMessageTarget(fixture.runtime).addHandler(handler);
    const listener = fixture.listeners[0];
    assert.ok(listener);

    assert.equal(
      listener(
        { kind: "catalog-action", actionId: "open" },
        { id: "extension-id" },
        (value) => responses.push(value),
      ),
      undefined,
    );
    assert.equal(calls.length, 0);
    assert.equal(responses.length, 0);

    assert.equal(
      listener(
        { kind: "query-root" },
        {
          id: "extension-id",
          url: "chrome-extension://extension-id/panel.html",
        },
        (value) => responses.push(value),
      ),
      true,
    );
    await flush();
    assert.deepEqual(calls[0]?.[1], { kind: "trusted-extension" });
    assert.deepEqual(responses, [
      { ok: false, error: { code: "invalid-message" } },
    ]);
  });

  it("classifies content scripts and fails closed for external or malformed senders", async () => {
    const fixture = createRuntime();
    const callers: unknown[] = [];
    const handler: WorkerMessageHandler = async (_message, caller) => {
      callers.push(caller);
      return { ok: false, error: { code: "caller-denied" } };
    };
    createChromeFoundationMessageTarget(fixture.runtime).addHandler(handler);
    const listener = fixture.listeners[0];
    assert.ok(listener);
    const send = () => undefined;

    listener({ kind: "mutate-root" }, { id: "extension-id", tab: {} }, send);
    listener(
      { kind: "assess-replacement" },
      { id: "external", url: "https://example.test/" },
      send,
    );
    listener(
      { kind: "replace-root" },
      {
        get id() {
          throw new Error("untrusted getter");
        },
      },
      send,
    );
    listener(
      { kind: "run-maintenance" },
      {
        id: "extension-id",
        url: "chrome-extension://extension-id.evil/panel.html",
      },
      send,
    );
    await flush();
    assert.deepEqual(callers, [
      { kind: "content-script" },
      { kind: "web-page" },
      { kind: "web-page" },
      { kind: "web-page" },
    ]);
  });

  it("normalizes rejection, responds once, and removes the exact listener idempotently", async () => {
    const fixture = createRuntime();
    const responses: unknown[] = [];
    const dispose = createChromeFoundationMessageTarget(
      fixture.runtime,
    ).addHandler(() => Promise.reject(new Error("secret detail")));
    const listener = fixture.listeners[0];
    assert.ok(listener);

    assert.equal(
      listener({ kind: "query-root" }, {}, (value) => responses.push(value)),
      true,
    );
    await flush();
    assert.deepEqual(responses, [
      { ok: false, error: { code: "message-handler-failed" } },
    ]);

    dispose();
    dispose();
    assert.deepEqual(fixture.removed, [listener]);
  });

  it("normalizes a synchronously thrown handler without leaking its value", () => {
    const fixture = createRuntime();
    const responses: unknown[] = [];
    createChromeFoundationMessageTarget(fixture.runtime).addHandler(() => {
      throw new Error("sensitive command detail");
    });
    const listener = fixture.listeners[0];
    assert.ok(listener);

    assert.equal(
      listener({ kind: "query-root" }, {}, (value) => responses.push(value)),
      true,
    );
    assert.deepEqual(responses, [
      { ok: false, error: { code: "message-handler-failed" } },
    ]);
  });
});
