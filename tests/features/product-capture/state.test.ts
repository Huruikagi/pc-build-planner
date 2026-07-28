import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  FeatureActivationIntent,
  FeatureId,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import {
  err,
  ok,
  type RequestId,
  type UtcTimestamp,
} from "../../../src/domain/public.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";

const A = "activation-a" as ActivationId;
const B = "activation-b" as ActivationId;
const TAB = 7 as TargetTabId;
const result = {
  requestId: "80000000-0000-4000-8000-000000000001" as RequestId,
  tabId: TAB,
  pageUrl: "https://example.invalid/p",
  capturedAt: "2026-07-28T00:00:00Z" as UtcTimestamp,
  draft: { fields: [], missingCoreFields: [] },
  rejectedFields: [],
};

test("activationごとに固定tabを持つidleへ初期化する", () => {
  const state = createCaptureState({
    coordinator: { captureTab: async () => ok(result) },
    isCurrent: () => true,
  });
  state.activate(A, TAB);
  assert.deepEqual(state.value, {
    status: "idle",
    activationId: A,
    tabId: TAB,
  });
  state.activate(B, 8 as TargetTabId);
  assert.deepEqual(state.value, { status: "idle", activationId: B, tabId: 8 });
});

test("現行世代だけが固定tabの抽出を開始する", async () => {
  const calls: TargetTabId[] = [];
  let current = A;
  const state = createCaptureState({
    coordinator: {
      async captureTab(tabId) {
        calls.push(tabId);
        return err({ kind: "permission-lost" });
      },
    },
    isCurrent: (id) => id === current,
  });
  state.activate(A, TAB);
  current = B;
  await state.startCapture();
  assert.deepEqual(calls, []);
});

test("失敗は同一世代で再試行できる", async () => {
  let calls = 0;
  const state = createCaptureState({
    coordinator: {
      async captureTab() {
        calls += 1;
        return calls === 1 ? err({ kind: "injection-failed" }) : ok(result);
      },
    },
    isCurrent: () => true,
  });
  state.activate(A, TAB);
  await state.startCapture();
  assert.equal(state.value?.status, "failed");
  await state.startCapture();
  assert.equal(state.value?.status, "idle");
  assert.equal(calls, 2);
});

test("stale callbackとunmount後のcallbackを破棄する", async () => {
  let resolve!: (value: ReturnType<typeof ok<typeof result>>) => void;
  const pending = new Promise<ReturnType<typeof ok<typeof result>>>((r) => {
    resolve = r;
  });
  let current = A;
  const state = createCaptureState({
    coordinator: { captureTab: async () => pending },
    isCurrent: (id) => id === current,
  });
  state.activate(A, TAB);
  const run = state.startCapture();
  current = B;
  state.activate(B, 8 as TargetTabId);
  resolve(ok(result));
  await run;
  assert.deepEqual(state.value, { status: "idle", activationId: B, tabId: 8 });
  state.deactivate();
  assert.equal(state.value, null);
});

test("handoff失敗intentを同一世代だけ保持し成功時に破棄する", async () => {
  const intent: FeatureActivationIntent = {
    featureId: "candidate-management" as FeatureId,
    target: "edit",
    payload: {},
  };
  const retries: FeatureActivationIntent[] = [];
  const state = createCaptureState({
    coordinator: { captureTab: async () => ok(result) },
    isCurrent: (id) => id === A,
    async retryHandoff(_activationId, retained) {
      retries.push(retained);
      return ok(undefined);
    },
  });
  state.activate(A, TAB);
  state.retainHandoffFailure({ kind: "transition-failed" }, intent);
  assert.deepEqual(
    state.value?.status === "failed" && state.value.failure.kind === "handoff"
      ? state.value.failure.retainedIntent
      : null,
    intent,
  );
  await state.startCapture();
  assert.deepEqual(retries, [intent]);
  assert.equal(state.value, null);
});

test("新activationと終了はretained intentを破棄する", () => {
  const intent: FeatureActivationIntent = {
    featureId: "candidate-management" as FeatureId,
    target: "edit",
    payload: {},
  };
  const state = createCaptureState({
    coordinator: { captureTab: async () => ok(result) },
    isCurrent: () => true,
  });
  state.activate(A, TAB);
  state.retainHandoffFailure({ kind: "transition-failed" }, intent);
  state.activate(B, 8 as TargetTabId);
  assert.deepEqual(state.value, {
    status: "idle",
    activationId: B,
    tabId: 8,
  });
  state.deactivate();
  assert.equal(state.value, null);
});
