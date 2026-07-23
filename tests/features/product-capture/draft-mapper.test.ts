import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectId,
  RequestId,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import type { CaptureSession } from "../../../src/features/product-capture/contracts.js";
import { toCandidateDraft } from "../../../src/features/product-capture/draft-mapper.js";

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
      value: { original: " 架空CPU X100 ", confirmed: "架空CPU X100" },
      source: "json-ld",
      sourceLabel: "JSON-LD name",
    },
    {
      field: "manufacturer",
      value: { original: "架空メーカー", confirmed: "架空メーカー" },
      source: "json-ld",
      sourceLabel: "JSON-LD brand",
    },
    {
      field: "price",
      value: {
        original: "42800 JPY",
        confirmed: { amount: 42800, currency: "JPY" },
      },
      source: "json-ld",
      sourceLabel: "JSON-LD offers.price",
    },
    {
      field: "url",
      value: {
        original: "https://shop.example.invalid/canonical",
        confirmed: "https://shop.example.invalid/canonical",
      },
      source: "meta",
      sourceLabel: "og:url",
    },
  ],
  rejectedFields: [],
  missingCoreFields: ["category", "modelNumber"],
  userCorrections: {},
  projectId: PROJECT_ID,
  ...overrides,
});

test("採用値からuncategorizedのCandidateDraftを生成する", () => {
  const result = toCandidateDraft(session());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.projectId, PROJECT_ID);
  assert.equal(result.value.category, "uncategorized");
  assert.deepEqual(result.value.normalizedAttributes, {
    category: "uncategorized",
  });
  assert.deepEqual(result.value.product.name, {
    original: " 架空CPU X100 ",
    confirmed: "架空CPU X100",
  });
  assert.deepEqual(result.value.product.manufacturer, {
    original: "架空メーカー",
    confirmed: "架空メーカー",
  });
  assert.deepEqual(result.value.product.price, {
    original: "42800 JPY",
    confirmed: { amount: 42800, currency: "JPY" },
  });
});

test("取得元URLはproductへ含めずsourceInfo.pageUrlだけを使う", () => {
  const result = toCandidateDraft(session());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    (result.value.product as unknown as Record<string, unknown>).url,
    undefined,
  );
  assert.equal(result.value.sourceInfo?.pageUrl, session().pageUrl);
  assert.equal(result.value.sourceInfo?.capturedAt, CAPTURED_AT);
});

test("欠損項目は元表記を保持しつつproductへ含めない", () => {
  const result = toCandidateDraft(session());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.product.modelNumber, undefined);
  assert.equal(result.value.sourceSnapshot?.modelNumber, undefined);
});

test("全項目の元表記をsourceSnapshotへ保持する", () => {
  const result = toCandidateDraft(session());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sourceSnapshot?.name, " 架空CPU X100 ");
  assert.equal(
    result.value.sourceSnapshot?.url,
    "https://shop.example.invalid/canonical",
  );
});

test("利用者修正値は元表記と区別して確認値に反映する", () => {
  const result = toCandidateDraft(
    session({ userCorrections: { name: "手修正した名前" } }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.product.name, {
    original: " 架空CPU X100 ",
    confirmed: "手修正した名前",
  });
});

test("価格の修正文字列は分離可能な時だけ確認値へ反映する", () => {
  const parsed = toCandidateDraft(
    session({ userCorrections: { price: "¥12,800" } }),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.product.price, {
    original: "42800 JPY",
    confirmed: { amount: 12800, currency: "JPY" },
  });

  const unparsable = toCandidateDraft(
    session({ userCorrections: { price: "お問い合わせください" } }),
  );
  assert.equal(unparsable.ok, true);
  if (!unparsable.ok) return;
  assert.deepEqual(unparsable.value.product.price, {
    original: "42800 JPY",
  });
});

test("商品名が空のセッションは検証エラーになる", () => {
  const result = toCandidateDraft(
    session({
      fields: [],
      missingCoreFields: [
        "name",
        "category",
        "manufacturer",
        "modelNumber",
        "price",
        "url",
      ],
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
});

test("projectId未選択のセッションはproject-requiredになる", () => {
  const { projectId: _projectId, ...withoutProject } = session();
  const result = toCandidateDraft(withoutProject);

  assert.deepEqual(result, { ok: false, error: { kind: "project-required" } });
});
