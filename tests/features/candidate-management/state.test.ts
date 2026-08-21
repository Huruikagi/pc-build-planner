import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  ProjectId,
  RequestId,
  Revision,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  ManagementError,
  MutationContext,
} from "../../../src/features/candidate-management/contracts.js";
import type { DuplicateMergeCoordinator } from "../../../src/features/candidate-management/duplicate-merge.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;

const draft = {
  projectId,
  category: "uncategorized",
  product: { name: { original: "架空の候補" } },
  normalizedAttributes: { category: "uncategorized" },
} satisfies CandidateDraft;

const pendingPreEdit = {
  draft: {
    category: "uncategorized" as const,
    product: { name: { original: "架空の抽出候補" } },
    normalizedAttributes: { category: "uncategorized" as const },
  },
};

const context: MutationContext = {
  requestId,
  expectedRevision: 0 as Revision,
};

const currentProject = {
  getCurrentProject: () => ({ status: "resolved" as const, projectId }),
  subscribe: () => () => {},
  async refresh() {
    return {
      ok: true as const,
      value: { status: "resolved" as const, projectId },
    };
  },
};

const createQuery = (failure?: ManagementError): CandidateQuery => ({
  async listProjects() {
    return failure === undefined
      ? {
          ok: true as const,
          value: [
            {
              id: projectId,
              name: "架空プロジェクト",
              updatedAt: "2026-07-22T00:00:00.000Z" as never,
            },
          ],
        }
      : { ok: false as const, error: failure };
  },
  async listCandidates() {
    return failure === undefined
      ? {
          ok: true as const,
          value: [
            {
              id: candidateId,
              projectId,
              category: "uncategorized" as const,
              name: { original: "架空の候補" },
              hasMissingDetails: true,
              updatedAt: "2026-07-22T00:00:00.000Z" as never,
            },
          ],
        }
      : { ok: false as const, error: failure };
  },
  async listBuildEligible() {
    return { ok: true as const, value: [] };
  },
  async getCandidateDraft() {
    return {
      ok: false as const,
      error: { kind: "not-found" as const, entity: "candidate" as const },
    };
  },
});

const createService = (
  overrides: Partial<CandidateManagementService> = {},
): CandidateManagementService => ({
  async createCandidate() {
    return { ok: false as const, error: { kind: "storage" } };
  },
  async updateCandidate() {
    throw new Error("not used");
  },
  async deleteCandidate() {
    throw new Error("not used");
  },
  ...overrides,
});

test("読込時に先頭projectと候補一覧を復元し、カテゴリ選択で一覧を絞り込む", async () => {
  const state = createManagementState({
    query: createQuery(),
    service: createService(),
    createMutationContext: () => context,
    currentProject,
  });

  await state.load();
  assert.equal(state.value.selectedProjectId, projectId);
  assert.equal(state.value.candidates.length, 1);

  await state.selectCategory("uncategorized");
  assert.equal(state.value.selectedCategory, "uncategorized");
  assert.equal(state.value.candidates.length, 1);
});

test("pending pre-edit は reset と load では失われず明示取消だけで破棄できる", async () => {
  const state = createManagementState({
    query: createQuery(),
    service: createService(),
    createMutationContext: () => context,
  });

  state.holdPendingPreEdit(pendingPreEdit);
  state.resetTransientState();
  await state.load();
  assert.deepEqual(state.value.pendingPreEdit, pendingPreEdit);

  state.cancelPendingPreEdit();
  assert.equal(state.value.pendingPreEdit, null);
});

test("確認済みの通常切替だけがdirty draftを破棄して新projectへ表示を切り替える", async () => {
  const state = createManagementState({
    query: createQuery(),
    service: createService(),
    createMutationContext: () => context,
  });
  await state.load();
  state.beginCreate(draft);
  assert.equal(state.hasDirtyProjectDraft(), true);

  state.discardDraftForConfirmedSwitch(projectId, otherProjectId);

  assert.equal(state.value.editor, null);
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.selectedProjectId, otherProjectId);
  assert.equal(state.hasDirtyProjectDraft(), false);
});

test("forced切替は旧projectのdraftを保持し新projectへのmutationを遮断する", async () => {
  let creates = 0;
  const state = createManagementState({
    query: createQuery(),
    service: createService({
      async createCandidate() {
        creates += 1;
        return { ok: false as const, error: { kind: "storage" as const } };
      },
    }),
    createMutationContext: () => context,
    currentProject,
  });
  await state.load();
  state.beginCreate(draft);

  state.preserveDraftAfterForcedSwitch(projectId);
  await state.saveEditor();

  assert.equal(state.value.editor?.projectId, projectId);
  assert.equal(state.value.editor?.draft.projectId, projectId);
  assert.deepEqual(state.value.projectChangedWithDraft, { from: projectId });
  assert.equal(state.value.displayError?.code, "project-changed-with-draft");
  assert.equal(state.value.mutationsDisabled, true);
  assert.equal(creates, 0);
});

test("候補保存の失敗では入力と一覧を保持し、同一操作の二重送信を抑止する", async () => {
  let release!: () => void;
  let calls = 0;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = createManagementState({
    query: createQuery(),
    service: createService({
      async createCandidate() {
        calls += 1;
        await delayed;
        return { ok: false as const, error: { kind: "storage" } };
      },
    }),
    createMutationContext: () => context,
    currentProject,
  });
  await state.load();
  state.beginCreate(draft);

  const first = state.saveEditor();
  const second = state.saveEditor();
  // The mutation context resolves asynchronously, so the service call lands on
  // a later microtask; the second submit must still be suppressed.
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);

  assert.deepEqual(state.value.editor, { mode: "create", projectId, draft });
  assert.equal(state.value.candidates.length, 1);
  assert.deepEqual(state.value.displayError, { code: "storage" });
  assert.equal(state.value.isSaving, false);
});

test("create 保存は重複 coordinator へ委譲し、edit 保存は既存 update を維持する", async () => {
  let evaluated = 0;
  let createdDirectly = 0;
  let updated = 0;
  const coordinator: DuplicateMergeCoordinator = {
    async evaluate(input) {
      evaluated += 1;
      assert.equal(input, draft);
      return { ok: true, value: { kind: "decision-required", matches: [] } };
    },
    async complete() {
      throw new Error("not used");
    },
  };
  const state = createManagementState({
    query: createQuery(),
    service: createService({
      async createCandidate() {
        createdDirectly += 1;
        return { ok: false, error: { kind: "storage" } };
      },
      async updateCandidate() {
        updated += 1;
        return { ok: true, value: {} as never };
      },
    }),
    createMutationContext: () => context,
    duplicateMergeCoordinator: coordinator,
  });
  await state.load();
  state.beginCreate(draft);
  await state.saveEditor();
  assert.equal(evaluated, 1);
  assert.equal(createdDirectly, 0);
  assert.equal(state.value.duplicateDecision.status, "deciding");

  state.cancelDuplicateDecision();
  state.beginEdit(candidateId, draft);
  await state.saveEditor();
  assert.equal(updated, 1);
});

test("重複判断の全commit経路は成功時だけeditorを閉じ、validation失敗をfieldへ写像する", async () => {
  for (const decision of ["saved-new", "save-new", "merge"] as const) {
    let completedWith: string | undefined;
    const coordinator: DuplicateMergeCoordinator = {
      async evaluate() {
        return decision === "saved-new"
          ? { ok: true, value: { kind: "saved-new", candidate: {} as never } }
          : ({
              ok: true,
              value: {
                kind: "decision-required",
                matches: [
                  {
                    candidateId,
                    confidence: "high",
                    evidence: { kind: "model-number" },
                    summary: {
                      id: candidateId,
                      projectId,
                      category: "uncategorized",
                      name: { original: "架空の候補" },
                      hasMissingDetails: true,
                      updatedAt: "2026-07-22T00:00:00.000Z" as never,
                    },
                  },
                ],
              },
            } as never);
      },
      async complete(_draft, _matches, selected) {
        completedWith = selected.kind;
        return selected.kind === "save-new"
          ? { ok: true, value: { kind: "saved-new", candidate: {} as never } }
          : { ok: true, value: { kind: "source-added", candidateId } };
      },
    };
    const state = createManagementState({
      query: createQuery(),
      service: createService(),
      createMutationContext: () => context,
      duplicateMergeCoordinator: coordinator,
    });
    await state.load();
    state.beginCreate(draft);
    await state.saveEditor();
    if (decision === "save-new") await state.saveDuplicateAsNew();
    if (decision === "merge") {
      state.selectDuplicateCandidate(candidateId);
      await state.mergeDuplicateCandidate();
    }
    assert.equal(state.value.editor, null);
    assert.equal(
      completedWith,
      decision === "saved-new" ? undefined : decision,
    );
  }

  const failed = createManagementState({
    query: createQuery(),
    service: createService(),
    createMutationContext: () => context,
    duplicateMergeCoordinator: {
      async evaluate() {
        return {
          ok: false,
          error: {
            kind: "management",
            cause: {
              kind: "validation",
              fields: { "product.name": "required" },
            },
          },
        };
      },
      async complete() {
        throw new Error("not used");
      },
    },
  });
  await failed.load();
  failed.beginCreate(draft);
  await failed.saveEditor();
  assert.equal(failed.value.editor?.draft, draft);
  assert.deepEqual(failed.value.fieldErrors, { "product.name": "required" });
  assert.deepEqual(failed.value.displayError, { code: "validation" });

  const sourceFailed = createManagementState({
    query: createQuery(),
    service: createService(),
    createMutationContext: () => context,
    duplicateMergeCoordinator: {
      async evaluate() {
        return {
          ok: true,
          value: {
            kind: "decision-required",
            matches: [
              {
                candidateId,
                confidence: "high",
                evidence: { kind: "model-number" },
                summary: {
                  id: candidateId,
                  projectId,
                  category: "uncategorized",
                  name: { original: "架空の候補" },
                  hasMissingDetails: true,
                  updatedAt: "2026-07-22T00:00:00.000Z" as never,
                },
              },
            ],
          },
        };
      },
      async complete() {
        return {
          ok: false,
          error: {
            kind: "source-route",
            cause: {
              kind: "source-add",
              cause: {
                kind: "validation",
                fields: { "source.pageUrl": "invalid-url" },
              },
            },
          },
        };
      },
    },
  });
  await sourceFailed.load();
  sourceFailed.beginCreate(draft);
  await sourceFailed.saveEditor();
  sourceFailed.selectDuplicateCandidate(candidateId);
  await sourceFailed.mergeDuplicateCandidate();
  assert.deepEqual(sourceFailed.value.fieldErrors, {
    "sources[0].pageUrl": "invalid-url",
  });
  sourceFailed.cancelDuplicateDecision();
  assert.deepEqual(sourceFailed.value.fieldErrors, {
    "sources[0].pageUrl": "invalid-url",
  });
});

test("候補削除の失敗では確認対象と一覧を維持して再試行できる", async () => {
  const state = createManagementState({
    query: createQuery(),
    service: createService({
      async deleteCandidate() {
        return { ok: false as const, error: { kind: "conflict" } };
      },
    }),
    createMutationContext: () => context,
    currentProject,
  });
  await state.load();
  state.requestDeletion({ kind: "candidate", candidateId });
  await state.confirmDeletion();

  assert.deepEqual(state.value.deletion, { kind: "candidate", candidateId });
  assert.equal(state.value.candidates.length, 1);
  assert.deepEqual(state.value.displayError, { code: "conflict" });
});

for (const error of [
  { kind: "unsupported-data" },
  { kind: "storage" },
  { kind: "quota" },
] as const satisfies readonly ManagementError[]) {
  test(`初期読込が ${error.kind} なら保存データを変更せず更新操作を停止する`, async () => {
    const state = createManagementState({
      query: createQuery(error),
      service: createService(),
      createMutationContext: () => context,
    });

    await state.load();
    state.beginCreate(draft);
    await state.saveEditor();

    assert.equal(state.value.mutationsDisabled, true);
    assert.deepEqual(state.value.displayError, { code: error.kind });
    assert.equal(state.value.editor, null);
  });
}
