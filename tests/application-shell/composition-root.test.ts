import assert from "node:assert/strict";
import test from "node:test";

import { createCompositionRoot } from "../../src/application-shell/composition-root.js";
import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../src/persistence/public.js";

const id = (value: string) => value as FeatureId;
const maintenanceSource: MaintenanceSnapshotSource = {
  async getSnapshot() {
    return {
      ok: true,
      value: {
        generation: 1 as MaintenanceSnapshot["generation"],
        revision: 1 as MaintenanceSnapshot["revision"],
        active: false,
      },
    };
  },
  subscribe: () => () => {},
};

function feature<TPublic extends object>(value: string, publicApi: TPublic) {
  let availabilityCleanup = 0;
  const registration: ApplicationFeatureRegistration<TPublic> = {
    id: id(value),
    navigation: { label: value, order: 0 },
    publicApi,
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {
      availabilityCleanup += 1;
    },
    async mount() {
      return { async unmount() {} };
    },
  };
  return { registration, availabilityCleanup: () => availabilityCleanup };
}

test("concurrent startと二重startは一回だけ合成し同じroot APIを返す", async () => {
  const projects = feature("projects", { list: () => ["one"] });
  let foundationStarts = 0;
  let hostStarts = 0;
  let workerStarts = 0;
  const root = createCompositionRoot({
    async initializeFoundation() {
      foundationStarts += 1;
      return { ok: true, value: { maintenanceSource } };
    },
    features: [
      {
        key: "projects",
        registration: projects.registration,
      },
    ] as const,
    workerRegistrations: [
      {
        id: id("worker"),
        register() {
          workerStarts += 1;
          return { ok: true, value: () => {} };
        },
      },
    ],
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
    createIntegration: () => ({
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      async start() {
        hostStarts += 1;
        return { ok: true, value: undefined };
      },
      async select() {
        return { ok: true, value: undefined };
      },
      async stop() {},
    }),
  });

  const [first, second] = await Promise.all([root.start(), root.start()]);
  const third = await root.start();
  assert.equal(first.ok && second.ok && third.ok, true);
  if (!first.ok || !second.ok || !third.ok) return;
  assert.equal(first.value.api, second.value.api);
  assert.equal(first.value.api, third.value.api);
  assert.deepEqual(first.value.api.projects.list(), ["one"]);
  assert.equal(Object.getPrototypeOf(first.value.api), null);
  assert.deepEqual(
    { foundationStarts, hostStarts, workerStarts },
    { foundationStarts: 1, hostStarts: 1, workerStarts: 1 },
  );
  await root.stop();
});

test("worker途中失敗はprior handle、feature購読、foundationを逆順cleanupしhostを開始しない", async () => {
  const events: string[] = [];
  const projects = feature("projects", {});
  const worker = (value: string): ApplicationWorkerRegistration => ({
    id: id(value),
    register() {
      events.push(`register:${value}`);
      return { ok: true, value: () => events.push(`cleanup:${value}`) };
    },
  });
  let hostStarts = 0;
  const root = createCompositionRoot({
    async initializeFoundation() {
      events.push("foundation:start");
      return {
        ok: true,
        value: {
          maintenanceSource,
          dispose: () => {
            events.push("foundation:cleanup");
          },
        },
      };
    },
    features: [
      { key: "projects", registration: projects.registration },
    ] as const,
    workerRegistrations: [
      worker("first"),
      worker("second"),
      {
        id: id("failed"),
        register: () => ({
          ok: false,
          error: { kind: "invalid_registration", detail: "failure" },
        }),
      },
    ],
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
    createIntegration: () => {
      hostStarts += 1;
      throw new Error("must not compose");
    },
  });

  const result = await root.start();
  assert.equal(result.ok, false);
  assert.deepEqual(events, [
    "foundation:start",
    "register:first",
    "register:second",
    "cleanup:second",
    "cleanup:first",
    "foundation:cleanup",
  ]);
  assert.equal(projects.availabilityCleanup(), 1);
  assert.equal(hostStarts, 0);
});

test("公開API合成失敗はhost mount前にrollbackする", async () => {
  const first = feature("first", {});
  const second = feature("second", {});
  let hostCompositions = 0;
  const root = createCompositionRoot({
    async initializeFoundation() {
      return { ok: true, value: { maintenanceSource } };
    },
    features: [
      { key: "same", registration: first.registration },
      { key: "same", registration: second.registration },
    ] as const,
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
    createIntegration: () => {
      hostCompositions += 1;
      throw new Error("unexpected");
    },
  });
  const result = await root.start();
  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: "missing_dependency",
      message: "必須の依存関係がありません",
    },
  });
  assert.equal(hostCompositions, 0);
  assert.equal(first.availabilityCleanup(), 1);
  assert.equal(second.availabilityCleanup(), 1);
});

test("foundation失敗は安全な共通error stateを通知しobserver例外を隔離する", async () => {
  const states: unknown[] = [];
  const diagnostics: string[] = [];
  let throwObserver = false;
  const root = createCompositionRoot({
    async initializeFoundation() {
      throw new Error("storage secret");
    },
    features: [] as const,
    container: document.createElement("div"),
    onStateChange(state) {
      states.push(state);
      if (throwObserver) throw new Error("observer");
    },
    reportError(message) {
      diagnostics.push(message);
    },
  });
  assert.equal((await root.start()).ok, false);
  assert.deepEqual(states.at(-1), {
    kind: "error",
    message: "アプリケーションを開始できませんでした",
    recoverable: false,
  });
  throwObserver = true;
  assert.equal((await root.start()).ok, false);
  assert.ok(
    diagnostics.some((message) => message.includes("state observer failed")),
  );
});

test("不正foundationとdisposeなしregistryをfeature side effect前に拒否する", async () => {
  let subscriptions = 0;
  const registration = feature("guarded", {});
  registration.registration.subscribeAvailability = () => {
    subscriptions += 1;
    return () => {};
  };
  const invalidFoundation = createCompositionRoot({
    async initializeFoundation() {
      return { ok: true, value: {} as never };
    },
    features: [
      { key: "guarded", registration: registration.registration },
    ] as const,
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
  });
  assert.equal((await invalidFoundation.start()).ok, false);
  assert.equal(subscriptions, 0);

  const invalidRegistry = createCompositionRoot({
    async initializeFoundation() {
      return { ok: true, value: { maintenanceSource } };
    },
    features: [
      { key: "guarded", registration: registration.registration },
    ] as const,
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
    createRegistry: (() => ({
      register() {
        throw new Error("unexpected");
      },
    })) as never,
  });
  assert.equal((await invalidRegistry.start()).ok, false);
  assert.equal(subscriptions, 0);
});

test("deferred start中のstop後startは停止完了後に新epochで再起動する", async () => {
  let resolveFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  let foundationStarts = 0;
  let hostStarts = 0;
  const root = createCompositionRoot({
    async initializeFoundation() {
      foundationStarts += 1;
      if (foundationStarts === 1) await first;
      return { ok: true, value: { maintenanceSource } };
    },
    features: [] as const,
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
    createIntegration: () => ({
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      async start() {
        hostStarts += 1;
        return { ok: true, value: undefined };
      },
      async select() {
        return { ok: true, value: undefined };
      },
      async stop() {},
    }),
  });
  const starting = root.start();
  const stopping = root.stop();
  const restarting = root.start();
  resolveFirst();
  assert.equal((await starting).ok, false);
  await stopping;
  assert.equal((await restarting).ok, true);
  assert.equal(foundationStarts, 2);
  assert.equal(hostStarts, 1);
  await root.stop();
});

test("cleanup失敗resourceは所有権を保持して次のstopで再試行する", async () => {
  let cleanupAttempts = 0;
  const root = createCompositionRoot({
    async initializeFoundation() {
      return { ok: true, value: { maintenanceSource } };
    },
    features: [] as const,
    workerRegistrations: [
      {
        id: id("retry-worker"),
        register: () => ({
          ok: true,
          value: () => {
            cleanupAttempts += 1;
            if (cleanupAttempts === 1) throw new Error("retry cleanup");
          },
        }),
      },
    ],
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
    createIntegration: () => ({
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      async start() {
        return { ok: true, value: undefined };
      },
      async select() {
        return { ok: true, value: undefined };
      },
      async stop() {},
    }),
  });
  assert.equal((await root.start()).ok, true);
  await assert.rejects(root.stop(), AggregateError);
  await root.stop();
  await root.stop();
  assert.equal(cleanupAttempts, 2);
});

test("registry factoryのthrowとnullを型付きfailureへ変換しfoundationをrollbackする", async () => {
  for (const createRegistry of [
    () => {
      throw new Error("registry secret");
    },
    () => null,
  ]) {
    let foundationCleanup = 0;
    const states: unknown[] = [];
    const root = createCompositionRoot({
      async initializeFoundation() {
        return {
          ok: true,
          value: {
            maintenanceSource,
            dispose: () => {
              foundationCleanup += 1;
            },
          },
        };
      },
      features: [] as const,
      container: document.createElement("div"),
      onStateChange(state) {
        states.push(state);
      },
      reportError() {},
      createRegistry: createRegistry as never,
    });
    const result = await root.start();
    assert.deepEqual(result, {
      ok: false,
      error: {
        kind: "missing_dependency",
        message: "必須の依存関係がありません",
      },
    });
    assert.equal(foundationCleanup, 1);
    assert.deepEqual(states.at(-1), {
      kind: "error",
      message: "必須の依存関係がありません",
      recoverable: false,
    });
  }
});

test("非関数foundation disposerを副作用前にmissing dependencyとして拒否する", async () => {
  let featureSubscriptions = 0;
  let workerRegistrations = 0;
  const guarded = feature("invalid-disposer", {});
  guarded.registration.subscribeAvailability = () => {
    featureSubscriptions += 1;
    return () => {};
  };
  const root = createCompositionRoot({
    async initializeFoundation() {
      return {
        ok: true,
        value: { maintenanceSource, dispose: "invalid" } as never,
      };
    },
    features: [{ key: "guarded", registration: guarded.registration }] as const,
    workerRegistrations: [
      {
        id: id("guarded-worker"),
        register() {
          workerRegistrations += 1;
          return { ok: true, value: () => {} };
        },
      },
    ],
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    container: document.createElement("div"),
    onStateChange() {},
    reportError() {},
  });
  assert.deepEqual(await root.start(), {
    ok: false,
    error: {
      kind: "missing_dependency",
      message: "必須の依存関係がありません",
    },
  });
  assert.equal(featureSubscriptions, 0);
  assert.equal(workerRegistrations, 0);
  await root.stop();
});
