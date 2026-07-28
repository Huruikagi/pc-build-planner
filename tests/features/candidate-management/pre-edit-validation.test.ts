import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  RequestId,
  Revision,
} from "../../../src/domain/public.js";
import {
  validateCandidateEditorPrefill,
  validatePreEditDraft,
} from "../../../src/features/candidate-management/pre-edit-validation.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";

const unresolvedDraft = {
  category: "uncategorized",
  product: { name: { original: "" } },
  normalizedAttributes: { category: "uncategorized" },
} as const;

test("pre-editはproject未解決かつ空名の構造的に正しいdraftを受理する", () => {
  assert.deepEqual(validatePreEditDraft(unresolvedDraft), {
    ok: true,
    value: unresolvedDraft,
  });
  assert.deepEqual(validateCandidateEditorPrefill({ draft: unresolvedDraft }), {
    ok: true,
    value: { draft: unresolvedDraft },
  });
});

test("pre-editは欠落、不正型、未知category、category不一致を閉じたerrorへ写像する", () => {
  assert.deepEqual(validatePreEditDraft({}), {
    ok: false,
    error: { kind: "invalid-draft-shape" },
  });
  assert.deepEqual(
    validatePreEditDraft({ ...unresolvedDraft, product: { name: 42 } }),
    { ok: false, error: { kind: "invalid-draft-shape" } },
  );
  assert.deepEqual(
    validatePreEditDraft({ ...unresolvedDraft, category: "quantum-cpu" }),
    { ok: false, error: { kind: "invalid-category" } },
  );
  assert.deepEqual(
    validatePreEditDraft({
      ...unresolvedDraft,
      category: "cpu",
      normalizedAttributes: { category: "memory" },
    }),
    { ok: false, error: { kind: "category-mismatch" } },
  );
});

test("outer prefillはprojectIdとcategoryHintを個別のerrorへ写像する", () => {
  assert.deepEqual(
    validateCandidateEditorPrefill({ draft: unresolvedDraft, projectId: "x" }),
    { ok: false, error: { kind: "invalid-project-id" } },
  );
  assert.deepEqual(
    validateCandidateEditorPrefill({ draft: unresolvedDraft, projectId: "" }),
    { ok: false, error: { kind: "invalid-project-id" } },
  );
  assert.deepEqual(
    validateCandidateEditorPrefill({
      draft: unresolvedDraft,
      categoryHint: "quantum-cpu",
    }),
    { ok: false, error: { kind: "invalid-category-hint" } },
  );
});

test("field固有型、URL、UTC日時、prototypeを構造不正として拒否する", () => {
  const invalidDrafts = [
    {
      ...unresolvedDraft,
      product: { name: { original: "架空", confirmed: 42 } },
    },
    {
      ...unresolvedDraft,
      product: {
        name: { original: "架空" },
        price: { original: "100", confirmed: "not-money" },
      },
    },
    { ...unresolvedDraft, sourceInfo: { pageUrl: "not-a-url" } },
    { ...unresolvedDraft, sourceInfo: { capturedAt: "yesterday" } },
    Object.assign(Object.create({ inherited: true }), unresolvedDraft),
  ];

  for (const draft of invalidDrafts)
    assert.deepEqual(validatePreEditDraft(draft), {
      ok: false,
      error: { kind: "invalid-draft-shape" },
    });
});

test("空名はpre-editだけで受理され、既存の保存serviceでは拒否される", async () => {
  const preEdit = validatePreEditDraft(unresolvedDraft);
  assert.equal(preEdit.ok, true);
  const service = createCandidateManagementService({
    data: {} as FoundationScopedDataPort,
  });
  assert.deepEqual(
    await service.createCandidate(
      {
        ...unresolvedDraft,
        projectId: "10000000-0000-4000-8000-000000000001" as ProjectId,
      },
      {
        requestId: "20000000-0000-4000-8000-000000000001" as RequestId,
        expectedRevision: 0 as Revision,
      },
    ),
    {
      ok: false,
      error: {
        kind: "validation",
        fields: { "product.name": "required" },
      },
    },
  );
});
