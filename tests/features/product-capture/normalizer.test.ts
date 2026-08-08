import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtractionCandidate,
  SiteNameCandidate,
} from "../../../src/features/product-capture/contracts.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";

const normalizer = createCaptureNormalizer();

const candidate = (
  overrides: Partial<ExtractionCandidate> = {},
): ExtractionCandidate => ({
  documentOrder: 0,
  field: "name",
  rawValue: "架空CPU X100",
  source: "json-ld",
  sourceLabel: "JSON-LD name",
  ...overrides,
});

test("空白と制御文字を正規化し採用値にする", () => {
  const result = normalizer.normalize(
    candidate({ rawValue: "  架空\tCPU\n  X100  " }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.normalizedValue, "架空 CPU X100");
});

test("空文字列は空理由で棄却する", () => {
  const result = normalizer.normalize(candidate({ rawValue: "   " }));

  assert.deepEqual(result, {
    ok: false,
    error: { field: "name", reason: "empty" },
  });
});

test("制御文字だけの値は制御文字理由で棄却する", () => {
  const result = normalizer.normalize(
    candidate({ rawValue: "\u0007\u0007\u0001" }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "name", reason: "control-characters" },
  });
});

test("長すぎる文字列項目は棄却し理由を識別できる", () => {
  const result = normalizer.normalize(
    candidate({ rawValue: "あ".repeat(500) }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "name", reason: "too-long" },
  });
});

test("実行可能なマークアップも文字情報として扱い実行しない", () => {
  const result = normalizer.normalize(
    candidate({ rawValue: "<script>alert(1)</script>" }),
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.ok && result.value.normalizedValue,
    "<script>alert(1)</script>",
  );
});

test("解決可能なhttp/https URLだけを採用値にする", () => {
  const result = normalizer.normalize(
    candidate({
      field: "url",
      rawValue: "https://shop.example.invalid/products/x100",
      source: "open-graph",
      sourceLabel: "og:url",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.ok && result.value.normalizedValue,
    "https://shop.example.invalid/products/x100",
  );
});

test("javascript:スキームのURLは形式不正として棄却する", () => {
  const result = normalizer.normalize(
    candidate({ field: "url", rawValue: "javascript:alert(1)" }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "url", reason: "invalid-format" },
  });
});

test("解釈できないURL文字列は解決不能として棄却する", () => {
  const result = normalizer.normalize(
    candidate({ field: "url", rawValue: "not a url" }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "url", reason: "unresolvable" },
  });
});

test("長すぎるURLは棄却する", () => {
  const result = normalizer.normalize(
    candidate({
      field: "url",
      rawValue: `https://shop.example.invalid/${"a".repeat(2100)}`,
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "url", reason: "too-long" },
  });
});

test("通貨コード付き価格を金額と通貨へ分離できたときだけ採用する", () => {
  const result = normalizer.normalize(
    candidate({ field: "price", rawValue: "42800 JPY" }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value.normalizedValue, {
    amount: 42800,
    currency: "JPY",
  });
});

test("通貨記号付き価格を金額と通貨へ分離できる", () => {
  const result = normalizer.normalize(
    candidate({ field: "price", rawValue: "¥12,800" }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value.normalizedValue, {
    amount: 12800,
    currency: "JPY",
  });
});

test("円サフィックス表記の価格を分離できる", () => {
  const result = normalizer.normalize(
    candidate({ field: "price", rawValue: "12800円" }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value.normalizedValue, {
    amount: 12800,
    currency: "JPY",
  });
});

test("数値と通貨表記へ分離できない価格は解決不能として棄却する", () => {
  const result = normalizer.normalize(
    candidate({ field: "price", rawValue: "お問い合わせください" }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "price", reason: "unresolvable" },
  });
});

test("長すぎる価格表記は棄却する", () => {
  const result = normalizer.normalize(
    candidate({ field: "price", rawValue: `${"1".repeat(60)} JPY` }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { field: "price", reason: "too-long" },
  });
});

test("spec項目も文字項目として同じ規則で正規化する", () => {
  const accepted = normalizer.normalize(
    candidate({
      field: "spec:ソケット",
      rawValue: " AM5 ",
      source: "table",
      sourceLabel: "ソケット",
    }),
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.ok && accepted.value.normalizedValue, "AM5");

  const rejected = normalizer.normalize(
    candidate({ field: "spec:コア数", rawValue: "" }),
  );
  assert.deepEqual(rejected, {
    ok: false,
    error: { field: "spec:コア数", reason: "empty" },
  });
});

test("型を迂回した未知fieldと不正sourceLabelもnormalizerで棄却する", () => {
  assert.deepEqual(
    normalizer.normalize(candidate({ field: "unexpected-field" as never })),
    {
      ok: false,
      error: { field: "unexpected-field", reason: "invalid-format" },
    },
  );

  for (const [sourceLabel, reason] of [
    ["", "empty"],
    ["x".repeat(81), "too-long"],
    ["meta\u0000price", "control-characters"],
  ] as const) {
    assert.deepEqual(normalizer.normalize(candidate({ sourceLabel })), {
      ok: false,
      error: { field: "name", reason },
    });
  }
});

test("採用結果は元表記と取得根拠を保持する", () => {
  const result = normalizer.normalize(
    candidate({
      field: "manufacturer",
      rawValue: " 架空メーカー ",
      source: "json-ld",
      sourceLabel: "JSON-LD brand",
    }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok && {
      rawValue: result.value.rawValue,
      source: result.value.source,
      sourceLabel: result.value.sourceLabel,
    },
    {
      rawValue: " 架空メーカー ",
      source: "json-ld",
      sourceLabel: "JSON-LD brand",
    },
  );
});

const siteNameCandidate = (rawValue: string): SiteNameCandidate => ({
  rawValue,
  source: "open-graph",
  sourceLabel: "og:site_name",
  documentOrder: 0,
});

test("有効なsite nameを正規化しOpenGraph provenanceと元表記を保つ", () => {
  const rawValue = "  架空ショップ\u0009本店  ";

  assert.deepEqual(normalizer.normalizeSiteName(siteNameCandidate(rawValue)), {
    ok: true,
    value: {
      value: "架空ショップ 本店",
      rawValue,
      source: "open-graph",
      sourceLabel: "og:site_name",
    },
  });
});

test("site nameの空・空白だけ・制御文字だけ・過長を棄却理由つきで閉じる", () => {
  assert.deepEqual(normalizer.normalizeSiteName(siteNameCandidate("")), {
    ok: false,
    error: "empty",
  });
  assert.deepEqual(normalizer.normalizeSiteName(siteNameCandidate("   ")), {
    ok: false,
    error: "empty",
  });
  assert.deepEqual(normalizer.normalizeSiteName(siteNameCandidate("\u0001")), {
    ok: false,
    error: "control-characters",
  });
  assert.deepEqual(
    normalizer.normalizeSiteName(siteNameCandidate("あ".repeat(201))),
    { ok: false, error: "too-long" },
  );
});

test("site nameの実行可能マークアップは文字情報として保持する", () => {
  const result = normalizer.normalizeSiteName(
    siteNameCandidate("<img src=x onerror=alert(1)>架空ショップ"),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.value, "<img src=x onerror=alert(1)>架空ショップ");
});

test("site nameの棄却は商品項目の正規化から独立している", () => {
  assert.equal(normalizer.normalizeSiteName(siteNameCandidate("")).ok, false);
  assert.deepEqual(
    normalizer.normalize(candidate({ rawValue: "  架空GPU  " })),
    {
      ok: true,
      value: {
        field: "name",
        normalizedValue: "架空GPU",
        rawValue: "  架空GPU  ",
        source: "json-ld",
        sourceLabel: "JSON-LD name",
        documentOrder: 0,
      },
    },
  );
});
