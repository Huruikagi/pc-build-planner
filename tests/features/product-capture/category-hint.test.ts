import assert from "node:assert/strict";
import test from "node:test";
import { inferCategoryHint } from "../../../src/features/product-capture/category-hint.js";

test("代表的な日本語ラベルを対応するカテゴリへ推定する", () => {
  assert.equal(inferCategoryHint("CPU"), "cpu");
  assert.equal(inferCategoryHint("グラフィックボード"), "gpu");
  assert.equal(inferCategoryHint("マザーボード"), "motherboard");
  assert.equal(inferCategoryHint("メモリ"), "memory");
  assert.equal(inferCategoryHint("SSD"), "storage");
  assert.equal(inferCategoryHint("電源ユニット"), "power-supply");
  assert.equal(inferCategoryHint("PCケース"), "case");
});

test("より具体的なカテゴリを広いキーワードより優先する", () => {
  assert.equal(inferCategoryHint("CPUクーラー"), "cpu-cooler");
  assert.equal(inferCategoryHint("ケースファン"), "case-fan");
});

test("英語ラベルとパンくず断片も推定できる", () => {
  assert.equal(inferCategoryHint("Graphics Card"), "gpu");
  assert.equal(inferCategoryHint("PCパーツ > CPU > AMD"), "cpu");
});

test("該当しない値・空・未定義ではundefinedを返す", () => {
  assert.equal(inferCategoryHint("配送方法"), undefined);
  assert.equal(inferCategoryHint(""), undefined);
  assert.equal(inferCategoryHint("   "), undefined);
  assert.equal(inferCategoryHint(undefined), undefined);
});
