import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  err,
  ok,
  type Project,
  type ProjectId,
  type RequestId,
  type Revision,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import type {
  ProjectCatalogItem,
  ProjectContextSnapshot,
  ProjectLifecycleDataPort,
  ProjectLifecycleMutation,
  ProjectPreferencePort,
} from "../../src/project-context/contracts.js";
import {
  describeProjectLifecycleMessages,
  type ProjectLifecycleMessageDescriptor,
  type ProjectLifecycleOperation,
} from "../../src/project-context/lifecycle-message-descriptors.js";
import { createProjectLifecyclePresentationContribution } from "../../src/project-context/lifecycle-presentation.js";
import { createProjectLifecycleService } from "../../src/project-context/lifecycle-service.js";
import { createProjectLifecycleState } from "../../src/project-context/lifecycle-state.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { createProjectContextService } from "../../src/project-context/service.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;
const REQUEST = "99999999-9999-4999-8999-999999999999" as RequestId;
const TIME = "2026-08-13T01:00:00.000Z" as UtcTimestamp;
const unsafeName = '<em data-owned="false">Synthetic & unsafe</em>';
const project = (id: ProjectId, name: string): Project => ({
  id,
  name,
  createdAt: TIME,
  updatedAt: TIME,
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const lifecycleHarness = (initial: readonly Project[] = []) => {
  let projects = [...initial];
  let snapshot: ProjectContextSnapshot = projects.length
    ? {
        status: "ready",
        generation: 1,
        catalog: projects.map(({ id, name, updatedAt }) => ({
          id,
          name,
          updatedAt,
        })) as [ProjectCatalogItem, ...ProjectCatalogItem[]],
        selectedProjectId: projects[0]?.id as ProjectId,
      }
    : { status: "empty", generation: 1, catalog: [], selectedProjectId: null };
  let mutationFailure: "conflict" | undefined;
  let refreshFailures = 0;
  let refreshAttempts = 0;
  let authoritativeAfterMutation: readonly Project[] | undefined;
  let holdMutation = false;
  let releaseMutation: (() => void) | undefined;
  const mutations: ProjectLifecycleMutation[] = [];
  const refreshes: ProjectContextSnapshot[] = [];
  const listeners = new Set<(value: ProjectContextSnapshot) => void>();
  const data: ProjectLifecycleDataPort = {
    async createMutationContext() {
      return ok({ requestId: REQUEST, expectedRevision: 1 as Revision });
    },
    async find(projectId) {
      return ok(projects.find(({ id }) => id === projectId));
    },
    async mutate(operation) {
      mutations.push(operation);
      if (holdMutation) {
        await new Promise<void>((resolve) => {
          releaseMutation = resolve;
        });
      }
      if (mutationFailure !== undefined) return err({ kind: mutationFailure });
      if (authoritativeAfterMutation !== undefined) {
        projects = [...authoritativeAfterMutation];
      } else if (operation.kind === "create") projects.push(operation.project);
      else if (operation.kind === "update")
        projects = projects.map((item) =>
          item.id === operation.project.id ? operation.project : item,
        );
      else if (operation.kind === "delete")
        projects = projects.filter(({ id }) => id !== operation.projectId);
      return ok({ revision: 2 as Revision, replayed: false });
    },
  };
  const read = {
    getSnapshot: () => snapshot,
    subscribe(listener: (value: ProjectContextSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const context = {
    async refresh() {
      refreshAttempts += 1;
      if (refreshFailures > 0) {
        refreshFailures -= 1;
        return err({ kind: "context-unavailable" } as const);
      }
      const selected =
        snapshot.status === "ready" &&
        projects.some(({ id }) => id === snapshot.selectedProjectId)
          ? snapshot.selectedProjectId
          : (projects[0]?.id ?? null);
      snapshot = projects.length
        ? {
            status: "ready",
            generation: snapshot.generation + 1,
            catalog: projects.map(({ id, name, updatedAt }) => ({
              id,
              name,
              updatedAt,
            })) as [ProjectCatalogItem, ...ProjectCatalogItem[]],
            selectedProjectId: selected ?? (projects[0]?.id as ProjectId),
          }
        : {
            status: "empty",
            generation: snapshot.generation + 1,
            catalog: [],
            selectedProjectId: null,
          };
      refreshes.push(snapshot);
      for (const listener of [...listeners]) listener(snapshot);
      return ok(snapshot);
    },
  };
  const lifecycle = createProjectLifecycleService({
    data,
    context,
    createProjectId: () => B,
    now: () => TIME,
  });
  return {
    lifecycle,
    read,
    mutations,
    refreshes,
    get refreshAttempts() {
      return refreshAttempts;
    },
    failMutation() {
      mutationFailure = "conflict";
    },
    failRefresh(count = 1) {
      refreshFailures = count;
    },
    foundationCommitsAs(next: readonly Project[]) {
      authoritativeAfterMutation = next;
    },
    holdMutation() {
      holdMutation = true;
    },
    releaseMutation() {
      assert.ok(releaseMutation);
      releaseMutation();
      holdMutation = false;
    },
  };
};

test("8.3 lifecycle contract: create/rename/delete、failure、repair済み結果、single-flight、refresh-only retry", async () => {
  const validation = lifecycleHarness();
  assert.deepEqual(await validation.lifecycle.create(" \t "), {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  assert.equal(validation.mutations.length, 0);
  assert.equal(validation.refreshAttempts, 0);

  const created = lifecycleHarness();
  assert.equal((await created.lifecycle.create("  New project  ")).ok, true);
  assert.equal(created.mutations.length, 1);
  assert.equal(created.refreshes.length, 1);

  const renamed = lifecycleHarness([project(A, "Before")]);
  assert.equal((await renamed.lifecycle.rename(A, "After")).ok, true);
  assert.deepEqual(
    renamed.mutations.map(({ kind }) => kind),
    ["update"],
  );
  assert.equal(renamed.refreshes.length, 1);

  const repaired = lifecycleHarness([
    project(A, "Delete"),
    project(B, "Fallback"),
  ]);
  repaired.foundationCommitsAs([project(B, "Foundation repaired fallback")]);
  const deletion = await repaired.lifecycle.delete(A);
  assert.equal(deletion.ok, true);
  assert.deepEqual(repaired.mutations, [{ kind: "delete", projectId: A }]);
  assert.equal(repaired.refreshes.length, 1);
  if (deletion.ok) assert.equal(deletion.value.snapshot.selectedProjectId, B);

  const maintained = lifecycleHarness([
    project(A, "Selected"),
    project(B, "Non-selected"),
  ]);
  assert.equal((await maintained.lifecycle.delete(B)).ok, true);
  assert.equal(maintained.read.getSnapshot().selectedProjectId, A);
  assert.equal(maintained.mutations.length, 1);
  assert.equal(maintained.refreshAttempts, 1);

  const emptied = lifecycleHarness([project(A, "Only")]);
  assert.equal((await emptied.lifecycle.delete(A)).ok, true);
  assert.equal(emptied.read.getSnapshot().status, "empty");
  assert.equal(emptied.mutations.length, 1);
  assert.equal(emptied.refreshAttempts, 1);

  const failed = lifecycleHarness([project(A, "Keep")]);
  failed.failMutation();
  assert.deepEqual(await failed.lifecycle.delete(A), {
    ok: false,
    error: { kind: "conflict" },
  });
  assert.equal(failed.mutations.length, 1);
  assert.equal(failed.refreshAttempts, 0);

  const recovery = lifecycleHarness([project(A, "Committed")]);
  recovery.failRefresh(1);
  assert.deepEqual(await recovery.lifecycle.rename(A, "Committed rename"), {
    ok: false,
    error: { kind: "committed-refresh-failed" },
  });
  assert.equal(recovery.mutations.length, 1);
  assert.equal(recovery.refreshAttempts, 1);
  recovery.failRefresh(1);
  assert.deepEqual(await recovery.lifecycle.retryRefresh(), {
    ok: false,
    error: { kind: "context-unavailable" },
  });
  assert.deepEqual(await recovery.lifecycle.delete(A), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.equal(recovery.refreshAttempts, 2);
  assert.equal(recovery.mutations.length, 1);
  assert.equal((await recovery.lifecycle.retryRefresh()).ok, true);
  assert.equal(recovery.mutations.length, 1);
  assert.equal(recovery.refreshes.length, 1);
  assert.equal(recovery.refreshAttempts, 3);

  for (const operation of ["create", "delete"] as const) {
    const branch = lifecycleHarness(
      operation === "delete" ? [project(A, "Delete committed")] : [],
    );
    branch.failRefresh();
    const result =
      operation === "create"
        ? await branch.lifecycle.create("Create committed")
        : await branch.lifecycle.delete(A);
    assert.deepEqual(result, {
      ok: false,
      error: { kind: "committed-refresh-failed" },
    });
    assert.equal(branch.mutations.length, 1);
    assert.equal(branch.refreshAttempts, 1);
    assert.equal((await branch.lifecycle.retryRefresh()).ok, true);
    assert.equal(branch.mutations.length, 1);
    assert.equal(branch.refreshAttempts, 2);
  }

  const concurrent = lifecycleHarness();
  concurrent.holdMutation();
  const publicApi = createProjectContextPublicApi({
    service: createProjectContextService({
      catalog: createProjectCatalogProjection({
        async list() {
          return ok([]);
        },
      }),
      preference: createInMemoryProjectPreferencePort(),
    }),
    lifecycle: concurrent.lifecycle,
  });
  const first = publicApi.lifecycle.create("First");
  await Promise.resolve();
  assert.deepEqual(await publicApi.lifecycle.rename(A, "Second"), {
    ok: false,
    error: { kind: "operation-in-progress" },
  });
  assert.equal(concurrent.mutations.length, 1);
  concurrent.releaseMutation();
  assert.equal((await first).ok, true);
  assert.equal(concurrent.refreshes.length, 1);
});

const resolved = (descriptor: ProjectLifecycleMessageDescriptor) =>
  [
    descriptor.intent,
    "projectName" in descriptor ? descriptor.projectName : "",
    "impact" in descriptor ? descriptor.impact : "",
    "operation" in descriptor ? descriptor.operation : "",
    "reason" in descriptor ? descriptor.reason : "",
  ].join("|");

test("8.3 semantic descriptor matrix: validation/failure/retry/pending/actions preserve parameters and resolver consumption", () => {
  const base = {
    nameInput: "",
    editingProjectId: null,
    deletion: null,
    pending: false,
    fieldError: null,
    error: null,
  } as const;
  const cases: readonly {
    operation?: ProjectLifecycleOperation;
    snapshot: Parameters<
      typeof describeProjectLifecycleMessages
    >[0]["snapshot"];
  }[] = [
    {
      snapshot: {
        ...base,
        fieldError: "required",
        error: { kind: "validation", fields: { name: "required" } },
      },
    },
    { snapshot: { ...base, error: { kind: "conflict" } } },
    { snapshot: { ...base, error: { kind: "committed-refresh-failed" } } },
    {
      operation: "rename",
      snapshot: { ...base, pending: true, editingProjectId: A },
    },
    {
      operation: "delete",
      snapshot: {
        ...base,
        pending: true,
        deletion: { projectId: A, projectName: unsafeName },
      },
    },
  ];
  const descriptors = cases.flatMap(({ snapshot, operation }) =>
    describeProjectLifecycleMessages({
      snapshot,
      ...(operation === undefined ? {} : { operation }),
      projects: [{ id: A, name: unsafeName, updatedAt: TIME }],
    }),
  );
  descriptors.push(
    { intent: "confirm-delete-action" },
    { intent: "cancel-delete" },
    { intent: "save-project-name-action" },
  );
  const consumed = descriptors.map(resolved);
  assert.ok(consumed.includes("name-required||||"));
  assert.ok(consumed.includes("operation-failed||||conflict"));
  assert.ok(consumed.includes("retry-refresh||||"));
  assert.ok(consumed.includes("operation-pending|||rename|"));
  assert.ok(consumed.includes("operation-pending|||delete|"));
  assert.ok(
    consumed.includes(`confirm-delete|${unsafeName}|owned-candidates||`),
  );
  assert.ok(consumed.includes("confirm-delete-action||||"));
  assert.equal(consumed.length, descriptors.length);
});

test("8.3 DOM integration: role/label、keyboard/focus/pending、cancel、descriptor、safe text", async () => {
  const h = lifecycleHarness([project(A, unsafeName)]);
  h.holdMutation();
  const descriptors: ProjectLifecycleMessageDescriptor[] = [];
  const state = createProjectLifecycleState({
    read: h.read,
    lifecycle: h.lifecycle,
  });
  const contribution = createProjectLifecyclePresentationContribution({
    read: h.read,
    lifecycle: h.lifecycle,
    state,
    messages: {
      resolve(descriptor) {
        descriptors.push(descriptor);
        return resolved(descriptor);
      },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  let mounted!: ReturnType<typeof contribution.mount>;
  act(() => {
    mounted = contribution.mount(container);
  });
  if (!mounted.ok) assert.fail("mount should succeed");
  const ui = within(container);
  const user = userEvent.setup();
  const deleteDescriptor = {
    intent: "confirm-delete",
    projectName: unsafeName,
    impact: "owned-candidates",
  } as const;
  const deleteTrigger = ui.getByRole("button", {
    name: resolved(deleteDescriptor),
  });
  await user.click(deleteTrigger);
  const dialog = ui.getByRole("dialog", { name: resolved(deleteDescriptor) });
  assert.match(dialog.textContent ?? "", /owned-candidates/);
  assert.equal(container.querySelector("em"), null);
  assert.equal(
    document.activeElement,
    within(dialog).getByRole("button", {
      name: resolved({ intent: "cancel-delete" }),
    }),
  );
  await user.keyboard("{Escape}");
  assert.equal(ui.queryByRole("dialog"), null);
  assert.equal(document.activeElement, deleteTrigger);
  assert.equal(h.mutations.length, 0);

  const input = ui.getByRole("textbox", {
    name: resolved({ intent: "create-project" }),
  });
  await user.type(input, "Keyboard project");
  await user.keyboard("{Enter}");
  assert.match(
    ui.getByRole("status").textContent ?? "",
    /operation-pending\|\|\|create/,
  );
  assert.equal(input.getAttribute("disabled"), "");
  assert.ok(
    descriptors.some(
      (item) =>
        item.intent === "operation-pending" && item.operation === "create",
    ),
  );
  h.releaseMutation();
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(h.mutations.length, 1);
  assert.equal(h.refreshes.length, 1);
  act(() => mounted.ok && mounted.value.unmount());
});

test("8.3 combined contract: generation/fallback/forced notification/subscriber isolation remain intact", async () => {
  let entries = [project(A, "A"), project(B, "B")];
  const storedPreference = createInMemoryProjectPreferencePort();
  const preferenceWrites: ProjectId[] = [];
  let preferenceClears = 0;
  const preference: ProjectPreferencePort = {
    read: () => storedPreference.read(),
    async write(projectId) {
      preferenceWrites.push(projectId);
      return storedPreference.write(projectId);
    },
    async clear() {
      preferenceClears += 1;
      return storedPreference.clear();
    },
  };
  const context = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok(
          entries.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
        );
      },
    }),
    preference,
  });
  const api = createProjectContextPublicApi({ service: context });
  const seen: number[] = [];
  api.read.subscribe(() => {
    throw new Error("isolated subscriber");
  });
  api.read.subscribe((snapshot) => seen.push(snapshot.generation));
  await api.commands.refresh();
  await api.commands.select(B);
  let forced = 0;
  api.guards.register({
    id: "lifecycle-contract-observer",
    async evaluate() {
      return ok({ kind: "allow" });
    },
    notifyForced(change) {
      forced += 1;
      assert.equal(change.cause, "catalog-invalidated");
    },
  });
  entries = [project(A, "A")];
  await api.commands.refresh();
  assert.equal(api.read.getSnapshot().selectedProjectId, A);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(forced, 1);
  assert.deepEqual(preferenceWrites, [A, B, A]);
  assert.equal(preferenceClears, 0);
  entries = [];
  await api.commands.refresh();
  assert.equal(api.read.getSnapshot().status, "empty");
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.deepEqual(preferenceWrites, [A, B, A]);
  assert.equal(preferenceClears, 1);
  assert.equal(forced, 2);
  const replacement = await api.replacementGuard.prepare();
  assert.ok(replacement.ok && replacement.value.kind === "permitted");
  if (!replacement.ok || replacement.value.kind !== "permitted") return;
  assert.ok(api.replacementGuard.begin(replacement.value.permit.id).ok);
  await api.replacementGuard.complete(replacement.value.permit.id, "failed");
  assert.equal(forced, 2);
});
