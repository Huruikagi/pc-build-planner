import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("pre-edit検証は仮entityを作らずproject非依存の構造だけを検証する", async () => {
  const source = await readFile(
    "src/features/candidate-management/pre-edit-validation.ts",
    "utf8",
  );

  assert.doesNotMatch(source, /validateCandidatePartValue/);
  assert.doesNotMatch(source, /00000000-0000-4000-8000-00000000000[12]/);
  assert.doesNotMatch(source, /createdAt|updatedAt/);
  assert.match(source, /domain\/runtime-schema\/public\.js/);
  assert.doesNotMatch(source, /const hasOnlyKeys|const isRecord/);
});

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

test("schema 2 pre-editは初期sourceとprimaryを受理しlegacy価格・単数sourceを拒否する", () => {
  const sourceDraft = {
    ...unresolvedDraft,
    product: { name: { original: "架空CPU", confirmed: "SYN CPU" } },
    sources: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        pageUrl: "https://shop.example.invalid/product",
        capturedAt: "2026-07-28T00:00:00.000Z",
        price: {
          original: "JPY 32,100",
          confirmed: { amount: 32100, currency: "JPY" },
        },
      },
    ],
    primarySourceId: "80000000-0000-4000-8000-000000000001",
  } as const;
  assert.deepEqual(validatePreEditDraft(sourceDraft), {
    ok: true,
    value: sourceDraft,
  });
  assert.equal(
    validatePreEditDraft({
      ...sourceDraft,
      product: {
        ...sourceDraft.product,
        price: sourceDraft.sources[0].price,
      },
    }).ok,
    false,
  );
  assert.equal(
    validatePreEditDraft({
      ...sourceDraft,
      sourceInfo: { pageUrl: sourceDraft.sources[0].pageUrl },
    }).ok,
    false,
  );
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

test("legacy handoffのstaleまたは無効なprojectIdは拒否せず検証済みprefillから落とす", () => {
  for (const projectId of [
    "x",
    "",
    "10000000-0000-4000-8000-000000000099",
    null,
    42,
  ]) {
    const result = validateCandidateEditorPrefill({
      draft: unresolvedDraft,
      projectId,
    });
    assert.deepEqual(result, { ok: true, value: { draft: unresolvedDraft } });
    assert.equal("projectId" in (result.ok ? result.value : {}), false);
  }
});

test("outer prefillのcategoryHintは個別のerrorへ写像する", () => {
  assert.deepEqual(
    validateCandidateEditorPrefill({
      draft: unresolvedDraft,
      categoryHint: "quantum-cpu",
    }),
    { ok: false, error: { kind: "invalid-category-hint" } },
  );
});

test("capture diagnostics fieldはclosedかつboundedな公開契約としてfail closedにする", () => {
  for (const field of [
    "",
    "unknown",
    "spec:",
    "spec: leading",
    "spec:nested:key",
    `spec:${"x".repeat(196)}`,
    "spec:socket\u0000",
  ]) {
    assert.equal(
      validateCandidateEditorPrefill({
        draft: unresolvedDraft,
        captureDiagnostics: [{ field, reason: "invalid-format" }],
      }).ok,
      false,
      field,
    );
  }
  assert.equal(
    validateCandidateEditorPrefill({
      draft: unresolvedDraft,
      captureDiagnostics: [
        { field: "name", reason: "invalid-format", rawValue: "secret" },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateCandidateEditorPrefill({
      draft: unresolvedDraft,
      captureDiagnostics: [{ field: "specification", reason: "unresolvable" }],
    }).ok,
    true,
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
        kind: "candidate-validation",
        fields: { "product.name": "required" },
      },
    },
  );
});
