import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CompatibilityError,
  CompatibilityQuery,
  CompatibilityReport,
} from "../../../src/features/compatibility/contracts.js";
import {
  type CompatibilityState,
  createCompatibilityState,
} from "../../../src/features/compatibility/state.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const reportWith = (
  status: CompatibilityReport["status"],
): CompatibilityReport => ({
  projectId,
  buildUpdatedAt: timestamp,
  status,
  results: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const queueQuery = (): {
  readonly query: CompatibilityQuery;
  /** Resolves the Nth (0-indexed) evaluate() call in call order, regardless of completion order. */
  readonly resolveCall: (
    index: number,
    result: Result<CompatibilityReport, CompatibilityError>,
  ) => void;
} => {
  const resolvers: Array<
    (result: Result<CompatibilityReport, CompatibilityError>) => void
  > = [];
  return {
    query: {
      async evaluate() {
        const { promise, resolve } =
          deferred<Result<CompatibilityReport, CompatibilityError>>();
        resolvers.push(resolve);
        return promise;
      },
    },
    resolveCall(index, result) {
      const resolve = resolvers[index];
      assert.ok(resolve, `expected call ${index} to be pending`);
      resolve(result);
    },
  };
};

const fixedQuery = (
  result: Result<CompatibilityReport, CompatibilityError>,
): CompatibilityQuery => ({
  async evaluate() {
    return result;
  },
});

const notifications = (state: CompatibilityState): (() => number) => {
  let count = 0;
  state.subscribe(() => {
    count += 1;
  });
  return () => count;
};

test("初期状態はidleとする", () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: true, value: reportWith("compatible") }),
  });
  assert.deepEqual(state.value, { status: "idle" });
});

test("evaluate呼び出しは即座にloadingへ遷移し完了までreportを保持しない", async () => {
  const { query, resolveCall } = queueQuery();
  const state = createCompatibilityState({ query });

  const evaluation = state.evaluate(projectId);
  assert.deepEqual(state.value, { status: "loading" });

  resolveCall(0, { ok: true, value: reportWith("compatible") });
  await evaluation;
  assert.equal(state.value.status, "ready");
});

test("成功結果はreadyへ集約結果と個別根拠を反映する", async () => {
  const report = reportWith("caution");
  const state = createCompatibilityState({
    query: fixedQuery({ ok: true, value: report }),
  });

  await state.evaluate(projectId);

  assert.deepEqual(state.value, { status: "ready", report });
});

test("no-buildはempty-buildとしてreasonを識別可能にする", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: false, error: { kind: "no-build" } }),
  });

  await state.evaluate(projectId);

  assert.deepEqual(state.value, { status: "empty-build", reason: "no-build" });
});

test("invalid-referenceはfailedとしてreasonを識別可能にする", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: false, error: { kind: "invalid-reference" } }),
  });

  await state.evaluate(projectId);

  assert.deepEqual(state.value, {
    status: "failed",
    reason: "invalid-reference",
  });
});

test("corrupt-data・unsupported-data・read-failedはfailedとしてreasonを識別可能にする", async () => {
  for (const kind of [
    "corrupt-data",
    "unsupported-data",
    "read-failed",
  ] as const) {
    const state = createCompatibilityState({
      query: fixedQuery({ ok: false, error: { kind } }),
    });

    await state.evaluate(projectId);

    assert.deepEqual(state.value, { status: "failed", reason: kind });
  }
});

test("同時評価では最新世代の完了だけを反映し古い完了を破棄する", async () => {
  const { query, resolveCall } = queueQuery();
  const state = createCompatibilityState({ query });

  const first = state.evaluate(projectId);
  const second = state.evaluate(projectId);

  resolveCall(1, { ok: true, value: reportWith("compatible") });
  await second;
  assert.deepEqual(state.value, {
    status: "ready",
    report: reportWith("compatible"),
  });

  resolveCall(0, { ok: false, error: { kind: "read-failed" } });
  await first;
  assert.deepEqual(state.value, {
    status: "ready",
    report: reportWith("compatible"),
  });
});

test("失敗時は誤った互換性statusを表示せずreadyの結果を保持しない", async () => {
  const { query, resolveCall } = queueQuery();
  const state = createCompatibilityState({ query });

  const firstEvaluation = state.evaluate(projectId);
  resolveCall(0, { ok: true, value: reportWith("incompatible") });
  await firstEvaluation;
  assert.equal(state.value.status, "ready");

  const secondEvaluation = state.evaluate(projectId);
  assert.deepEqual(state.value, { status: "loading" });
  resolveCall(1, { ok: false, error: { kind: "read-failed" } });
  await secondEvaluation;

  assert.deepEqual(state.value, { status: "failed", reason: "read-failed" });
});

test("状態遷移ごとに購読者へ通知する", async () => {
  const { query, resolveCall } = queueQuery();
  const state = createCompatibilityState({ query });
  const count = notifications(state);

  const evaluation = state.evaluate(projectId);
  assert.equal(count(), 1);
  resolveCall(0, { ok: true, value: reportWith("compatible") });
  await evaluation;
  assert.equal(count(), 2);
});
