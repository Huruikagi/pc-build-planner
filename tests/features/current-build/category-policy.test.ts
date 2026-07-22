import assert from "node:assert/strict";
import test from "node:test";
import type { PartCategory } from "../../../src/domain/public.js";
import { PART_CATEGORIES } from "../../../src/domain/public.js";
import {
  createCategoryPolicy,
  isValidQuantity,
  type SelectionMode,
} from "../../../src/features/current-build/category-policy.js";

const SINGLE_CATEGORIES: readonly PartCategory[] = [
  "cpu",
  "cpu-cooler",
  "motherboard",
  "power-supply",
  "case",
];

const MULTIPLE_CATEGORIES: readonly PartCategory[] = [
  "memory",
  "gpu",
  "storage",
  "case-fan",
  "expansion-card",
  "other",
];

const INELIGIBLE_CATEGORIES: readonly PartCategory[] = ["uncategorized"];

test("CPU、CPUクーラー、マザーボード、電源、ケースは単一選択である", () => {
  const policy = createCategoryPolicy();
  for (const category of SINGLE_CATEGORIES) {
    assert.equal(policy.modeFor(category), "single");
  }
});

test("メモリ、GPU、ストレージ、ケースファン、拡張カード、その他は複数選択である", () => {
  const policy = createCategoryPolicy();
  for (const category of MULTIPLE_CATEGORIES) {
    assert.equal(policy.modeFor(category), "multiple");
  }
});

test("未分類カテゴリは選択不可である", () => {
  const policy = createCategoryPolicy();
  for (const category of INELIGIBLE_CATEGORIES) {
    assert.equal(policy.modeFor(category), "ineligible");
  }
});

test("全canonicalカテゴリはちょうど一つの選択方式へ排他的に分類される", () => {
  const policy = createCategoryPolicy();
  const grouped = {
    single: new Set(SINGLE_CATEGORIES),
    multiple: new Set(MULTIPLE_CATEGORIES),
    ineligible: new Set(INELIGIBLE_CATEGORIES),
  } as const;

  assert.equal(
    SINGLE_CATEGORIES.length +
      MULTIPLE_CATEGORIES.length +
      INELIGIBLE_CATEGORIES.length,
    PART_CATEGORIES.length,
    "単一・複数・選択不可の合計はcanonicalカテゴリ総数と一致しなければならない",
  );

  for (const category of PART_CATEGORIES) {
    const mode = policy.modeFor(category);
    const memberships = (["single", "multiple", "ineligible"] as const).filter(
      (candidate) => grouped[candidate].has(category),
    );

    assert.equal(
      memberships.length,
      1,
      `${category} はちょうど一つの選択方式グループへ属さなければならない`,
    );
    assert.equal(mode, memberships[0]);
  }
});

test("単一選択カテゴリは数量1だけを受け付ける", () => {
  const mode: SelectionMode = "single";
  assert.equal(isValidQuantity(mode, 1), true);
  assert.equal(isValidQuantity(mode, 2), false);
  assert.equal(isValidQuantity(mode, 0), false);
  assert.equal(isValidQuantity(mode, -1), false);
  assert.equal(isValidQuantity(mode, 1.5), false);
});

test("複数選択カテゴリは正整数だけを受け付ける", () => {
  const mode: SelectionMode = "multiple";
  assert.equal(isValidQuantity(mode, 1), true);
  assert.equal(isValidQuantity(mode, 5), true);
  assert.equal(isValidQuantity(mode, 0), false);
  assert.equal(isValidQuantity(mode, -1), false);
  assert.equal(isValidQuantity(mode, 2.5), false);
});

test("選択不可カテゴリはどの数量も受け付けない", () => {
  const mode: SelectionMode = "ineligible";
  assert.equal(isValidQuantity(mode, 1), false);
  assert.equal(isValidQuantity(mode, 0), false);
});
