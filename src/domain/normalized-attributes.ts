import type { UtcTimestamp } from "./identifiers.js";

export const PART_CATEGORIES = [
  "cpu",
  "cpu-cooler",
  "motherboard",
  "memory",
  "gpu",
  "storage",
  "power-supply",
  "case",
  "case-fan",
  "expansion-card",
  "other",
  "uncategorized",
] as const;

export type PartCategory = (typeof PART_CATEGORIES)[number];

/** 安定した既知規格の一覧。ソケットやメモリ規格と異なり新規格の追加頻度が低いため固定値として持つ。 */
export const MOTHERBOARD_FORM_FACTORS = [
  "E-ATX",
  "ATX",
  "Micro-ATX",
  "Mini-ITX",
] as const;

export const POWER_SUPPLY_FORM_FACTORS = ["ATX", "SFX", "SFX-L"] as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

/** 自動取得された元表記と、利用者が確認・修正した値を分離する。 */
export interface SourcedValue<T extends JsonValue> {
  readonly original: string | null;
  readonly confirmed?: T;
}

/** field名ごとの元表記を、明示的な欠損を含めて保持する。 */
export type SourceSnapshot = Readonly<Record<string, string | null>>;

export interface SourceInfo {
  readonly pageUrl?: string;
  readonly siteName?: string;
  readonly capturedAt?: UtcTimestamp;
}

export interface MoneyValue extends Readonly<Record<string, JsonValue>> {
  readonly amount: number;
  readonly currency: string;
}

/** URL以外は欠損を正常状態として表現する共通商品値。 */
export interface CandidateProductValues {
  readonly name?: SourcedValue<string>;
  readonly manufacturer?: SourcedValue<string>;
  readonly modelNumber?: SourcedValue<string>;
  readonly price?: SourcedValue<MoneyValue>;
  readonly notes?: SourcedValue<string>;
}

export interface CpuAttributes {
  readonly category: "cpu";
  readonly socket?: SourcedValue<string>;
}

export interface CpuCoolerAttributes {
  readonly category: "cpu-cooler";
  readonly supportedSockets?: SourcedValue<readonly string[]>;
}

export interface MotherboardAttributes {
  readonly category: "motherboard";
  readonly socket?: SourcedValue<string>;
  readonly memoryStandard?: SourcedValue<string>;
  readonly formFactor?: SourcedValue<string>;
}

export interface MemoryAttributes {
  readonly category: "memory";
  readonly memoryStandard?: SourcedValue<string>;
}

export interface GpuAttributes {
  readonly category: "gpu";
}

export interface StorageAttributes {
  readonly category: "storage";
}

export interface PowerSupplyAttributes {
  readonly category: "power-supply";
  readonly formFactor?: SourcedValue<string>;
}

export interface CaseAttributes {
  readonly category: "case";
  readonly supportedMotherboardFormFactors?: SourcedValue<readonly string[]>;
  readonly supportedPowerSupplyFormFactors?: SourcedValue<readonly string[]>;
}

export interface CaseFanAttributes {
  readonly category: "case-fan";
}

export interface ExpansionCardAttributes {
  readonly category: "expansion-card";
}

export interface OtherAttributes {
  readonly category: "other";
}

export interface UncategorizedAttributes {
  readonly category: "uncategorized";
}

export type NormalizedAttributes =
  | CpuAttributes
  | CpuCoolerAttributes
  | MotherboardAttributes
  | MemoryAttributes
  | GpuAttributes
  | StorageAttributes
  | PowerSupplyAttributes
  | CaseAttributes
  | CaseFanAttributes
  | ExpansionCardAttributes
  | OtherAttributes
  | UncategorizedAttributes;
