import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
} from "../../src/candidate-sources/public.js";
import {
  beginCandidateSourceEditorSave,
  type CandidateSourceEditorSnapshot,
  loadCandidateSourceEditor,
} from "./candidate-source-editor-consumer.js";

const candidateId = "82000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "82000000-0000-4000-8000-000000000002" as CandidateSourceId;
const snapshot: CandidateSourceEditorSnapshot = {
  draft: { siteName: "編集中の架空店舗" },
  sources: [{ candidateId, sourceId, isPrimary: true }],
  fieldErrors: {},
  saving: false,
};

test("port未注入ではdraftとsource表示を保持してfallbackしない", async () => {
  assert.deepEqual(
    await loadCandidateSourceEditor(undefined, candidateId, snapshot),
    {
      kind: "unavailable",
      snapshot,
    },
  );

  const save = beginCandidateSourceEditorSave(undefined, snapshot, {
    kind: "set-primary",
    candidateId,
    sourceId,
  });
  assert.equal(save.started.saving, true);
  assert.deepEqual(await save.completed, { kind: "unavailable", snapshot });
});

test("catalog失敗では既存表示を保持する", async () => {
  const result = await loadCandidateSourceEditor(
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
  assert.deepEqual(result, {
    kind: "failed",
    snapshot,
    error: { kind: "not-found", entity: "candidate" },
  });
});

test("validationとprimary replacement errorをfieldへ投影し入力を保持する", async () => {
  for (const [error, field] of [
    [
      {
        kind: "source-validation",
        path: "source.pageUrl",
        reason: "invalid-url",
      },
      "source.pageUrl",
    ],
    [{ kind: "primary-required" }, "replacementPrimarySourceId"],
  ] as const) {
    const save = beginCandidateSourceEditorSave(
      {
        catalog: {} as never,
        mutations: {
          async setPrimarySource() {
            return { ok: false, error };
          },
        } as never,
      },
      snapshot,
      { kind: "set-primary", candidateId, sourceId },
    );
    assert.equal(save.started.saving, true);
    assert.deepEqual(await save.completed, {
      kind: "failed",
      snapshot: {
        ...snapshot,
        fieldErrors: { [field]: error.kind },
      },
      error,
    });
  }
});
