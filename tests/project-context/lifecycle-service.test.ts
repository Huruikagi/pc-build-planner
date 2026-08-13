import assert from "node:assert/strict";
import test from "node:test";
import type {
  Project,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
} from "../../src/domain/public.js";
import type {
  ProjectContextSnapshot,
  ProjectLifecycleDataPort,
  ProjectLifecycleMutation,
} from "../../src/project-context/contracts.js";
import { createProjectLifecycleService } from "../../src/project-context/lifecycle-service.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;
const requestId = "99999999-9999-4999-8999-999999999999" as RequestId;
const createdAt = "2026-08-13T01:00:00.000Z" as UtcTimestamp;
const renamedAt = "2026-08-13T02:00:00.000Z" as UtcTimestamp;

const snapshot = (project: Project): ProjectContextSnapshot => ({
  status: "ready",
  generation: 1,
  catalog: [
    { id: project.id, name: project.name, updatedAt: project.updatedAt },
  ],
  selectedProjectId: project.id,
});

const harness = (initial?: Project) => {
  let stored = initial;
  const mutations: ProjectLifecycleMutation[] = [];
  let refreshes = 0;
  const data: ProjectLifecycleDataPort = {
    async createMutationContext() {
      return {
        ok: true,
        value: { requestId, expectedRevision: 0 as Revision },
      };
    },
    async find(projectId) {
      return { ok: true, value: stored?.id === projectId ? stored : undefined };
    },
    async mutate(operation) {
      mutations.push(operation);
      if (operation.kind !== "delete") stored = operation.project;
      return {
        ok: true,
        value: { revision: 1 as Revision, replayed: false },
      };
    },
  };
  const context = {
    async refresh() {
      refreshes += 1;
      if (stored === undefined)
        return {
          ok: true as const,
          value: {
            status: "empty" as const,
            generation: 1,
            catalog: [] as const,
            selectedProjectId: null,
          },
        };
      return { ok: true as const, value: snapshot(stored) };
    },
  };
  return {
    data,
    context,
    mutations,
    get refreshes() {
      return refreshes;
    },
  };
};

test("createは名前をtrimし注入ID/日時で一回保存してemptyから作成projectを選択する", async () => {
  const h = harness();
  const service = createProjectLifecycleService({
    data: h.data,
    context: h.context,
    createProjectId: () => A,
    now: () => createdAt,
  });

  const result = await service.create("  Synthetic build  ");

  assert.equal(result.ok, true);
  assert.deepEqual(h.mutations, [
    {
      kind: "create",
      project: {
        id: A,
        name: "Synthetic build",
        createdAt,
        updatedAt: createdAt,
      },
    },
  ]);
  assert.equal(h.refreshes, 1);
  if (result.ok) {
    assert.equal(result.value.projectId, A);
    assert.equal(result.value.snapshot.status, "ready");
    assert.equal(result.value.snapshot.selectedProjectId, A);
  }
});

test("renameはcreatedAtを保ち注入日時とtrim名で同じIDを一回更新する", async () => {
  const original: Project = {
    id: A,
    name: "Before",
    createdAt,
    updatedAt: createdAt,
  };
  const h = harness(original);
  const service = createProjectLifecycleService({
    data: h.data,
    context: h.context,
    createProjectId: () => A,
    now: () => renamedAt,
  });

  const result = await service.rename(A, "  After  ");
  const updatedProject: Project = {
    ...original,
    name: "After",
    updatedAt: renamedAt,
  };

  assert.deepEqual(h.mutations, [
    {
      kind: "update",
      project: updatedProject,
    },
  ]);
  assert.equal(h.refreshes, 1);
  assert.deepEqual(result, {
    ok: true,
    value: { projectId: A, snapshot: snapshot(updatedProject) },
  });
});

test("空白名はfield validation failureでquery/mutation/refreshを行わない", async () => {
  const h = harness();
  const service = createProjectLifecycleService({
    data: h.data,
    context: h.context,
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.create(" \t "), {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  assert.equal(h.mutations.length, 0);
  assert.equal(h.refreshes, 0);
});

test("並行commandはmutation前にoperation-in-progressとして拒否する", async () => {
  let release: (() => void) | undefined;
  const h = harness();
  const data: ProjectLifecycleDataPort = {
    ...h.data,
    async mutate(operation, context) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return h.data.mutate(operation, context);
    },
  };
  const service = createProjectLifecycleService({
    data,
    context: h.context,
    createProjectId: () => A,
    now: () => createdAt,
  });

  const first = service.create("First");
  await Promise.resolve();
  assert.deepEqual(await service.rename(A, "Second"), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.equal(h.mutations.length, 0);
  assert.ok(release);
  release();
  assert.equal((await first).ok, true);
  assert.equal(h.mutations.length, 1);
});

test("mutation failureはrefreshせず同じcommandを再送しない", async () => {
  const h = harness();
  let calls = 0;
  const service = createProjectLifecycleService({
    data: {
      ...h.data,
      async mutate() {
        calls += 1;
        return { ok: false, error: { kind: "conflict" } };
      },
    },
    context: h.context,
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.create("Synthetic"), {
    ok: false,
    error: { kind: "conflict" },
  });
  assert.equal(calls, 1);
  assert.equal(h.refreshes, 0);
});

test("confirmed deleteはdata portへ一回委譲し成功後のcontext snapshotを解釈せず返す", async () => {
  const original: Project = {
    id: A,
    name: "Deleted",
    createdAt,
    updatedAt: createdAt,
  };
  const h = harness(original);
  const fallback: ProjectContextSnapshot = {
    status: "ready",
    generation: 2,
    catalog: [{ id: B, name: "First remaining", updatedAt: renamedAt }],
    selectedProjectId: B,
  };
  const service = createProjectLifecycleService({
    data: h.data,
    context: {
      async refresh() {
        return { ok: true, value: fallback };
      },
    },
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.delete(A), {
    ok: true,
    value: { projectId: A, snapshot: fallback },
  });
  assert.deepEqual(h.mutations, [{ kind: "delete", projectId: A }]);
});

test("non-current deleteはcontext refreshが維持したcurrentをそのまま返す", async () => {
  const current: Project = {
    id: A,
    name: "Current",
    createdAt,
    updatedAt: createdAt,
  };
  const maintained = snapshot(current);
  const h = harness(current);
  const service = createProjectLifecycleService({
    data: h.data,
    context: {
      async refresh() {
        return { ok: true, value: maintained };
      },
    },
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.delete(B), {
    ok: true,
    value: { projectId: B, snapshot: maintained },
  });
  assert.deepEqual(h.mutations, [{ kind: "delete", projectId: B }]);
});

test("delete mutation failureはrefreshせず、失敗値を安定したerrorとして返す", async () => {
  let refreshes = 0;
  let mutations = 0;
  const h = harness();
  const service = createProjectLifecycleService({
    data: {
      ...h.data,
      async mutate() {
        mutations += 1;
        return { ok: false, error: { kind: "conflict" } };
      },
    },
    context: {
      async refresh() {
        refreshes += 1;
        return h.context.refresh();
      },
    },
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.delete(A), {
    ok: false,
    error: { kind: "conflict" },
  });
  assert.equal(mutations, 1);
  assert.equal(refreshes, 0);
});

test("delete commit後のrefresh failureはdeleteを再送せずrefresh-only retryでemptyへ回復する", async () => {
  const h = harness();
  let refreshes = 0;
  let releaseRetry: (() => void) | undefined;
  const service = createProjectLifecycleService({
    data: h.data,
    context: {
      async refresh() {
        refreshes += 1;
        if (refreshes === 1)
          return { ok: false, error: { kind: "context-unavailable" } };
        await new Promise<void>((resolve) => {
          releaseRetry = resolve;
        });
        return {
          ok: true,
          value: {
            status: "empty",
            generation: 2,
            catalog: [],
            selectedProjectId: null,
          },
        };
      },
    },
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.delete(A), {
    ok: false,
    error: { kind: "committed-refresh-failed" },
  });
  assert.deepEqual(h.mutations, [{ kind: "delete", projectId: A }]);
  assert.deepEqual(await service.delete(A), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });

  const retry = service.retryRefresh();
  await Promise.resolve();
  assert.deepEqual(await service.retryRefresh(), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.ok(releaseRetry);
  releaseRetry();
  assert.deepEqual(await retry, {
    ok: true,
    value: {
      status: "empty",
      generation: 2,
      catalog: [],
      selectedProjectId: null,
    },
  });
  assert.deepEqual(h.mutations, [{ kind: "delete", projectId: A }]);
});

test("commit後refresh failureはretry成功までcommandを封鎖しrefreshだけを再試行する", async () => {
  const h = harness();
  let refreshes = 0;
  let finds = 0;
  let releaseSuccessfulRetry: (() => void) | undefined;
  const service = createProjectLifecycleService({
    data: {
      ...h.data,
      async find(projectId) {
        finds += 1;
        return h.data.find(projectId);
      },
    },
    context: {
      async refresh() {
        refreshes += 1;
        if (refreshes <= 2)
          return { ok: false, error: { kind: "context-unavailable" } };
        if (refreshes === 3)
          await new Promise<void>((resolve) => {
            releaseSuccessfulRetry = resolve;
          });
        return h.context.refresh();
      },
    },
    createProjectId: () => A,
    now: () => createdAt,
  });

  assert.deepEqual(await service.create("Synthetic"), {
    ok: false,
    error: { kind: "committed-refresh-failed" },
  });
  assert.equal(h.mutations.length, 1);
  assert.deepEqual(await service.create("Must not replay"), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.deepEqual(await service.rename(A, "Must not lookup"), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.equal(h.mutations.length, 1);
  assert.equal(finds, 0);
  assert.equal(refreshes, 1);

  assert.deepEqual(await service.retryRefresh(), {
    ok: false,
    error: { kind: "context-unavailable" },
  });
  assert.deepEqual(await service.create("Still blocked"), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.equal(h.mutations.length, 1);

  const retry = service.retryRefresh();
  await Promise.resolve();
  assert.deepEqual(await service.create("Blocked during retry"), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.ok(releaseSuccessfulRetry);
  releaseSuccessfulRetry();
  const recovered = await retry;
  assert.equal(recovered.ok, true);
  assert.equal(h.mutations.length, 1);
  assert.equal(refreshes, 3);

  assert.equal((await service.create("Allowed after recovery")).ok, true);
  assert.equal(h.mutations.length, 2);
  assert.equal(refreshes, 4);
});
