import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  TargetTabId,
} from "../../src/application-shell/transient-surface-ports.js";
import { ok } from "../../src/domain/public.js";
import { createPanelActivationAdapter } from "../../src/runtime/panel-activation-adapter.js";
import type {
  ActivationAuthorization,
  TransientActivationRecord,
} from "../../src/runtime/transient-activation-store.js";

const record = (stage: TransientActivationRecord["stage"] = "pending") => ({
  activationId: "activation-1" as ActivationId,
  surfaceId: "transient-fixture" as TransientActivationRecord["surfaceId"],
  tabId: 7 as TargetTabId,
  seq: 1 as TransientActivationRecord["seq"],
  stage,
});

test("read/subscribeではmountせずwatch設置後にだけtyped authorizationを要求する", async () => {
  const events: string[] = [];
  let subscriber:
    | ((value: TransientActivationRecord | undefined) => void)
    | undefined;
  const outcomes: string[] = [];
  const adapter = createPanelActivationAdapter({
    store: {
      async read() {
        events.push("read");
        return ok(record());
      },
      subscribe(listener) {
        events.push("subscribe");
        subscriber = listener;
        return () => events.push("unsubscribe");
      },
    },
    lifecycle: {
      watch() {
        events.push("watch");
        return () => events.push("unwatch");
      },
    },
    activation: {
      async authorizeAfterWatchReady() {
        events.push("authorize");
        return ok<ActivationAuthorization>({
          kind: "authorized",
          record: record("activated"),
        });
      },
    },
  });

  const cleanup = await adapter.start((outcome) => {
    outcomes.push(outcome.kind);
  });
  assert.equal(cleanup.ok, true);
  assert.deepEqual(events, ["subscribe", "read", "watch", "authorize"]);
  assert.deepEqual(outcomes, ["authorized"]);
  subscriber?.(record());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(outcomes, ["authorized"]);
  if (cleanup.ok) {
    cleanup.value();
    cleanup.value();
  }
  assert.deepEqual(events.slice(-2), ["unwatch", "unsubscribe"]);
});

test("watch-ready前失効とtyped errorではauthorizedを通知しない", async () => {
  for (const result of [
    ok<ActivationAuthorization>({
      kind: "invalidated",
      record: record("invalidated"),
    }),
    { ok: false as const, error: { kind: "store-unavailable" as const } },
  ]) {
    const outcomes: string[] = [];
    let unwatch = 0;
    const adapter = createPanelActivationAdapter({
      store: {
        async read() {
          return ok(record());
        },
        subscribe() {
          return () => {};
        },
      },
      lifecycle: {
        watch() {
          return () => {
            unwatch += 1;
          };
        },
      },
      activation: {
        async authorizeAfterWatchReady() {
          return result;
        },
      },
    });
    const cleanup = await adapter.start((outcome) => {
      outcomes.push(outcome.kind);
    });
    assert.equal(cleanup.ok, true);
    assert.deepEqual(outcomes, [result.ok ? "invalidated" : "error"]);
    assert.equal(unwatch, 1);
    if (cleanup.ok) cleanup.value();
    assert.equal(unwatch, 1);
  }
});

test("authorization待機中にpanel監視が終了した世代へ遅延authorizedを通知しない", async () => {
  let end: ((id: ActivationId, reason: "navigated") => void) | undefined;
  let resolveAuthorization!: (
    value: ReturnType<typeof ok<ActivationAuthorization>>,
  ) => void;
  const authorization = new Promise<
    ReturnType<typeof ok<ActivationAuthorization>>
  >((resolve) => {
    resolveAuthorization = resolve;
  });
  const outcomes: string[] = [];
  let unwatch = 0;
  const adapter = createPanelActivationAdapter({
    store: {
      async read() {
        return ok(record());
      },
      subscribe() {
        return () => {};
      },
    },
    lifecycle: {
      watch(_id, _tabId, onEnded) {
        end = onEnded as typeof end;
        return () => {
          unwatch += 1;
        };
      },
    },
    activation: { authorizeAfterWatchReady: () => authorization },
  });
  const started = adapter.start((outcome) => {
    outcomes.push(outcome.kind);
  });
  await new Promise((resolve) => setImmediate(resolve));
  end?.("activation-1" as ActivationId, "navigated");
  resolveAuthorization(ok({ kind: "authorized", record: record("activated") }));
  const cleanup = await started;
  assert.deepEqual(outcomes, ["ended"]);
  assert.equal(unwatch, 0);
  if (cleanup.ok) cleanup.value();
  assert.equal(unwatch, 0);
});
