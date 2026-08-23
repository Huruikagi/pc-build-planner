import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceCatalogPort,
  CandidateSourceId,
  CandidateSourceMutationPort,
} from "../../../src/candidate-sources/public.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const candidateId = "84000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "84000000-0000-4000-8000-000000000002" as CandidateSourceId;

const query = {
  async getCandidateDraft() {
    return {
      ok: true as const,
      value: {
        projectId: "84000000-0000-4000-8000-000000000003",
        category: "uncategorized" as const,
        product: { name: { original: "架空候補" } },
        sources: [{ id: sourceId, siteName: "既存表示" }],
        primarySourceId: sourceId,
        normalizedAttributes: { category: "uncategorized" as const },
      },
    };
  },
} as unknown as CandidateManagementQuery;

const service = {} as CandidateManagementService;

test("synthetic compositionのcanonical catalogとmutation結果を既存editor stateへ接続する", async () => {
  let catalogCalls = 0;
  let mutationCalls = 0;
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          catalogCalls += 1;
          return {
            ok: true,
            value: [
              {
                candidateId,
                sourceId,
                pageUrl: "https://example.test/catalog",
                kind: "retail" as const,
                isPrimary: true,
              },
            ],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async setPrimarySource() {
          mutationCalls += 1;
          return {
            ok: true,
            value: {
              id: candidateId,
              sources: [
                {
                  id: sourceId,
                  pageUrl: "https://example.test/mutated",
                  siteName: "変更後表示",
                  kind: "retail",
                },
              ],
              primarySourceId: sourceId,
            } as never,
          };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });

  await state.startEdit(candidateId);
  assert.equal(catalogCalls, 1);
  assert.deepEqual(state.value.editor?.draft.sources, [
    {
      id: sourceId,
      siteName: "既存表示",
      pageUrl: "https://example.test/catalog",
      kind: "retail",
    },
  ]);

  await state.setEditorPrimarySource(sourceId);
  assert.equal(mutationCalls, 1);
  assert.deepEqual(state.value.editor?.draft.sources, [
    {
      id: sourceId,
      pageUrl: "https://example.test/mutated",
      siteName: "変更後表示",
      kind: "retail",
    },
  ]);
});

test("canonical port未注入・失敗時はdraftとsource表示を保持し旧source coreを実行しない", async () => {
  const withoutPort = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
  });
  await withoutPort.startEdit(candidateId);
  const before = withoutPort.value.editor?.draft;
  await withoutPort.setEditorPrimarySource(sourceId);
  assert.deepEqual(withoutPort.value.editor?.draft, before);

  const failed = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: false,
            error: { kind: "not-found", entity: "candidate" },
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {} as CandidateSourceMutationPort,
    },
  });
  await failed.startEdit(candidateId);
  assert.equal(failed.value.editor?.draft.sources?.[0]?.siteName, "既存表示");
  assert.deepEqual(failed.value.sourceEditorError, {
    kind: "not-found",
    entity: "candidate",
  });
  assert.deepEqual(failed.value.displayError, { code: "not-found" });
});

test("遅延したcatalog結果は後から開いた別candidate editorへ適用しない", async () => {
  const candidateB = "84000000-0000-4000-8000-000000000004" as CandidatePartId;
  const sourceB = "84000000-0000-4000-8000-000000000005" as CandidateSourceId;
  let releaseA: (() => void) | undefined;
  const delayedA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences(
          input: Parameters<
            CandidateSourceCatalogPort["listSourceReferences"]
          >[0],
        ) {
          const id =
            input.scope.kind === "candidate"
              ? input.scope.candidateId
              : candidateId;
          if (id === candidateId) await delayedA;
          return {
            ok: true,
            value: [
              {
                candidateId: id,
                sourceId: id === candidateId ? sourceId : sourceB,
                pageUrl: `https://example.test/${id === candidateId ? "a" : "b"}`,
                isPrimary: true,
              },
            ],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {} as CandidateSourceMutationPort,
    },
  });

  const openingA = state.startEdit(candidateId);
  const openingB = state.startEdit(candidateB);
  await openingB;
  releaseA?.();
  await openingA;

  assert.equal(state.value.editor?.mode, "edit");
  assert.equal(
    state.value.editor?.mode === "edit"
      ? state.value.editor.candidateId
      : undefined,
    candidateB,
  );
  assert.equal(
    state.value.editor?.draft.sources?.[0]?.pageUrl,
    "https://example.test/b",
  );
});

test("canonical mutationの非validation errorを理由ごと表示stateへ保持する", async () => {
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [{ candidateId, sourceId, isPrimary: true }],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async setPrimarySource() {
          return { ok: false, error: { kind: "precondition-failed" } };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  const before = state.value.editor?.draft;
  await state.setEditorPrimarySource(sourceId);
  assert.deepEqual(state.value.editor?.draft, before);
  assert.deepEqual(state.value.sourceEditorError, {
    kind: "precondition-failed",
  });
  assert.deepEqual(state.value.displayError, { code: "conflict" });
});

test("canonical remove失敗は候補draft・sources・primaryを操作前のまま保持してerrorを公開する", async () => {
  const secondSourceId =
    "84000000-0000-4000-8000-000000000007" as CandidateSourceId;
  const sourceDraft = await query.getCandidateDraft(candidateId);
  if (!sourceDraft.ok) throw new Error("fixture draft must exist");
  const draftWithTwoSources = {
    ...sourceDraft.value,
    sources: [
      ...(sourceDraft.value.sources ?? []),
      {
        id: secondSourceId,
        pageUrl: "https://example.test/second",
        kind: "manufacturer" as const,
      },
    ],
    primarySourceId: sourceId,
  };
  const state = createManagementState({
    query: {
      ...query,
      async getCandidateDraft() {
        return { ok: true as const, value: draftWithTwoSources };
      },
    },
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [
              { candidateId, sourceId, isPrimary: true },
              { candidateId, sourceId: secondSourceId, isPrimary: false },
            ],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async removeSource() {
          return { ok: false, error: { kind: "precondition-failed" } };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  const before = state.value.editor?.draft;

  await state.removeEditorSource(sourceId, secondSourceId);

  assert.deepEqual(state.value.editor?.draft, before);
  assert.equal(state.value.editor?.draft.primarySourceId, sourceId);
  assert.deepEqual(state.value.sourceEditorError, {
    kind: "precondition-failed",
  });
  assert.deepEqual(state.value.displayError, { code: "conflict" });
  assert.equal(state.value.isSaving, false);
});

test("source validation失敗後のretry成功はsource所有の表示・field errorを消してcanonical snapshotを反映する", async () => {
  let calls = 0;
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [{ candidateId, sourceId, isPrimary: true }],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async setPrimarySource() {
          calls += 1;
          if (calls === 1)
            return {
              ok: false,
              error: {
                kind: "source-validation",
                path: "source.pageUrl",
                reason: "invalid-url",
              },
            } as const;
          return {
            ok: true,
            value: {
              id: candidateId,
              sources: [
                {
                  id: sourceId,
                  pageUrl: "https://example.test/retried",
                  siteName: "retry成功",
                  kind: "retail",
                },
              ],
              primarySourceId: sourceId,
            } as never,
          } as const;
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);

  await state.setEditorPrimarySource(sourceId);
  assert.deepEqual(state.value.sourceEditorError, {
    kind: "source-validation",
    path: "source.pageUrl",
    reason: "invalid-url",
  });
  assert.deepEqual(state.value.displayError, { code: "validation" });
  assert.notDeepEqual(state.value.fieldErrors, {});
  assert.equal(state.value.isSaving, false);

  await state.setEditorPrimarySource(sourceId);

  assert.deepEqual(state.value.editor?.draft.sources, [
    {
      id: sourceId,
      pageUrl: "https://example.test/retried",
      siteName: "retry成功",
      kind: "retail",
    },
  ]);
  assert.equal(state.value.sourceEditorError, null);
  assert.equal(state.value.displayError, null);
  assert.deepEqual(state.value.fieldErrors, {});
  assert.equal(state.value.isSaving, false);
});

test("source retry中のforced project switchはsource成功後もproject変更errorを保持する", async () => {
  let calls = 0;
  let releaseRetry: (() => void) | undefined;
  const retryPending = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [{ candidateId, sourceId, isPrimary: true }],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async setPrimarySource() {
          calls += 1;
          if (calls === 1)
            return {
              ok: false,
              error: {
                kind: "source-validation",
                path: "source.pageUrl",
                reason: "invalid-url",
              },
            } as const;
          await retryPending;
          return {
            ok: true,
            value: {
              id: candidateId,
              sources: [
                {
                  id: sourceId,
                  pageUrl: "https://example.test/switched",
                  kind: "retail",
                },
              ],
              primarySourceId: sourceId,
            } as never,
          } as const;
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  await state.setEditorPrimarySource(sourceId);

  const pending = state.setEditorPrimarySource(sourceId);
  assert.equal(state.value.isSaving, true);
  state.preserveDraftAfterForcedSwitch(
    "84000000-0000-4000-8000-000000000003" as never,
  );
  assert.deepEqual(state.value.displayError, {
    code: "project-changed-with-draft",
  });
  releaseRetry?.();
  await pending;

  assert.deepEqual(state.value.projectChangedWithDraft, {
    from: "84000000-0000-4000-8000-000000000003",
  });
  assert.deepEqual(state.value.displayError, {
    code: "project-changed-with-draft",
  });
  assert.equal(state.value.sourceEditorError, null);
  assert.deepEqual(state.value.fieldErrors, {});
  assert.equal(state.value.isSaving, false);
});

test("別editorへ切替後の遅延mutation failureはerror・field・saving stateを変更しない", async () => {
  const candidateB = "84000000-0000-4000-8000-000000000006" as CandidatePartId;
  let releaseFailure: (() => void) | undefined;
  const delayedFailure = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const state = createManagementState({
    query,
    service,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences(
          input: Parameters<
            CandidateSourceCatalogPort["listSourceReferences"]
          >[0],
        ) {
          const id =
            input.scope.kind === "candidate"
              ? input.scope.candidateId
              : candidateId;
          return {
            ok: true,
            value: [{ candidateId: id, sourceId, isPrimary: true }],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async setPrimarySource() {
          await delayedFailure;
          return {
            ok: false,
            error: {
              kind: "source-validation",
              path: "source.pageUrl",
              reason: "invalid-url",
            },
          };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  const pending = state.setEditorPrimarySource(sourceId);
  assert.equal(state.value.isSaving, true);
  const draftB = await query.getCandidateDraft(candidateB);
  if (!draftB.ok) throw new Error("fixture draft must exist");
  state.beginEdit(candidateB, draftB.value);
  assert.equal(state.value.isSaving, false);
  releaseFailure?.();
  await pending;

  assert.equal(
    state.value.editor?.mode === "edit"
      ? state.value.editor.candidateId
      : undefined,
    candidateB,
  );
  assert.equal(state.value.sourceEditorError, null);
  assert.equal(state.value.displayError, null);
  assert.deepEqual(state.value.fieldErrors, {});
  assert.equal(state.value.isSaving, false);
});
