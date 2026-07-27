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
import { ok } from "../../src/domain/public.js";

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
    async showTransient(id) {
      events.push(`show:${id}`);
      selected = id;
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
});

test("実hostとのhandoffは成功・rollback・staleの全経路で単一mountを保つ", async () => {
  for (const activationFails of [false, true]) {
    const events: string[] = [];
    let mounted = 0;
    let maximumMounted = 0;
    let activations = 0;
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
        : { presentation }),
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
    assert.equal(activations, 1);
    assert.equal(host.getSelected(), activationFails ? capture.id : target.id);
    assert.equal(maximumMounted, 1);
    assert.equal(mounted, 1);
    await controller.stop();
    await host.stop();
  }
});
