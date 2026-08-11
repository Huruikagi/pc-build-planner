import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
  CurrentProjectPort,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const projectId = "10000000-0000-4000-8000-000000000071" as Uuid as ProjectId;
const timestamp = "2026-08-10T00:00:00.000Z" as UtcTimestamp;
const pending: UnresolvedCandidateEditorPrefill = {
  draft: {
    category: "uncategorized",
    product: { name: { original: "架空の回復待ち候補" } },
    normalizedAttributes: { category: "uncategorized" },
  },
};

const query: CandidateManagementQuery = {
  async listProjects() {
    return {
      ok: true,
      value: [{ id: projectId, name: "架空", updatedAt: timestamp }],
    };
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    return { ok: false, error: { kind: "not-found", entity: "candidate" } };
  },
};

test("project mutation失敗時はcontext refreshせず既存表示を保持する", async () => {
  let creates = 0;
  let renames = 0;
  let deletes = 0;
  let refreshes = 0;
  let deleteShouldFail = true;
  const currentProject: CurrentProjectPort = {
    getCurrentProject: () => ({ status: "resolved", projectId }),
    subscribe: () => () => {},
    async refresh() {
      refreshes += 1;
      return { ok: true, value: { status: "resolved", projectId } };
    },
  };
  const service = {
    async createProject() {
      creates += 1;
      return { ok: false as const, error: { kind: "storage" as const } };
    },
    async renameProject() {
      renames += 1;
      return { ok: false as const, error: { kind: "storage" as const } };
    },
    async deleteProject() {
      deletes += 1;
      return deleteShouldFail
        ? { ok: false as const, error: { kind: "storage" as const } }
        : { ok: true as const, value: undefined };
    },
  } as unknown as CandidateManagementService;
  const state = createManagementState({
    query,
    service,
    currentProject,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000070" as never,
      expectedRevision: 0 as never,
    }),
  });
  await state.load();
  const projectsBefore = state.value.projects;

  await state.createProject("失敗する作成");
  assert.equal(creates, 1);
  assert.equal(refreshes, 0);
  assert.deepEqual(state.value.projects, projectsBefore);
  assert.equal(state.value.isSaving, false);
  assert.equal(state.value.displayError?.code, "storage");

  await state.renameProject(projectId, "失敗する改名");
  assert.equal(renames, 1);
  assert.equal(refreshes, 0);
  assert.deepEqual(state.value.projects, projectsBefore);
  assert.equal(state.value.isSaving, false);
  assert.equal(state.value.displayError?.code, "storage");

  state.requestDeletion({ kind: "project", projectId });
  await state.confirmDeletion();
  assert.equal(deletes, 1);
  assert.equal(refreshes, 0);
  assert.deepEqual(state.value.projects, projectsBefore);
  assert.deepEqual(state.value.deletion, { kind: "project", projectId });
  assert.equal(state.value.isSaving, false);
  assert.equal(state.value.displayError?.code, "storage");

  deleteShouldFail = false;
  await state.confirmDeletion();
  assert.equal(deletes, 2);
  assert.equal(refreshes, 1);
  assert.equal(state.value.deletion, null);
});

test("project作成後のrefresh失敗はdraftを保持し、回復操作はmutationを再送しない", async () => {
  let creates = 0;
  let refreshes = 0;
  let current: ProjectId | null = null;
  const currentProject: CurrentProjectPort = {
    getCurrentProject: () =>
      current === null
        ? { status: "unresolved" }
        : { status: "resolved", projectId: current },
    subscribe: () => () => {},
    async refresh() {
      refreshes += 1;
      if (refreshes === 1)
        return { ok: false, error: { kind: "context-unavailable" } };
      current = projectId;
      return { ok: true, value: { status: "resolved", projectId } };
    },
  };
  const service = {
    async createProject() {
      creates += 1;
      return {
        ok: true as const,
        value: {
          id: projectId,
          name: "架空",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
    },
  } as unknown as CandidateManagementService;
  const state = createManagementState({
    query,
    service,
    currentProject,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000071" as never,
      expectedRevision: 0 as never,
    }),
  });
  state.holdPendingPreEdit(pending);

  await state.createProject("架空");
  assert.equal(creates, 1);
  assert.equal(refreshes, 1);
  assert.deepEqual(state.value.pendingPreEdit, pending);
  assert.deepEqual(state.value.displayError, {
    code: "context-refresh-failed",
  });

  await state.retryContextRefresh();
  assert.equal(creates, 1);
  assert.equal(refreshes, 2);
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor?.projectId, projectId);
});

test("project削除は確認取消でmutationせず、確定後のforced通知でも旧draftを保持する", async () => {
  let deletes = 0;
  let refreshes = 0;
  let state: ReturnType<typeof createManagementState>;
  const currentProject: CurrentProjectPort = {
    getCurrentProject: () => ({ status: "unresolved" }),
    subscribe: () => () => {},
    async refresh() {
      refreshes += 1;
      state.preserveDraftAfterForcedSwitch(projectId);
      return { ok: true, value: { status: "unresolved" } };
    },
  };
  const service = {
    async deleteProject() {
      deletes += 1;
      return { ok: true as const, value: undefined };
    },
  } as unknown as CandidateManagementService;
  state = createManagementState({
    query,
    service,
    currentProject,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000072" as never,
      expectedRevision: 0 as never,
    }),
  });
  state.beginCreate({
    projectId,
    category: "uncategorized",
    product: { name: { original: "削除後も保持する入力" } },
    normalizedAttributes: { category: "uncategorized" },
  });

  state.requestDeletion({ kind: "project", projectId });
  state.cancelDeletion();
  assert.equal(deletes, 0);
  assert.equal(refreshes, 0);
  assert.equal(state.value.editor?.projectId, projectId);

  state.requestDeletion({ kind: "project", projectId });
  await state.confirmDeletion();
  assert.equal(deletes, 1);
  assert.equal(refreshes, 1);
  assert.equal(state.value.editor?.projectId, projectId);
  assert.equal(
    state.value.editor?.draft.product.name.original,
    "削除後も保持する入力",
  );
  assert.deepEqual(state.value.projectChangedWithDraft, { from: projectId });
  assert.equal(state.value.displayError?.code, "project-changed-with-draft");
});

test("project削除後のforced通知でもpending pre-editを保持する", async () => {
  let state: ReturnType<typeof createManagementState>;
  const currentProject: CurrentProjectPort = {
    getCurrentProject: () => ({ status: "unresolved" }),
    subscribe: () => () => {},
    async refresh() {
      state.preserveDraftAfterForcedSwitch(projectId);
      return { ok: true, value: { status: "unresolved" } };
    },
  };
  const service = {
    async deleteProject() {
      return { ok: true as const, value: undefined };
    },
  } as unknown as CandidateManagementService;
  state = createManagementState({
    query,
    service,
    currentProject,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000073" as never,
      expectedRevision: 0 as never,
    }),
  });
  state.holdPendingPreEdit(pending);

  state.requestDeletion({ kind: "project", projectId });
  await state.confirmDeletion();

  assert.deepEqual(state.value.pendingPreEdit, pending);
  assert.equal(state.value.editor, null);
  assert.deepEqual(state.value.projectChangedWithDraft, { from: projectId });
  assert.equal(state.value.displayError?.code, "project-changed-with-draft");
  assert.equal(state.value.mutationsDisabled, true);

  state.cancelPendingPreEdit();

  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.projectChangedWithDraft, null);
  assert.equal(state.value.mutationsDisabled, false);
  assert.equal(state.value.displayError?.code, "project-required");
});
