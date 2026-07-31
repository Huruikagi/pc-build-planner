import assert from "node:assert/strict";
import test from "node:test";
import type { TargetTabId } from "../../../src/application-shell/public.js";
import type {
  CandidateSourceId,
  RequestId,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { createCaptureDraftMapper } from "../../../src/features/product-capture/draft-mapper.js";

const captureResult = (fields: readonly unknown[] = []) => ({
  requestId: "80000000-0000-4000-8000-000000000001" as RequestId,
  tabId: 7 as TargetTabId,
  pageUrl: "https://shop.example.invalid/product",
  capturedAt: "2026-07-28T00:00:00.000Z" as UtcTimestamp,
  draft: { fields, missingCoreFields: [] },
  rejectedFields: [],
});
const sourceId = "80000000-0000-4000-8000-000000000002" as CandidateSourceId;

test("抽出結果をproject未解決draftへ必要最小限で写像する", () => {
  const mapped = createCaptureDraftMapper({
    createSourceId: () => sourceId,
  }).toUnresolvedDraft(
    captureResult([
      {
        field: "name",
        normalizedValue: "架空CPU",
        rawValue: "  架空CPU  ",
        source: "heading",
        sourceLabel: "h1",
        documentOrder: 0,
      },
      {
        field: "manufacturer",
        normalizedValue: "架空メーカー",
        rawValue: "架空メーカー",
        source: "meta",
        sourceLabel: "og:brand",
        documentOrder: 1,
      },
      {
        field: "price",
        normalizedValue: { amount: 32100, currency: "JPY" },
        rawValue: "JPY 32,100",
        source: "meta",
        sourceLabel: "product:price",
        documentOrder: 2,
      },
    ]),
  );
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.deepEqual(mapped.value, {
    category: "uncategorized",
    product: {
      name: { original: "  架空CPU  ", confirmed: "架空CPU" },
      manufacturer: {
        original: "架空メーカー",
        confirmed: "架空メーカー",
      },
    },
    normalizedAttributes: { category: "uncategorized" },
    sources: [
      {
        id: sourceId,
        pageUrl: "https://shop.example.invalid/product",
        capturedAt: "2026-07-28T00:00:00.000Z",
        price: {
          original: "JPY 32,100",
          confirmed: { amount: 32100, currency: "JPY" },
        },
      },
    ],
    primarySourceId: sourceId,
    sourceSnapshot: {
      name: "  架空CPU  ",
      "name:source": "heading",
      "name:sourceLabel": "h1",
      manufacturer: "架空メーカー",
      "manufacturer:source": "meta",
      "manufacturer:sourceLabel": "og:brand",
      price: "JPY 32,100",
      "price:source": "meta",
      "price:sourceLabel": "product:price",
    },
  });
  assert.equal("projectId" in mapped.value, false);
  assert.equal("sourceInfo" in mapped.value, false);
  assert.equal("price" in mapped.value.product, false);
  assert.equal("kind" in (mapped.value.sources?.[0] ?? {}), false);
  assert.deepEqual(mapped.value.sourceSnapshot, {
    name: "  架空CPU  ",
    "name:source": "heading",
    "name:sourceLabel": "h1",
    manufacturer: "架空メーカー",
    "manufacturer:source": "meta",
    "manufacturer:sourceLabel": "og:brand",
    price: "JPY 32,100",
    "price:source": "meta",
    "price:sourceLabel": "product:price",
  });
});

test("通常sourceとdomain-mapのprovenanceを公開pre-edit契約へ保持する", () => {
  const mapped = createCaptureDraftMapper().toEditorPrefill(
    captureResult([
      {
        field: "name",
        normalizedValue: "架空CPU",
        rawValue: "架空CPU",
        source: "heading",
        sourceLabel: "h1",
        documentOrder: 0,
      },
      {
        field: "manufacturer",
        normalizedValue: "架空メーカー",
        rawValue: "架空メーカー",
        source: "domain-map",
        sourceLabel: "maker.example",
        documentOrder: Number.MAX_SAFE_INTEGER,
      },
    ]),
  );
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.deepEqual(mapped.value.draft.sourceSnapshot, {
    name: "架空CPU",
    "name:source": "heading",
    "name:sourceLabel": "h1",
    manufacturer: "架空メーカー",
    "manufacturer:source": "domain-map",
    "manufacturer:sourceLabel": "maker.example",
  });
});

test("棄却値を露出せずfieldとstable reasonだけをeditor prefillへ渡す", () => {
  const input = {
    ...captureResult(),
    rejectedFields: [
      { field: "name", reason: "too-long" },
      { field: "price", reason: "invalid-format" },
      { field: "spec: socket:nested\u0000", reason: "unresolvable" },
      { field: "spec:another-page-label", reason: "unresolvable" },
    ],
  } as const;
  const mapped = createCaptureDraftMapper().toEditorPrefill(input);
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.deepEqual(mapped.value.captureDiagnostics, [
    { field: "name", reason: "too-long" },
    { field: "price", reason: "invalid-format" },
    { field: "specification", reason: "unresolvable" },
  ]);
  assert.equal(
    JSON.stringify(mapped.value.captureDiagnostics).includes("rawValue"),
    false,
  );
  assert.equal("captureDiagnostics" in mapped.value.draft, false);
});

test("カテゴリは確定せずcandidate editorの参考値へ写像する", () => {
  const mapped = createCaptureDraftMapper().toEditorPrefill(
    captureResult([
      {
        field: "category",
        normalizedValue: "CPUクーラー",
        rawValue: "PCパーツ > CPUクーラー",
        source: "breadcrumb",
        sourceLabel: "breadcrumb",
        documentOrder: 0,
      },
    ]),
  );
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.equal(mapped.value.draft.category, "uncategorized");
  assert.equal(mapped.value.categoryHint, "cpu-cooler");
});

test("候補ゼロの手入力開始では空の商品名を保持する", () => {
  assert.deepEqual(createCaptureDraftMapper().toManualDraft(), {
    category: "uncategorized",
    product: { name: { original: null, confirmed: "" } },
    normalizedAttributes: { category: "uncategorized" },
    sources: [],
  });
  const extracted = createCaptureDraftMapper().toUnresolvedDraft(
    captureResult(),
  );
  assert.equal(extracted.ok, true);
  if (extracted.ok) {
    assert.deepEqual(extracted.value.product.name, {
      original: null,
      confirmed: "",
    });
  }
});

test("構造不正と余分な値を拒否する", () => {
  const mapper = createCaptureDraftMapper();
  assert.deepEqual(mapper.toUnresolvedDraft({}), {
    ok: false,
    error: { kind: "invalid-payload" },
  });
  assert.deepEqual(
    mapper.toUnresolvedDraft({
      ...captureResult(),
      html: "<main>secret</main>",
    }),
    { ok: false, error: { kind: "invalid-payload" } },
  );
  for (const invalid of [
    captureResult([
      {
        field: "name",
        normalizedValue: "架空CPU",
        rawValue: "架空CPU",
        source: "not-a-source",
        sourceLabel: "h1",
        documentOrder: 0,
      },
    ]),
    {
      ...captureResult(),
      draft: { fields: [], missingCoreFields: [123] },
    },
    { ...captureResult(), rejectedFields: [{ anything: true }] },
    { ...captureResult(), capturedAt: "not-a-timestamp" },
    captureResult([
      {
        field: "price",
        normalizedValue: {
          amount: 100,
          currency: "JPY",
          html: "<secret>",
        },
        rawValue: "100 JPY",
        source: "meta",
        sourceLabel: "price",
        documentOrder: 0,
      },
    ]),
    captureResult([
      {
        field: "currency",
        normalizedValue: "JPY",
        rawValue: "JPY",
        source: "meta",
        sourceLabel: "currency",
        documentOrder: 1,
      },
    ]),
  ]) {
    assert.deepEqual(mapper.toUnresolvedDraft(invalid), {
      ok: false,
      error: { kind: "invalid-payload" },
    });
  }
  assert.equal(
    mapper.toUnresolvedDraft(
      captureResult([
        {
          field: "url",
          normalizedValue: "https://example.invalid/canonical",
          rawValue: "https://example.invalid/canonical",
          source: "meta",
          sourceLabel: "og:url",
          documentOrder: 0,
        },
      ]),
    ).ok,
    true,
  );
});
