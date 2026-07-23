import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureActivationError } from "../../../src/application-shell/public.js";
import type {
  ProjectId,
  RequestId,
  Result,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { err, ok } from "../../../src/domain/public.js";
import type { CandidateEditorPrefill } from "../../../src/features/candidate-management/public.js";
import type { CaptureSession } from "../../../src/features/product-capture/contracts.js";
import { createCandidateEditorNavigation } from "../../../src/features/product-capture/editor-navigation.js";

const REQUEST_ID = "80000000-0000-4000-8000-000000000001" as RequestId;
const CAPTURED_AT = "2026-07-23T00:00:00Z" as UtcTimestamp;
const PROJECT_ID = "10000000-0000-4000-8000-000000000001" as ProjectId;

const session = (overrides: Partial<CaptureSession> = {}): CaptureSession => ({
  requestId: REQUEST_ID,
  tabId: 7,
  pageUrl: "https://shop.example.invalid/products/x100",
  capturedAt: CAPTURED_AT,
  fields: [
    {
      field: "name",
      value: { original: "架空CPU X100", confirmed: "架空CPU X100" },
      source: "json-ld",
      sourceLabel: "JSON-LD name",
    },
  ],
  rejectedFields: [],
  missingCoreFields: [
    "category",
    "manufacturer",
    "modelNumber",
    "price",
    "url",
  ],
  userCorrections: {},
  projectId: PROJECT_ID,
  ...overrides,
});

interface Harness {
  readonly calls: CandidateEditorPrefill[];
  setResult(result: Result<void, FeatureActivationError>): void;
  readonly openCandidateEditor: (
    prefill: CandidateEditorPrefill,
  ) => Promise<Result<void, FeatureActivationError>>;
}

const harness = (): Harness => {
  const calls: CandidateEditorPrefill[] = [];
  let result: Result<void, FeatureActivationError> = ok(undefined);
  return {
    calls,
    setResult(next) {
      result = next;
    },
    async openCandidateEditor(prefill) {
      calls.push(prefill);
      return result;
    },
  };
};

test("openは採用値からprefillを生成しopenCandidateEditorだけを介して要求する", async () => {
  const h = harness();
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const result = await navigation.open(session());

  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.projectId, PROJECT_ID);
  assert.equal(h.calls[0]?.draft.product.name.confirmed, "架空CPU X100");
  assert.equal(h.calls[0]?.draft.category, "uncategorized");
});

test("商品名が空のセッションはopenCandidateEditorを呼ばずvalidationを返す", async () => {
  const h = harness();
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const result = await navigation.open(session({ fields: [] }));

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  assert.equal(h.calls.length, 0);
});

test("projectId未選択のセッションはopenCandidateEditorを呼ばずproject-requiredを返す", async () => {
  const h = harness();
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const { projectId: _projectId, ...withoutProject } = session();
  const result = await navigation.open(withoutProject);

  assert.deepEqual(result, { ok: false, error: { kind: "project-required" } });
  assert.equal(h.calls.length, 0);
});

test("openCandidateEditorが失敗した場合はnavigationエラーへ変換する", async () => {
  const h = harness();
  h.setResult(err({ kind: "invalid_activation", detail: "架空の失敗" }));
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const result = await navigation.open(session());

  assert.deepEqual(result, { ok: false, error: { kind: "navigation" } });
});

test("openManualEntryは商品名だけからuncategorizedのprefillを生成する", async () => {
  const h = harness();
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const result = await navigation.openManualEntry("架空手入力品", PROJECT_ID);

  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0]?.draft.product.name, {
    original: null,
    confirmed: "架空手入力品",
  });
  assert.equal(h.calls[0]?.draft.category, "uncategorized");
  assert.equal(h.calls[0]?.projectId, PROJECT_ID);
});

test("openManualEntryは空白のみの商品名を拒否しopenCandidateEditorを呼ばない", async () => {
  const h = harness();
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const result = await navigation.openManualEntry("   ", PROJECT_ID);

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  assert.equal(h.calls.length, 0);
});

test("openManualEntryの失敗もnavigationエラーへ変換する", async () => {
  const h = harness();
  h.setResult(
    err({ kind: "mount_failed", featureId: "candidate-management" as never }),
  );
  const navigation = createCandidateEditorNavigation({
    openCandidateEditor: h.openCandidateEditor,
  });

  const result = await navigation.openManualEntry("架空手入力品", PROJECT_ID);

  assert.deepEqual(result, { ok: false, error: { kind: "navigation" } });
});
