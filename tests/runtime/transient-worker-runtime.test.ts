import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import type { FeatureContribution } from "../../src/application-shell/feature-contribution-catalog.js";
import type { ActivationId } from "../../src/application-shell/transient-surface-ports.js";
import { createChromeActivationFailureSignal } from "../../src/runtime/activation-failure-signal.js";
import {
  createProductionTransientRuntimeBootstrap,
  createTransientWorkerRuntimeBootstrap,
} from "../../src/runtime/service-worker.js";
import {
  createTransientActivationScheduler,
  createTransientActivationStore,
  type TransientActivationEnvelope,
  type TransientSessionStorage,
} from "../../src/runtime/transient-activation-store.js";

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
      for (const listener of [...listeners]) listener(...args);
    },
    size: () => listeners.size,
  };
};

class Session implements TransientSessionStorage {
  value: unknown;
  failReads = false;
  failWrites = false;
  async get() {
    if (this.failReads) throw new Error("unavailable");
    return this.value;
  }
  async set(value: TransientActivationEnvelope) {
    if (this.failWrites) throw new Error("unavailable");
    this.value = structuredClone(value);
  }
}

class DeferredFirstWriteSession extends Session {
  readonly started: Promise<void>;
  readonly #gate: Promise<void>;
  #markStarted!: () => void;
  #release!: () => void;
  #first = true;
  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.#markStarted = resolve;
    });
    this.#gate = new Promise((resolve) => {
      this.#release = resolve;
    });
  }
  override async set(value: TransientActivationEnvelope) {
    if (this.#first) {
      this.#first = false;
      this.#markStarted();
      await this.#gate;
    }
    await super.set(value);
  }
  release() {
    this.#release();
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("gesture callback内でpanel openを同期開始し同じschedulerへputする", async () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const session = new Session();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  const opened: number[] = [];
  const signalCalls: string[] = [];
  const cleanup = createTransientWorkerRuntimeBootstrap({
    scheduler,
    action: { onClicked: action },
    tabs: { onUpdated, onRemoved },
    sidePanel: {
      open: async ({ tabId }) => {
        if (tabId === undefined) throw new Error("tabId missing");
        opened.push(tabId);
      },
    },
    failureSignal: createChromeActivationFailureSignal({
      action: {
        async setBadgeText({ text }) {
          signalCalls.push(`badge:${text}`);
        },
        async setTitle({ title }) {
          signalCalls.push(`title:${title}`);
        },
      },
      runtime: { getManifest: () => ({ name: "Planner", action: {} }) },
    }),
    surfaceId: "transient-fixture" as FeatureId,
    createActivationId: () => "activation-1" as ActivationId,
  });

  action.emit({ id: 7 });
  assert.deepEqual(opened, [7]);
  await settle();
  const record = await scheduler.store.read();
  assert.equal(record.ok && record.value?.activationId, "activation-1");
  assert.deepEqual(signalCalls, ["badge:", "title:Planner"]);
  cleanup();
  assert.equal(action.size(), 0);
  assert.equal(onUpdated.size(), 0);
  assert.equal(onRemoved.size(), 0);
});

test("put失敗をsignalへpublishし次のdurable put成功後にclearする", async () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const session = new Session();
  session.failWrites = true;
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  const calls: string[] = [];
  let counter = 0;
  createTransientWorkerRuntimeBootstrap({
    scheduler,
    action: { onClicked: action },
    tabs: { onUpdated, onRemoved },
    sidePanel: { open: async () => {} },
    failureSignal: createChromeActivationFailureSignal({
      action: {
        async setBadgeText({ text }) {
          calls.push(`badge:${text}`);
        },
        async setTitle({ title }) {
          calls.push(`title:${title}`);
        },
      },
      runtime: { getManifest: () => ({ name: "Planner" }) },
    }),
    surfaceId: "transient-fixture" as FeatureId,
    createActivationId: () => `activation-${++counter}` as ActivationId,
  });
  action.emit({ id: 7 });
  await settle();
  assert.deepEqual(calls, [
    "badge:!",
    "title:起動情報を保存できません。拡張アイコンを再操作してください",
  ]);
  session.failWrites = false;
  action.emit({ id: 7 });
  await settle();
  assert.deepEqual(calls.slice(-2), ["badge:", "title:Planner"]);
});

test("初回session read障害から同じworkerの再操作で復旧しsignalをclearする", async () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const session = new Session();
  session.failReads = true;
  const calls: string[] = [];
  let counter = 0;
  createTransientWorkerRuntimeBootstrap({
    scheduler: createTransientActivationScheduler(
      createTransientActivationStore(session),
    ),
    action: { onClicked: action },
    tabs: { onUpdated, onRemoved },
    sidePanel: { open: async () => {} },
    failureSignal: createChromeActivationFailureSignal({
      action: {
        async setBadgeText({ text }) {
          calls.push(`badge:${text}`);
        },
        async setTitle({ title }) {
          calls.push(`title:${title}`);
        },
      },
      runtime: { getManifest: () => ({ name: "Planner" }) },
    }),
    surfaceId: "transient-fixture" as FeatureId,
    createActivationId: () => `read-retry-${++counter}` as ActivationId,
  });
  action.emit({ id: 8 });
  await settle();
  assert.equal(calls[0], "badge:!");
  session.failReads = false;
  action.emit({ id: 8 });
  await settle();
  assert.deepEqual(calls.slice(-2), ["badge:", "title:Planner"]);
});

test("top-level tab eventsはrecord不在でも同一schedulerへ失効をenqueueする", async () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const session = new Session();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  createTransientWorkerRuntimeBootstrap({
    scheduler,
    action: { onClicked: action },
    tabs: { onUpdated, onRemoved },
    sidePanel: { open: async () => {} },
    failureSignal: createChromeActivationFailureSignal({
      action: { async setBadgeText() {}, async setTitle() {} },
      runtime: { getManifest: () => ({ name: "Planner" }) },
    }),
    surfaceId: "transient-fixture" as FeatureId,
    createActivationId: () => "activation" as ActivationId,
  });
  onUpdated.emit(11, { status: "complete" });
  onUpdated.emit(11, { status: "loading" });
  onRemoved.emit(12);
  await settle();
  const envelope = await scheduler.store.readEnvelope();
  assert.deepEqual(
    envelope.ok && envelope.value.tombstones.map((x) => x.tabId),
    [11, 12],
  );
});

test("gesture直後のnavigationは保留putを追い越さず同世代をinvalidatedにする", async () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const session = new DeferredFirstWriteSession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  createTransientWorkerRuntimeBootstrap({
    scheduler,
    action: { onClicked: action },
    tabs: { onUpdated, onRemoved },
    sidePanel: { open: async () => {} },
    failureSignal: createChromeActivationFailureSignal({
      action: { async setBadgeText() {}, async setTitle() {} },
      runtime: { getManifest: () => ({ name: "Planner" }) },
    }),
    surfaceId: "transient-fixture" as FeatureId,
    createActivationId: () => "activation-race" as ActivationId,
  });
  action.emit({ id: 31 });
  await session.started;
  onUpdated.emit(31, { status: "loading" });
  session.release();
  await settle();
  const record = await scheduler.store.read();
  assert.equal(record.ok && record.value?.stage, "invalidated");
});

test("production compositionはgesture・tabs・watch-readyへ単一schedulerを注入する", async () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const messages = event<[unknown, unknown, (response: unknown) => void]>();
  const session = new Session();
  const runtime = {
    id: "extension-id",
    getURL: (path: string) => `chrome-extension://extension-id/${path}`,
    getManifest: () => ({ name: "Planner", action: {} }),
    onMessage: messages,
  };
  const composition = createProductionTransientRuntimeBootstrap(
    runtime,
    {
      storage: {
        session: {
          async get() {
            return { transientActivationEnvelope: session.value };
          },
          async set(items) {
            session.value = items.transientActivationEnvelope;
          },
        },
      },
      action: {
        onClicked: action,
        async setBadgeText() {},
        async setTitle() {},
      },
      tabs: { onUpdated, onRemoved },
      sidePanel: { open: async () => {} },
    },
    [
      {
        key: "transient-fixture",
        registration: {
          id: "transient-fixture" as FeatureId,
          presentation: "transient",
        },
      } as unknown as FeatureContribution,
    ],
  );
  assert.equal(composition.hasTransientGesture, true);
  action.emit({ id: 21 });
  await settle();
  const stored = await composition.scheduler.store.read();
  assert.equal(stored.ok && stored.value?.tabId, 21);
  const activationId = stored.ok && stored.value?.activationId;
  assert.equal(typeof activationId, "string");
  const response = await new Promise<unknown>((resolve) => {
    messages.emit(
      { version: 1, kind: "transient-watch-ready", activationId },
      { id: runtime.id, url: runtime.getURL("side-panel.html") },
      resolve,
    );
  });
  assert.equal(
    (response as { decision?: { kind?: string } }).decision?.kind,
    "authorized",
  );
  composition.cleanup();
  assert.equal(action.size(), 0);
  assert.equal(onUpdated.size(), 0);
  assert.equal(onRemoved.size(), 0);
  assert.equal(messages.size(), 0);
});
