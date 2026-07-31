import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  TransientActivationRequest,
} from "../../src/application-shell/transient-surface-ports.js";
import { ok } from "../../src/domain/public.js";
import { createPanelActivationAdapter } from "../../src/runtime/panel-activation-adapter.js";
import {
  createProductionMonitoringIntegration,
  type MonitoringActivationAdapter,
} from "../../src/runtime/production-monitoring-integration.js";
import type { TransientActivationRecord } from "../../src/runtime/transient-activation-store.js";

const activationId = "a1" as ActivationId;
const authorizedRecord = {
  activationId,
  surfaceId: "fixture" as TransientActivationRecord["surfaceId"],
  tabId: 7 as TransientActivationRecord["tabId"],
  seq: 1 as TransientActivationRecord["seq"],
  stage: "received" as const,
};

const adapter = (): {
  value: MonitoringActivationAdapter;
  emit(
    outcome: Parameters<Parameters<MonitoringActivationAdapter["start"]>[0]>[0],
  ): Promise<void>;
  cleanups: number;
} => {
  let listener: Parameters<MonitoringActivationAdapter["start"]>[0] | undefined;
  let cleanups = 0;
  return {
    value: {
      async start(next) {
        listener = next;
        return ok(() => {
          cleanups += 1;
        });
      },
    },
    async emit(outcome) {
      await listener?.(outcome);
    },
    get cleanups() {
      return cleanups;
    },
  };
};

test("authorized時だけcontroller mount後にactivatedへ進める", async () => {
  const source = adapter();
  const events: string[] = [];
  const integration = createProductionMonitoringIntegration({
    adapter: source.value,
    controller: {
      async request(value: TransientActivationRequest) {
        events.push(`mount:${value.activationId}`);
        return ok(undefined);
      },
      async dismiss(id) {
        events.push(`dismiss:${id}`);
        return ok(undefined);
      },
    },
    stages: {
      async advance(id, stage) {
        events.push(`${stage}:${id}`);
        return ok(undefined);
      },
    },
  });
  assert.equal((await integration.start()).ok, true);
  await source.emit({ kind: "authorized", record: authorizedRecord });
  assert.deepEqual(events, ["mount:a1", "activated:a1"]);
  integration.stop();
  integration.stop();
  assert.equal(source.cleanups, 1);
});

test("authorization後のgeneration失効とtab終了を利用者noticeへ通知する", async () => {
  const source = adapter();
  const expired: string[] = [];
  const integration = createProductionMonitoringIntegration({
    adapter: source.value,
    controller: {
      async request() {
        return ok(undefined);
      },
      async dismiss() {
        return ok(undefined);
      },
    },
    stages: {
      async advance() {
        return ok(undefined);
      },
    },
    onActivationExpired: (reason) => expired.push(reason),
  });
  await integration.start();
  await source.emit({
    kind: "invalidated",
    record: { ...authorizedRecord, stage: "invalidated" },
  });
  await source.emit({ kind: "ended", activationId, reason: "navigated" });
  assert.deepEqual(expired, ["invalidated", "navigated"]);
});

test("mount中失効はsurfaceを撤収しactivatedへ進めない", async () => {
  const source = adapter();
  let finishMount!: () => void;
  const mount = new Promise<void>((resolve) => {
    finishMount = resolve;
  });
  const events: string[] = [];
  const integration = createProductionMonitoringIntegration({
    adapter: source.value,
    controller: {
      async request() {
        events.push("mount:start");
        await mount;
        events.push("mount:end");
        return ok(undefined);
      },
      async dismiss(_id, reason) {
        events.push(`dismiss:${reason}`);
        return ok(undefined);
      },
    },
    stages: {
      async advance() {
        events.push("activated");
        return ok(undefined);
      },
    },
  });
  await integration.start();
  const mounting = source.emit({
    kind: "authorized",
    record: authorizedRecord,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await source.emit({ kind: "ended", activationId, reason: "tab-closed" });
  finishMount();
  await mounting;
  assert.deepEqual(events, ["mount:start", "dismiss:tab-closed", "mount:end"]);
});

test("stage前進失敗時はmount済みsurfaceをfail-safeに撤収する", async () => {
  const source = adapter();
  const events: string[] = [];
  const integration = createProductionMonitoringIntegration({
    adapter: source.value,
    controller: {
      async request() {
        events.push("mount");
        return ok(undefined);
      },
      async dismiss(_id, reason) {
        events.push(`dismiss:${reason}`);
        return ok(undefined);
      },
    },
    stages: {
      async advance() {
        return { ok: false, error: { kind: "storage-unavailable" as const } };
      },
    },
  });
  await integration.start();
  await source.emit({ kind: "authorized", record: authorizedRecord });
  assert.deepEqual(events, ["mount", "dismiss:navigated"]);
});

test("adapter開始中のstopは遅延取得したcleanupを即時解放する", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleanups = 0;
  const integration = createProductionMonitoringIntegration({
    adapter: {
      async start() {
        await gate;
        return ok(() => {
          cleanups += 1;
        });
      },
    },
    controller: {
      async request() {
        return ok(undefined);
      },
      async dismiss() {
        return ok(undefined);
      },
    },
    stages: {
      async advance() {
        return ok(undefined);
      },
    },
  });
  const starting = integration.start();
  integration.stop();
  release();
  assert.equal((await starting).ok, false);
  assert.equal(cleanups, 1);
});

test("実adapter結合はwatch-ready前後のnavigation/closeに監視空白を作らない", async () => {
  for (const timing of ["before", "after"] as const) {
    for (const reason of ["navigated", "tab-closed"] as const) {
      let onEnded:
        | ((id: ActivationId, value: "navigated" | "tab-closed") => void)
        | undefined;
      let authorize!: (
        value: ReturnType<
          typeof ok<{ kind: "authorized"; record: typeof authorizedRecord }>
        >,
      ) => void;
      const authorization = new Promise<
        ReturnType<
          typeof ok<{ kind: "authorized"; record: typeof authorizedRecord }>
        >
      >((resolve) => {
        authorize = resolve;
      });
      const events: string[] = [];
      const panel = createPanelActivationAdapter({
        store: {
          async read() {
            return ok(authorizedRecord);
          },
          subscribe() {
            return () => {};
          },
        },
        lifecycle: {
          watch(_id, _tab, listener) {
            onEnded = listener;
            return () => {};
          },
        },
        activation: { authorizeAfterWatchReady: () => authorization },
      });
      const integration = createProductionMonitoringIntegration({
        adapter: panel,
        controller: {
          async request() {
            events.push("mount");
            return ok(undefined);
          },
          async dismiss(_id, value) {
            events.push(`dismiss:${value}`);
            return ok(undefined);
          },
        },
        stages: {
          async advance() {
            events.push("activated");
            return ok(undefined);
          },
        },
      });
      const starting = integration.start();
      await new Promise((resolve) => setImmediate(resolve));
      if (timing === "before") onEnded?.(activationId, reason);
      authorize(ok({ kind: "authorized", record: authorizedRecord }));
      await starting;
      if (timing === "after") onEnded?.(activationId, reason);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(
        events,
        timing === "before"
          ? [`dismiss:${reason}`]
          : ["mount", "activated", `dismiss:${reason}`],
        `${timing}:${reason}`,
      );
      integration.stop();
    }
  }
});

test("stop後のrestart中に旧start listenerがemitしてもmountしない", async () => {
  const listeners: Array<Parameters<MonitoringActivationAdapter["start"]>[0]> =
    [];
  const events: string[] = [];
  const integration = createProductionMonitoringIntegration({
    adapter: {
      async start(listener) {
        listeners.push(listener);
        return ok(() => {});
      },
    },
    controller: {
      async request() {
        events.push("mount");
        return ok(undefined);
      },
      async dismiss() {
        events.push("dismiss");
        return ok(undefined);
      },
    },
    stages: {
      async advance() {
        events.push("activated");
        return ok(undefined);
      },
    },
  });
  await integration.start();
  integration.stop();
  await integration.start();
  await listeners[0]?.({ kind: "authorized", record: authorizedRecord });
  assert.deepEqual(events, []);
  await listeners[1]?.({ kind: "authorized", record: authorizedRecord });
  assert.deepEqual(events, ["mount", "activated"]);
});

test("旧世代のmount待機中にstop/restartしてもactivatedへ進めない", async () => {
  const listeners: Array<Parameters<MonitoringActivationAdapter["start"]>[0]> =
    [];
  let finishMount!: () => void;
  const mount = new Promise<void>((resolve) => {
    finishMount = resolve;
  });
  const events: string[] = [];
  const integration = createProductionMonitoringIntegration({
    adapter: {
      async start(listener) {
        listeners.push(listener);
        return ok(() => {});
      },
    },
    controller: {
      async request() {
        events.push("mount:start");
        await mount;
        events.push("mount:end");
        return ok(undefined);
      },
      async dismiss() {
        events.push("dismiss");
        return ok(undefined);
      },
    },
    stages: {
      async advance() {
        events.push("activated");
        return ok(undefined);
      },
    },
  });
  await integration.start();
  const old = listeners[0]?.({ kind: "authorized", record: authorizedRecord });
  await new Promise((resolve) => setImmediate(resolve));
  integration.stop();
  await integration.start();
  finishMount();
  await old;
  assert.deepEqual(events, ["mount:start", "mount:end"]);
});
