import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedField } from "../../../src/features/product-capture/contracts.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";

const ranker = createCandidateRanker();

const field = (overrides: Partial<NormalizedField> = {}): NormalizedField => ({
  field: "name",
  normalizedValue: "架空品",
  rawValue: "架空品",
  source: "json-ld",
  sourceLabel: "JSON-LD name",
  ...overrides,
});

test("同一項目は構造化データ、meta、見出し・パンくず、表・定義リストの順で選ぶ", () => {
  const draft = ranker.select([
    field({ normalizedValue: "table版", rawValue: "table版", source: "table" }),
    field({ normalizedValue: "meta版", rawValue: "meta版", source: "meta" }),
    field({
      normalizedValue: "json-ld版",
      rawValue: "json-ld版",
      source: "json-ld",
    }),
    field({
      normalizedValue: "heading版",
      rawValue: "heading版",
      source: "heading",
    }),
  ]);

  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0]?.normalizedValue, "json-ld版");
  assert.equal(draft.fields[0]?.source, "json-ld");
});

test("見出しとパンくずは同順位として扱う", () => {
  const draft = ranker.select([
    field({
      normalizedValue: "breadcrumb版",
      rawValue: "breadcrumb版",
      field: "category",
      source: "breadcrumb",
    }),
    field({
      normalizedValue: "heading版",
      rawValue: "heading版",
      field: "category",
      source: "heading",
    }),
  ]);

  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0]?.source, "breadcrumb");
  assert.equal(draft.fields[0]?.normalizedValue, "breadcrumb版");
});

test("表と定義リストは同順位として扱う", () => {
  const draft = ranker.select([
    field({
      normalizedValue: "definition-list版",
      rawValue: "definition-list版",
      field: "spec:ソケット",
      source: "definition-list",
    }),
    field({
      normalizedValue: "table版",
      rawValue: "table版",
      field: "spec:ソケット",
      source: "table",
    }),
  ]);

  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0]?.source, "definition-list");
});

test("同順位は文書順(配列の並び)で決定する", () => {
  const first = ranker.select([
    field({ normalizedValue: "1件目", rawValue: "1件目", source: "meta" }),
    field({ normalizedValue: "2件目", rawValue: "2件目", source: "meta" }),
  ]);
  assert.equal(first.fields[0]?.normalizedValue, "1件目");

  const reversed = ranker.select([
    field({ normalizedValue: "2件目", rawValue: "2件目", source: "meta" }),
    field({ normalizedValue: "1件目", rawValue: "1件目", source: "meta" }),
  ]);
  assert.equal(reversed.fields[0]?.normalizedValue, "2件目");
});

test("候補がない既知項目は欠損項目として識別できる", () => {
  const draft = ranker.select([
    field({ field: "name" }),
    field({ field: "manufacturer", source: "meta" }),
  ]);

  assert.deepEqual(
    [...draft.missingCoreFields].sort(),
    ["category", "modelNumber", "price", "url"].sort(),
  );
});

test("spec項目は既知項目でないため欠損として報告しない", () => {
  const draft = ranker.select([field({ field: "spec:ソケット" })]);

  assert.equal(
    draft.missingCoreFields.includes("spec:ソケット" as never),
    false,
  );
  assert.deepEqual(
    [...draft.missingCoreFields].sort(),
    ["category", "manufacturer", "modelNumber", "name", "price", "url"].sort(),
  );
});

test("採用値は元表記と取得根拠を保持したまま返す", () => {
  const draft = ranker.select([
    field({
      field: "price",
      normalizedValue: { amount: 42800, currency: "JPY" },
      rawValue: "42800 JPY",
      source: "json-ld",
      sourceLabel: "JSON-LD offers.price",
    }),
  ]);

  assert.deepEqual(draft.fields[0], {
    field: "price",
    normalizedValue: { amount: 42800, currency: "JPY" },
    rawValue: "42800 JPY",
    source: "json-ld",
    sourceLabel: "JSON-LD offers.price",
  });
});

test("異なる項目は互いに影響せず独立して選ばれる", () => {
  const draft = ranker.select([
    field({ field: "name", normalizedValue: "架空名", rawValue: "架空名" }),
    field({
      field: "manufacturer",
      normalizedValue: "架空メーカー",
      rawValue: "架空メーカー",
      source: "meta",
    }),
  ]);

  assert.equal(draft.fields.length, 2);
  const byField = new Map(draft.fields.map((entry) => [entry.field, entry]));
  assert.equal(byField.get("name")?.normalizedValue, "架空名");
  assert.equal(byField.get("manufacturer")?.normalizedValue, "架空メーカー");
});

test("複数候補を含む架空ページで採用値と根拠は常に同じになる", () => {
  const candidates = [
    field({ normalizedValue: "table版", rawValue: "table版", source: "table" }),
    field({ normalizedValue: "meta版", rawValue: "meta版", source: "meta" }),
    field({
      field: "manufacturer",
      normalizedValue: "架空メーカー",
      rawValue: "架空メーカー",
      source: "meta",
    }),
  ];

  const first = ranker.select(candidates);
  const second = ranker.select(candidates);

  assert.deepEqual(first, second);
});

test("候補が一件もない場合はすべての既知項目が欠損になる", () => {
  const draft = ranker.select([]);

  assert.deepEqual(draft.fields, []);
  assert.deepEqual(
    [...draft.missingCoreFields].sort(),
    ["category", "manufacturer", "modelNumber", "name", "price", "url"].sort(),
  );
});
