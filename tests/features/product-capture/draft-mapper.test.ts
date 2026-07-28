import assert from "node:assert/strict";
import test from "node:test";
import type { TargetTabId } from "../../../src/application-shell/public.js";
import type { RequestId, UtcTimestamp } from "../../../src/domain/public.js";
import { createCaptureDraftMapper } from "../../../src/features/product-capture/draft-mapper.js";

const captureResult = (fields: readonly unknown[] = []) => ({
  requestId: "80000000-0000-4000-8000-000000000001" as RequestId,
  tabId: 7 as TargetTabId,
  pageUrl: "https://shop.example.invalid/product",
  capturedAt: "2026-07-28T00:00:00.000Z" as UtcTimestamp,
  draft: { fields, missingCoreFields: [] },
  rejectedFields: [],
});

test("抽出結果をproject未解決draftへ必要最小限で写像する", () => {
  const mapped = createCaptureDraftMapper().toUnresolvedDraft(
    captureResult([
      {
        field: "name",
        normalizedValue: "架空CPU",
        rawValue: "  架空CPU  ",
        source: "heading",
        sourceLabel: "h1",
      },
      {
        field: "manufacturer",
        normalizedValue: "架空メーカー",
        rawValue: "架空メーカー",
        source: "meta",
        sourceLabel: "og:brand",
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
    sourceInfo: {
      pageUrl: "https://shop.example.invalid/product",
      capturedAt: "2026-07-28T00:00:00.000Z",
    },
    sourceSnapshot: {
      name: "  架空CPU  ",
      "name:source": "heading",
      "name:sourceLabel": "h1",
      manufacturer: "架空メーカー",
      "manufacturer:source": "meta",
      "manufacturer:sourceLabel": "og:brand",
    },
  });
  assert.equal("projectId" in mapped.value, false);
  assert.deepEqual(mapped.value.sourceInfo, {
    pageUrl: "https://shop.example.invalid/product",
    capturedAt: "2026-07-28T00:00:00.000Z",
  });
  assert.deepEqual(mapped.value.sourceSnapshot, {
    name: "  架空CPU  ",
    "name:source": "heading",
    "name:sourceLabel": "h1",
    manufacturer: "架空メーカー",
    "manufacturer:source": "meta",
    "manufacturer:sourceLabel": "og:brand",
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
      },
      {
        field: "manufacturer",
        normalizedValue: "架空メーカー",
        rawValue: "架空メーカー",
        source: "domain-map",
        sourceLabel: "maker.example",
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

test("カテゴリは確定せずcandidate editorの参考値へ写像する", () => {
  const mapped = createCaptureDraftMapper().toEditorPrefill(
    captureResult([
      {
        field: "category",
        normalizedValue: "CPUクーラー",
        rawValue: "PCパーツ > CPUクーラー",
        source: "breadcrumb",
        sourceLabel: "breadcrumb",
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
      },
    ]),
    captureResult([
      {
        field: "currency",
        normalizedValue: "JPY",
        rawValue: "JPY",
        source: "meta",
        sourceLabel: "currency",
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
        },
      ]),
    ).ok,
    true,
  );
});
