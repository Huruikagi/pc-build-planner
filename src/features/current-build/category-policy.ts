import type { PartCategory, PositiveInteger } from "../../domain/public.js";

export type SelectionMode = "single" | "multiple" | "ineligible";

export interface CategoryPolicy {
  modeFor(category: PartCategory): SelectionMode;
}

const CATEGORY_MODES: Readonly<Record<PartCategory, SelectionMode>> = {
  cpu: "single",
  "cpu-cooler": "single",
  motherboard: "single",
  "power-supply": "single",
  case: "single",
  memory: "multiple",
  gpu: "multiple",
  storage: "multiple",
  "case-fan": "multiple",
  "expansion-card": "multiple",
  other: "multiple",
  uncategorized: "ineligible",
};

export function createCategoryPolicy(): CategoryPolicy {
  return {
    modeFor(category) {
      return CATEGORY_MODES[category];
    },
  };
}

/** 単一選択カテゴリは数量1固定、複数選択カテゴリは正整数だけを許可する規則を一元化する。 */
export function isValidQuantity(
  mode: SelectionMode,
  quantity: number,
): quantity is PositiveInteger {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return false;
  }
  return mode === "single" ? quantity === 1 : mode === "multiple";
}
