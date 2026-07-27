import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  TargetTabId,
} from "../../src/application-shell/transient-surface-ports.js";
import { createChromeTabLifecycleAdapter } from "../../src/runtime/tab-lifecycle-adapter.js";

type Listener<T extends unknown[]> = (...args: T) => void;
const event = <T extends unknown[]>() => {
  const listeners = new Set<Listener<T>>();
  return {
    addListener(listener: Listener<T>) {
      listeners.add(listener);
    },
    removeListener(listener: Listener<T>) {
      listeners.delete(listener);
    },
    emit(...args: T) {
      for (const listener of listeners) listener(...args);
    },
    size: () => listeners.size,
  };
};

test("対象tabのloading開始だけをnavigatedとして最大1回通知する", () => {
  const onUpdated = event<[number, { status?: string; url?: string }]>();
  const onRemoved = event<[number]>();
  const adapter = createChromeTabLifecycleAdapter({ onUpdated, onRemoved });
  const ended: unknown[] = [];
  const activationId = "activation-1" as ActivationId;
  adapter.watch(activationId, 7 as TargetTabId, (...args) => ended.push(args));

  onUpdated.emit(8, { status: "loading", url: "https://ignored.example" });
  onUpdated.emit(7, { status: "complete" });
  onUpdated.emit(7, { status: "loading" });
  onRemoved.emit(7);

  assert.deepEqual(ended, [[activationId, "navigated"]]);
  assert.equal(onUpdated.size(), 0);
  assert.equal(onRemoved.size(), 0);
});

test("対象tab closeを通知しcleanup後は全eventを無視する", () => {
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const adapter = createChromeTabLifecycleAdapter({ onUpdated, onRemoved });
  const ended: unknown[] = [];
  const activationId = "activation-2" as ActivationId;
  const cleanup = adapter.watch(activationId, 9 as TargetTabId, (...args) =>
    ended.push(args),
  );
  onRemoved.emit(8);
  cleanup();
  cleanup();
  onUpdated.emit(9, { status: "loading" });
  onRemoved.emit(9);
  assert.equal(ended.length, 0);

  adapter.watch(activationId, 9 as TargetTabId, (...args) => ended.push(args));
  onRemoved.emit(9);
  assert.deepEqual(ended, [[activationId, "tab-closed"]]);
});
