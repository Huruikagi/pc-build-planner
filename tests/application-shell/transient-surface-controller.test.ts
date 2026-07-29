import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  ApplicationFeatureRegistration,
  FeatureActivationIntent,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import { createSidePanelHost } from "../../src/application-shell/side-panel-host.js";
import {
  createTransientSurfaceController,
  type TransientSurfaceHost,
} from "../../src/application-shell/transient-surface-controller.js";
import type {
  ActivationId,
  TargetTabId,
} from "../../src/application-shell/transient-surface-ports.js";
import { transientHandoffFailure } from "../../src/application-shell/transient-surface-ports.js";
import { err, ok } from "../../src/domain/public.js";

const featureId = (value: string) => value as FeatureId;
const activationId = (value: string) => value as ActivationId;
const tabId = (value: number) => value as TargetTabId;

function harness() {
  const events: string[] = [];
  let selected: FeatureId | null = featureId("planner");
  let failDismiss = false;
  let failHandoff = false;
  const host: TransientSurfaceHost = {
    getSelected: () => selected,
    isTransientAvailable: (id) => id === featureId("capture"),
    async showTransient(request) {
      events.push(`show:${request.surfaceId}`);
      selected = request.surfaceId;
      return ok(undefined);
    },
    async restorePersistent(preferred) {
      events.push(`restore:${preferred ?? "fallback"}`);
      if (failDismiss)
        return { ok: false, error: { kind: "transition-failed" } };
      selected = preferred ?? featureId("fallback");
      return ok(undefined);
    },
    async activate(intent: FeatureActivationIntent) {
      events.push(`activate:${intent.featureId}`);
      if (failHandoff)
        return { ok: false, error: { kind: "transition-failed" } };
      selected = intent.featureId;
      return ok(undefined);
    },
  };
  return {
    events,
    host,
    selected: () => selected,
    failDismiss: () => {
      failDismiss = true;
    },
    recoverDismiss: () => {
      failDismiss = false;
    },
    failHandoff: () => {
      failHandoff = true;
    },
    recoverHandoff: () => {
      failHandoff = false;
    },
  };
}

test("controller境界は業務永続portへ到達しない", () => {
  const source = readFileSync(
    new URL(
      "../../src/application-shell/transient-surface-controller.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /persistence|FoundationDataPort|\.mutate\(/);
});

test("有効要求だけをmountし同一tabの新世代が旧callbackを無効化する", async () => {
  const h = harness();
  const controller = createTransientSurfaceController({ host: h.host });
  const snapshots: string[] = [];
  controller.subscribe((state) => snapshots.push(state.kind));
  assert.equal((await controller.start()).ok, true);
  assert.equal(
    (
      await controller.request({
        activationId: activationId("a1"),
        surfaceId: featureId("capture"),
        tabId: tabId(7),
      })
    ).ok,
    true,
  );
  await controller.request({
    activationId: activationId("a2"),
    surfaceId: featureId("capture"),
    tabId: tabId(7),
  });
  assert.equal(controller.isCurrent(activationId("a1")), false);
  assert.equal(controller.isCurrent(activationId("a2")), true);
  assert.equal(
    (await controller.dismiss(activationId("a1"), "navigated")).ok,
    true,
  );
  assert.equal(h.selected(), featureId("capture"));
  assert.deepEqual(snapshots, ["active", "active"]);
});

test("3終了理由はいずれも記録した常設面へ復帰する", async () => {
  for (const reason of [
    "navigated",
    "tab-closed",
    "persistent-selected",
  ] as const) {
    const h = harness();
    const controller = createTransientSurfaceController({ host: h.host });
    await controller.start();
    await controller.request({
      activationId: activationId(reason),
      surfaceId: featureId("capture"),
      tabId: tabId(1),
    });
    assert.equal(
      (await controller.dismiss(activationId(reason), reason)).ok,
      true,
    );
    assert.equal(h.selected(), featureId("planner"));
    assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  }
});

test("常設選択はreturnToではなく選択targetへ終了しcontrollerをinactive化する", async () => {
  const h = harness();
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("selected"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });

  assert.equal(
    (await controller.selectPersistent(featureId("compatibility"))).ok,
    true,
  );
  assert.equal(h.selected(), featureId("compatibility"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });

  await controller.dismiss(activationId("selected"), "navigated");
  assert.equal(h.selected(), featureId("compatibility"));
});

test("deferred showTransient中の後発navが選択targetを保持する", async () => {
  const h = harness();
  let releaseShow!: () => void;
  const showPending = new Promise<void>((resolve) => {
    releaseShow = resolve;
  });
  const originalShow = h.host.showTransient;
  h.host.showTransient = async (...args) => {
    await showPending;
    return originalShow(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  const request = controller.request({
    activationId: activationId("pending-show"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  await Promise.resolve();
  const navigation = controller.selectPersistent(featureId("compatibility"));
  assert.equal(controller.getSnapshot().kind, "closing");
  releaseShow();
  assert.equal((await request).ok, true);
  assert.equal((await navigation).ok, true);
  assert.equal(h.selected(), featureId("compatibility"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
});

test("deferred conclude中の後発navがhandoff完了より優先される", async () => {
  const h = harness();
  let releaseActivate!: () => void;
  const activatePending = new Promise<void>((resolve) => {
    releaseActivate = resolve;
  });
  const originalActivate = h.host.activate;
  h.host.activate = async (...args) => {
    await activatePending;
    return originalActivate(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("pending-conclude"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const conclusion = controller.conclude(activationId("pending-conclude"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  await Promise.resolve();
  const navigation = controller.selectPersistent(featureId("compatibility"));
  assert.equal(controller.getSnapshot().kind, "closing");
  releaseActivate();
  assert.equal((await conclusion).ok, true);
  assert.equal((await navigation).ok, true);
  assert.equal(h.selected(), featureId("compatibility"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
});

test("deferred conclude中の同世代handoffは最初の受付だけがhostを起動する", async () => {
  const h = harness();
  let releaseActivate!: () => void;
  const activatePending = new Promise<void>((resolve) => {
    releaseActivate = resolve;
  });
  let activateCount = 0;
  const originalActivate = h.host.activate;
  h.host.activate = async (...args) => {
    activateCount += 1;
    await activatePending;
    return originalActivate(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("single-owner"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });

  const first = controller.conclude(activationId("single-owner"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  await Promise.resolve();
  const duplicate = controller.conclude(activationId("single-owner"), {
    featureId: featureId("planner"),
    target: "edit",
    payload: {},
  });

  assert.equal(controller.isCurrent(activationId("single-owner")), false);
  releaseActivate();
  assert.equal((await first).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(activateCount, 1);
  assert.equal(h.selected(), featureId("candidates"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
});

test("nav受付後の新世代requestだけがnavをsupersedeする", async () => {
  const h = harness();
  let releaseRestore!: () => void;
  const restorePending = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  const originalRestore = h.host.restorePersistent;
  h.host.restorePersistent = async (...args) => {
    await restorePending;
    return originalRestore(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("old"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const navigation = controller.selectPersistent(featureId("compatibility"));
  const nextRequest = controller.request({
    activationId: activationId("new"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  releaseRestore();
  assert.equal((await navigation).ok, true);
  assert.equal((await nextRequest).ok, true);
  assert.equal(h.selected(), featureId("capture"));
  assert.equal(controller.isCurrent(activationId("new")), true);
  assert.equal(controller.getSnapshot().kind, "active");
});

test("終了pending中は現行世代の実行操作とhandoffを拒否する", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness();
  const originalRestore = h.host.restorePersistent;
  h.host.restorePersistent = async (...args) => {
    await pending;
    return originalRestore(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("closing"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });

  const snapshots: string[] = [];
  controller.subscribe((state) => snapshots.push(state.kind));
  const dismissal = controller.selectPersistent(featureId("planner"));
  assert.equal(controller.isCurrent(activationId("closing")), false);
  assert.equal(controller.getSnapshot().kind, "closing");
  assert.deepEqual(snapshots, ["closing"]);
  const conclusion = controller.conclude(activationId("closing"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  release();
  assert.equal((await dismissal).ok, true);
  assert.equal((await conclusion).ok, true);
  assert.equal(
    h.events.some((event) => event === "activate:candidates"),
    false,
  );
});

test("終了失敗を同一世代のdismiss-failedに保ち再試行できる", async () => {
  const h = harness();
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("a1"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  h.failDismiss();
  assert.equal(
    (await controller.dismiss(activationId("a1"), "navigated")).ok,
    false,
  );
  assert.equal(controller.getSnapshot().kind, "dismiss-failed");
  assert.equal(h.selected(), featureId("capture"));
  h.recoverDismiss();
  assert.equal(
    (await controller.dismiss(activationId("a1"), "navigated")).ok,
    true,
  );
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  assert.equal(h.selected(), featureId("planner"));
  assert.equal(
    h.events.filter((event) => event.startsWith("restore:")).length,
    2,
  );
});

test("常設選択失敗はtargetとreasonを保持し同じcommandを再試行する", async () => {
  const h = harness();
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("retry-selection"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  h.failDismiss();
  assert.equal(
    (await controller.selectPersistent(featureId("compatibility"))).ok,
    false,
  );
  assert.deepEqual(controller.getSnapshot(), {
    kind: "dismiss-failed",
    activationId: activationId("retry-selection"),
    surfaceId: featureId("capture"),
    returnTo: featureId("planner"),
    target: featureId("compatibility"),
    reason: "persistent-selected",
  });
  await controller.dismiss(activationId("retry-selection"), "navigated");
  assert.equal(controller.getSnapshot().kind, "dismiss-failed");
  h.recoverDismiss();
  assert.equal((await controller.retryDismiss()).ok, true);
  assert.equal(h.selected(), featureId("compatibility"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
});

test("dismiss-failed後の新世代は旧世代retryをno-opにする", async () => {
  const h = harness();
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("old"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  h.failDismiss();
  await controller.dismiss(activationId("old"), "navigated");
  h.recoverDismiss();
  await controller.request({
    activationId: activationId("new"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const restoresBeforeStaleRetry = h.events.filter((event) =>
    event.startsWith("restore:"),
  ).length;
  assert.equal(
    (await controller.dismiss(activationId("old"), "navigated")).ok,
    true,
  );
  assert.equal(
    h.events.filter((event) => event.startsWith("restore:")).length,
    restoresBeforeStaleRetry,
  );
  assert.equal(controller.isCurrent(activationId("new")), true);
  assert.equal(h.selected(), featureId("capture"));
});

test("typed handoff成功時は引き渡し先を保持し失敗時は一過性面を維持する", async () => {
  const success = harness();
  const controller = createTransientSurfaceController({ host: success.host });
  await controller.start();
  await controller.request({
    activationId: activationId("a1"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  assert.equal(
    (
      await controller.conclude(activationId("a1"), {
        featureId: featureId("candidates"),
        target: "edit",
        payload: {},
      })
    ).ok,
    true,
  );
  assert.equal(success.selected(), featureId("candidates"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });

  const failure = harness();
  failure.failHandoff();
  const failed = createTransientSurfaceController({ host: failure.host });
  await failed.start();
  await failed.request({
    activationId: activationId("a2"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  assert.equal(
    (
      await failed.conclude(activationId("a2"), {
        featureId: featureId("candidates"),
        target: "edit",
        payload: {},
      })
    ).ok,
    false,
  );
  assert.equal(failure.selected(), featureId("capture"));
  assert.equal(failed.getSnapshot().kind, "active");
  assert.equal(failed.isCurrent(activationId("a2")), true);
  failure.recoverHandoff();
  assert.equal(
    (
      await failed.conclude(activationId("a2"), {
        featureId: featureId("candidates"),
        target: "edit",
        payload: {},
      })
    ).ok,
    true,
  );
  assert.equal(failure.selected(), featureId("candidates"));
  assert.deepEqual(failed.getSnapshot(), { kind: "inactive" });
});

test("typed handoff失敗はhostが返した安全な理由を消さずcallerへ返す", async () => {
  const h = harness();
  h.host.activate = async () => ({
    ok: false,
    error: { kind: "transition-failed", reason: "operation-blocked" },
  });
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("reason"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });

  assert.deepEqual(
    await controller.conclude(activationId("reason"), {
      featureId: featureId("candidates"),
      target: "edit",
      payload: {},
    }),
    {
      ok: false,
      error: { kind: "transition-failed", reason: "operation-blocked" },
    },
  );
});

test("rollback失敗は表示できないcapture世代をactiveへ戻さない", async () => {
  const h = harness();
  h.host.activate = async () => ({
    ok: false,
    error: { kind: "transition-failed", reason: "rollback-failed" },
  });
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("rollback-failed"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });

  const result = await controller.conclude(activationId("rollback-failed"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });

  assert.equal(result.ok, false);
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  assert.equal(controller.isCurrent(activationId("rollback-failed")), false);
});

test("実hostのstale target cleanup失敗でもcontrollerをinactiveへ同期する", async () => {
  let targetAvailable = true;
  let publishTargetAvailability:
    | ((value: { status: "unavailable"; reason: string }) => void)
    | undefined;
  let leaseReleases = 0;
  const planner: ApplicationFeatureRegistration = {
    id: featureId("planner"),
    presentation: "persistent",
    navigation: { labelKey: "planner" as never, order: 0 },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    async mount() {
      return { async unmount() {} };
    },
  };
  const capture: ApplicationFeatureRegistration = {
    id: featureId("capture"),
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    transientActivation: {
      validate: (request) => ok(request),
      accept: async () =>
        ok({
          async release() {
            leaseReleases += 1;
          },
        }),
    },
    async mount() {
      return {
        async captureState() {
          return ok({ activationId: "current" });
        },
        async unmount() {},
      };
    },
  };
  const target: ApplicationFeatureRegistration<object, unknown> = {
    id: featureId("target"),
    presentation: "persistent",
    navigation: { labelKey: "target" as never, order: 1 },
    publicApi: {},
    getAvailability: () =>
      targetAvailable
        ? { status: "available" }
        : { status: "unavailable", reason: "closed" },
    subscribeAvailability(listener) {
      publishTargetAvailability = listener;
      return () => {
        publishTargetAvailability = undefined;
      };
    },
    async mount() {
      targetAvailable = false;
      publishTargetAvailability?.({ status: "unavailable", reason: "closed" });
      return {
        async unmount() {
          throw new Error("cleanup failed");
        },
      };
    },
    activation: { validate: () => ok({}), activate: async () => ok(undefined) },
  };
  const registry = createFeatureRegistry();
  for (const value of [planner, capture, target])
    assert.equal(registry.register(value).ok, true);
  const host = createSidePanelHost({
    registry,
    container: document.createElement("div"),
    operationPolicy: {
      isAllowed: () => true,
      subscribe: () => () => undefined,
    },
    onStateChange() {},
    reportError() {},
  });
  await host.start();
  const controller = createTransientSurfaceController({
    host: {
      getSelected: host.getSelected,
      isTransientAvailable: (id) => id === capture.id,
      async showTransient(request) {
        const result = await host.showTransient(request);
        return result.ok ? ok(undefined) : err({ kind: "transition-failed" });
      },
      async restorePersistent(preferred, reason) {
        const result = await host.restorePersistent(preferred, reason);
        return result.ok ? ok(undefined) : err({ kind: "transition-failed" });
      },
      async activate(intent) {
        const result = await host.activate(intent);
        return result.ok
          ? ok(undefined)
          : err(transientHandoffFailure(result.error));
      },
    },
  });
  await controller.start();
  await controller.request({
    activationId: activationId("current"),
    surfaceId: capture.id,
    tabId: tabId(1),
  });

  const result = await controller.conclude(activationId("current"), {
    featureId: target.id,
    target: "edit",
    payload: {},
  });

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "transition-failed", reason: "rollback-failed" },
  });
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  assert.equal(controller.isCurrent(activationId("current")), false);
  assert.equal(host.getSelected(), target.id);
  assert.equal(leaseReleases, 1);
  await controller.stop();
  await assert.rejects(host.stop(), AggregateError);
});

test("stale conclude失敗は後発navと新世代claimを復活させない", async () => {
  const h = harness();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalActivate = h.host.activate;
  let activateCount = 0;
  h.host.activate = async (...args) => {
    activateCount += 1;
    if (activateCount === 1) {
      await pending;
      return { ok: false, error: { kind: "transition-failed" } };
    }
    return originalActivate(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("old"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const stale = controller.conclude(activationId("old"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  await Promise.resolve();
  const navigation = controller.selectPersistent(featureId("compatibility"));
  assert.equal(controller.getSnapshot().kind, "closing");
  release();
  assert.equal((await stale).ok, false);
  assert.notEqual(controller.getSnapshot().kind, "active");
  assert.equal((await navigation).ok, true);
  assert.equal(h.selected(), featureId("compatibility"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });

  await controller.request({
    activationId: activationId("new"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const first = controller.conclude(activationId("new"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  const duplicate = controller.conclude(activationId("new"), {
    featureId: featureId("planner"),
    target: "edit",
    payload: {},
  });
  assert.equal((await first).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(activateCount, 2);
  assert.equal(h.selected(), featureId("candidates"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
});

test("stopはpending concludeのclaimを捨てrestart後の同一IDを一度だけ受理する", async () => {
  const h = harness();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalActivate = h.host.activate;
  let activateCount = 0;
  h.host.activate = async (...args) => {
    activateCount += 1;
    if (activateCount === 1) await pending;
    return originalActivate(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("reused"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const old = controller.conclude(activationId("reused"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  await Promise.resolve();
  const stopping = controller.stop();
  release();
  await old;
  await stopping;
  await controller.start();
  await controller.request({
    activationId: activationId("reused"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const next = controller.conclude(activationId("reused"), {
    featureId: featureId("planner"),
    target: "edit",
    payload: {},
  });
  const duplicate = controller.conclude(activationId("reused"), {
    featureId: featureId("candidates"),
    target: "edit",
    payload: {},
  });
  assert.equal((await next).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(activateCount, 2);
  assert.equal(h.selected(), featureId("planner"));
});

test("pending dismiss中の同一callbackはrestoreを重複せず次commandを受理する", async () => {
  const h = harness();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalRestore = h.host.restorePersistent;
  let restoreCount = 0;
  h.host.restorePersistent = async (...args) => {
    restoreCount += 1;
    await pending;
    return originalRestore(...args);
  };
  const controller = createTransientSurfaceController({ host: h.host });
  await controller.start();
  await controller.request({
    activationId: activationId("dismiss"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  const first = controller.dismiss(activationId("dismiss"), "navigated");
  const duplicate = controller.dismiss(activationId("dismiss"), "navigated");
  release();
  assert.equal((await first).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(restoreCount, 1);
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  await controller.request({
    activationId: activationId("after-dismiss"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  assert.equal(controller.isCurrent(activationId("after-dismiss")), true);
});

test("start前requestはghost claimを残さずstart後は通常受理する", async () => {
  const h = harness();
  const controller = createTransientSurfaceController({ host: h.host });
  const rejected = await controller.request({
    activationId: activationId("before-start"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  await controller.start();
  const navigation = controller.selectPersistent(featureId("compatibility"));
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
  assert.equal((await navigation).ok, true);
  assert.equal(h.selected(), featureId("compatibility"));
  await controller.request({
    activationId: activationId("after-start"),
    surfaceId: featureId("capture"),
    tabId: tabId(1),
  });
  assert.equal(controller.isCurrent(activationId("after-start")), true);
});

test("起動要求の検証・表示失敗はghost pendingを残さない", async () => {
  for (const failure of [
    "unavailable",
    "show-failed",
    "show-rejected",
  ] as const) {
    const h = harness();
    if (failure === "show-failed") {
      h.host.showTransient = async () => ({
        ok: false,
        error: { kind: "transition-failed" },
      });
    }
    if (failure === "show-rejected") {
      h.host.showTransient = async () => {
        throw new Error("fixture show rejection");
      };
    }
    const controller = createTransientSurfaceController({ host: h.host });
    await controller.start();
    const requested = await controller.request({
      activationId: activationId(failure),
      surfaceId: featureId(failure === "unavailable" ? "missing" : "capture"),
      tabId: tabId(1),
    });
    assert.equal(requested.ok, false);
    assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });

    const navigation = controller.selectPersistent(featureId("compatibility"));
    assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
    assert.equal((await navigation).ok, true);
    assert.equal(h.selected(), featureId("compatibility"));
  }
});

test("実hostとのhandoffは成功・rollback・staleの全経路で単一mountを保つ", async () => {
  for (const activationFails of [false, true]) {
    const events: string[] = [];
    let mounted = 0;
    let maximumMounted = 0;
    let activations = 0;
    let leaseReleases = 0;
    const registration = (
      id: string,
      presentation: "persistent" | "transient",
      activation = false,
    ): ApplicationFeatureRegistration<object, unknown> => ({
      id: featureId(id),
      ...(presentation === "persistent"
        ? {
            presentation,
            navigation: {
              labelKey: id as never,
              order: id === "planner" ? 0 : 1,
            },
          }
        : {
            presentation,
            transientActivation: {
              validate: (request) => ok(request),
              accept: async () =>
                ok({
                  async release() {
                    leaseReleases += 1;
                  },
                }),
            },
          }),
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => undefined,
      async mount() {
        mounted += 1;
        maximumMounted = Math.max(maximumMounted, mounted);
        events.push(`mount:${id}`);
        return {
          async captureState() {
            return ok({ id });
          },
          async unmount() {
            events.push(`unmount:${id}`);
            mounted -= 1;
          },
        };
      },
      ...(activation
        ? {
            activation: {
              validate: () => ok({}),
              async activate() {
                activations += 1;
                return activationFails
                  ? {
                      ok: false as const,
                      error: {
                        kind: "activation_failed" as const,
                        detail: "fixture",
                      },
                    }
                  : ok(undefined);
              },
            },
          }
        : {}),
    });
    const registry = createFeatureRegistry();
    const planner = registration("planner", "persistent");
    const capture = registration("capture", "transient");
    const target = registration("target", "persistent", true);
    for (const value of [planner, capture, target])
      assert.equal(registry.register(value).ok, true);
    const host = createSidePanelHost({
      registry,
      container: document.createElement("div"),
      operationPolicy: {
        isAllowed: () => true,
        subscribe: () => () => undefined,
      },
      onStateChange() {},
      reportError() {},
    });
    await host.start();
    const controller = createTransientSurfaceController({
      host: {
        getSelected: host.getSelected,
        isTransientAvailable: (id) => id === capture.id,
        async showTransient(id) {
          const result = await host.showTransient(id);
          return result.ok
            ? ok(undefined)
            : { ok: false, error: { kind: "transition-failed" } };
        },
        async restorePersistent(preferred, reason) {
          const result = await host.restorePersistent(preferred, reason);
          return result.ok
            ? ok(undefined)
            : { ok: false, error: { kind: "transition-failed" } };
        },
        async activate(intent) {
          const result = await host.activate(intent);
          return result.ok
            ? ok(undefined)
            : { ok: false, error: { kind: "transition-failed" } };
        },
      },
    });
    await controller.start();
    await controller.request({
      activationId: activationId("old"),
      surfaceId: capture.id,
      tabId: tabId(1),
    });
    await controller.request({
      activationId: activationId("current"),
      surfaceId: capture.id,
      tabId: tabId(1),
    });
    const beforeStale = [...events];
    await controller.conclude(activationId("old"), {
      featureId: target.id,
      target: "edit",
      payload: {},
    });
    assert.deepEqual(events, beforeStale);
    const result = await controller.conclude(activationId("current"), {
      featureId: target.id,
      target: "edit",
      payload: {},
    });
    assert.equal(result.ok, !activationFails);
    assert.equal(
      leaseReleases,
      2,
      "handoff must release the source transient lease before target mount",
    );
    assert.equal(activations, 1);
    assert.equal(host.getSelected(), activationFails ? capture.id : target.id);
    assert.equal(maximumMounted, 1);
    assert.equal(mounted, 1);
    await controller.stop();
    await host.stop();
  }
});
