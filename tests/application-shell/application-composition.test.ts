import assert from "node:assert/strict";
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
import type { MaintenanceSnapshotSource } from "../../src/persistence/public.js";

const id = (value: string) => value as FeatureId;

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
          publish(state) {
            states.push(state);
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
    navigation: { label: "Planner", order: 1 },
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
        dispose: () => {
          events.push("foundation:stop");
        },
      } satisfies ProductionFoundationHandle,
    };
  };
  return {
    events,
    states,
    shellContainer,
    presentation,
    feature,
    worker,
    initializeFoundation,
    foundationStarts: () => foundationStarts,
  };
}

test("foundation→registry→presentation→feature host→workerの順で一度だけ開始し逆順停止する", async () => {
  const h = harness();
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    contributions: {
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    },
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
    contributions: { features: [] as const, workerRegistrations: [] },
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
    contributions: {
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    },
    presentation: h.presentation,
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
  });
  assert.equal((await root.start()).ok, false);
  assert.ok(
    h.states.some(
      (state) => state.kind === "error" && state.recoverable === false,
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

test("foundation失敗時のpresentation例外をrejectせずtyped failureへ変換する", async () => {
  const h = harness({ foundationFails: true });
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    contributions: { features: [] as const, workerRegistrations: [] },
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
      message: "アプリケーションを開始できませんでした",
    },
  });
});

test("foundation失敗後の逐次retryでもpresentation ownershipを一つに保つ", async () => {
  const h = harness({ foundationFails: true });
  const root = createProductionApplicationComposition({
    shellContainer: h.shellContainer,
    initializeFoundation: h.initializeFoundation,
    contributions: { features: [] as const, workerRegistrations: [] },
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
    contributions: {
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    },
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
    contributions: { features: [] as const, workerRegistrations: [] },
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
    contributions: {
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [h.worker],
    },
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
    contributions: { features: [] as const, workerRegistrations: [] },
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
          dispose() {
            disposeAttempts += 1;
            if (disposeAttempts === 1) throw new Error("fixture cleanup");
          },
        },
      };
    },
    contributions: { features: [] as const, workerRegistrations: [] },
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
    contributions: {
      features: [{ key: "planner", registration: h.feature }] as const,
      workerRegistrations: [],
    },
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
    contributions: { features: [] as const, workerRegistrations: [] },
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
