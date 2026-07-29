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
import type { MessageKey } from "../../src/ui-messages/public.js";

const featureId = (value: string) => value as FeatureId;
const noopTransientActivation = () => ({
  validate: (
    request: import("../../src/application-shell/transient-surface-ports.js").TransientActivationRequest,
  ) => ok(request),
  accept: async () => ok({ release: async () => undefined }),
});
const transientRequest = (surfaceId: FeatureId) => ({
  activationId:
    "fixture-activation" as import("../../src/application-shell/transient-surface-ports.js").ActivationId,
  surfaceId,
  tabId:
    1 as import("../../src/application-shell/transient-surface-ports.js").TargetTabId,
});

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
    presentation: "persistent",
    navigation: { labelKey: id as MessageKey, order },
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

test("transient起動をmount前に受理し通常終了でleaseを一度だけ解放する", async () => {
  const events: string[] = [];
  const persistent = feature("planner", 0, events);
  const transient: ApplicationFeatureRegistration = {
    id: featureId("capture"),
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    transientActivation: {
      validate(request) {
        events.push(`validate:${request.activationId}`);
        return ok(request);
      },
      async accept(request) {
        events.push(`accept:${request.tabId}`);
        let released = false;
        return ok({
          async release() {
            if (released) return;
            released = true;
            events.push("release");
          },
        });
      },
    },
    async mount() {
      events.push("mount:capture");
      return {
        async unmount() {
          events.push("unmount:capture");
        },
      };
    },
  };
  const { host } = setup([persistent, transient]);
  await host.start();
  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    true,
  );
  await host.restorePersistent(persistent.id, "navigated");
  await host.stop();
  assert.deepEqual(events, [
    "mount:planner",
    "validate:fixture-activation",
    "accept:1",
    "unmount:planner",
    "mount:capture",
    "unmount:capture",
    "release",
    "mount:planner",
    "unmount:planner",
  ]);
});

test("transient受理失敗では常設mountを維持する", async () => {
  const events: string[] = [];
  const persistent = feature("planner", 0, events);
  const transient: ApplicationFeatureRegistration = {
    id: featureId("rejected"),
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    transientActivation: {
      validate: (request) => ok(request),
      accept: async () =>
        err({ kind: "activation_failed", detail: "rejected" }),
    },
    async mount() {
      events.push("mount:rejected");
      return { async unmount() {} };
    },
  };
  const { host } = setup([persistent, transient]);
  await host.start();
  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    false,
  );
  assert.equal(host.getSelected(), persistent.id);
  assert.deepEqual(events, ["mount:planner"]);
  await host.stop();
});

test("transient mount失敗はleaseを一度解放して常設面を復元する", async () => {
  const events: string[] = [];
  let releases = 0;
  const persistent = feature("planner", 0, events);
  const transient: ApplicationFeatureRegistration = {
    id: featureId("broken"),
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    transientActivation: {
      validate: (request) => ok(request),
      accept: async () =>
        ok({
          release: async () => {
            releases += 1;
          },
        }),
    },
    async mount() {
      throw new Error("mount failed");
    },
  };
  const { host } = setup([persistent, transient]);
  await host.start();
  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    false,
  );
  assert.equal(releases, 1);
  assert.equal(host.getSelected(), persistent.id);
  assert.deepEqual(events, [
    "mount:planner",
    "unmount:planner",
    "mount:planner",
  ]);
  await host.stop();
});

test("lease release拒否を一度だけ診断しunmount済みslotを保持しない", async () => {
  const events: string[] = [];
  let releases = 0;
  const persistent = feature("planner", 0, events);
  const transient: ApplicationFeatureRegistration = {
    id: featureId("release-fails"),
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    transientActivation: {
      validate: (request) => ok(request),
      accept: async () =>
        ok({
          release: async () => {
            releases += 1;
            throw new Error("release failed");
          },
        }),
    },
    async mount() {
      return {
        async unmount() {
          events.push("unmount:transient");
        },
      };
    },
  };
  const { diagnostics, host } = setup([persistent, transient]);
  await host.start();
  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    true,
  );
  assert.equal(
    (await host.restorePersistent(persistent.id, "navigated")).ok,
    false,
  );
  assert.equal(host.getSelected(), null);
  await host.stop();
  assert.equal(releases, 1);
  assert.equal(
    diagnostics.some((value) =>
      value.includes("transient-activation-release-failed"),
    ),
    true,
  );
});

test("accept後にcurrent unmountが失敗しても新leaseを一度だけ解放する", async () => {
  const events: string[] = [];
  let releases = 0;
  const persistent: ApplicationFeatureRegistration = {
    ...feature("sticky", 0, events),
    async mount() {
      events.push("mount:sticky");
      return {
        async unmount() {
          events.push("unmount:sticky");
          throw new Error("sticky");
        },
      };
    },
  };
  const transient: ApplicationFeatureRegistration = {
    id: featureId("capture-after-sticky"),
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    transientActivation: {
      validate: (request) => ok(request),
      accept: async () =>
        ok({
          release: async () => {
            releases += 1;
          },
        }),
    },
    async mount() {
      events.push("mount:transient");
      return { async unmount() {} };
    },
  };
  const { host } = setup([persistent, transient]);
  await host.start();
  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    false,
  );
  assert.equal(releases, 1);
  assert.equal(host.getSelected(), persistent.id);
  assert.deepEqual(events, ["mount:sticky", "unmount:sticky"]);
  await assert.rejects(host.stop(), AggregateError);
  assert.equal(releases, 1);
});

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

test("一過性面から利用不可の戻り先を避けて常設fallbackと理由noticeを提示する", async () => {
  const events: string[] = [];
  const unavailable = feature("previous", 0, events, {
    availability: { status: "unavailable", reason: "準備中" },
  });
  const fallback = feature("fallback", 1, events);
  const transient: ApplicationFeatureRegistration = {
    id: featureId("capture"),
    presentation: "transient",
    transientActivation: noopTransientActivation(),
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    async mount() {
      events.push("mount:capture");
      return {
        async unmount() {
          events.push("unmount:capture");
        },
      };
    },
  };
  const { host, states } = setup([unavailable, fallback, transient]);
  await host.start();
  await host.showTransient(transientRequest(transient.id));
  assert.equal(
    (await host.restorePersistent(unavailable.id, "navigated")).ok,
    true,
  );
  assert.deepEqual(events.slice(-3), [
    "mount:capture",
    "unmount:capture",
    "mount:fallback",
  ]);
  const state = states.at(-1);
  assert.equal(state?.kind, "ready");
  if (state?.kind === "ready") {
    assert.equal(state.selected, fallback.id);
    assert.deepEqual(state.transientNotice?.message, {
      key: "shell.featureUnavailable",
      params: { featureId: unavailable.id, reason: "準備中" },
    });
  }
  await host.stop();
});

test("一過性featureを初期表示と通常選択の候補から除外する", async () => {
  const events: string[] = [];
  const persistent = feature("persistent", 10, events);
  const transient: ApplicationFeatureRegistration = {
    id: featureId("transient"),
    presentation: "transient",
    transientActivation: noopTransientActivation(),
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    async mount() {
      events.push("mount:transient");
      return { async unmount() {} };
    },
  };
  const { container, host } = setup([transient, persistent]);

  assert.equal((await host.start()).ok, true);
  assert.equal(
    container.querySelector("[data-feature]")?.getAttribute("data-feature"),
    "persistent",
  );
  assert.equal((await host.select(transient.id)).ok, false);
  assert.deepEqual(events, ["mount:persistent"]);
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
  const transient: ApplicationFeatureRegistration = {
    id: featureId("transient-fallback"),
    presentation: "transient",
    transientActivation: noopTransientActivation(),
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    async mount() {
      events.push("mount:transient-fallback");
      return { async unmount() {} };
    },
  };
  const { diagnostics, host } = setup([transient, first, dynamic]);
  await host.start();

  availability = { status: "unavailable", reason: "同期が必要です" };
  for (const listener of listeners) listener(availability);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ["mount:dynamic", "unmount:dynamic", "mount:first"]);
  const rejected = await host.select(dynamic.id);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.error.kind, "unavailable");
    assert.deepEqual(rejected.error.message, {
      key: "shell.featureUnavailable",
      params: { featureId: dynamic.id, reason: "同期が必要です" },
    });
  }
  assert.ok(
    diagnostics.some(
      (message) =>
        message.includes("feature-unavailable") && message.includes(dynamic.id),
    ),
  );
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
    message: {
      key: "shell.featureUnavailable",
      params: { featureId: only.id, reason: "初期設定が必要です" },
    },
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
    diagnostics.some(
      (message) =>
        message.includes("stale-feature-unmount-failed") &&
        message.includes("pending"),
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
      message.includes("host-stop-unmount-failed"),
    ).length,
    2,
  );
});

test("別featureへのactivationはmount後に一度配送し、適用失敗では安定診断を残して直前featureを回復する", async () => {
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
  const { container, diagnostics, host } = setup([previous, target]);
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
  assert.deepEqual(diagnostics, [
    "side-panel-host: activation-apply-failed-activation_failed featureId=target",
  ]);
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
