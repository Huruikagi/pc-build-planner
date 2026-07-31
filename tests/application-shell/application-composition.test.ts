import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createProductionApplicationComposition,
  type ProductionFoundationHandle,
} from "../../src/application-shell/application-composition.js";
import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  FeatureId,
  ShellViewState,
} from "../../src/application-shell/contracts.js";
import type { ShellPresentationAdapter } from "../../src/application-shell/shell-presentation.js";
import type { ShellNavigationItem } from "../../src/application-shell/shell-view.js";
import type {
  ActivationId,
  TransientSurfaceLifecyclePort,
} from "../../src/application-shell/transient-surface-ports.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
  MaintenanceSnapshotSource,
} from "../../src/persistence/public.js";

const noopTransientActivation = () => ({
  validate: (
    request: import("../../src/application-shell/transient-surface-ports.js").TransientActivationRequest,
  ) => ({ ok: true as const, value: request }),
  accept: async () => ({
    ok: true as const,
    value: { release: async () => undefined },
  }),
});

import type { MessageKey } from "../../src/ui-messages/public.js";

const id = (value: string) => value as FeatureId;

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

const source: MaintenanceSnapshotSource = {
  async getSnapshot() {
    return {
      ok: true,
      value: { generation: 0, revision: 0, active: false },
    } as never;
  },
  subscribe: () => () => {},
};

function harness(options?: {
  foundationFails?: boolean;
  workerFails?: boolean;
}) {
  const events: string[] = [];
  const states: ShellViewState[] = [];
  const navigationSnapshots: (readonly ShellNavigationItem[])[] = [];
  const shellContainer = document.createElement("div");
  const featureContainer = document.createElement("div");
  shellContainer.append(featureContainer);
  const presentation: ShellPresentationAdapter = {
    mount() {
      events.push("presentation:mount");
      return {
        ok: true,
        value: {
          featureContainer,
          publish(state, navigation) {
            states.push(state);
            navigationSnapshots.push(navigation);
          },
          stop() {
            events.push("presentation:stop");
          },
        },
      };
    },
  };
  const feature: ApplicationFeatureRegistration<{
    readonly ping: () => string;
  }> = {
    id: id("planner"),
    presentation: "persistent",
    navigation: { labelKey: "Planner" as MessageKey, order: 1 },
    publicApi: { ping: () => "pong" },
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => events.push("feature:unsubscribe"),
    async mount(context) {
      assert.equal(context.container, featureContainer);
      events.push("feature:mount");
      return {
        async unmount() {
          events.push("feature:unmount");
        },
      };
    },
  };
  const worker: ApplicationWorkerRegistration = {
    id: id("worker"),
    register() {
      events.push("worker:start");
      if (options?.workerFails) {
        return {
          ok: false,
          error: { kind: "invalid_registration", detail: "fixture" },
        };
      }
      return {
        ok: true,
        value: () => {
          events.push("worker:stop");
        },
      };
    },
  };
  let foundationStarts = 0;
  const initializeFoundation = async () => {
    foundationStarts += 1;
    events.push("foundation:start");
    if (options?.foundationFails) {
      return { ok: false as const, error: { code: "fixture" } };
    }
    return {
      ok: true as const,
      value: {
        maintenanceSource: source,
        workerRegistrations: [] as const,
        dataPort: stubDataPort,
        fullDataPort: stubFullDataPort,
        dispose: () => {
          events.push("foundation:stop");
        },
      } satisfies ProductionFoundationHandle,
    };
  };
  return {
    events,
    states,
    navigationSnapshots,
    shellContainer,
    presentation,
    feature,
    worker,
    initializeFoundation,
    foundationStarts: () => foundationStarts,
  };
}

test("常設と一過性の混在時もpresentation navigationと初期表示を常設限定にする", async () => {
  const h = harness();
  const transient: ApplicationFeatureRegistration = {
    id: id("transient"),
    presentation: "transient",
    transientActivation: noopTransientActivation(),
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    async mount() {
      h.events.push("transient:mount");
      return { async unmount() {} };
    },
  };
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [
        { key: "transient", registration: transient },
        { key: "planner", registration: h.feature },
      ] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: {
      addActionHandler: () => () => undefined,
      reportError() {},
    },
    reportError() {},
  });

  assert.equal((await root.start()).ok, true);
  assert.deepEqual(
    h.navigationSnapshots.at(-1)?.map(({ id }) => id),
    [id("planner")],
  );
  assert.equal(h.states.at(-1)?.kind, "ready");
  assert.equal(h.events.includes("transient:mount"), false);
  await root.stop();
});

test("production contributionへ同じlate-bound lifecycle参照を一度だけ注入する", async () => {
  const h = harness();
  const seen: TransientSurfaceLifecyclePort[] = [];
  let beforeBind:
    | ReturnType<TransientSurfaceLifecyclePort["conclude"]>
    | undefined;
  const activationId = "fixture" as ActivationId;
  const handoff = {
    featureId: id("planner"),
    target: "noop",
    payload: {},
  };
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: (_context, dependencies) => {
      seen.push(dependencies.transientSurface);
      beforeBind = dependencies.transientSurface.conclude(
        activationId,
        handoff,
      );
      return {
        features: [{ key: "planner", registration: h.feature }] as const,
        workerRegistrations: [],
      };
    },
    presentation: h.presentation,
    workerContext: {
      addActionHandler: () => () => undefined,
      reportError() {},
    },
    reportError() {},
  });
  assert.equal((await root.start()).ok, true);
  assert.equal(seen.length, 1);
  assert.ok(beforeBind);
  const stablePort = seen[0];
  assert.ok(stablePort);
  assert.deepEqual(await beforeBind, {
    ok: false,
    error: { kind: "not-started" },
  });
  assert.equal((await stablePort.conclude(activationId, handoff)).ok, true);
  await root.stop();
  assert.deepEqual(await stablePort.conclude(activationId, handoff), {
    ok: false,
    error: { kind: "not-started" },
  });
});

test("production nav commandは終了失敗をUI retryし選択targetと遅延eventを一貫管理する", async () => {
  const h = harness();
  let presentationInput:
    | Parameters<ShellPresentationAdapter["mount"]>[0]
    | undefined;
  let controller:
    | Parameters<
        NonNullable<
          Parameters<
            typeof createProductionApplicationComposition
          >[0]["createTransientMonitoring"]
        >
      >[0]
    | undefined;
  let failUnmount = true;
  const transient: ApplicationFeatureRegistration = {
    id: id("capture"),
    presentation: "transient",
    transientActivation: noopTransientActivation(),
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    async mount() {
      return {
        async unmount() {
          if (failUnmount) {
            failUnmount = false;
            throw new Error("fixture dismiss failure");
          }
        },
      };
    },
  };
  const target: ApplicationFeatureRegistration = {
    ...h.feature,
    id: id("compatibility"),
    navigation: { labelKey: "Compatibility" as MessageKey, order: 2 },
  };
  const presentation: ShellPresentationAdapter = {
    mount(input) {
      presentationInput = input;
      return h.presentation.mount(input);
    },
  };
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [
        { key: "planner", registration: h.feature },
        { key: "capture", registration: transient },
        { key: "compatibility", registration: target },
      ] as const,
      workerRegistrations: [],
    }),
    presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
    createTransientMonitoring(value) {
      controller = value;
      return {
        async start() {
          return { ok: true as const, value: undefined };
        },
        stop() {},
      };
    },
  });

  assert.equal((await root.start()).ok, true);
  const activation = "nav-selection" as ActivationId;
  assert.equal(
    (
      await controller?.request({
        activationId: activation,
        surfaceId: transient.id,
        tabId: 1 as never,
      })
    )?.ok,
    true,
  );
  presentationInput?.onNavigate(target.id);
  await new Promise((resolve) => setImmediate(resolve));
  const failedState = h.states.at(-1);
  assert.equal(failedState?.kind, "error");
  if (failedState?.kind === "error")
    assert.equal(failedState.recoverable, true);
  presentationInput?.onRetry();
  await new Promise((resolve) => setImmediate(resolve));
  const selectedAfterRetry = h.states.at(-1);
  assert.equal(selectedAfterRetry?.kind, "ready");
  if (selectedAfterRetry?.kind === "ready")
    assert.equal(selectedAfterRetry.selected, target.id);

  await controller?.dismiss(activation, "navigated");
  const selectedAfterLateEvent = h.states.at(-1);
  if (selectedAfterLateEvent?.kind === "ready")
    assert.equal(selectedAfterLateEvent.selected, target.id);
  await root.stop();
});

test("compositionはproxy bind→host start→controller startと逆順cleanupを固定する", async () => {
  const source = await readFile(
    "src/application-shell/application-composition.ts",
    "utf8",
  );
  const bind = source.indexOf("lateBoundLifecycle.bind(controller)");
  const hostStart = source.indexOf("await integration.start()", bind);
  const controllerStart = source.indexOf("await controller.start()", hostStart);
  assert.ok(bind >= 0 && bind < hostStart && hostStart < controllerStart);

  const cleanup = source.indexOf("const cleanup = async");
  const controllerStop = source.indexOf("await owned.stop()", cleanup);
  const unbind = source.indexOf("lateBoundLifecycle.unbind()", controllerStop);
  assert.ok(cleanup >= 0 && controllerStop < unbind);
});

test("session read noticeは常設表示と併存し成功通知まで保持する", async () => {
  const h = harness();
  let notices:
    | {
        sessionReadFailed(): void;
        sessionReadSucceeded(): void;
        activationAccepted(): void;
        activationExpired(): void;
      }
    | undefined;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
    createTransientMonitoring: (_controller, value) => {
      notices = value;
      return {
        async start() {
          value.sessionReadFailed();
          return { ok: true as const, value: undefined };
        },
        stop() {},
      };
    },
  });
  assert.equal((await root.start()).ok, true);
  const failed = h.states.at(-1);
  assert.equal(failed?.kind, "ready");
  if (failed?.kind === "ready") {
    assert.equal(failed.selected, id("planner"));
    assert.deepEqual(failed.transientNotice?.message, {
      key: "shell.transientActivationFailed",
    });
  }
  notices?.sessionReadFailed();
  assert.ok(h.states.at(-1)?.kind === "ready");
  notices?.sessionReadSucceeded();
  const recovered = h.states.at(-1);
  assert.equal(recovered?.kind, "ready");
  if (recovered?.kind === "ready")
    assert.equal("transientNotice" in recovered, false);

  notices?.activationExpired();
  const expired = h.states.at(-1);
  assert.equal(expired?.kind, "ready");
  if (expired?.kind === "ready")
    assert.deepEqual(expired.transientNotice?.message, {
      key: "shell.transientActivationExpired",
    });

  notices?.sessionReadSucceeded();
  const expiredAfterRead = h.states.at(-1);
  assert.equal(expiredAfterRead?.kind, "ready");
  if (expiredAfterRead?.kind === "ready")
    assert.deepEqual(expiredAfterRead.transientNotice?.message, {
      key: "shell.transientActivationExpired",
    });

  notices?.activationAccepted();
  const accepted = h.states.at(-1);
  assert.equal(accepted?.kind, "ready");
  if (accepted?.kind === "ready")
    assert.equal("transientNotice" in accepted, false);
  await root.stop();
});

test("startup rollback後も注入済みlifecycleをnot-startedへ戻す", async () => {
  const h = harness({ workerFails: true });
  let lifecycle: TransientSurfaceLifecyclePort | undefined;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: (_context, dependencies) => {
      lifecycle = dependencies.transientSurface;
      return {
        features: [{ key: "planner", registration: h.feature }] as const,
        workerRegistrations: [h.worker],
      };
    },
    presentation: h.presentation,
    workerContext: {
      addActionHandler: () => () => undefined,
      reportError() {},
    },
    reportError() {},
  });
  assert.equal((await root.start()).ok, false);
  assert.ok(lifecycle);
  assert.deepEqual(
    await lifecycle.conclude("rollback" as ActivationId, {
      featureId: id("planner"),
      target: "noop",
      payload: {},
    }),
    { ok: false, error: { kind: "not-started" } },
  );
});

test("foundation→registry→presentation→feature host→workerの順で一度だけ開始し逆順停止する", async () => {
  const h = harness();
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  const [first, second] = await Promise.all([root.start(), root.start()]);
  assert.equal(first.ok && second.ok, true);
  if (first.ok) assert.equal(first.value.api.planner.ping(), "pong");
  assert.equal(h.foundationStarts(), 1);
  assert.deepEqual(h.events.slice(0, 5), [
    "foundation:start",
    "presentation:mount",
    "feature:mount",
    "worker:start",
  ]);
  await root.stop();
  await root.stop();
  assert.deepEqual(h.events.slice(-5), [
    "worker:stop",
    "feature:unmount",
    "feature:unsubscribe",
    "presentation:stop",
    "foundation:stop",
  ]);
});

test("空catalogを正常起動する", async () => {
  const h = harness();
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await root.start()).ok, true);
  assert.ok(
    h.states.some((state) => state.kind === "ready" && state.selected === null),
  );
  await root.stop();
});

test("foundation失敗時はpresentationだけを開始して共通errorを表示する", async () => {
  const h = harness({ foundationFails: true });
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await root.start()).ok, false);
  assert.ok(
    h.states.some(
      (state) => state.kind === "error" && state.recoverable === true,
    ),
  );
  assert.equal(h.events.includes("feature:mount"), false);
  assert.equal(h.events.includes("worker:start"), false);
  await root.stop();
  assert.deepEqual(h.events, [
    "foundation:start",
    "presentation:mount",
    "presentation:stop",
  ]);
});

test("production startup errorのretry操作は同じpresentationで再起動する", async () => {
  const h = harness();
  let attempts = 0;
  let presentationInput:
    | Parameters<ShellPresentationAdapter["mount"]>[0]
    | undefined;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false as const, error: { code: "fixture" } }
        : h.initializeFoundation();
    },
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [],
    }),
    presentation: {
      mount(input) {
        presentationInput = input;
        return h.presentation.mount(input);
      },
    },
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });

  assert.equal((await root.start()).ok, false);
  const failed = h.states.at(-1);
  assert.equal(failed?.kind, "error");
  if (failed?.kind === "error") assert.equal(failed.recoverable, true);

  presentationInput?.onRetry();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(attempts, 2);
  assert.equal(h.states.at(-1)?.kind, "ready");
  assert.equal(
    h.events.filter((event) => event === "presentation:mount").length,
    1,
  );
  await root.stop();
});

test("foundation失敗時のpresentation例外をrejectせずtyped failureへ変換する", async () => {
  const h = harness({ foundationFails: true });
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: {
      mount() {
        throw new Error("presentation adapter failed");
      },
    },
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });

  const result = await root.start().then(
    (value) => value,
    () => "rejected" as const,
  );

  assert.notEqual(result, "rejected");
  if (result === "rejected") return;
  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: "startup_failed",
      message: { key: "shell.startupFailed" },
    },
  });
});

test("foundation失敗後の逐次retryでもpresentation ownershipを一つに保つ", async () => {
  const h = harness({ foundationFails: true });
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });

  assert.equal((await root.start()).ok, false);
  assert.equal((await root.start()).ok, false);
  await root.stop();
  assert.deepEqual(h.events, [
    "foundation:start",
    "presentation:mount",
    "foundation:start",
    "presentation:stop",
  ]);
});

test("不正feature slotはpresentationを一度だけ解放してretryでも再mountしない", async () => {
  const h = harness();
  let presentationMounts = 0;
  let presentationStops = 0;
  const invalidPresentation: ShellPresentationAdapter = {
    mount() {
      presentationMounts += 1;
      return {
        ok: true,
        value: {
          featureContainer: h.shellContainer,
          publish() {},
          stop() {
            presentationStops += 1;
          },
        },
      };
    },
  };
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    }),
    presentation: invalidPresentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });

  const first = await root.start();
  const second = await root.start();
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (!first.ok) assert.equal(first.error.kind, "startup_failed");
  assert.equal(h.events.includes("feature:mount"), false);
  assert.equal(h.events.includes("worker:start"), false);
  await root.stop();
  await root.stop();
  assert.deepEqual(
    { presentationMounts, presentationStops },
    {
      presentationMounts: 1,
      presentationStops: 1,
    },
  );
});

test("不正feature slotのstop失敗は診断して所有権を保持しcleanupで再試行する", async () => {
  const h = harness();
  const diagnostics: string[] = [];
  let stopAttempts = 0;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: {
      mount: () => ({
        ok: true,
        value: {
          featureContainer: h.shellContainer,
          publish() {},
          stop() {
            stopAttempts += 1;
            if (stopAttempts === 1) throw new Error("fixture");
          },
        },
      }),
    },
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError: (message) => diagnostics.push(message),
  });

  assert.equal((await root.start()).ok, false);
  await root.stop();
  assert.equal(stopAttempts, 2);
  assert.ok(
    diagnostics.some((message) =>
      message.includes("rejected presentation cleanup failed"),
    ),
  );
});

test("worker途中失敗をfeature、購読、presentation、foundationまでrollbackする", async () => {
  const h = harness({ workerFails: true });
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await root.start()).ok, false);
  assert.deepEqual(h.events.slice(-4), [
    "feature:unmount",
    "feature:unsubscribe",
    "presentation:stop",
    "foundation:stop",
  ]);
});

test("開始中のstopはepochを無効化し、cleanup後のstartだけが新しいlifecycleを開始する", async () => {
  const h = harness();
  let releaseFirst!: (
    value: Awaited<ReturnType<typeof h.initializeFoundation>>,
  ) => void;
  const firstFoundation = new Promise<
    Awaited<ReturnType<typeof h.initializeFoundation>>
  >((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: () => {
      calls += 1;
      return calls === 1 ? firstFoundation : h.initializeFoundation();
    },
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });

  const staleStart = root.start();
  const stopping = root.stop();
  const restarted = root.start();
  releaseFirst(await h.initializeFoundation());

  assert.equal((await staleStart).ok, false);
  await stopping;
  assert.equal((await restarted).ok, true);
  assert.equal(calls, 2);
  await root.stop();
});

test("cleanup失敗中は新規startを拒否し、stop再試行成功後だけrestartできる", async () => {
  const h = harness();
  let starts = 0;
  let disposeAttempts = 0;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: async () => {
      starts += 1;
      return {
        ok: true as const,
        value: {
          maintenanceSource: source,
          workerRegistrations: [] as const,
          dataPort: stubDataPort,
          fullDataPort: stubFullDataPort,
          dispose() {
            disposeAttempts += 1;
            if (disposeAttempts === 1) throw new Error("fixture cleanup");
          },
        },
      };
    },
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });

  assert.equal((await root.start()).ok, true);
  await assert.rejects(root.stop(), AggregateError);
  assert.equal((await root.start()).ok, false);
  assert.equal(starts, 1);
  await root.stop();
  assert.equal((await root.start()).ok, true);
  assert.equal(starts, 2);
  await root.stop();
});

test("malformed foundation handleを下流副作用前に拒否し取得済みdisposeを解放する", async () => {
  const h = harness();
  let disposed = 0;
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: async () => ({
      ok: true as const,
      value: {
        maintenanceSource: { getSnapshot: "invalid", subscribe() {} },
        workerRegistrations: {},
        dispose() {
          disposed += 1;
        },
      } as never,
    }),
    createContributions: () => ({
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [],
    }),
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await root.start()).ok, false);
  assert.equal(disposed, 1);
  assert.equal(h.events.includes("presentation:mount"), false);
  assert.equal(h.events.includes("feature:mount"), false);
});

test("presentation getter例外をrejectせずtyped failureへ変換しfoundationをrollbackする", async () => {
  const h = harness();
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    createContributions: () => ({
      features: [] as const,
      workerRegistrations: [],
    }),
    presentation: {
      mount: () => ({
        ok: true,
        value: {
          get featureContainer(): HTMLElement {
            throw new Error("secret");
          },
          publish() {},
          stop() {
            h.events.push("presentation:stop");
          },
        },
      }),
    },
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await root.start()).ok, false);
  assert.deepEqual(h.events.slice(-2), [
    "presentation:stop",
    "foundation:stop",
  ]);
});
