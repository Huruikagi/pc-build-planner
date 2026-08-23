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
  CandidateManagementService,
  CandidateQuery,
} from "../../../src/features/candidate-management/contracts.js";
import type { SourcePagePort } from "../../../src/features/candidate-management/source-page-port.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const sourceA =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const sourceB =
  "40000000-0000-4000-8000-000000000002" as Uuid as CandidateSourceId;
const draft = {
  projectId,
  category: "uncategorized",
  product: { name: { original: "架空候補" } },
  normalizedAttributes: { category: "uncategorized" },
  sources: [{ id: sourceA, pageUrl: "https://shop.invalid/a", kind: "retail" }],
  primarySourceId: sourceA,
} satisfies CandidateDraft;

const query: CandidateQuery = {
  async listProjects() {
    return {
      ok: true,
      value: [
        {
          id: projectId,
          name: "架空",
          updatedAt: "2026-07-28T00:00:00.000Z" as never,
        },
      ],
    };
  },
  async listCandidates() {
    return {
      ok: true,
      value: [
        {
          id: candidateId,
          projectId,
          category: "uncategorized",
          name: { original: "架空候補" },
          hasMissingDetails: true,
          updatedAt: "2026-07-28T00:00:00.000Z" as never,
        },
      ],
    };
  },
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    return { ok: true, value: draft as never };
  },
};
const service = {
  async updateCandidate() {
    return { ok: false, error: { code: "storage-unavailable" } };
  },
} as unknown as CandidateManagementService;

const createState = async (
  open: SourcePagePort["open"] = async () => ({
    ok: true as const,
    value: undefined,
  }),
  localInput = false,
) => {
  const state = createManagementState({
    query,
    service,
    sourcePage: { open },
    currentProject: {
      getCurrentProject: () => ({ status: "resolved", projectId }),
      subscribe: () => () => {},
    },
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as Uuid as RequestId,
      expectedRevision: 0 as Revision,
    }),
  });
  await state.load();
  if (localInput) state.beginCreate(draft);
  else state.beginEdit(candidateId, draft);
  return state;
};

test("source追加・編集・primary選択をdraftだけへ反映する", async () => {
  const state = await createState(undefined, true);
  state.addEditorSource({
    id: sourceB,
    pageUrl: "https://maker.invalid/b",
    kind: "manufacturer",
  });
  state.updateEditorSource({
    id: sourceB,
    pageUrl: "https://maker.invalid/updated",
    kind: "manufacturer",
  });
  state.setEditorPrimarySource(sourceB);
  assert.deepEqual(state.value.editor?.draft.sources, [
    draft.sources?.[0],
    {
      id: sourceB,
      pageUrl: "https://maker.invalid/updated",
      kind: "manufacturer",
    },
  ]);
  assert.equal(state.value.editor?.draft.primarySourceId, sourceB);
});

test("primary削除はreplacementを要求し、最後のsourceはreplacementなしで削除する", async () => {
  const state = await createState(undefined, true);
  state.addEditorSource({ id: sourceB, pageUrl: "https://maker.invalid/b" });
  state.removeEditorSource(sourceA);
  assert.deepEqual(state.value.sourceOperationError, {
    kind: "replacement-required",
  });
  state.removeEditorSource(sourceA, sourceB);
  assert.equal(state.value.editor?.draft.primarySourceId, sourceB);
  state.removeEditorSource(sourceB);
  assert.deepEqual(state.value.editor?.draft.sources, []);
  assert.equal(state.value.editor?.draft.primarySourceId, undefined);
});

test("再訪結果は保存状態と分離し、open失敗を安定codeで保持する", async () => {
  const opened: string[] = [];
  const state = await createState(async (url: string) => {
    opened.push(url);
    return { ok: false as const, error: { kind: "open-failed" as const } };
  });
  await state.openSource("https://shop.invalid/a");
  assert.deepEqual(opened, ["https://shop.invalid/a"]);
  assert.deepEqual(state.value.sourceOpenError, { kind: "open-failed" });
  assert.deepEqual(state.value.editor?.draft, draft);
  assert.equal(state.value.candidates.length, 1);
});

test("再訪成功はURLを一度だけ渡して以前のopen errorを解除する", async () => {
  const opened: string[] = [];
  let shouldFail = true;
  const state = await createState(async (url: string) => {
    opened.push(url);
    return shouldFail
      ? { ok: false as const, error: { kind: "open-failed" as const } }
      : { ok: true as const, value: undefined };
  });
  await state.openSource("https://shop.invalid/a");
  shouldFail = false;
  await state.openSource("https://shop.invalid/a");

  assert.deepEqual(opened, [
    "https://shop.invalid/a",
    "https://shop.invalid/a",
  ]);
  assert.equal(state.value.sourceOpenError, null);
  assert.deepEqual(state.value.editor?.draft, draft);
  assert.equal(state.value.candidates.length, 1);
});

test("保存中はsource操作をgateし、mutation失敗後も入力と一覧を保持する", async () => {
  const state = await createState();
  const saving = state.saveEditor();
  state.addEditorSource({ id: sourceB, pageUrl: "https://shop.invalid/b" });
  await saving;
  assert.deepEqual(state.value.editor?.draft, draft);
  assert.equal(state.value.candidates.length, 1);
  assert.deepEqual(state.value.displayError, { code: "storage" });
});
