import type { PartCategory } from "../model.js";

/**
 * 日本語ロケール向けの取り込み支援データ（表示文言ではない）。
 *
 * これは商品ページの自由記述からカテゴリを推定するためのキーワード辞書で
 * あり、UIに表示する文言ではない。翻訳対象外である: 他ロケールでの動作を
 * 妨げない加算的な最適化であり、他言語向けキーワードの追加（多言語化）は
 * 本 spec の対象外である。
 *
 * 順序は最も具体的なキーワードを先に置く（`category-hint.ts` の
 * `inferCategoryHint` がこの順で走査し、最初に一致したカテゴリを採用する）。
 *
 * v0.4.0 の `src/features/product-capture/locale/ja-category-keywords.ts`
 * から辞書をそのまま引き継いでいる。
 */
export const JA_CATEGORY_KEYWORDS: readonly (readonly [
  PartCategory,
  readonly string[],
])[] = [
  [
    "cpu-cooler",
    [
      "cpuクーラー",
      "cpuクーラ",
      "cpu cooler",
      "クーラー",
      "クーラ",
      "cooler",
      "水冷",
      "空冷",
    ],
  ],
  ["case-fan", ["ケースファン", "case fan", "ファン", "fan"]],
  [
    "motherboard",
    ["マザーボード", "マザボ", "mother board", "motherboard", "mainboard"],
  ],
  [
    "power-supply",
    ["電源ユニット", "電源", "power supply", "power-supply", "psu"],
  ],
  [
    "expansion-card",
    [
      "拡張カード",
      "拡張ボード",
      "expansion card",
      "expansion-card",
      "サウンドカード",
      "キャプチャーボード",
      "キャプチャボード",
    ],
  ],
  [
    "gpu",
    [
      "グラフィックボード",
      "グラフィックスボード",
      "グラフィックカード",
      "ビデオカード",
      "graphics card",
      "graphics-card",
      "video card",
      "gpu",
      "vga",
    ],
  ],
  ["cpu", ["cpu", "プロセッサー", "プロセッサ", "processor"]],
  ["memory", ["メモリー", "メモリ", "memory", "dram", "ram"]],
  [
    "storage",
    [
      "ストレージ",
      "ハードディスク",
      "hard drive",
      "hard disk",
      "storage",
      "ssd",
      "hdd",
      "nvme",
      "m.2",
    ],
  ],
  [
    "case",
    [
      "pcケース",
      "パソコンケース",
      "pc case",
      "computer case",
      "シャーシ",
      "chassis",
      "ケース",
      "case",
    ],
  ],
];
