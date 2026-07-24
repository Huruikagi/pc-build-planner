import type { PartCategory } from "../../domain/public.js";

/**
 * Best-effort mapping from a free-text category label (JSON-LD `category`,
 * breadcrumb segment, ...) to a `PartCategory`. This never *confirms* a
 * category: it only produces a non-binding suggestion that seeds the detail
 * editor's default selection, so Requirement 3.6 ("推測で確定しない") is kept —
 * the value becomes formal only after the user ratifies it in the editor.
 *
 * Entries are ordered most-specific first so that, for example, "CPUクーラー"
 * resolves to `cpu-cooler` (via "クーラー") before the broader "cpu" keyword can
 * match. `other` and `uncategorized` are intentionally never inferred.
 */
const CATEGORY_KEYWORDS: readonly (readonly [
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

/**
 * Returns a suggested `PartCategory` for a raw label, or `undefined` when no
 * keyword matches confidently. Matching is case-insensitive substring; the
 * caller must treat the result as a hint, never as a confirmed category.
 */
export const inferCategoryHint = (
  raw: string | undefined,
): PartCategory | undefined => {
  if (raw === undefined) return undefined;
  const haystack = raw.toLowerCase();
  if (haystack.trim().length === 0) return undefined;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }
  return undefined;
};
