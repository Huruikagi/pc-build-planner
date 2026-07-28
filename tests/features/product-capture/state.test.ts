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
const handoff = {
  createHandoffIntent: () =>
    ok({
      featureId: "candidate-management" as FeatureId,
      target: "open-candidate-editor",
      payload: {},
    }),
  conclude: async () => ok(undefined),
};

test("activationごとに固定tabを持つidleへ初期化する", () => {
  const state = createCaptureState({
    ...handoff,
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
    ...handoff,
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
    ...handoff,
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
  assert.equal(state.value, null);
  assert.equal(calls, 2);
});

test("stale callbackとunmount後のcallbackを破棄する", async () => {
  let resolve!: (value: ReturnType<typeof ok<typeof result>>) => void;
  const pending = new Promise<ReturnType<typeof ok<typeof result>>>((r) => {
    resolve = r;
  });
  let current = A;
  const state = createCaptureState({
    ...handoff,
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
    createHandoffIntent: () => ok(intent),
    async conclude(_activationId, retained) {
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
    ...handoff,
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

test("現行世代の抽出成功を一度だけtyped concludeし成功後に終了する", async () => {
  const intent: FeatureActivationIntent = {
    featureId: "candidate-management" as FeatureId,
    target: "open-candidate-editor",
    payload: { draft: "typed" },
  };
  const concluded: Array<[ActivationId, FeatureActivationIntent]> = [];
  const state = createCaptureState({
    coordinator: { captureTab: async () => ok(result) },
    isCurrent: (id) => id === A,
    createHandoffIntent: () => ok(intent),
    async conclude(id, value) {
      concluded.push([id, value]);
      return ok(undefined);
    },
  });
  state.activate(A, TAB);
  await Promise.all([state.startCapture(), state.startCapture()]);
  assert.deepEqual(concluded, [[A, intent]]);
  assert.equal(state.value, null);
});

test("conclude失敗はintentを保持し同一世代のretryだけを許可する", async () => {
  const intent: FeatureActivationIntent = {
    featureId: "candidate-management" as FeatureId,
    target: "open-candidate-editor",
    payload: {},
  };
  let attempts = 0;
  const state = createCaptureState({
    coordinator: { captureTab: async () => ok(result) },
    isCurrent: (id) => id === A,
    createHandoffIntent: () => ok(intent),
    async conclude() {
      attempts += 1;
      return attempts === 1
        ? err({ kind: "transition-failed" })
        : ok(undefined);
    },
  });
  state.activate(A, TAB);
  await state.startCapture();
  assert.deepEqual(
    state.value?.status === "failed" ? state.value.failure : null,
    {
      kind: "handoff",
      error: { kind: "transition-failed" },
      retainedIntent: intent,
    },
  );
  await state.startCapture();
  assert.equal(attempts, 2);
  assert.equal(state.value, null);
});

test("抽出後にstaleとなった世代はintent生成もconcludeもしない", async () => {
  let resolve!: (value: ReturnType<typeof ok<typeof result>>) => void;
  const pending = new Promise<ReturnType<typeof ok<typeof result>>>((done) => {
    resolve = done;
  });
  let current = A;
  let intents = 0;
  let concludes = 0;
  const state = createCaptureState({
    coordinator: { captureTab: async () => pending },
    isCurrent: (id) => id === current,
    createHandoffIntent: () => {
      intents += 1;
      return ok({} as FeatureActivationIntent);
    },
    async conclude() {
      concludes += 1;
      return ok(undefined);
    },
  });
  state.activate(A, TAB);
  const run = state.startCapture();
  current = B;
  state.activate(B, 8 as TargetTabId);
  resolve(ok(result));
  await run;
  assert.equal(intents, 0);
  assert.equal(concludes, 0);
});

test("retained intentの同時retryはconcludeを一度だけ呼ぶ", async () => {
  let release!: (value: ReturnType<typeof ok<void>>) => void;
  const pending = new Promise<ReturnType<typeof ok<void>>>((done) => {
    release = done;
  });
  let calls = 0;
  const intent = {
    featureId: "candidate-management" as FeatureId,
    target: "open-candidate-editor",
    payload: {},
  };
  const state = createCaptureState({
    coordinator: { captureTab: async () => ok(result) },
    isCurrent: () => true,
    createHandoffIntent: handoff.createHandoffIntent,
    async conclude() {
      calls += 1;
      return pending;
    },
  });
  state.activate(A, TAB);
  state.retainHandoffFailure({ kind: "transition-failed" }, intent);
  const first = state.startCapture();
  const second = state.startCapture();
  assert.equal(calls, 1);
  release(ok(undefined));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("concludeの後着成功と失敗は新activationを変更しない", async () => {
  for (const response of [
    ok(undefined),
    err({ kind: "transition-failed" } as const),
  ]) {
    let release!: (value: typeof response) => void;
    const pending = new Promise<typeof response>((done) => {
      release = done;
    });
    const state = createCaptureState({
      coordinator: { captureTab: async () => ok(result) },
      isCurrent: () => true,
      createHandoffIntent: () =>
        ok({
          featureId: "candidate-management" as FeatureId,
          target: "open-candidate-editor",
          payload: {},
        }),
      conclude: async () => pending,
    });
    state.activate(A, TAB);
    const run = state.startCapture();
    await Promise.resolve();
    state.activate(B, 8 as TargetTabId);
    release(response);
    await run;
    assert.deepEqual(state.value, {
      status: "idle",
      activationId: B,
      tabId: 8,
    });
  }
});

test("候補なしの場合だけ空名manual draftをtyped concludeする", async () => {
  const intent = {
    featureId: "candidate-management" as FeatureId,
    target: "open-candidate-editor",
    payload: {
      draft: {
        category: "uncategorized",
        product: { name: { original: null, confirmed: "" } },
        normalizedAttributes: { category: "uncategorized" },
      },
    },
  };
  const concluded: FeatureActivationIntent[] = [];
  const state = createCaptureState({
    coordinator: { captureTab: async () => err({ kind: "no-candidate" }) },
    isCurrent: () => true,
    createHandoffIntent: handoff.createHandoffIntent,
    createManualIntent: () => intent,
    async conclude(_id, value) {
      concluded.push(value);
      return ok(undefined);
    },
  });
  state.activate(A, TAB);
  await state.startManualEntry();
  assert.deepEqual(concluded, []);
  await state.startCapture();
  await state.startManualEntry();
  assert.deepEqual(concluded, [intent]);
  assert.equal(state.value, null);
});

test("manual conclude失敗はintentを保持し、retryでは再抽出しない", async () => {
  const intent: FeatureActivationIntent = {
    featureId: "candidate-management" as FeatureId,
    target: "open-candidate-editor",
    payload: { draft: "manual" },
  };
  let captures = 0;
  let concludes = 0;
  const state = createCaptureState({
    coordinator: {
      async captureTab() {
        captures += 1;
        return err({ kind: "no-candidate" });
      },
    },
    isCurrent: () => true,
    createHandoffIntent: handoff.createHandoffIntent,
    createManualIntent: () => intent,
    async conclude() {
      concludes += 1;
      return concludes === 1
        ? err({ kind: "transition-failed" })
        : ok(undefined);
    },
  });

  state.activate(A, TAB);
  await state.startCapture();
  await state.startManualEntry();
  assert.deepEqual(
    state.value?.status === "failed" ? state.value.failure : null,
    {
      kind: "handoff",
      error: { kind: "transition-failed" },
      retainedIntent: intent,
    },
  );
  await state.startCapture();
  assert.equal(captures, 1);
  assert.equal(concludes, 2);
  assert.equal(state.value, null);
});

test("manual handoffの後着結果は新activationを変更しない", async () => {
  let release!: (value: ReturnType<typeof ok<void>>) => void;
  const pending = new Promise<ReturnType<typeof ok<void>>>((resolve) => {
    release = resolve;
  });
  const state = createCaptureState({
    coordinator: { captureTab: async () => err({ kind: "no-candidate" }) },
    isCurrent: () => true,
    createHandoffIntent: handoff.createHandoffIntent,
    createManualIntent: () => ({
      featureId: "candidate-management" as FeatureId,
      target: "open-candidate-editor",
      payload: {},
    }),
    conclude: async () => pending,
  });

  state.activate(A, TAB);
  await state.startCapture();
  const manual = state.startManualEntry();
  await Promise.resolve();
  state.activate(B, 8 as TargetTabId);
  release(ok(undefined));
  await manual;
  assert.deepEqual(state.value, {
    status: "idle",
    activationId: B,
    tabId: 8,
  });
});
