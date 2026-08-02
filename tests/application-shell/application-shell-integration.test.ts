import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import { createProductionApplicationComposition } from "../../src/application-shell/application-composition.js";
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
import {
  createShellPresentation,
  type ShellPresentationAdapter,
} from "../../src/application-shell/shell-presentation.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../src/persistence/public.js";
import {
  defaultMessageResolver,
  type MessageKey,
} from "../../src/ui-messages/public.js";

const featureId = (value: string) => value as FeatureId;
const labelKey = (value: string) => value as MessageKey;

const stubDataPort: FoundationScopedDataPort = {
  async query() {
    return { ok: true, value: {} } as never;
  },
  async mutate() {
    return { ok: true, value: {} } as never;
  },
};

const stubFullDataPort: FoundationDataPort = {
  async query() {
    return { ok: true, value: {} } as never;
  },
  async mutate() {
    return { ok: true, value: {} } as never;
  },
  async assessReplacement() {
    return { ok: true, value: {} } as never;
  },
  async replaceRoot() {
    return { ok: true, value: {} } as never;
  },
  async runMaintenance() {
    return { ok: true, value: {} } as never;
  },
};
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
      presentation: "persistent",
      navigation: { labelKey: labelKey(id), order },
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
    message: { key: "shell.maintenanceActive" },
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

test("mount中のfeatureはpolicy購読でmaintenance遷移を再mountなしに観測する", async () => {
  const { contexts, fixture, integration } = setup(snapshot(1, 1, false));
  assert.equal((await integration.start()).ok, true);
  const policy = contexts.get("projects")?.operationPolicy;
  assert.ok(policy);

  const observed: boolean[] = [];
  const unsubscribe = policy.subscribe(() =>
    observed.push(policy.isAllowed("mutation")),
  );

  fixture.emit(snapshot(2, 1, true));
  // Same generation, later revision, still active: the allowed set is unchanged.
  fixture.emit(snapshot(2, 2, true));
  fixture.emit(snapshot(2, 3, false));

  assert.deepEqual(observed, [false, true]);

  unsubscribe();
  fixture.emit(snapshot(3, 1, true));
  assert.deepEqual(observed, [false, true]);
  assert.equal(policy.isAllowed("mutation"), false);
});

test("空ストレージ起動でも初期snapshotを診断エラーなしで取り込む", async () => {
  const { diagnostics, fixture, integration, states } = setup(
    snapshot(0, 0, false),
  );
  assert.equal((await integration.start()).ok, true);

  assert.equal(diagnostics.length, 0);
  assert.deepEqual(states.at(-1), {
    kind: "ready",
    selected: featureId("projects"),
  });

  // 初期受理後もcursor後退の抑止は従来どおり働く。
  fixture.emit(snapshot(0, 0, true));
  assert.ok(diagnostics.some((message) => message.includes("stale")));
});

test("初期snapshot失敗はfeatureをmountせずstartup failureへ変換する", async () => {
  const { contexts, integration, states } = setup(new Error("storage detail"));
  const result = await integration.start();
  assert.equal(result.ok, false);
  assert.equal(contexts.size, 0);
  assert.deepEqual(states.at(-1), {
    kind: "error",
    message: { key: "shell.maintenanceStartupFailed" },
    recoverable: true,
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
      presentation: "persistent",
      navigation: { labelKey: labelKey("deferred"), order: 0 },
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
      presentation: "persistent",
      navigation: { labelKey: labelKey("single"), order: 0 },
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
      presentation: "persistent",
      navigation: { labelKey: labelKey("retry-cleanup"), order: 0 },
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

test("stopはfeature hostを先に停止してからmaintenance購読を解除し両失敗を再試行する", async () => {
  const events: string[] = [];
  let unmountAttempts = 0;
  let unsubscribeAttempts = 0;
  const registry = createFeatureRegistry();
  assert.equal(
    registry.register({
      id: featureId("ordered-cleanup"),
      presentation: "persistent",
      navigation: { labelKey: labelKey("ordered"), order: 0 },
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => {},
      async mount() {
        return {
          async unmount() {
            events.push("feature");
            unmountAttempts += 1;
            if (unmountAttempts === 1) throw new Error("feature");
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
          events.push("maintenance");
          unsubscribeAttempts += 1;
          if (unsubscribeAttempts === 1) throw new Error("maintenance");
        };
      },
    },
    onStateChange() {},
    reportError() {},
  });
  await integration.start();
  await assert.rejects(integration.stop(), AggregateError);
  assert.deepEqual(events, ["feature", "maintenance"]);
  events.length = 0;
  await integration.stop();
  assert.deepEqual(events, ["feature", "maintenance"]);
});

test("host start失敗時に取得済みresourceをrollbackしretryで実際にmountする", async () => {
  const registration: ApplicationFeatureRegistration = {
    id: featureId("retry-start"),
    presentation: "persistent",
    navigation: { labelKey: labelKey("retry-start"), order: 0 },
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

test("production-shaped runtimeでUI、worker、maintenance、failure、cleanupを横断する", async () => {
  const shellContainer = document.createElement("div");
  document.body.append(shellContainer);
  const events: string[] = [];
  const diagnostics: string[] = [];
  const maintenance = source(snapshot(7, 1, false));
  const availabilityListeners = new Map<
    string,
    Set<
      (
        value:
          | { status: "available" }
          | { status: "unavailable"; reason: string },
      ) => void
    >
  >();
  const availability = new Map<
    string,
    { status: "available" } | { status: "unavailable"; reason: string }
  >([
    ["projects", { status: "available" }],
    ["broken", { status: "available" }],
    ["compatibility", { status: "available" }],
  ]);
  const policies = new Map<string, FeatureMountContext["operationPolicy"]>();
  let activationValidationCount = 0;
  let activationApplyCount = 0;

  const feature = (
    id: string,
    label: string,
    options?: { readonly mountFails?: boolean; readonly activation?: boolean },
  ): ApplicationFeatureRegistration<{ readonly name: string }> => ({
    id: featureId(id),
    presentation: "persistent",
    navigation: {
      labelKey: labelKey(label),
      order: id === "projects" ? 0 : id === "broken" ? 1 : 2,
    },
    publicApi: { name: id },
    getAvailability: () =>
      availability.get(id) ?? { status: "unavailable", reason: "missing" },
    subscribeAvailability(listener) {
      const listeners = availabilityListeners.get(id) ?? new Set();
      listeners.add(listener);
      availabilityListeners.set(id, listeners);
      return () => {
        listeners.delete(listener);
      };
    },
    async mount(context) {
      events.push(`${id}:mount`);
      if (options?.mountFails)
        throw new Error("<script>mount-secret()</script>");
      policies.set(id, context.operationPolicy);
      context.container.textContent = `${id}-view`;
      return {
        ...(id === "projects"
          ? {
              async captureState() {
                return { ok: true as const, value: { draft: "project-state" } };
              },
            }
          : {}),
        async unmount() {
          context.container.textContent = "";
          assert.equal(context.container.textContent, "");
          events.push(`${id}:unmount`);
        },
      };
    },
    ...(options?.activation
      ? {
          activation: {
            validate(intent) {
              activationValidationCount += 1;
              if (intent.target !== "open-editor")
                return {
                  ok: false as const,
                  error: {
                    kind: "invalid_activation" as const,
                    detail: "target",
                  },
                };
              return { ok: true as const, value: undefined as never };
            },
            async activate() {
              activationApplyCount += 1;
              return { ok: true as const, value: undefined };
            },
          },
        }
      : {}),
  });
  const setAvailability = (
    id: string,
    value: { status: "available" } | { status: "unavailable"; reason: string },
  ) => {
    availability.set(id, value);
    for (const listener of availabilityListeners.get(id) ?? []) listener(value);
  };
  let foundationStops = 0;
  let workerStops = 0;
  const reactPresentation = createShellPresentation();
  const observedPresentation: ShellPresentationAdapter = {
    mount(input) {
      const mounted = reactPresentation.mount(input);
      if (!mounted.ok) return mounted;
      return {
        ok: true,
        value: {
          featureContainer: mounted.value.featureContainer,
          publish: (state, navigation) =>
            mounted.value.publish(state, navigation),
          stop() {
            mounted.value.stop();
            events.push("presentation:stop");
          },
        },
      };
    },
  };
  const root = createProductionApplicationComposition({
    shellContainer,
    initializeFoundation: async () => ({
      ok: true,
      value: {
        maintenanceSource: {
          getSnapshot: () => maintenance.maintenanceSource.getSnapshot(),
          subscribe(listener) {
            const unsubscribe =
              maintenance.maintenanceSource.subscribe(listener);
            return () => {
              unsubscribe();
              events.push("maintenance:stop");
            };
          },
        },
        workerRegistrations: [],
        dataPort: stubDataPort,
        fullDataPort: stubFullDataPort,
        dispose() {
          foundationStops += 1;
          events.push("foundation:stop");
        },
      },
    }),
    createContributions: () => ({
      features: [
        {
          key: "projects",
          registration: feature("projects", "Projects <img src=x>"),
        },
        {
          key: "broken",
          registration: feature("broken", "Broken", { mountFails: true }),
        },
        {
          key: "compatibility",
          registration: feature("compatibility", "Compatibility", {
            activation: true,
          }),
        },
      ] as const,
      workerRegistrations: [
        {
          id: featureId("runtime-worker"),
          register() {
            events.push("worker:start");
            return {
              ok: true as const,
              value: () => {
                workerStops += 1;
                events.push("worker:stop");
              },
            };
          },
        },
      ],
    }),
    presentation: observedPresentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError: (message) => diagnostics.push(message),
  });

  const started = await act(() => root.start());
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(Object.getPrototypeOf(started.value.api), null);
  assert.deepEqual(Object.keys(started.value.api), [
    "projects",
    "broken",
    "compatibility",
  ]);
  const featureSlot = shellContainer.querySelector<HTMLElement>(
    "[data-shell-feature-slot]",
  );
  assert.ok(featureSlot);
  assert.notEqual(featureSlot, shellContainer);
  assert.equal(featureSlot.textContent, "projects-view");
  assert.equal(shellContainer.querySelector("img"), null);
  assert.match(shellContainer.textContent ?? "", /Projects <img src=x>/);
  assert.ok(events.indexOf("projects:mount") < events.indexOf("worker:start"));

  const clickNavigation = async (label: string) => {
    const button = [...shellContainer.querySelectorAll("nav button")].find(
      (candidate) => candidate.textContent === label,
    );
    assert.ok(button);
    await act(() => (button as HTMLButtonElement).click());
  };
  await clickNavigation("Compatibility");
  assert.deepEqual(events.slice(0, 4), [
    "projects:mount",
    "worker:start",
    "projects:unmount",
    "compatibility:mount",
  ]);
  assert.equal(featureSlot.textContent, "compatibility-view");

  await clickNavigation("Broken");
  assert.equal(featureSlot.textContent, "compatibility-view");
  assert.deepEqual(events.slice(4, 7), [
    "compatibility:unmount",
    "broken:mount",
    "compatibility:mount",
  ]);
  assert.ok(
    diagnostics.some((message) =>
      message.includes("feature-mount-failed featureId=broken"),
    ),
  );
  assert.equal(shellContainer.querySelector("script"), null);
  await clickNavigation("Projects <img src=x>");
  assert.equal(featureSlot.textContent, "projects-view");

  const activated = await act(() =>
    root.activate?.({
      featureId: featureId("compatibility"),
      target: "open-editor",
      payload: { candidateId: "fictional-candidate" },
    }),
  );
  assert.equal(activated?.ok, true);
  assert.equal(activationValidationCount, 1);
  assert.equal(activationApplyCount, 1);
  assert.equal(featureSlot.textContent, "compatibility-view");
  await clickNavigation("Projects <img src=x>");
  assert.equal(featureSlot.textContent, "projects-view");

  await act(async () => {
    setAvailability("compatibility", {
      status: "unavailable",
      reason: "<svg onload=secret()>互換性を確認中",
    });
    setAvailability("broken", {
      status: "unavailable",
      reason: "fixture failure",
    });
    setAvailability("projects", {
      status: "unavailable",
      reason: "<script>availability-secret()</script>",
    });
  });
  assert.equal(featureSlot.textContent, "");
  assert.match(
    shellContainer.textContent ?? "",
    /<script>availability-secret\(\)<\/script>/,
  );
  assert.equal(shellContainer.querySelector("script"), null);
  await act(async () =>
    setAvailability("compatibility", { status: "available" }),
  );
  assert.equal(featureSlot.textContent, "compatibility-view");

  const policy = policies.get("compatibility");
  assert.ok(policy);
  await act(() => maintenance.emit(snapshot(8, 1, true)));
  assert.equal(policy.isAllowed("read"), true);
  assert.equal(policy.isAllowed("mutation"), false);
  assert.match(
    shellContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.maintenanceActive")),
  );
  await act(() => maintenance.emit(snapshot(7, 99, false)));
  assert.equal(policy.isAllowed("mutation"), false);
  await act(() => maintenance.emit(snapshot(8, 2, false)));
  assert.equal(policy.isAllowed("mutation"), true);
  assert.ok(diagnostics.some((message) => message.includes("stale")));

  events.length = 0;
  await act(() => root.stop());
  assert.deepEqual(events, [
    "worker:stop",
    "compatibility:unmount",
    "maintenance:stop",
    "presentation:stop",
    "foundation:stop",
  ]);
  assert.equal(
    events.filter((event) => event === "compatibility:unmount").length,
    1,
  );
  const stoppedEvents = [...events];
  await act(() => root.stop());
  assert.deepEqual(events, stoppedEvents);
  assert.equal(workerStops, 1);
  assert.equal(maintenance.unsubscribeCalls(), 1);
  assert.equal(foundationStops, 1);
  assert.equal(availabilityListeners.get("projects")?.size, 0);
  assert.equal(availabilityListeners.get("broken")?.size, 0);
  assert.equal(availabilityListeners.get("compatibility")?.size, 0);
  assert.equal(shellContainer.textContent, "");
  shellContainer.remove();
});

test("同じproduction presentation fixtureは空catalogを安全なempty stateで起動・解放する", async () => {
  const shellContainer = document.createElement("div");
  document.body.append(shellContainer);
  const maintenance = source(snapshot(1, 1, false));
  let foundationStops = 0;
  const root = createProductionApplicationComposition({
    shellContainer,
    initializeFoundation: async () => ({
      ok: true,
      value: {
        maintenanceSource: maintenance.maintenanceSource,
        workerRegistrations: [],
        dataPort: stubDataPort,
        fullDataPort: stubFullDataPort,
        dispose() {
          foundationStops += 1;
        },
      },
    }),
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: createShellPresentation(),
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await act(() => root.start())).ok, true);
  assert.equal(shellContainer.querySelectorAll("nav button").length, 0);
  assert.match(
    shellContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.emptyHeading")),
  );
  const featureSlot = shellContainer.querySelector("[data-shell-feature-slot]");
  assert.ok(featureSlot);
  assert.notEqual(featureSlot, shellContainer);
  await act(() => root.stop());
  assert.equal(maintenance.unsubscribeCalls(), 1);
  assert.equal(foundationStops, 1);
  assert.equal(shellContainer.textContent, "");
  shellContainer.remove();
});
