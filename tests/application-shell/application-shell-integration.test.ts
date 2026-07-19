import assert from "node:assert/strict";
import test from "node:test";

import {
  type ApplicationShellIntegration,
  createApplicationShellIntegration,
} from "../../src/application-shell/application-shell-integration.js";
import type {
  ApplicationFeatureRegistration,
  FeatureId,
  FeatureMountContext,
  ShellViewState,
} from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../src/persistence/public.js";

const featureId = (value: string) => value as FeatureId;
const snapshot = (
  generation: number,
  revision: number,
  active: boolean,
): MaintenanceSnapshot => ({
  generation: generation as MaintenanceSnapshot["generation"],
  revision: revision as MaintenanceSnapshot["revision"],
  active,
});

function source(initial: MaintenanceSnapshot | Error) {
  const listeners = new Set<(value: MaintenanceSnapshot) => void>();
  let unsubscribeCalls = 0;
  const maintenanceSource: MaintenanceSnapshotSource = {
    async getSnapshot() {
      if (initial instanceof Error) throw initial;
      return { ok: true, value: initial };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        unsubscribeCalls += 1;
        listeners.delete(listener);
      };
    },
  };
  return {
    maintenanceSource,
    emit(value: MaintenanceSnapshot) {
      for (const listener of listeners) listener(value);
    },
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(initial: MaintenanceSnapshot | Error) {
  const registry = createFeatureRegistry();
  const contexts = new Map<string, FeatureMountContext>();
  for (const [order, id] of ["projects", "compatibility"].entries()) {
    const registration: ApplicationFeatureRegistration = {
      id: featureId(id),
      navigation: { label: id, order },
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => {},
      async mount(context) {
        contexts.set(id, context);
        return { async unmount() {} };
      },
    };
    assert.equal(registry.register(registration).ok, true);
  }
  const states: ShellViewState[] = [];
  const diagnostics: string[] = [];
  const fixture = source(initial);
  const integration = createApplicationShellIntegration({
    container: document.createElement("div"),
    maintenanceSource: fixture.maintenanceSource,
    registry,
    onStateChange: (state) => states.push(state),
    reportError: (message) => diagnostics.push(message),
  });
  return { contexts, diagnostics, fixture, integration, states };
}

test("maintenanceを共通表示と全featureの同一live policyへ反映しstale終了では復帰しない", async () => {
  const { contexts, diagnostics, fixture, integration, states } = setup(
    snapshot(3, 4, false),
  );
  assert.equal((await integration.start()).ok, true);
  const firstPolicy = contexts.get("projects")?.operationPolicy;
  assert.ok(firstPolicy);
  assert.equal(firstPolicy.isAllowed("read"), true);
  assert.equal(firstPolicy.isAllowed("mutation"), true);

  fixture.emit(snapshot(4, 1, true));
  assert.deepEqual(states.at(-1), {
    kind: "maintenance",
    selected: featureId("projects"),
    message: "メンテナンス中です。変更操作は利用できません。",
  });
  assert.equal(firstPolicy.isAllowed("read"), true);
  assert.equal(firstPolicy.isAllowed("mutation"), false);

  assert.equal((await integration.select(featureId("compatibility"))).ok, true);
  const secondPolicy = contexts.get("compatibility")?.operationPolicy;
  assert.equal(secondPolicy, firstPolicy);
  assert.equal(secondPolicy?.isAllowed("read"), true);
  assert.equal(secondPolicy?.isAllowed("mutation"), false);

  fixture.emit(snapshot(3, 99, false));
  assert.equal(secondPolicy?.isAllowed("mutation"), false);
  assert.ok(diagnostics.some((message) => message.includes("stale")));

  fixture.emit(snapshot(4, 2, false));
  assert.deepEqual(states.at(-1), {
    kind: "ready",
    selected: featureId("compatibility"),
  });
  assert.equal(firstPolicy.isAllowed("mutation"), true);
  assert.equal(secondPolicy?.isAllowed("mutation"), true);
});

test("初期snapshot失敗はfeatureをmountせずstartup failureへ変換する", async () => {
  const { contexts, integration, states } = setup(new Error("storage detail"));
  const result = await integration.start();
  assert.equal(result.ok, false);
  assert.equal(contexts.size, 0);
  assert.deepEqual(states.at(-1), {
    kind: "error",
    message: "メンテナンス状態を取得できませんでした",
    recoverable: false,
  });
});

test("stopはsourceとhostをbest-effortかつ冪等にcleanupする", async () => {
  const { fixture, integration } = setup(snapshot(1, 1, false));
  await integration.start();
  await integration.stop();
  await integration.stop();
  assert.equal(fixture.unsubscribeCalls(), 1);
});

test("source listener例外を診断へ隔離し後続通知を処理する", async () => {
  const { diagnostics, fixture, integration } = setup(snapshot(1, 1, false));
  await integration.start();
  fixture.emit(snapshot(-1, 2, true));
  fixture.emit(snapshot(1, 2, true));
  assert.equal(integration.operationPolicy.isAllowed("mutation"), false);
  assert.ok(diagnostics.some((message) => message.includes("invalid")));
});

test("deferred初期snapshot中のstopは後続subscribeとfeature mountを開始しない", async () => {
  const initial =
    deferred<Awaited<ReturnType<MaintenanceSnapshotSource["getSnapshot"]>>>();
  let subscribeCalls = 0;
  const registry = createFeatureRegistry();
  let mountCalls = 0;
  assert.equal(
    registry.register({
      id: featureId("deferred"),
      navigation: { label: "deferred", order: 0 },
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => {},
      async mount() {
        mountCalls += 1;
        return { async unmount() {} };
      },
    }).ok,
    true,
  );
  const integration = createApplicationShellIntegration({
    registry,
    container: document.createElement("div"),
    maintenanceSource: {
      getSnapshot: () => initial.promise,
      subscribe() {
        subscribeCalls += 1;
        return () => {};
      },
    },
    onStateChange() {},
    reportError() {},
  });

  const starting = integration.start();
  const stopping = integration.stop();
  initial.resolve({ ok: true, value: snapshot(1, 1, false) });
  await Promise.all([starting, stopping]);
  assert.equal(subscribeCalls, 0);
  assert.equal(mountCalls, 0);
});

test("concurrent startは初期化、購読、mountをsingle-flight化する", async () => {
  const initial =
    deferred<Awaited<ReturnType<MaintenanceSnapshotSource["getSnapshot"]>>>();
  let snapshotCalls = 0;
  let subscribeCalls = 0;
  const registry = createFeatureRegistry();
  let mountCalls = 0;
  assert.equal(
    registry.register({
      id: featureId("single"),
      navigation: { label: "single", order: 0 },
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => {},
      async mount() {
        mountCalls += 1;
        return { async unmount() {} };
      },
    }).ok,
    true,
  );
  const integration = createApplicationShellIntegration({
    registry,
    container: document.createElement("div"),
    maintenanceSource: {
      getSnapshot() {
        snapshotCalls += 1;
        return initial.promise;
      },
      subscribe() {
        subscribeCalls += 1;
        return () => {};
      },
    },
    onStateChange() {},
    reportError() {},
  });
  const first = integration.start();
  const second = integration.start();
  initial.resolve({ ok: true, value: snapshot(1, 1, false) });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(snapshotCalls, 1);
  assert.equal(subscribeCalls, 1);
  assert.equal(mountCalls, 1);
  await integration.stop();
});

test("unsubscribeとhost cleanupは成功するまで所有し、失敗分だけ再stopする", async () => {
  let unsubscribeAttempts = 0;
  let unmountAttempts = 0;
  const registry = createFeatureRegistry();
  assert.equal(
    registry.register({
      id: featureId("retry-cleanup"),
      navigation: { label: "retry-cleanup", order: 0 },
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => {},
      async mount() {
        return {
          async unmount() {
            unmountAttempts += 1;
            if (unmountAttempts === 1) throw new Error("host cleanup");
          },
        };
      },
    }).ok,
    true,
  );
  const integration = createApplicationShellIntegration({
    registry,
    container: document.createElement("div"),
    maintenanceSource: {
      async getSnapshot() {
        return { ok: true, value: snapshot(1, 1, false) };
      },
      subscribe() {
        return () => {
          unsubscribeAttempts += 1;
          if (unsubscribeAttempts === 1) throw new Error("source cleanup");
        };
      },
    },
    onStateChange() {},
    reportError() {},
  });
  await integration.start();
  await assert.rejects(
    integration.stop(),
    (error: unknown) =>
      error instanceof AggregateError && error.errors.length === 2,
  );
  await integration.stop();
  await integration.stop();
  assert.equal(unsubscribeAttempts, 2);
  assert.equal(unmountAttempts, 2);
});

test("host start失敗時に取得済みresourceをrollbackしretryで実際にmountする", async () => {
  const registration: ApplicationFeatureRegistration = {
    id: featureId("retry-start"),
    navigation: { label: "retry-start", order: 0 },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    async mount() {
      mountCalls += 1;
      return { async unmount() {} };
    },
  };
  let registrySubscribeCalls = 0;
  let mountCalls = 0;
  let sourceSubscribeCalls = 0;
  let sourceUnsubscribeCalls = 0;
  const integration = createApplicationShellIntegration({
    registry: {
      register: () => ({ ok: true, value: undefined }),
      snapshot: () => [registration],
      subscribe() {
        registrySubscribeCalls += 1;
        if (registrySubscribeCalls === 1) throw new Error("registry subscribe");
        return () => {};
      },
    },
    container: document.createElement("div"),
    maintenanceSource: {
      async getSnapshot() {
        return { ok: true, value: snapshot(1, sourceSubscribeCalls, false) };
      },
      subscribe() {
        sourceSubscribeCalls += 1;
        return () => {
          sourceUnsubscribeCalls += 1;
        };
      },
    },
    onStateChange() {},
    reportError() {},
  });

  const failed = await integration.start();
  assert.equal(failed.ok, false);
  assert.equal(sourceUnsubscribeCalls, 1);
  assert.equal(mountCalls, 0);

  const retried = await integration.start();
  assert.equal(retried.ok, true);
  assert.equal(registrySubscribeCalls, 2);
  assert.equal(sourceSubscribeCalls, 2);
  assert.equal(mountCalls, 1);
  await integration.stop();
  assert.equal(sourceUnsubscribeCalls, 2);
});

// Compile-time assertion for the public integration boundary.
const acceptsIntegration = (_value: ApplicationShellIntegration): void => {};
void acceptsIntegration;
