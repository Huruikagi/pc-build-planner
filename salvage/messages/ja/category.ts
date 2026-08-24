import type { PartCategory } from "../../../domain/public.js";

/**
 * パーツカテゴリ12種の表示名。候補管理・現在構成・商品取り込みの3箇所に
 * 重複していた表を単一定義へ統合する。`satisfies Record<PartCategory, string>`
 * が、カテゴリの増減を型検査の段階で検出する。
 */
export const category = {
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
} as const satisfies Record<PartCategory, string>;
