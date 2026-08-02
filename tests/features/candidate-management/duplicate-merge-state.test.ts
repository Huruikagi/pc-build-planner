import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  CandidateSourceId,
  ProjectId,
  RequestId,
  Revision,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  MutationContext,
} from "../../../src/features/candidate-management/contracts.js";
import type { DuplicateCandidateMatch } from "../../../src/features/candidate-management/duplicate-matcher.js";
import type {
  DuplicateMergeCoordinator,
  DuplicateMergeError,
} from "../../../src/features/candidate-management/duplicate-merge.js";
import {
  createDuplicateMergeState,
  createDuplicateMergeStateSnapshotCodec,
} from "../../../src/features/candidate-management/duplicate-merge-state.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const sourceId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const context: MutationContext = {
  requestId: "20000000-0000-4000-8000-000000000001" as Uuid as RequestId,
  expectedRevision: 0 as Revision,
};
const draft: CandidateDraft = {
  projectId,
  category: "cpu",
  product: {
    name: { original: "架空 CPU" },
    modelNumber: { original: "CPU-1" },
  },
  normalizedAttributes: { category: "cpu", socket: { original: "S1" } },
  sources: [
    { id: sourceId, pageUrl: "https://shop.invalid/cpu-1", kind: "retail" },
  ],
  primarySourceId: sourceId,
};
const match: DuplicateCandidateMatch = {
  candidateId,
  confidence: "high",
  evidence: { kind: "model-number" },
  summary: {
    id: candidateId,
    projectId,
    category: "cpu",
    name: { original: "既存の架空 CPU" },
    manufacturer: { original: "Example" },
    modelNumber: { original: "CPU-1" },
    hasMissingDetails: false,
    updatedAt: "2026-07-22T00:00:00.000Z" as never,
  },
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

test("評価中の二重送信を抑止し、未選択の判断待ちへ遷移する", async () => {
  const evaluation =
    deferred<Awaited<ReturnType<DuplicateMergeCoordinator["evaluate"]>>>();
  let calls = 0;
  const state = createDuplicateMergeState({
    coordinator: {
      evaluate: async () => {
        calls += 1;
        return evaluation.promise;
      },
      complete: async () => assert.fail("completeしてはならない"),
    },
    createMutationContext: () => context,
    onCommitted: async () => {},
  });

  const first = state.evaluate(draft);
  const second = state.evaluate(draft);
  await Promise.resolve();
  assert.equal(state.value.status, "evaluating");
  assert.equal(calls, 1);
  evaluation.resolve({
    ok: true,
    value: { kind: "decision-required", matches: [match] },
  });
  await Promise.all([first, second]);
  assert.deepEqual(state.value, {
    status: "deciding",
    draft,
    matches: [match],
  });
});

test("target選択、取消、失敗時のdraft保持、再試行、明示新規保存を区別する", async () => {
  const failure: DuplicateMergeError = { kind: "stale-decision" };
  let completeCalls = 0;
  let committed = 0;
  const coordinator: DuplicateMergeCoordinator = {
    async evaluate() {
      return {
        ok: true,
        value: { kind: "decision-required", matches: [match] },
      };
    },
    async complete(_draft, _matches, decision) {
      completeCalls += 1;
      return completeCalls === 1
        ? { ok: false, error: failure }
        : {
            ok: true,
            value:
              decision.kind === "save-new"
                ? { kind: "saved-new", candidate: {} as never }
                : { kind: "source-added", candidateId },
          };
    },
  };
  const state = createDuplicateMergeState({
    coordinator,
    createMutationContext: () => context,
    onCommitted: async () => {
      committed += 1;
    },
  });

  await state.evaluate(draft);
  assert.equal(state.selectCandidate(candidateId), true);
  await state.mergeSelected();
  assert.deepEqual(state.value, {
    status: "failed",
    draft,
    matches: [match],
    error: failure,
  });
  assert.equal(committed, 0);
  await state.retry();
  assert.equal(state.value.status, "deciding");
  await state.saveNew();
  assert.equal(state.value.status, "idle");
  assert.equal(committed, 1);

  await state.evaluate(draft);
  state.cancel();
  assert.deepEqual(state.value, { status: "idle" });
});

test("snapshotはdeciding/failedだけを復元し、処理途中を再試行可能な失敗へ変換して不正値を拒否する", async () => {
  const state = createDuplicateMergeState({
    coordinator: {
      async evaluate() {
        return {
          ok: true,
          value: { kind: "decision-required", matches: [match] },
        };
      },
      async complete() {
        return { ok: false, error: { kind: "stale-decision" } };
      },
    },
    createMutationContext: () => context,
    onCommitted: async () => {},
  });
  const codec = createDuplicateMergeStateSnapshotCodec();

  await state.evaluate(draft);
  const snapshot = codec.capture(state.value);
  assert.ok(snapshot);
  assert.deepEqual(codec.restore(snapshot), { ok: true, value: state.value });
  assert.equal(codec.restore({ ...snapshot, version: 99 }).ok, false);
  assert.equal(
    codec.restore({
      ...snapshot,
      state: { ...state.value, matches: [{ ...match, candidateId: "bad" }] },
    }).ok,
    false,
  );

  const pending =
    deferred<Awaited<ReturnType<DuplicateMergeCoordinator["complete"]>>>();
  const committing = createDuplicateMergeState({
    coordinator: {
      async evaluate() {
        return {
          ok: true,
          value: { kind: "decision-required", matches: [match] },
        };
      },
      complete: async () => pending.promise,
    },
    createMutationContext: () => context,
    onCommitted: async () => {},
  });
  await committing.evaluate(draft);
  committing.selectCandidate(candidateId);
  const write = committing.mergeSelected();
  const interrupted = codec.capture(committing.value);
  assert.ok(interrupted);
  assert.equal(interrupted.state.status, "committing");
  const restored = codec.restore(interrupted);
  assert.equal(restored.ok && restored.value.status, "failed");
  assert.equal(
    restored.ok &&
      restored.value.status === "failed" &&
      restored.value.error.kind,
    "stale-decision",
  );
  pending.resolve({ ok: true, value: { kind: "source-added", candidateId } });
  await write;
});

test("snapshotはidleを保存・復元せず、処理途中の直接restoreとcanonical値検証をfail-closedに行う", async () => {
  const codec = createDuplicateMergeStateSnapshotCodec();
  assert.equal(codec.capture({ status: "idle" }), null);
  assert.deepEqual(codec.restore({ version: 1, state: { status: "idle" } }), {
    ok: false,
    error: { kind: "invalid-shape" },
  });
  assert.deepEqual(
    codec.restore({ version: 1, state: { status: "evaluating", draft } }),
    {
      ok: true,
      value: {
        status: "failed",
        draft,
        matches: [],
        error: { kind: "stale-decision" },
      },
    },
  );

  const valid = {
    version: 1,
    state: { status: "deciding", draft, matches: [match] },
  } as const;
  for (const corrupted of [
    {
      ...valid,
      state: {
        ...valid.state,
        matches: [
          { ...match, summary: { ...match.summary, category: "invalid" } },
        ],
      },
    },
    {
      ...valid,
      state: {
        ...valid.state,
        matches: [
          { ...match, summary: { ...match.summary, updatedAt: "yesterday" } },
        ],
      },
    },
    {
      ...valid,
      state: {
        ...valid.state,
        matches: [
          {
            ...match,
            summary: { ...match.summary, manufacturer: { original: 42 } },
          },
        ],
      },
    },
    {
      ...valid,
      state: {
        ...valid.state,
        matches: [
          { ...match, summary: { ...match.summary, unexpected: true } },
        ],
      },
    },
    {
      version: 1,
      state: {
        status: "failed",
        draft,
        matches: [match],
        error: { kind: "management", cause: { arbitrary: true } },
      },
    },
    {
      version: 1,
      state: {
        status: "failed",
        draft,
        matches: [match],
        error: {
          kind: "source-route",
          cause: {
            kind: "source-refresh",
            cause: { kind: "ambiguous-match", payload: "bad" },
          },
        },
      },
    },
  ])
    assert.equal(codec.restore(corrupted).ok, false);
});
