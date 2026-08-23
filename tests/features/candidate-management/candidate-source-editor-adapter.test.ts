import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
} from "../../../src/candidate-sources/public.js";
import {
  beginCandidateSourceEditorSave,
  type CandidateSourceEditorSnapshot,
  loadCandidateSourceEditor,
} from "../../../src/features/candidate-management/candidate-source-editor-adapter.js";

const candidateId = "83000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "83000000-0000-4000-8000-000000000002" as CandidateSourceId;
const snapshot: CandidateSourceEditorSnapshot = {
  draft: { siteName: "編集中の架空店舗" },
  sources: [{ id: sourceId }],
  fieldErrors: { "source.pageUrl": "invalid-url" },
  saving: false,
};

test("canonical catalogの表示結果だけをeditor snapshotへ反映する", async () => {
  const nextSourceId =
    "83000000-0000-4000-8000-000000000003" as CandidateSourceId;
  const result = await loadCandidateSourceEditor(
    {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [{ candidateId, sourceId: nextSourceId, isPrimary: true }],
          };
        },
        async getSourceReference() {
          throw new Error("unused");
        },
      },
      mutations: {} as never,
    },
    candidateId,
    snapshot,
  );

  assert.deepEqual(result, {
    kind: "ready",
    snapshot: {
      ...snapshot,
      sources: [{ id: nextSourceId }],
      primarySourceId: nextSourceId,
      fieldErrors: {},
    },
  });
});

test("port未注入とcatalog失敗ではdraftと既存表示を保持する", async () => {
  assert.deepEqual(
    await loadCandidateSourceEditor(undefined, candidateId, snapshot),
    { kind: "unavailable", snapshot },
  );

  const failed = await loadCandidateSourceEditor(
    {
      catalog: {
        async listSourceReferences() {
          return {
            ok: false,
            error: { kind: "not-found", entity: "candidate" },
          };
        },
        async getSourceReference() {
          throw new Error("unused");
        },
      },
      mutations: {} as never,
    },
    candidateId,
    snapshot,
  );
  assert.deepEqual(failed, {
    kind: "failed",
    snapshot,
    error: { kind: "not-found", entity: "candidate" },
  });
});

test("mutation結果をsaving stateへ適合し失敗時もdraftと表示を保持する", async () => {
  const unavailable = beginCandidateSourceEditorSave(undefined, snapshot, {
    kind: "set-primary",
    candidateId,
    sourceId,
  });
  assert.equal(unavailable.started.saving, true);
  assert.deepEqual(await unavailable.completed, {
    kind: "unavailable",
    snapshot,
  });

  const failed = beginCandidateSourceEditorSave(
    {
      catalog: {} as never,
      mutations: {
        async setPrimarySource() {
          return { ok: false, error: { kind: "primary-required" } };
        },
      } as never,
    },
    snapshot,
    { kind: "set-primary", candidateId, sourceId },
  );
  assert.equal(failed.started.saving, true);
  assert.deepEqual(await failed.completed, {
    kind: "failed",
    snapshot: {
      ...snapshot,
      fieldErrors: { replacementPrimarySourceId: "primary-required" },
    },
    error: { kind: "primary-required" },
  });

  const nextSourceId =
    "83000000-0000-4000-8000-000000000004" as CandidateSourceId;
  const succeeded = beginCandidateSourceEditorSave(
    {
      catalog: {} as never,
      mutations: {
        async setPrimarySource() {
          return {
            ok: true,
            value: {
              id: candidateId,
              sources: [
                { id: nextSourceId, pageUrl: "https://example.test/new" },
              ],
              primarySourceId: nextSourceId,
            } as never,
          };
        },
      } as never,
    },
    snapshot,
    { kind: "set-primary", candidateId, sourceId },
  );
  assert.deepEqual(await succeeded.completed, {
    kind: "ready",
    snapshot: {
      ...snapshot,
      sources: [{ id: nextSourceId, pageUrl: "https://example.test/new" }],
      primarySourceId: nextSourceId,
      fieldErrors: {},
      saving: false,
    },
  });
});

test("remove失敗はstaged削除を戻して操作前sources・primary・draftを保持しerrorを返す", async () => {
  const secondSourceId =
    "83000000-0000-4000-8000-000000000007" as CandidateSourceId;
  const current: CandidateSourceEditorSnapshot = {
    ...snapshot,
    draft: { productName: "保持する候補draft" },
    sources: [{ id: sourceId }, { id: secondSourceId }],
    primarySourceId: sourceId,
  };
  const remove = beginCandidateSourceEditorSave(
    {
      catalog: {} as never,
      mutations: {
        async removeSource() {
          return { ok: false, error: { kind: "primary-required" } };
        },
      } as never,
    },
    current,
    { kind: "remove", candidateId, sourceId },
  );

  assert.deepEqual(remove.started.sources, [{ id: secondSourceId }]);
  assert.deepEqual(await remove.completed, {
    kind: "failed",
    snapshot: {
      ...current,
      fieldErrors: { replacementPrimarySourceId: "primary-required" },
      saving: false,
    },
    error: { kind: "primary-required" },
  });
});

test("canonical mutation errorを試行対象の実indexへ適合し操作前snapshotを保持する", async () => {
  const secondSourceId =
    "83000000-0000-4000-8000-000000000005" as CandidateSourceId;
  const thirdSourceId =
    "83000000-0000-4000-8000-000000000006" as CandidateSourceId;
  const current: CandidateSourceEditorSnapshot = {
    ...snapshot,
    sources: [
      { id: sourceId, pageUrl: "https://example.test/first" },
      { id: secondSourceId, pageUrl: "https://example.test/second" },
    ],
  };
  const update = beginCandidateSourceEditorSave(
    {
      catalog: {} as never,
      mutations: {
        async updateSource() {
          return {
            ok: false,
            error: {
              kind: "source-validation",
              path: "candidate.sources[0].pageUrl",
              reason: "invalid-url",
            },
          };
        },
      } as never,
    },
    current,
    {
      kind: "update",
      candidateId,
      source: { id: secondSourceId, pageUrl: "unsafe update" },
    },
  );
  assert.equal(update.started.sources[1]?.pageUrl, "unsafe update");
  const updateResult = await update.completed;
  assert.equal(
    updateResult.snapshot.sources[1]?.pageUrl,
    "https://example.test/second",
  );
  assert.deepEqual(updateResult.snapshot.fieldErrors, {
    "sources[1].pageUrl": "invalid-url",
  });

  const add = beginCandidateSourceEditorSave(
    {
      catalog: {} as never,
      mutations: {
        async addSource() {
          return {
            ok: false,
            error: {
              kind: "source-validation",
              path: "candidate.sources[2].pageUrl",
              reason: "invalid-url",
            },
          };
        },
      } as never,
    },
    current,
    {
      kind: "add",
      candidateId,
      source: { id: thirdSourceId, pageUrl: "unsafe add" },
    },
  );
  const addResult = await add.completed;
  assert.deepEqual(addResult.snapshot.sources, current.sources);
  assert.deepEqual(addResult.snapshot.fieldErrors, {
    "sources[2].pageUrl": "invalid-url",
  });
});

test("対応inputのないcanonical pathをURL fieldへ偽装しない", async () => {
  const failed = beginCandidateSourceEditorSave(
    {
      catalog: {} as never,
      mutations: {
        async updateSource() {
          return {
            ok: false,
            error: {
              kind: "source-validation",
              path: "source.id",
              reason: "missing-field",
            },
          };
        },
      } as never,
    },
    snapshot,
    {
      kind: "update",
      candidateId,
      source: { id: sourceId, pageUrl: "https://example.test/source" },
    },
  );
  const result = await failed.completed;
  assert.deepEqual(result.snapshot.fieldErrors, {});
  assert.deepEqual(result.kind === "failed" ? result.error : undefined, {
    kind: "source-validation",
    path: "source.id",
    reason: "missing-field",
  });
});
