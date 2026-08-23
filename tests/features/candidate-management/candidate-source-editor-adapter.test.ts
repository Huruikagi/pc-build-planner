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
  sources: [{ candidateId, sourceId, isPrimary: true }],
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
      sources: [{ candidateId, sourceId: nextSourceId, isPrimary: true }],
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
      saving: false,
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
      sources: [
        {
          candidateId,
          sourceId: nextSourceId,
          pageUrl: "https://example.test/new",
          isPrimary: true,
        },
      ],
      fieldErrors: {},
      saving: false,
    },
  });
});
