import type { PartCategory } from "../../../domain/public.js";

/** Display names for the 12 part categories. Shared across features. */
export const category = {
  cpu: "CPU",
  "cpu-cooler": "CPU cooler",
  motherboard: "Motherboard",
  memory: "Memory",
  gpu: "GPU",
  storage: "Storage",
  "power-supply": "Power supply",
  case: "Case",
  "case-fan": "Case fan",
  "expansion-card": "Expansion card",
  other: "Other",
  uncategorized: "Uncategorized",
} as const satisfies Record<PartCategory, string>;
