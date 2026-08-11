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
  MutationContext,
} from "../../../src/features/candidate-management/contracts.js";
import { createDuplicateMergeStateSnapshotCodec } from "../../../src/features/candidate-management/duplicate-merge-state.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { createManagementStateSnapshotCodec } from "../../../src/features/candidate-management/state-snapshot.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;
const sourceId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const secondSourceId =
  "40000000-0000-4000-8000-000000000002" as Uuid as CandidateSourceId;

const draft = {
  projectId,
  category: "uncategorized",
  product: { name: { original: "未保存の架空候補" } },
  normalizedAttributes: { category: "uncategorized" },
  sources: [
    {
      id: sourceId,
      pageUrl: "https://shop.invalid/item",
      price: { original: "$123", confirmed: { amount: 123, currency: "USD" } },
      kind: "retail",
    },
  ],
  primarySourceId: sourceId,
} satisfies CandidateDraft;

const context: MutationContext = {
  requestId,
  expectedRevision: 0 as Revision,
};

const query: CandidateQuery = {
  async listProjects() {
    return {
      ok: true as const,
      value: [
        {
          id: projectId,
          name: "架空プロジェクト",
          updatedAt: "2026-07-22T00:00:00.000Z" as never,
        },
      ],
    };
  },
  async listCandidates() {
    return {
      ok: true as const,
      value: [
        {
          id: candidateId,
          projectId,
          category: "uncategorized" as const,
          name: { original: "保存済みの架空候補" },
          hasMissingDetails: true,
          updatedAt: "2026-07-22T00:00:00.000Z" as never,
        },
      ],
    };
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
};

const service = {} as CandidateManagementService;

const createState = async () => {
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => context,
    currentProject: {
      getCurrentProject: () => ({ status: "resolved", projectId }),
      subscribe: () => () => {},
    },
  });
  await state.load();
  return state;
};

test("未保存の編集・選択・削除確認・表示エラーだけをversion付きsnapshotとしてcaptureし、restoreする", async () => {
  const state = await createState();
  state.beginEdit(candidateId, draft);
  state.requestDeletion({ kind: "candidate", candidateId });
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );

  const snapshot = codec.capture(state);
  const restored = codec.restore(snapshot);

  assert.deepEqual(snapshot, {
    version: 3,
    selectedProjectId: projectId,
    selectedCategory: null,
    editor: { mode: "edit", projectId, candidateId, draft },
    deletion: { kind: "candidate", candidateId },
    displayError: null,
    duplicateDecision: null,
  });
  assert.deepEqual(restored, {
    ok: true,
    value: { ...snapshot, duplicateDecision: { status: "idle" } },
  });
  assert.equal("projects" in snapshot, false);
  assert.equal("isSaving" in snapshot, false);
});

test("snapshot restore失敗の表示状態もcaptureとrestoreをround-tripできる", async () => {
  const state = await createState();
  state.rejectSnapshotRestore();
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );

  const snapshot = codec.capture(state);

  assert.deepEqual(snapshot.displayError, { code: "snapshot-restore-failed" });
  assert.deepEqual(codec.restore(snapshot), {
    ok: true,
    value: { ...snapshot, duplicateDecision: { status: "idle" } },
  });
});

test("複数sourceと非先頭primaryを持つversion 3 editor snapshotを完全にround-tripし、不正source tableを拒否する", async () => {
  const state = await createState();
  const firstSource = draft.sources?.[0];
  assert.ok(firstSource);
  const multiSourceDraft: CandidateDraft = {
    ...draft,
    sources: [
      firstSource,
      {
        id: secondSourceId,
        pageUrl: "https://manufacturer.invalid/product/cpu-2",
        siteName: "架空メーカー",
        capturedAt: "2026-07-23T00:00:00.000Z" as never,
        price: {
          original: "JPY 25000",
          confirmed: { amount: 25000, currency: "JPY" },
        },
        kind: "manufacturer",
      },
    ],
    primarySourceId: secondSourceId,
  };
  state.beginEdit(candidateId, multiSourceDraft);
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );
  const snapshot = codec.capture(state);

  assert.deepEqual(codec.restore(snapshot), {
    ok: true,
    value: { ...snapshot, duplicateDecision: { status: "idle" } },
  });
  const before = state.value;
  const sources = multiSourceDraft.sources;
  const secondSource = sources?.[1];
  assert.ok(sources);
  assert.ok(secondSource);
  const invalidSources = [
    [firstSource, { ...secondSource, id: sourceId }],
    sources,
    [firstSource, { ...secondSource, pageUrl: "javascript:alert(1)" }],
    [
      firstSource,
      {
        ...secondSource,
        price: {
          original: "bad",
          confirmed: { amount: "not-a-number", currency: "JPY" },
        },
      },
    ],
    [firstSource, { ...secondSource, kind: "marketplace" }],
  ] as const;
  for (const [index, sources] of invalidSources.entries()) {
    const invalidDraft: Record<string, unknown> = {
      ...multiSourceDraft,
      sources,
      ...(index === 1
        ? {
            primarySourceId:
              "40000000-0000-4000-8000-000000000099" as Uuid as CandidateSourceId,
          }
        : {}),
    };
    assert.deepEqual(
      codec.restore({
        ...snapshot,
        editor: { mode: "edit", projectId, candidateId, draft: invalidDraft },
      }),
      { ok: false, error: { kind: "invalid-draft" } },
    );
    assert.deepEqual(state.value, before);
  }
});

test("未知version、存在しない参照、無効draftを識別可能なrestore errorとして拒否し、stateを変更しない", async () => {
  const state = await createState();
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );
  const before = state.value;

  assert.deepEqual(codec.restore({ version: 1 }), {
    ok: false,
    error: { kind: "unsupported-version" },
  });
  assert.deepEqual(
    codec.restore({
      ...codec.capture(state),
      duplicateDecision: { version: 99, state: { status: "idle" } },
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      ...codec.capture(state),
      selectedProjectId: "data:text/html,<script>alert(1)</script>",
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 3,
      selectedProjectId: otherProjectId,
      selectedCategory: null,
      editor: null,
      deletion: null,
      displayError: null,
      duplicateDecision: null,
    }),
    { ok: false, error: { kind: "invalid-reference" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 3,
      selectedProjectId: projectId,
      selectedCategory: null,
      editor: { mode: "create", projectId, draft: { product: {} } },
      deletion: null,
      displayError: null,
      duplicateDecision: null,
    }),
    { ok: false, error: { kind: "invalid-draft" } },
  );
  assert.deepEqual(state.value, before);
});

test("構造だけが正しい不正draftは属性、source、余剰fieldをfail-closedで拒否する", async () => {
  const state = await createState();
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );
  const validSnapshot = codec.capture(state);

  for (const invalidDraft of [
    {
      ...draft,
      normalizedAttributes: {
        category: "uncategorized",
        socket: { original: 42 },
      },
    },
    { ...draft, sourceInfo: { pageUrl: "javascript:alert(1)" } },
    {
      ...draft,
      sources: [{ ...draft.sources[0], pageUrl: "javascript:alert(1)" }],
    },
    { ...draft, sources: [{ ...draft.sources[0], id: "not-a-source-id" }] },
    { ...draft, primarySourceId: "40000000-0000-4000-8000-000000000099" },
    { ...draft, sourceSnapshot: { title: { raw: "不正" } } },
    { ...draft, unexpected: true },
  ]) {
    assert.deepEqual(
      codec.restore({
        ...validSnapshot,
        editor: { mode: "create", projectId, draft: invalidDraft },
      }),
      { ok: false, error: { kind: "invalid-draft" } },
    );
  }
});

test("カテゴリ切替で表示から外れた編集対象も完全な候補参照集合でrestoreする", async () => {
  const state = await createState();
  state.beginEdit(candidateId, draft);
  await state.selectCategory("cpu");
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );

  assert.equal(state.value.candidates.length, 0);
  const snapshot = codec.capture(state);
  assert.deepEqual(codec.restore(snapshot), {
    ok: true,
    value: { ...snapshot, duplicateDecision: { status: "idle" } },
  });
});

test("別projectへ所属すると偽装したcandidate editorはrestoreしない", async () => {
  const state = createManagementState({
    query: {
      ...query,
      async listProjects() {
        return {
          ok: true as const,
          value: [
            {
              id: projectId,
              name: "第一案",
              updatedAt: "2026-07-22T00:00:00.000Z" as never,
            },
            {
              id: otherProjectId,
              name: "第二案",
              updatedAt: "2026-07-22T00:00:00.000Z" as never,
            },
          ],
        };
      },
      async listCandidates(input) {
        return {
          ok: true as const,
          value:
            input.projectId === projectId
              ? [
                  {
                    id: candidateId,
                    projectId,
                    category: "uncategorized" as const,
                    name: { original: "保存済みの架空候補" },
                    hasMissingDetails: true,
                    updatedAt: "2026-07-22T00:00:00.000Z" as never,
                  },
                ]
              : [],
        };
      },
    },
    service,
    createMutationContext: () => context,
  });
  await state.load();
  const codec = createManagementStateSnapshotCodec(
    state,
    createDuplicateMergeStateSnapshotCodec(),
  );

  assert.deepEqual(
    codec.restore({
      ...codec.capture(state),
      selectedProjectId: otherProjectId,
      editor: {
        mode: "edit",
        projectId: otherProjectId,
        candidateId,
        draft: { ...draft, projectId: otherProjectId },
      },
    }),
    { ok: false, error: { kind: "invalid-reference" } },
  );
});
