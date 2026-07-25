import assert from "node:assert/strict";
import test from "node:test";
import type { PartCategory } from "../../src/domain/public.js";
import { PART_CATEGORIES } from "../../src/domain/public.js";
import { MESSAGES } from "../../src/ui-messages/catalog/index.js";

// Compile-time guarantee (5.4): an incomplete category table fails typecheck
// (missing "gpu"), demonstrating that a category addition/removal is caught
// by `pnpm typecheck` rather than discovered at runtime.
// @ts-expect-error missing "gpu" must fail Record<PartCategory, string> coverage.
const _incompleteCategoryTable: Record<PartCategory, string> = {
  cpu: "CPU",
  "cpu-cooler": "CPUクーラー",
  motherboard: "マザーボード",
  memory: "メモリ",
  storage: "ストレージ",
  "power-supply": "電源",
  case: "ケース",
  "case-fan": "ケースファン",
  "expansion-card": "拡張カード",
  other: "その他",
  uncategorized: "未分類",
};
void _incompleteCategoryTable;

// The pre-migration table transcribed from `categoryLabels` in
// candidate-management/view.tsx and current-build/view.tsx (identical in both).
const PRE_MIGRATION_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  cpu: "CPU",
  "cpu-cooler": "CPUクーラー",
  motherboard: "マザーボード",
  memory: "メモリ",
  gpu: "GPU",
  storage: "ストレージ",
  "power-supply": "電源",
  case: "ケース",
  "case-fan": "ケースファン",
  "expansion-card": "拡張カード",
  other: "その他",
  uncategorized: "未分類",
};

test("category名前空間はPartCategoryを1件ずつ、移行前と同じ表示名で網羅する", () => {
  assert.deepEqual(
    Object.keys(MESSAGES.category).sort(),
    [...PART_CATEGORIES].sort(),
  );
  for (const category of PART_CATEGORIES) {
    assert.equal(
      MESSAGES.category[category],
      PRE_MIGRATION_CATEGORY_LABELS[category],
    );
  }
});

// The pre-migration texts transcribed from candidate-management/current-build's
// `errorMessages` tables, limited to the codes design.md names as integrable
// (identical wording across both features).
const PRE_MIGRATION_PERSISTENCE_ERROR: Readonly<Record<string, string>> = {
  validation: "入力内容を確認してください。",
  maintenance: "保守操作の実行中です。完了後にもう一度お試しください。",
  quota:
    "保存容量が不足しています。不要な候補を削除してからもう一度お試しください。",
  conflict:
    "他の変更と競合しました。最新の内容を読み込んでからもう一度お試しください。",
  snapshotRestoreFailed: "前回の画面状態を復元できませんでした。",
};

test("persistenceError名前空間は統合対象コードだけを、移行前と1件ずつ同じ文言で保持する", () => {
  assert.deepEqual(
    Object.keys(MESSAGES.persistenceError).sort(),
    Object.keys(PRE_MIGRATION_PERSISTENCE_ERROR).sort(),
  );
  for (const [code, text] of Object.entries(PRE_MIGRATION_PERSISTENCE_ERROR)) {
    assert.equal(
      (MESSAGES.persistenceError as Readonly<Record<string, string>>)[code],
      text,
    );
  }
});
