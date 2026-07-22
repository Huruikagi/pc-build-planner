import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureActivationIntent,
  FeatureId,
  FeatureMountHandle,
  ShellViewState,
} from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import { createSidePanelHost } from "../../src/application-shell/side-panel-host.js";
import { err, ok } from "../../src/domain/public.js";

const featureId = (value: string) => value as FeatureId;

function feature(
  id: string,
  order: number,
  events: string[],
  options: { availability?: Availability; failMount?: boolean } = {},
): ApplicationFeatureRegistration {
  const availability = options.availability ?? { status: "available" };
  const listeners = new Set<(value: Availability) => void>();
  return {
    id: featureId(id),
    navigation: { label: id, order },
    publicApi: {},
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mount({ container }): Promise<FeatureMountHandle> {
      events.push(`mount:${id}`);
      if (options.failMount) throw new Error("unsafe internal detail");
      const marker = document.createElement("p");
      marker.dataset.feature = id;
      container.append(marker);
      return {
        async captureState() {
          return ok(undefined);
        },
        async unmount() {
          events.push(`unmount:${id}`);
          marker.remove();
        },
      };
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(
  registrations: readonly ApplicationFeatureRegistration<object, unknown>[],
) {
  const registry = createFeatureRegistry();
  for (const registration of registrations) {
    assert.equal(registry.register(registration).ok, true);
  }
  const container = document.createElement("div");
  const states: ShellViewState[] = [];
  const diagnostics: string[] = [];
  const host = createSidePanelHost({
    container,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    registry,
    onStateChange: (state) => states.push(state),
    reportError: (message) => diagnostics.push(message),
  });
  return { container, diagnostics, host, states };
}

test("開始時に決定順の利用可能featureだけを選び、切替はunmount後にmountする", async () => {
  const events: string[] = [];
  const unavailable = feature("hidden", 0, events, {
    availability: { status: "unavailable", reason: "準備中" },
  });
  const first = feature("first", 1, events);
  const second = feature("second", 2, events);
  const { container, host, states } = setup([second, unavailable, first]);

  assert.equal((await host.start()).ok, true);
  assert.equal(container.querySelectorAll("[data-feature]").length, 1);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "first",
  );

  assert.equal((await host.select(second.id)).ok, true);
  assert.deepEqual(events, ["mount:first", "unmount:first", "mount:second"]);
  assert.equal(container.querySelectorAll("[data-feature]").length, 1);
  assert.equal(states.at(-1)?.kind, "ready");
});

test("利用不可featureの理由を返し、選択中が不可なら安全な遷移先へ移る", async () => {
  const events: string[] = [];
  let availability: Availability = { status: "available" };
  const listeners = new Set<(value: Availability) => void>();
  const first = feature("first", 1, events);
  const dynamic: ApplicationFeatureRegistration = {
    ...feature("dynamic", 0, events),
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const { diagnostics, host } = setup([first, dynamic]);
  await host.start();

  availability = { status: "unavailable", reason: "同期が必要です" };
  for (const listener of listeners) listener(availability);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ["mount:dynamic", "unmount:dynamic", "mount:first"]);
  const rejected = await host.select(dynamic.id);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.error.kind, "unavailable");
    assert.match(rejected.error.message, /同期が必要です/);
  }
  assert.ok(diagnostics.some((message) => message.includes("同期が必要です")));
});

test("mount失敗をfeature単位で隔離し、再試行と別featureへの移動を維持する", async () => {
  const events: string[] = [];
  const broken = feature("broken", 0, events, { failMount: true });
  const healthy = feature("healthy", 1, events);
  const { container, diagnostics, host, states } = setup([broken, healthy]);

  const started = await host.start();
  assert.equal(started.ok, true);
  assert.equal(states.at(-1)?.kind, "error");
  assert.ok(diagnostics.some((message) => message.includes("broken")));

  const retried = await host.select(broken.id);
  assert.equal(retried.ok, false);
  assert.equal((await host.select(healthy.id)).ok, true);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "healthy",
  );
  assert.deepEqual(events, ["mount:broken", "mount:broken", "mount:healthy"]);
});

test("stopは購読解除と現在viewのunmountを冪等に行う", async () => {
  const events: string[] = [];
  const { host } = setup([feature("first", 0, events)]);
  await host.start();
  await host.stop();
  await host.stop();
  assert.deepEqual(events, ["mount:first", "unmount:first"]);
});

test("遷移先がなければunavailable理由を利用者向けerror stateへ表示する", async () => {
  const events: string[] = [];
  let availability: Availability = { status: "available" };
  const listeners = new Set<(value: Availability) => void>();
  const only: ApplicationFeatureRegistration = {
    ...feature("only", 0, events),
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const { host, states } = setup([only]);
  await host.start();

  availability = { status: "unavailable", reason: "初期設定が必要です" };
  for (const listener of listeners) listener(availability);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(states.at(-1), {
    kind: "error",
    message: "feature only は利用できません: 初期設定が必要です",
    recoverable: true,
  });
  assert.deepEqual(events, ["mount:only", "unmount:only"]);
});

test("deferred mount完了前にstopした場合はstale viewを即unmountしてreadyを発行しない", async () => {
  const mountResult = deferred<FeatureMountHandle>();
  const mountStarted = deferred<void>();
  const events: string[] = [];
  const pending: ApplicationFeatureRegistration = {
    ...feature("pending", 0, events),
    async mount() {
      events.push("mount:pending");
      mountStarted.resolve();
      return mountResult.promise;
    },
  };
  const { host, states } = setup([pending]);
  const starting = host.start();
  await mountStarted.promise;
  const stopping = host.stop();
  mountResult.resolve({
    async unmount() {
      events.push("unmount:pending");
    },
  });
  await Promise.all([starting, stopping]);

  assert.deepEqual(events, ["mount:pending", "unmount:pending"]);
  assert.equal(
    states.some((state) => state.kind === "ready"),
    false,
  );
});

test("deferred mount中のavailability変更はstale viewを破棄してfallbackへ遷移する", async () => {
  const mountResult = deferred<FeatureMountHandle>();
  const mountStarted = deferred<void>();
  const events: string[] = [];
  let availability: Availability = { status: "available" };
  const listeners = new Set<(value: Availability) => void>();
  const pending: ApplicationFeatureRegistration = {
    ...feature("pending", 0, events),
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mount() {
      events.push("mount:pending");
      mountStarted.resolve();
      return mountResult.promise;
    },
  };
  const fallback = feature("fallback", 1, events);
  const { host, states } = setup([pending, fallback]);
  const starting = host.start();
  await mountStarted.promise;
  availability = { status: "unavailable", reason: "準備中です" };
  for (const listener of listeners) listener(availability);
  mountResult.resolve({
    async unmount() {
      events.push("unmount:pending");
    },
  });
  await starting;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, [
    "mount:pending",
    "unmount:pending",
    "mount:fallback",
  ]);
  assert.deepEqual(states.at(-1), {
    kind: "ready",
    selected: fallback.id,
  });
  assert.equal(
    states.some(
      (state) => state.kind === "ready" && state.selected === pending.id,
    ),
    false,
  );
});

test("mount contextへoperation policyとfeature診断をそのまま接続する", async () => {
  const registry = createFeatureRegistry();
  const events: string[] = [];
  const diagnostics: string[] = [];
  const operationPolicy = {
    isAllowed: (kind: "read" | "mutation") => kind === "read",
    subscribe: () => () => {},
  };
  const registration: ApplicationFeatureRegistration = {
    ...feature("context", 0, events),
    async mount(context) {
      assert.equal(context.operationPolicy, operationPolicy);
      assert.equal(context.operationPolicy.isAllowed("read"), true);
      assert.equal(context.operationPolicy.isAllowed("mutation"), false);
      context.reportError("外部由来の診断");
      return { async unmount() {} };
    },
  };
  assert.equal(registry.register(registration).ok, true);
  const host = createSidePanelHost({
    container: document.createElement("div"),
    operationPolicy,
    registry,
    onStateChange() {},
    reportError: (message) => diagnostics.push(message),
  });

  await host.start();

  assert.deepEqual(diagnostics, [
    "side-panel-host: feature context: 外部由来の診断",
  ]);
  await host.stop();
});

test("stale viewのcleanup失敗を診断しfallback遷移を継続する", async () => {
  const mountResult = deferred<FeatureMountHandle>();
  const mountStarted = deferred<void>();
  const events: string[] = [];
  let availability: Availability = { status: "available" };
  const listeners = new Set<(value: Availability) => void>();
  const pending: ApplicationFeatureRegistration = {
    ...feature("pending", 0, events),
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mount() {
      events.push("mount:pending");
      mountStarted.resolve();
      return mountResult.promise;
    },
  };
  const fallback = feature("fallback", 1, events);
  const { diagnostics, host, states } = setup([pending, fallback]);
  const starting = host.start();
  await mountStarted.promise;
  availability = { status: "unavailable", reason: "利用条件が変わりました" };
  for (const listener of listeners) listener(availability);
  mountResult.resolve({
    async unmount() {
      events.push("unmount:pending");
      throw new Error("cleanup detail");
    },
  });

  await starting;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, [
    "mount:pending",
    "unmount:pending",
    "mount:fallback",
  ]);
  assert.ok(
    diagnostics.some((message) =>
      message.includes("stale feature pending の表示終了に失敗しました"),
    ),
  );
  assert.deepEqual(states.at(-1), { kind: "ready", selected: fallback.id });
  await host.stop();
});

test("明示切替のunmount失敗後も旧handleを保持し再選択でcleanupを再試行する", async () => {
  const events: string[] = [];
  let unmountAttempts = 0;
  const first: ApplicationFeatureRegistration = {
    ...feature("first", 0, events),
    async mount({ container }) {
      events.push("mount:first");
      const marker = document.createElement("p");
      marker.dataset.feature = "first";
      container.append(marker);
      return {
        async unmount() {
          unmountAttempts += 1;
          events.push(`unmount:first:${unmountAttempts}`);
          if (unmountAttempts === 1)
            throw new Error("transient cleanup failure");
          marker.remove();
        },
      };
    },
  };
  const second = feature("second", 1, events);
  const { container, host } = setup([first, second]);
  await host.start();

  const failed = await host.select(second.id);
  assert.equal(failed.ok, false);
  assert.equal(container.querySelectorAll("[data-feature]").length, 1);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "first",
  );
  assert.equal(events.includes("mount:second"), false);

  assert.equal((await host.select(second.id)).ok, true);
  assert.deepEqual(events, [
    "mount:first",
    "unmount:first:1",
    "unmount:first:2",
    "mount:second",
  ]);
  assert.equal(container.querySelectorAll("[data-feature]").length, 1);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "second",
  );

  await host.stop();
  assert.deepEqual(events, [
    "mount:first",
    "unmount:first:1",
    "unmount:first:2",
    "mount:second",
    "unmount:second",
  ]);
});

test("stopのunmountが常に失敗してもownershipを保持して再stopで再試行する", async () => {
  const events: string[] = [];
  let unmountAttempts = 0;
  const registration: ApplicationFeatureRegistration = {
    ...feature("persistent", 0, events),
    async mount() {
      events.push("mount:persistent");
      return {
        async unmount() {
          unmountAttempts += 1;
          events.push(`unmount:persistent:${unmountAttempts}`);
          throw new Error("persistent cleanup failure");
        },
      };
    },
  };
  const { diagnostics, host } = setup([registration]);
  await host.start();

  await assert.rejects(host.stop(), AggregateError);
  await assert.rejects(host.stop(), AggregateError);

  assert.equal(unmountAttempts, 2);
  assert.equal(
    diagnostics.filter((message) =>
      message.includes("停止時のfeature表示終了に失敗しました"),
    ).length,
    2,
  );
});

test("別featureへのactivationはmount後に一度配送し、適用失敗では直前featureを回復する", async () => {
  const events: string[] = [];
  const previous = feature("previous", 0, events);
  const target: ApplicationFeatureRegistration<object, unknown> = {
    ...feature("target", 1, events),
    activation: {
      validate(intent) {
        if (intent.target !== "editor" || !isValuePayload(intent.payload))
          return err({ kind: "invalid_activation", detail: "invalid payload" });
        return ok(intent.payload);
      },
      async activate(input) {
        if (!isValuePayload(input))
          return err({ kind: "activation_failed", detail: "invalid input" });
        events.push(`activate:target:${input.value}`);
        return err({ kind: "activation_failed", detail: "apply failed" });
      },
    },
  };
  const { container, host } = setup([previous, target]);
  await host.start();

  const result = await host.activate({
    featureId: target.id,
    target: "editor",
    payload: { value: "prefill" },
  });

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "activation_failed", detail: "apply failed" },
  });
  assert.deepEqual(events, [
    "mount:previous",
    "unmount:previous",
    "mount:target",
    "activate:target:prefill",
    "unmount:target",
    "mount:previous",
  ]);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "previous",
  );
  await host.stop();
});

test("同一featureへのactivationは再mountせず、各intentを一度だけ配送する", async () => {
  const events: string[] = [];
  const target: ApplicationFeatureRegistration<object, unknown> = {
    ...feature("target", 0, events),
    activation: {
      validate(intent) {
        if (intent.target !== "editor" || !isValuePayload(intent.payload))
          return err({ kind: "invalid_activation", detail: "invalid payload" });
        return ok(intent.payload);
      },
      async activate(input) {
        if (!isValuePayload(input))
          return err({ kind: "activation_failed", detail: "invalid input" });
        events.push(`activate:target:${input.value}`);
        return ok(undefined);
      },
    },
  };
  const { host } = setup([target]);
  await host.start();
  const intent: FeatureActivationIntent = {
    featureId: target.id,
    target: "editor",
    payload: { value: "prefill" },
  };

  assert.equal((await host.activate(intent)).ok, true);
  assert.deepEqual(events, ["mount:target", "activate:target:prefill"]);
  await host.stop();
});

test("activation用mount失敗は既存featureを維持する", async () => {
  const events: string[] = [];
  const previous = feature("previous", 0, events);
  const target: ApplicationFeatureRegistration<object, unknown> = {
    ...feature("target", 1, events, { failMount: true }),
    activation: {
      validate: () => ok<unknown>({}),
      activate: async () => ok(undefined),
    },
  };
  const { container, host } = setup([previous, target]);
  await host.start();

  const result = await host.activate({
    featureId: target.id,
    target: "editor",
    payload: {},
  });

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "mount_failed", featureId: target.id },
  });
  assert.deepEqual(events, [
    "mount:previous",
    "unmount:previous",
    "mount:target",
    "mount:previous",
  ]);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "previous",
  );
  await host.stop();
});

test("snapshotを拒否するsourceからのactivationは表示を変更しない", async () => {
  const events: string[] = [];
  const source: ApplicationFeatureRegistration = {
    ...feature("source", 0, events),
    async mount(context) {
      const handle = await feature("source", 0, events).mount(context);
      return {
        ...handle,
        async captureState() {
          events.push("snapshot:source");
          throw new Error("snapshot rejected");
        },
      };
    },
  };
  const target: ApplicationFeatureRegistration<object, unknown> = {
    ...feature("target", 1, events),
    activation: { validate: () => ok({}), activate: async () => ok(undefined) },
  };
  const { container, host } = setup([source, target]);
  await host.start();

  const result = await host.activate({
    featureId: target.id,
    target: "x",
    payload: {},
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: "activation_failed",
      detail: "source feature rejected activation snapshot",
    },
  });
  assert.deepEqual(events, ["mount:source", "snapshot:source"]);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "source",
  );
  await host.stop();
});

test("activation失敗後にtarget cleanupが失敗するとtarget ownershipを保持しsourceを復元しない", async () => {
  const events: string[] = [];
  const source = feature("source", 0, events);
  const target: ApplicationFeatureRegistration<object, unknown> = {
    ...feature("target", 1, events),
    async mount(context) {
      const handle = await feature("target", 1, events).mount(context);
      return {
        ...handle,
        async unmount() {
          events.push("unmount:target:failed");
          throw new Error("cleanup failed");
        },
      };
    },
    activation: {
      validate: () => ok({}),
      async activate() {
        events.push("activate:target");
        return err({ kind: "activation_failed", detail: "apply failed" });
      },
    },
  };
  const { host } = setup([source, target]);
  await host.start();

  const result = await host.activate({
    featureId: target.id,
    target: "x",
    payload: {},
  });

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "mount_failed", featureId: target.id },
  });
  assert.deepEqual(events, [
    "mount:source",
    "unmount:source",
    "mount:target",
    "activate:target",
    "unmount:target:failed",
  ]);
  await assert.rejects(host.stop(), AggregateError);
  assert.deepEqual(events, [
    "mount:source",
    "unmount:source",
    "mount:target",
    "activate:target",
    "unmount:target:failed",
    "unmount:target:failed",
  ]);
});

test("activation中にtargetが利用不可になるとstale targetをcleanupしてsnapshot付きでsourceを復元する", async () => {
  const events: string[] = [];
  const targetMount = deferred<FeatureMountHandle>();
  const targetStarted = deferred<void>();
  let availability: Availability = { status: "available" };
  const listeners = new Set<(value: Availability) => void>();
  const source: ApplicationFeatureRegistration = {
    ...feature("source", 0, events),
    async mount(context) {
      events.push(
        context.restoredState === undefined
          ? "mount:source:fresh"
          : `mount:source:restored:${String((context.restoredState as { value: string }).value)}`,
      );
      return {
        async captureState() {
          events.push("snapshot:source");
          return ok({ value: "draft" });
        },
        async unmount() {
          events.push("unmount:source");
        },
      };
    },
  };
  const target: ApplicationFeatureRegistration<object, unknown> = {
    ...feature("target", 1, events),
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mount() {
      events.push("mount:target");
      targetStarted.resolve();
      return targetMount.promise;
    },
    activation: { validate: () => ok({}), activate: async () => ok(undefined) },
  };
  const { host } = setup([source, target]);
  await host.start();
  const activating = host.activate({
    featureId: target.id,
    target: "x",
    payload: {},
  });
  await targetStarted.promise;
  availability = { status: "unavailable", reason: "closed" };
  for (const listener of listeners) listener(availability);
  targetMount.resolve({
    async unmount() {
      events.push("unmount:target");
    },
  });

  assert.deepEqual(await activating, {
    ok: false,
    error: { kind: "mount_failed", featureId: target.id },
  });
  assert.deepEqual(events, [
    "mount:source:fresh",
    "snapshot:source",
    "unmount:source",
    "mount:target",
    "unmount:target",
    "mount:source:restored:draft",
  ]);
  await host.stop();
});

function isValuePayload(value: unknown): value is { readonly value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
  );
}
