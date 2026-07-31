import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  Project,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementQuery,
  CandidateManagementService,
  ManagementError,
  MutationContext,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const createdProjectId =
  "10000000-0000-4000-8000-000000000023" as Uuid as ProjectId;
const existingProjectId =
  "10000000-0000-4000-8000-000000000024" as Uuid as ProjectId;
const existingCandidateId =
  "30000000-0000-4000-8000-000000000024" as Uuid as CandidatePartId;
const timestamp = "2026-07-28T00:00:00.000Z" as UtcTimestamp;
const context: MutationContext = {
  requestId: "20000000-0000-4000-8000-000000000023" as Uuid as RequestId,
  expectedRevision: 0 as Revision,
};

const prefill = (name: string): UnresolvedCandidateEditorPrefill => ({
  draft: {
    category: "uncategorized",
    product: { name: { original: name } },
    normalizedAttributes: { category: "uncategorized" },
  },
});

const project = (name: string): Project => ({
  id: createdProjectId,
  name,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const unusedQuery = (): CandidateManagementQuery => ({
  async listProjects() {
    throw new Error("project 作成結果の解決で再一覧取得してはならない");
  },
  async listCandidates() {
    throw new Error("project 作成結果の解決で候補一覧を取得してはならない");
  },
  async getCandidateDraft() {
    throw new Error("not used");
  },
  async listBuildEligible() {
    throw new Error("not used");
  },
});

const serviceWithCreate = (
  createProject: CandidateManagementService["createProject"],
): CandidateManagementService => ({
  createProject,
  async renameProject() {
    throw new Error("not used");
  },
  async deleteProject() {
    throw new Error("not used");
  },
  async createCandidate() {
    throw new Error("not used");
  },
  async updateCandidate() {
    throw new Error("not used");
  },
  async deleteCandidate() {
    throw new Error("not used");
  },
});

const createState = (
  createProject: CandidateManagementService["createProject"],
) =>
  createManagementState({
    query: unusedQuery(),
    service: serviceWithCreate(createProject),
    createMutationContext: () => context,
  });

test("project 作成結果の ProjectId を pending draft へ直接適用して editor を開く", async () => {
  const pending = prefill("架空の抽出候補");
  const state = createState(async () => ({
    ok: true,
    value: project("架空プロジェクト"),
  }));
  state.holdPendingPreEdit(pending);

  await state.createProject("架空プロジェクト");

  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.selectedProjectId, createdProjectId);
  assert.deepEqual(state.value.editor, {
    mode: "create",
    projectId: createdProjectId,
    draft: { ...pending.draft, projectId: createdProjectId },
  });
});

test("project 作成失敗では pending draft と再試行入力を保持し、成功時だけ editor へ移す", async () => {
  const inputs: string[] = [];
  let attempt = 0;
  const pending = prefill("再試行する架空候補");
  const state = createState(async (input) => {
    inputs.push(input.name);
    attempt += 1;
    return attempt === 1
      ? { ok: false, error: { kind: "storage" } satisfies ManagementError }
      : { ok: true, value: project(input.name) };
  });
  state.holdPendingPreEdit(pending);

  await state.createProject("保持する入力");
  assert.equal(state.value.pendingPreEdit, pending);
  assert.deepEqual(state.value.displayError, { code: "storage" });

  await state.createProject("保持する入力");
  assert.deepEqual(inputs, ["保持する入力", "保持する入力"]);
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(
    state.value.editor?.draft.product.name.original,
    "再試行する架空候補",
  );
});

test("pending project 作成後も既存projectの候補cacheを保持する", async () => {
  const query: CandidateManagementQuery = {
    async listProjects() {
      return {
        ok: true,
        value: [
          {
            id: existingProjectId,
            name: "既存の架空プロジェクト",
            updatedAt: timestamp,
          },
        ],
      };
    },
    async listCandidates() {
      return {
        ok: true,
        value: [
          {
            id: existingCandidateId,
            projectId: existingProjectId,
            category: "uncategorized",
            name: { original: "既存の架空候補" },
            hasMissingDetails: true,
            updatedAt: timestamp,
          },
        ],
      };
    },
    async getCandidateDraft() {
      throw new Error("not used");
    },
    async listBuildEligible() {
      throw new Error("not used");
    },
  };
  const state = createManagementState({
    query,
    service: serviceWithCreate(async () => ({
      ok: true,
      value: project("新しい架空プロジェクト"),
    })),
    createMutationContext: () => context,
  });
  await state.load();
  const pending = prefill("新しい架空候補");
  state.holdPendingPreEdit(pending);

  await state.createProject("新しい架空プロジェクト");
  assert.equal(state.value.candidates.length, 0);

  await state.selectProject(existingProjectId);
  assert.equal(state.value.candidates[0]?.id, existingCandidateId);
});

test("project 作成中の新しい pre-edit activation を成功した project で解決する", async () => {
  let complete!: (value: {
    readonly ok: true;
    readonly value: Project;
  }) => void;
  const delayed = new Promise<{ readonly ok: true; readonly value: Project }>(
    (resolve) => {
      complete = resolve;
    },
  );
  const oldPending = prefill("古い架空候補");
  const newPending = prefill("新しい架空候補");
  const state = createState(async () => delayed);
  state.holdPendingPreEdit(oldPending);

  const creation = state.createProject("古い作成入力");
  await Promise.resolve();
  state.holdPendingPreEdit(newPending);
  complete({ ok: true, value: project("古い作成入力") });
  await creation;

  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.projects.length, 1);
  assert.equal(state.value.projects[0]?.id, createdProjectId);
  assert.equal(state.value.selectedProjectId, createdProjectId);
  assert.deepEqual(state.value.editor, {
    mode: "create",
    projectId: createdProjectId,
    draft: { ...newPending.draft, projectId: createdProjectId },
  });
  assert.equal(state.value.isSaving, false);
});

test("project 作成中の古い失敗は新しい pre-edit activation の状態を変更しない", async () => {
  let complete!: (value: {
    readonly ok: false;
    readonly error: ManagementError;
  }) => void;
  const delayed = new Promise<{
    readonly ok: false;
    readonly error: ManagementError;
  }>((resolve) => {
    complete = resolve;
  });
  const oldPending = prefill("古い失敗対象の架空候補");
  const newPending = prefill("新しい架空候補");
  const newEditorDraft: CandidateDraft = {
    ...newPending.draft,
    projectId: createdProjectId,
  };
  const state = createState(async () => delayed);
  state.holdPendingPreEdit(oldPending);

  const creation = state.createProject("古い失敗対象の入力");
  await Promise.resolve();
  state.holdPendingPreEdit(newPending);
  state.beginCreate(newEditorDraft);
  complete({ ok: false, error: { kind: "storage" } });
  await creation;

  assert.equal(state.value.pendingPreEdit, newPending);
  assert.deepEqual(state.value.editor, {
    mode: "create",
    projectId: createdProjectId,
    draft: newEditorDraft,
  });
  assert.equal(state.value.displayError, null);
  assert.equal(state.value.isSaving, false);
});
