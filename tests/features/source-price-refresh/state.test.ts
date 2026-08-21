import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import {
  type CandidatePartId,
  type CandidateSourceId,
  err,
  ok,
  type Result,
  type UtcTimestamp,
} from "../../../src/domain/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshReceipt,
  SourcePriceRefreshStateValue,
} from "../../../src/features/source-price-refresh/contracts.js";
import {
  createSourcePriceRefreshState,
  type SourcePriceRefreshWorkflowInput,
} from "../../../src/features/source-price-refresh/state.js";

const candidateId = "30000000-0000-4000-8000-00000000000a" as CandidatePartId;
const sourceId = "40000000-0000-4000-8000-00000000000a" as CandidateSourceId;

const receiptFor = (amount: number): SourcePriceRefreshReceipt => ({
  candidateId,
  sourceId,
  price: { original: `${amount} JPY`, confirmed: { amount, currency: "JPY" } },
  capturedAt: "2026-07-31T00:00:00.000Z" as UtcTimestamp,
  isPrimary: false,
});

const activationOf = (suffix: string): ActivationId =>
  `activation-${suffix}` as ActivationId;

const tabOf = (value: number): TargetTabId => value as TargetTabId;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Hand-resolved port so late arrivals are ordered by the test, not by timers. */
const createDeferred = <T>(): Deferred<T> => {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolveWith) => {
    settle = resolveWith;
  });
  if (settle === undefined) throw new TypeError("deferred not initialised");
  const resolve = settle;
  return { promise, resolve };
};

type WorkflowResult = Result<
  SourcePriceRefreshReceipt,
  SourcePriceRefreshError
>;

interface WorkflowStub {
  readonly run: (
    input: SourcePriceRefreshWorkflowInput,
  ) => Promise<WorkflowResult>;
  readonly calls: readonly SourcePriceRefreshWorkflowInput[];
  pending(activationId: ActivationId): Deferred<WorkflowResult>;
}

/** Records every activation the state auto-starts and defers each completion. */
const createWorkflowStub = (): WorkflowStub => {
  const calls: SourcePriceRefreshWorkflowInput[] = [];
  const deferreds = new Map<ActivationId, Deferred<WorkflowResult>>();
  return {
    calls,
    run(input) {
      calls.push(input);
      const deferred = createDeferred<WorkflowResult>();
      deferreds.set(input.activationId, deferred);
      return deferred.promise;
    },
    pending(activationId) {
      const deferred = deferreds.get(activationId);
      if (deferred === undefined)
        throw new TypeError(`workflow was not started for ${activationId}`);
      return deferred;
    },
  };
};

/** Lets the microtask queue drain so awaited port results are applied. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("activation受理で即座にrunningとなり固定tabで自動開始する", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });

  assert.equal(state.value, null);

  const activationId = activationOf("a");
  void state.activate(activationId, tabOf(7));

  assert.deepEqual(state.value, {
    status: "running",
    activationId,
    tabId: tabOf(7),
  });
  assert.deepEqual(workflow.calls, [{ activationId, tabId: tabOf(7) }]);
});

test("成功でsucceededとreceiptを公開する", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  const activationId = activationOf("a");
  const settled = state.activate(activationId, tabOf(7));
  const receipt = receiptFor(1234);
  workflow.pending(activationId).resolve(ok(receipt));
  await settled;

  assert.deepEqual(state.value, {
    status: "succeeded",
    activationId,
    receipt,
  });
});

/**
 * design.md「エラー処理」の表と同じ単一規則で判定する。回復手順が同じcontext
 * menu操作の再実行で完結するものは recoverable、保存済みsourceの修復を先に
 * 求めるものは非recoverable。`Record` なのでunionへkindが増えると型検査で落ちる。
 */
const recoverableByKind: Record<SourcePriceRefreshError["kind"], boolean> = {
  "no-match": false,
  "ambiguous-match": false,
  validation: false,
  "unsupported-data": false,
  unexpected: false,
  "invalid-url": true,
  "ineligible-source": true,
  "price-unavailable": true,
  "stale-activation": true,
  "stale-target": true,
  "tab-unavailable": true,
  "permission-lost": true,
  "restricted-page": true,
  "tab-changed": true,
  "injection-failed": true,
  "invalid-payload": true,
  conflict: true,
  maintenance: true,
  storage: true,
  quota: true,
};

const errorSamples: readonly SourcePriceRefreshError[] = [
  { kind: "no-match" },
  { kind: "ambiguous-match" },
  { kind: "validation" },
  { kind: "unsupported-data" },
  { kind: "unexpected" },
  { kind: "invalid-url" },
  { kind: "ineligible-source" },
  { kind: "price-unavailable" },
  { kind: "stale-activation" },
  { kind: "stale-target" },
  { kind: "tab-unavailable" },
  { kind: "permission-lost" },
  { kind: "restricted-page" },
  { kind: "tab-changed" },
  { kind: "injection-failed" },
  { kind: "invalid-payload" },
  { kind: "conflict" },
  { kind: "maintenance" },
  { kind: "storage" },
  { kind: "quota" },
];

test("recoverable期待表がerror union全メンバーを網羅する", async () => {
  assert.deepEqual(
    errorSamples.map((error) => error.kind).sort(),
    Object.keys(recoverableByKind).sort(),
    "union追加時はsampleと期待表の双方を更新する",
  );
});

test("失敗でfailedとerrorおよびrecoverable判定を公開する", async () => {
  const cases = errorSamples.map(
    (error): readonly [SourcePriceRefreshError, boolean] => [
      error,
      recoverableByKind[error.kind],
    ],
  );

  for (const [error, recoverable] of cases) {
    const workflow = createWorkflowStub();
    const state = createSourcePriceRefreshState({
      runRefresh: workflow.run,
      isCurrent: () => true,
    });
    const activationId = activationOf(error.kind);
    const settled = state.activate(activationId, tabOf(7));
    workflow.pending(activationId).resolve(err(error));
    await settled;

    assert.deepEqual(
      state.value,
      { status: "failed", activationId, error, recoverable },
      `${error.kind} の recoverable 判定`,
    );
  }
});

test("新世代のactivationが旧stateを置換し旧完了を無視する", async () => {
  const workflow = createWorkflowStub();
  let current = activationOf("a");
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: (activationId) => activationId === current,
  });

  const first = activationOf("a");
  const firstSettled = state.activate(first, tabOf(7));

  const second = activationOf("b");
  current = second;
  const secondSettled = state.activate(second, tabOf(9));

  assert.deepEqual(state.value, {
    status: "running",
    activationId: second,
    tabId: tabOf(9),
  });

  workflow.pending(first).resolve(ok(receiptFor(1)));
  await firstSettled;

  assert.deepEqual(
    state.value,
    { status: "running", activationId: second, tabId: tabOf(9) },
    "旧世代の完了はstateを変更しない",
  );

  const receipt = receiptFor(2);
  workflow.pending(second).resolve(ok(receipt));
  await secondSettled;

  assert.deepEqual(state.value, {
    status: "succeeded",
    activationId: second,
    receipt,
  });
});

test("上流が両世代を現行と見なしても旧完了は新runningを上書きしない", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  const first = activationOf("a");
  const firstSettled = state.activate(first, tabOf(7));
  const second = activationOf("b");
  const secondSettled = state.activate(second, tabOf(9));

  workflow.pending(first).resolve(ok(receiptFor(11)));
  await firstSettled;

  assert.deepEqual(
    state.value,
    { status: "running", activationId: second, tabId: tabOf(9) },
    "世代が古い完了は現行世代のrunningを置き換えない",
  );

  const receipt = receiptFor(12);
  workflow.pending(second).resolve(ok(receipt));
  await secondSettled;
  assert.deepEqual(state.value, {
    status: "succeeded",
    activationId: second,
    receipt,
  });
});

test("旧世代の失敗完了も現行stateを変更しない", async () => {
  const workflow = createWorkflowStub();
  let current = activationOf("a");
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: (activationId) => activationId === current,
  });
  const first = activationOf("a");
  const firstSettled = state.activate(first, tabOf(7));
  const second = activationOf("b");
  current = second;
  const secondSettled = state.activate(second, tabOf(9));
  const receipt = receiptFor(3);
  workflow.pending(second).resolve(ok(receipt));
  await secondSettled;

  workflow.pending(first).resolve(err({ kind: "storage" }));
  await firstSettled;

  assert.deepEqual(state.value, {
    status: "succeeded",
    activationId: second,
    receipt,
  });
});

test("上流が世代を失った完了はstateを変更しない", async () => {
  const workflow = createWorkflowStub();
  let current: ActivationId | null = activationOf("a");
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: (activationId) => activationId === current,
  });
  const activationId = activationOf("a");
  const settled = state.activate(activationId, tabOf(7));
  current = null;
  workflow.pending(activationId).resolve(ok(receiptFor(4)));
  await settled;

  assert.deepEqual(state.value, {
    status: "running",
    activationId,
    tabId: tabOf(7),
  });
});

test("現行でないactivationは更新を開始せずstale-activationを提示する", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => false,
  });
  const activationId = activationOf("a");
  // Not awaited on purpose: the stale verdict is synchronous, and a regression
  // that started the deferred workflow would hang instead of failing.
  void state.activate(activationId, tabOf(7));

  assert.deepEqual(state.value, {
    status: "failed",
    activationId,
    error: { kind: "stale-activation" },
    recoverable: true,
  });
  assert.deepEqual(workflow.calls, []);
});

test("unmount後に到着したcallbackはstateを変更せずlistenerも解除する", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  let notifications = 0;
  state.subscribe(() => {
    notifications += 1;
  });
  const activationId = activationOf("a");
  const settled = state.activate(activationId, tabOf(7));
  assert.equal(notifications, 1);

  state.unmount();
  assert.equal(state.value, null);
  const afterUnmount = notifications;

  workflow.pending(activationId).resolve(ok(receiptFor(5)));
  await settled;

  assert.equal(state.value, null);
  assert.equal(notifications, afterUnmount, "unmount後は通知しない");
});

test("unmount後のactivationは何も開始せずstateも復活させない", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  state.unmount();
  // Intentionally not awaited: a regression that starts the workflow would
  // never settle, so the assertions must observe the synchronous effect.
  void state.activate(activationOf("a"), tabOf(7));

  assert.equal(state.value, null);
  assert.deepEqual(workflow.calls, []);
});

test("unmountは購読中のlistenerを実際に手放す", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  state.subscribe(() => {});
  state.subscribe(() => {});
  assert.equal(state.listenerCount, 2, "購読数がstateから観測できる");

  state.unmount();

  assert.equal(state.listenerCount, 0, "unmountでlistenerを解放する");
});

test("旧activationの遅延到着は現行runningを打ち切りその完了も破棄する", async () => {
  const workflow = createWorkflowStub();
  const current = activationOf("b");
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: (activationId) => activationId === current,
  });
  const running = activationOf("b");
  const settled = state.activate(running, tabOf(9));

  const stale = activationOf("a");
  void state.activate(stale, tabOf(7));

  assert.deepEqual(
    state.value,
    {
      status: "failed",
      activationId: stale,
      error: { kind: "stale-activation" },
      recoverable: true,
    },
    "受理できないactivationも理由を提示する",
  );

  workflow.pending(running).resolve(ok(receiptFor(8)));
  await settled;

  assert.deepEqual(
    state.value,
    {
      status: "failed",
      activationId: stale,
      error: { kind: "stale-activation" },
      recoverable: true,
    },
    "打ち切られた世代の完了は表示を復活させない",
  );
});

test("subscribeの解除関数は以後の通知を止める", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  let notifications = 0;
  const unsubscribe = state.subscribe(() => {
    notifications += 1;
  });
  unsubscribe();
  void state.activate(activationOf("a"), tabOf(7));

  assert.equal(notifications, 0);
});

test("workflowの例外はstateがerror kindへ翻訳せずそのまま伝播する", async () => {
  const boom = new Error("boom");
  const state = createSourcePriceRefreshState({
    runRefresh: () => Promise.reject(boom),
    isCurrent: () => true,
  });
  const activationId = activationOf("a");

  // 契約: runRefresh は型付き Result で settle し、例外を投げない（task 3.2 の
  // service が負う義務）。state が例外を任意の error kind へ丸めると原因を
  // 誤報告し、recoverable扱いで無限再試行を誘発するため、翻訳しない。
  await assert.rejects(state.activate(activationId, tabOf(7)), (error) => {
    assert.equal(error, boom);
    return true;
  });

  assert.deepEqual(
    state.value,
    { status: "running", activationId, tabId: tabOf(7) },
    "例外を捏造したfailedへ落とさない",
  );
});

test("公開stateはrunning・succeeded・failed以外の待機状態を持たない", async () => {
  const workflow = createWorkflowStub();
  const state = createSourcePriceRefreshState({
    runRefresh: workflow.run,
    isCurrent: () => true,
  });
  const observed: string[] = [];
  state.subscribe(() => {
    const value = state.value;
    if (value !== null) observed.push(value.status);
  });
  const activationId = activationOf("a");
  const settled = state.activate(activationId, tabOf(7));
  workflow.pending(activationId).resolve(ok(receiptFor(6)));
  await settled;
  await flush();

  assert.deepEqual(observed, ["running", "succeeded"]);

  const exhaustive = (value: SourcePriceRefreshStateValue): string => {
    switch (value.status) {
      case "running":
      case "succeeded":
      case "failed":
        return value.status;
      default: {
        const never: never = value;
        return never;
      }
    }
  };
  assert.equal(
    exhaustive({ status: "running", activationId, tabId: tabOf(7) }),
    "running",
  );
});
