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
import type {
  CompatibilityProjectAvailability,
  CompatibilityProjectContextAdapter,
} from "../../../src/features/compatibility/project-context-adapter.js";
import { createCompatibilityState } from "../../../src/features/compatibility/state.js";

const projectA = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const projectB = "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const timestamp = "2026-08-11T00:00:00.000Z" as UtcTimestamp;

const report = (projectId: ProjectId): CompatibilityReport => ({
  projectId,
  buildUpdatedAt: timestamp,
  status: "compatible",
  results: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const contextHarness = (initial: CompatibilityProjectAvailability) => {
  let current = initial;
  const listeners = new Set<
    (value: CompatibilityProjectAvailability) => void
  >();
  const adapter: CompatibilityProjectContextAdapter = {
    getCurrent: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    adapter,
    get subscriberCount() {
      return listeners.size;
    },
    publish(value: CompatibilityProjectAvailability) {
      current = value;
      for (const listener of [...listeners]) listener(value);
    },
  };
};

const queryHarness = () => {
  type StateError = CompatibilityError | { readonly kind: "empty-build" };
  const calls: Array<{
    projectId: ProjectId;
    resolve: (value: Result<CompatibilityReport, StateError>) => void;
  }> = [];
  const query: CompatibilityQuery = {
    async evaluate(projectId: ProjectId) {
      const pending = deferred<Result<CompatibilityReport, StateError>>();
      calls.push({ projectId, resolve: pending.resolve });
      return pending.promise;
    },
  };
  return { calls, query };
};

test("ready AからBへ切替えると旧reportを直ちに外し遅延A完了を破棄する", async () => {
  const context = contextHarness({
    status: "ready",
    generation: 1,
    projectId: projectA,
  });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });

  state.start();
  assert.deepEqual(state.value, { status: "loading" });
  assert.deepEqual(
    evaluation.calls.map((call) => call.projectId),
    [projectA],
  );

  context.publish({ status: "ready", generation: 2, projectId: projectB });
  assert.deepEqual(state.value, { status: "loading" });
  assert.deepEqual(
    evaluation.calls.map((call) => call.projectId),
    [projectA, projectB],
  );

  evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
  await flush();
  assert.deepEqual(state.value, { status: "loading" });

  evaluation.calls[1]?.resolve({ ok: true, value: report(projectB) });
  await flush();
  assert.deepEqual(state.value, { status: "ready", report: report(projectB) });
});

test("同一ready通知は重複評価せず同一projectの新generationは再評価する", async () => {
  const context = contextHarness({
    status: "ready",
    generation: 1,
    projectId: projectA,
  });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });

  state.start();
  context.publish({ status: "ready", generation: 1, projectId: projectA });
  assert.equal(evaluation.calls.length, 1);

  context.publish({ status: "ready", generation: 2, projectId: projectA });
  assert.equal(evaluation.calls.length, 2);
  assert.deepEqual(state.value, { status: "loading" });

  evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
  await flush();
  assert.deepEqual(state.value, { status: "loading" });

  evaluation.calls[1]?.resolve({ ok: true, value: report(projectA) });
  await flush();
  assert.deepEqual(state.value, { status: "ready", report: report(projectA) });
});

test("emptyとunavailableを分離しunavailableからreadyへ回復する", async () => {
  const context = contextHarness({ status: "empty", generation: 1 });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });

  state.start();
  assert.deepEqual(state.value, { status: "no-projects" });
  assert.equal(evaluation.calls.length, 0);

  context.publish({ status: "unavailable", generation: 2 });
  assert.deepEqual(state.value, { status: "context-unavailable" });
  assert.equal(evaluation.calls.length, 0);

  context.publish({ status: "ready", generation: 3, projectId: projectB });
  assert.deepEqual(state.value, { status: "loading" });
  evaluation.calls[0]?.resolve({ ok: true, value: report(projectB) });
  await flush();
  assert.deepEqual(state.value, { status: "ready", report: report(projectB) });
});

test("ready結果はproject 0件またはcontext利用不能への遷移で直ちに破棄する", async () => {
  for (const transition of [
    {
      availability: { status: "empty", generation: 2 } as const,
      expected: { status: "no-projects" } as const,
    },
    {
      availability: { status: "unavailable", generation: 2 } as const,
      expected: { status: "context-unavailable" } as const,
    },
  ]) {
    const context = contextHarness({
      status: "ready",
      generation: 1,
      projectId: projectA,
    });
    const evaluation = queryHarness();
    const state = createCompatibilityState({
      query: evaluation.query,
      projectContext: context.adapter,
    });

    state.start();
    evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
    await flush();
    assert.equal(state.value.status, "ready");

    context.publish(transition.availability);
    assert.deepEqual(state.value, transition.expected);
    assert.equal(evaluation.calls.length, 1, "代替projectを評価した");
  }
});

test("構成なし・構成空・参照失敗を結果から分離する", async () => {
  for (const error of [
    { kind: "no-build" },
    { kind: "empty-build" },
    { kind: "invalid-reference" },
    { kind: "read-failed" },
  ] as const) {
    const context = contextHarness({
      status: "ready",
      generation: 1,
      projectId: projectA,
    });
    const query: CompatibilityQuery = {
      async evaluate() {
        return { ok: false, error } as Result<
          CompatibilityReport,
          CompatibilityError
        >;
      },
    };
    const state = createCompatibilityState({
      query,
      projectContext: context.adapter,
    });
    state.start();
    await flush();

    assert.deepEqual(
      state.value,
      error.kind === "no-build" || error.kind === "empty-build"
        ? { status: "empty-build", reason: error.kind }
        : { status: "failed", reason: error.kind },
    );
  }
});

test("retryは最新snapshotを再読取しreadyでなければfallback評価しない", async () => {
  const context = contextHarness({
    status: "ready",
    generation: 1,
    projectId: projectA,
  });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });
  state.start();

  context.publish({ status: "unavailable", generation: 2 });
  await state.retry();
  assert.deepEqual(state.value, { status: "context-unavailable" });
  assert.deepEqual(
    evaluation.calls.map((call) => call.projectId),
    [projectA],
  );

  context.publish({ status: "ready", generation: 3, projectId: projectB });
  const retry = state.retry();
  assert.deepEqual(
    evaluation.calls.map((call) => call.projectId),
    [projectA, projectB, projectB],
  );

  evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
  evaluation.calls[1]?.resolve({ ok: true, value: report(projectB) });
  evaluation.calls[2]?.resolve({ ok: true, value: report(projectB) });
  await retry;
  assert.deepEqual(state.value, { status: "ready", report: report(projectB) });
});

test("stop後の再startは同一generation・projectでも旧reportを外して最新構成を再評価する", async () => {
  const context = contextHarness({
    status: "ready",
    generation: 1,
    projectId: projectA,
  });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });

  state.start();
  evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
  await flush();
  assert.equal(state.value.status, "ready");

  state.stop();
  state.start();

  assert.equal(evaluation.calls.length, 2, "再startでqueryを再実行していない");
  assert.deepEqual(state.value, { status: "loading" });
  evaluation.calls[1]?.resolve({
    ok: false,
    error: { kind: "empty-build" },
  });
  await flush();
  assert.deepEqual(state.value, {
    status: "empty-build",
    reason: "empty-build",
  });
});

test("stop前の遅延完了は同一contextで再startした最新評価へ反映しない", async () => {
  const context = contextHarness({
    status: "ready",
    generation: 1,
    projectId: projectA,
  });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });

  state.start();
  state.stop();
  state.start();
  assert.equal(evaluation.calls.length, 2);

  evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
  await flush();
  assert.deepEqual(state.value, { status: "loading" });

  evaluation.calls[1]?.resolve({ ok: false, error: { kind: "no-build" } });
  await flush();
  assert.deepEqual(state.value, {
    status: "empty-build",
    reason: "no-build",
  });
});

test("stopは購読を解除し解除後のcontext通知と遅延完了を破棄する", async () => {
  const context = contextHarness({
    status: "ready",
    generation: 1,
    projectId: projectA,
  });
  const evaluation = queryHarness();
  const state = createCompatibilityState({
    query: evaluation.query,
    projectContext: context.adapter,
  });

  state.start();
  assert.equal(context.subscriberCount, 1);
  state.stop();
  assert.equal(context.subscriberCount, 0);

  context.publish({ status: "ready", generation: 2, projectId: projectB });
  evaluation.calls[0]?.resolve({ ok: true, value: report(projectA) });
  await flush();

  assert.deepEqual(state.value, { status: "loading" });
  assert.deepEqual(
    evaluation.calls.map((call) => call.projectId),
    [projectA],
  );
});
