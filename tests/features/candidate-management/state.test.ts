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
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;

const draft = {
  projectId,
  category: "uncategorized",
  product: { name: { original: "架空の候補" } },
  normalizedAttributes: { category: "uncategorized" },
} satisfies CandidateDraft;

const context: MutationContext = {
  requestId,
  expectedRevision: 0 as Revision,
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
});

const createService = (
  overrides: Partial<CandidateManagementService> = {},
): CandidateManagementService =>
  ({
    async createProject() {
      throw new Error("not used");
    },
    async renameProject() {
      throw new Error("not used");
    },
    async deleteProject() {
      throw new Error("not used");
    },
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
  }) as CandidateManagementService;

test("読込時に先頭projectと候補一覧を復元し、カテゴリ選択で一覧を絞り込む", async () => {
  const state = createManagementState({
    query: createQuery(),
    service: createService(),
    createMutationContext: () => context,
  });

  await state.load();
  assert.equal(state.value.selectedProjectId, projectId);
  assert.equal(state.value.candidates.length, 1);

  await state.selectCategory("uncategorized");
  assert.equal(state.value.selectedCategory, "uncategorized");
  assert.equal(state.value.candidates.length, 1);
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
  });
  await state.load();
  state.beginCreate(draft);

  const first = state.saveEditor();
  const second = state.saveEditor();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);

  assert.deepEqual(state.value.editor, { mode: "create", projectId, draft });
  assert.equal(state.value.candidates.length, 1);
  assert.deepEqual(state.value.displayError, { code: "storage" });
  assert.equal(state.value.isSaving, false);
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
  });
  await state.load();
  state.requestDeletion({ kind: "candidate", candidateId });
  await state.confirmDeletion();

  assert.deepEqual(state.value.deletion, { kind: "candidate", candidateId });
  assert.equal(state.value.candidates.length, 1);
  assert.deepEqual(state.value.displayError, { code: "conflict" });
});

test("初期読込が利用不能なら保存データを変更せず更新操作を停止する", async () => {
  const state = createManagementState({
    query: createQuery({ kind: "unsupported-data" }),
    service: createService(),
    createMutationContext: () => context,
  });

  await state.load();
  state.beginCreate(draft);
  await state.saveEditor();

  assert.equal(state.value.mutationsDisabled, true);
  assert.deepEqual(state.value.displayError, { code: "unsupported-data" });
  assert.equal(state.value.editor, null);
});
