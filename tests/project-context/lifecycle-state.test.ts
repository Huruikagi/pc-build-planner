import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectId,
  Result,
  UtcTimestamp,
} from "../../src/domain/public.js";
import type { ProjectContextSnapshot } from "../../src/project-context/contracts.js";
import type {
  ProjectLifecycleCommandResult,
  ProjectLifecycleError,
  ProjectLifecycleRefreshError,
  ProjectLifecycleService,
} from "../../src/project-context/lifecycle-service.js";
import {
  createProjectLifecycleState,
  type ProjectLifecycleStateSnapshot,
} from "../../src/project-context/lifecycle-state.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;
const updatedAt = "2026-08-13T01:00:00.000Z" as UtcTimestamp;

const ready = (nameA = "Alpha"): ProjectContextSnapshot => ({
  status: "ready",
  generation: 4,
  catalog: [
    { id: A, name: nameA, updatedAt },
    { id: B, name: "Beta", updatedAt },
  ],
  selectedProjectId: A,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const harness = () => {
  let context = ready();
  const calls: string[] = [];
  let nextCommand: Result<
    ProjectLifecycleCommandResult,
    ProjectLifecycleError
  > = {
    ok: true,
    value: { projectId: A, snapshot: context },
  };
  let nextRefresh: Result<
    ProjectContextSnapshot,
    ProjectLifecycleRefreshError
  > = {
    ok: true,
    value: context,
  };
  let commandWait:
    | ReturnType<
        typeof deferred<
          Result<ProjectLifecycleCommandResult, ProjectLifecycleError>
        >
      >
    | undefined;
  const service: ProjectLifecycleService = {
    async create(name) {
      calls.push(`create:${name}`);
      return commandWait?.promise ?? nextCommand;
    },
    async rename(projectId, name) {
      calls.push(`rename:${projectId}:${name}`);
      return commandWait?.promise ?? nextCommand;
    },
    async delete(projectId) {
      calls.push(`delete:${projectId}`);
      return commandWait?.promise ?? nextCommand;
    },
    async retryRefresh() {
      calls.push("refresh");
      return nextRefresh;
    },
  };
  const state = createProjectLifecycleState({
    read: {
      getSnapshot: () => context,
      subscribe: () => () => {},
    },
    lifecycle: service,
  });
  return {
    state,
    calls,
    setContext(value: ProjectContextSnapshot) {
      context = value;
    },
    setCommand(
      value: Result<ProjectLifecycleCommandResult, ProjectLifecycleError>,
    ) {
      nextCommand = value;
    },
    setRefresh(
      value: Result<ProjectContextSnapshot, ProjectLifecycleRefreshError>,
    ) {
      nextRefresh = value;
    },
    pauseCommand() {
      commandWait = deferred();
      return commandWait;
    },
  };
};

test("create/rename success transitions clear drafts without candidate state", async () => {
  const h = harness();
  h.state.setNameInput(" New build ");
  await h.state.submitCreate();
  assert.deepEqual(h.calls, ["create: New build "]);
  assert.deepEqual(h.state.getSnapshot(), {
    nameInput: "",
    editingProjectId: null,
    deletion: null,
    pending: false,
    fieldError: null,
    error: null,
  });

  assert.deepEqual(h.state.beginRename(B), { ok: true, value: undefined });
  assert.equal(h.state.getSnapshot().nameInput, "Beta");
  h.state.setNameInput("Renamed");
  await h.state.submitRename();
  assert.equal(h.calls.at(-1), `rename:${B}:Renamed`);
  assert.equal(h.state.getSnapshot().editingProjectId, null);
});

test("delete request fixes current catalog id/name and cancel calls no service", () => {
  const h = harness();
  assert.deepEqual(h.state.requestDelete(A), { ok: true, value: undefined });
  h.setContext(ready("Changed later"));
  assert.deepEqual(h.state.getSnapshot().deletion, {
    projectId: A,
    projectName: "Alpha",
  });
  h.state.cancelDelete();
  assert.equal(h.state.getSnapshot().deletion, null);
  assert.deepEqual(h.calls, []);
});

test("rename cancel clears only lifecycle draft and target without service calls", () => {
  const h = harness();
  assert.deepEqual(h.state.beginRename(A), { ok: true, value: undefined });
  h.state.setNameInput("discarded rename");
  h.state.cancelRename();
  assert.equal(h.state.getSnapshot().editingProjectId, null);
  assert.equal(h.state.getSnapshot().nameInput, "");
  assert.deepEqual(h.calls, []);
});

test("stale rename/delete targets are rejected from the current catalog", () => {
  const h = harness();
  h.setContext({
    status: "empty",
    generation: 5,
    catalog: [],
    selectedProjectId: null,
  });
  assert.deepEqual(h.state.beginRename(A), {
    ok: false,
    error: { kind: "project-not-found" },
  });
  assert.deepEqual(h.state.requestDelete(A), {
    ok: false,
    error: { kind: "project-not-found" },
  });
});

test("rename target removed after begin is rejected at submit without losing target state", async () => {
  const h = harness();
  assert.deepEqual(h.state.beginRename(A), { ok: true, value: undefined });
  h.state.setNameInput("Still editable");
  h.setContext({
    status: "ready",
    generation: 5,
    catalog: [{ id: B, name: "Beta", updatedAt }],
    selectedProjectId: B,
  });

  await h.state.submitRename();

  assert.deepEqual(h.calls, []);
  assert.equal(h.state.getSnapshot().error?.kind, "not-found");
  assert.equal(h.state.getSnapshot().editingProjectId, A);
  assert.equal(h.state.getSnapshot().nameInput, "Still editable");
});

test("delete target removed after confirmation snapshot is rejected without losing confirmation", async () => {
  const h = harness();
  assert.deepEqual(h.state.requestDelete(A), { ok: true, value: undefined });
  const confirmation = h.state.getSnapshot().deletion;
  h.setContext({
    status: "ready",
    generation: 5,
    catalog: [{ id: B, name: "Beta", updatedAt }],
    selectedProjectId: B,
  });

  await h.state.confirmDelete();

  assert.deepEqual(h.calls, []);
  assert.equal(h.state.getSnapshot().error?.kind, "not-found");
  assert.deepEqual(h.state.getSnapshot().deletion, confirmation);
});

test("validation and service single-flight failures remain observable", async () => {
  const h = harness();
  h.setCommand({
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  await h.state.submitCreate();
  assert.equal(h.state.getSnapshot().fieldError, "required");
  assert.equal(h.state.getSnapshot().error?.kind, "validation");

  h.setCommand({ ok: false, error: { kind: "operation-in-progress" } });
  h.state.setNameInput("valid");
  await h.state.submitCreate();
  assert.equal(h.state.getSnapshot().error?.kind, "operation-in-progress");
});

test("pending disables duplicate controls and delete confirm submits the fixed id once", async () => {
  const h = harness();
  h.state.requestDelete(A);
  const wait = h.pauseCommand();
  const confirming = h.state.confirmDelete();
  await Promise.resolve();
  assert.equal(h.state.getSnapshot().pending, true);
  h.state.setNameInput("ignored");
  await h.state.submitCreate();
  h.state.cancelDelete();
  assert.deepEqual(h.calls, [`delete:${A}`]);
  assert.notEqual(h.state.getSnapshot().deletion, null);
  wait.resolve({ ok: true, value: { projectId: A, snapshot: ready() } });
  await confirming;
  assert.equal(h.state.getSnapshot().pending, false);
  assert.equal(h.state.getSnapshot().deletion, null);
});

test("committed refresh failure locks mutations and retry never replays the mutation", async () => {
  const h = harness();
  h.setCommand({ ok: false, error: { kind: "committed-refresh-failed" } });
  h.state.setNameInput("Committed");
  await h.state.submitCreate();
  assert.equal(h.state.getSnapshot().error?.kind, "committed-refresh-failed");

  await h.state.submitCreate();
  assert.deepEqual(h.calls, ["create:Committed"]);
  h.setRefresh({ ok: false, error: { kind: "context-unavailable" } });
  await h.state.retryRefresh();
  assert.deepEqual(h.calls, ["create:Committed", "refresh"]);
  assert.equal(h.state.getSnapshot().error?.kind, "committed-refresh-failed");

  h.setRefresh({ ok: true, value: ready() });
  await h.state.retryRefresh();
  assert.deepEqual(h.calls, ["create:Committed", "refresh", "refresh"]);
  assert.equal(h.state.getSnapshot().error, null);
});

test("snapshots are immutable and listener failure/unsubscribe are isolated", () => {
  const h = harness();
  const seen: ProjectLifecycleStateSnapshot[] = [];
  h.state.subscribe(() => {
    throw new Error("synthetic listener failure");
  });
  const unsubscribe = h.state.subscribe((value) => seen.push(value));
  h.state.setNameInput("one");
  unsubscribe();
  h.state.setNameInput("two");
  assert.equal(seen.length, 1);
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.equal(Object.isFrozen(h.state.getSnapshot()), true);
});
