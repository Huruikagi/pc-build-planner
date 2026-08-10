import assert from "node:assert/strict";
import test from "node:test";

import type {
  Project,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
  CurrentProjectPort,
  ManagementError,
  MutationContext,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const recoveredProjectId =
  "10000000-0000-4000-8000-000000000041" as Uuid as ProjectId;
const chosenProjectId =
  "10000000-0000-4000-8000-000000000042" as Uuid as ProjectId;
const createdProjectId =
  "10000000-0000-4000-8000-000000000043" as Uuid as ProjectId;
const timestamp = "2026-08-10T00:00:00.000Z" as UtcTimestamp;
const context: MutationContext = {
  requestId: "20000000-0000-4000-8000-000000000041" as Uuid as RequestId,
  expectedRevision: 0 as Revision,
};

const prefill = (name: string): UnresolvedCandidateEditorPrefill => ({
  draft: {
    category: "uncategorized",
    product: { name: { original: name } },
    normalizedAttributes: { category: "uncategorized" },
  },
  captureDiagnostics: [{ field: "price", reason: "invalid-format" }],
});

const query: CandidateManagementQuery = {
  async listProjects() {
    return {
      ok: true,
      value: [
        { id: recoveredProjectId, name: "回復先", updatedAt: timestamp },
        { id: chosenProjectId, name: "明示選択先", updatedAt: timestamp },
      ],
    };
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    throw new Error("pending の再開で保存済み draft を読み直してはならない");
  },
};

const service = (
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

const unusedCreate: CandidateManagementService["createProject"] = async () => {
  throw new Error("回復経路で project を作成してはならない");
};

const currentContext = (initial: ProjectId | null) => {
  const listeners = new Set<() => void>();
  let current = initial;
  return {
    port: {
      getCurrentProject: () =>
        current === null
          ? ({ status: "unresolved" } as const)
          : ({ status: "resolved", projectId: current } as const),
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies CurrentProjectPort,
    change(next: ProjectId | null) {
      current = next;
      for (const listener of listeners) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
};

const createState = (
  currentProject: CurrentProjectPort,
  createProject: CandidateManagementService["createProject"] = unusedCreate,
) =>
  createManagementState({
    query,
    service: service(createProject),
    createMutationContext: () => context,
    currentProject,
  });

test("明示選択は保持中の同じ pre-edit を再抽出せず editor へ移す", async () => {
  const state = createState(currentContext(null).port);
  await state.load();
  const pending = prefill("架空の明示選択候補");
  state.holdPendingPreEdit(pending);

  state.resumePendingPreEdit(chosenProjectId);

  assert.equal(state.value.pendingPreEdit, null);
  assert.deepEqual(state.value.editor, {
    mode: "create",
    projectId: chosenProjectId,
    draft: { ...pending.draft, projectId: chosenProjectId },
    captureDiagnostics: pending.captureDiagnostics,
  });
  assert.equal(state.value.selectedProjectId, chosenProjectId);
});

test("current context の回復は保持中 pre-edit を同じ内容で再開する", async () => {
  const context = currentContext(null);
  const state = createState(context.port);
  await state.load();
  state.attachCurrentProject();
  const pending = prefill("架空の回復候補");
  state.holdPendingPreEdit(pending);
  assert.equal(state.value.editor === null, true);

  context.change(recoveredProjectId);

  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor?.projectId, recoveredProjectId);
  assert.equal(
    state.value.editor?.draft.product.name.original,
    "架空の回復候補",
  );
  state.releaseCurrentProject();
});

test("mount 時点で current context が既に解決済みなら保持中 pre-edit を即座に再開する", async () => {
  const state = createState(currentContext(recoveredProjectId).port);
  await state.load();
  state.holdPendingPreEdit(prefill("架空の即時回復候補"));

  state.attachCurrentProject();

  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor?.projectId, recoveredProjectId);
  state.releaseCurrentProject();
});

test("binding 済み project は以降の context 変更でも置換されない", async () => {
  const context = currentContext(null);
  const state = createState(context.port);
  await state.load();
  state.attachCurrentProject();
  state.holdPendingPreEdit(prefill("架空の固定候補"));
  state.resumePendingPreEdit(chosenProjectId);

  context.change(recoveredProjectId);

  assert.equal(state.value.editor?.projectId, chosenProjectId);
  assert.equal(state.value.editor?.draft.projectId, chosenProjectId);
  state.releaseCurrentProject();
});

test("作成成功は service が返した ID をそのまま維持し、失敗は pre-edit を保持する", async () => {
  const context = currentContext(null);
  let attempts = 0;
  const state = createState(context.port, async ({ name }) => {
    attempts += 1;
    return attempts === 1
      ? { ok: false, error: { kind: "storage" } satisfies ManagementError }
      : {
          ok: true,
          value: {
            id: createdProjectId,
            name,
            createdAt: timestamp,
            updatedAt: timestamp,
          } satisfies Project,
        };
  });
  await state.load();
  state.attachCurrentProject();
  const pending = prefill("架空の作成候補");
  state.holdPendingPreEdit(pending);

  await state.createProject("失敗する作成");
  assert.equal(state.value.pendingPreEdit, pending);
  assert.deepEqual(state.value.displayError, { code: "storage" });
  assert.equal(state.value.editor === null, true);

  await state.createProject("成功する作成");
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor?.projectId, createdProjectId);

  // A later context recovery must not re-resolve the created project.
  context.change(recoveredProjectId);
  assert.equal(state.value.editor?.projectId, createdProjectId);
  state.releaseCurrentProject();
});

test("pending は明示取消と新しい pre-edit activation だけで破棄され、capture 終了では残る", async () => {
  const state = createState(currentContext(null).port);
  await state.load();
  const first = prefill("架空の初回候補");
  state.holdPendingPreEdit(first);

  // A capture surface ending resets transient screen state only.
  state.resetTransientState();
  assert.equal(state.value.pendingPreEdit, first);

  const second = prefill("架空の後続候補");
  state.holdPendingPreEdit(second);
  assert.equal(state.value.pendingPreEdit, second);

  state.cancelPendingPreEdit();
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor === null, true);
});

test("session cleanup 後の context 変更は保持中 pre-edit を再開しない", async () => {
  const context = currentContext(null);
  const state = createState(context.port);
  await state.load();
  state.attachCurrentProject();
  const pending = prefill("架空の session 候補");
  state.holdPendingPreEdit(pending);

  state.releaseCurrentProject();
  assert.equal(context.listenerCount, 0);
  context.change(recoveredProjectId);

  assert.equal(state.value.pendingPreEdit, pending);
  assert.equal(state.value.editor === null, true);
});
