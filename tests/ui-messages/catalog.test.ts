import assert from "node:assert/strict";
import test from "node:test";
import type { PartCategory } from "../../src/domain/public.js";
import { PART_CATEGORIES } from "../../src/domain/public.js";
import { MESSAGES } from "../../src/ui-messages/catalog/index.js";
import { resolverFor } from "../../src/ui-messages/public.js";

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
    "保存容量が不足しています。不要なパーツを削除してからもう一度お試しください。",
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

test("transient product-capture は navigation と legacy 保存 message を公開しない", () => {
  assert.equal("productCapture" in MESSAGES.nav, false);

  const capture = MESSAGES.capture as Readonly<Record<string, unknown>>;
  for (const legacyKey of [
    "saveDestinationLabel",
    "selectPrompt",
    "noProjectsNotice",
    "reviewTitle",
    "submittingTitle",
    "submittingStatus",
    "savedTitle",
    "savedWithoutProject",
    "savedWithProject",
    "captureAnotherAction",
  ]) {
    assert.equal(legacyKey in capture, false, legacyKey);
  }
  assert.equal(typeof capture.manualEntryAction, "string");
});

test("v0.3.0 settings・shell回復・capture回復messageをja/enで解決できる", () => {
  const ja = resolverFor("ja");
  const en = resolverFor("en");

  const expected = {
    "nav.settings": ["設定", "Settings"],
    "settings.title": ["設定", "Settings"],
    "settings.language.title": ["表示言語", "Display language"],
    "settings.language.description": [
      "画面に表示する言語を選択します。",
      "Choose the language used by the interface.",
    ],
    "settings.backupRestore.title": ["バックアップ・復元", "Backup & Restore"],
    "settings.backupRestore.description": [
      "ローカルデータをファイルへ退避し、必要なときに復元します。",
      "Back up local data to a file and restore it when needed.",
    ],
    "shell.transientActivationFailed": [
      "一過性の表示を開始できませんでした。拡張アイコンをもう一度操作して、新しい権限で起動してください。",
      "The temporary view couldn't start. Click the extension icon again to start it with newly granted access.",
    ],
    "shell.transientActivationExpired": [
      "この表示の起動情報は失効しました。古い画面から再実行せず、拡張アイコンをもう一度操作して新しい表示を起動してください。",
      "This view's activation has expired. Don't retry from the stale view; click the extension icon again to start a new one.",
    ],
    "shell.settingsRecoveryLoading": [
      "読み込み中です。表示言語は設定 / Settings から変更できます。読み込み完了までお待ちください。",
      "Loading. You can change the display language in 設定 / Settings. Wait for loading to finish.",
    ],
    "shell.settingsRecoveryStartupFailed": [
      "起動に失敗しました。表示言語は設定 / Settings から変更できます。再試行してください。",
      "Startup failed. You can change the display language in 設定 / Settings. Try again.",
    ],
    "capture.errors.permission-lost": [
      "ページへのアクセス権限が失効しました。ページを表示し直してから拡張アイコンをもう一度操作し、権限を付与し直してください。",
      "Permission to access the page has expired. Reload the page, then click the extension icon again to grant access again.",
    ],
    "capture.newGenerationHint": [
      "拡張アイコンを新しく操作すると、古い失敗状態や保持中の結果は新しい取り込みで置き換わります。",
      "A new extension icon gesture replaces any stale failure or retained result with a new capture.",
    ],
    "capture.handoffRetainedNotice": [
      "取り込み結果は現在の起動世代に保持されています。",
      "The capture result is retained for the current activation generation.",
    ],
    "capture.retryHandoffAction": ["引き渡しを再試行", "Retry handoff"],
  } as const;

  const resolve = (resolver: typeof ja, key: string): string =>
    (resolver as unknown as (messageKey: string) => string)(key);
  for (const [key, [jaText, enText]] of Object.entries(expected)) {
    assert.equal(resolve(ja, key), jaText, key);
    assert.equal(resolve(en, key), enText, key);
  }
});
