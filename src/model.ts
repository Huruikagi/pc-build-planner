/**
 * 永続化されるデータの形。`docs/reverse/features.md` 1 章に対応する。
 *
 * 現在構成は未実装。対応する画面を作るときにここへ足す。使う予定の
 * フィールドを先回りして定義しないこと。
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

/* --- カテゴリと正規化属性 (features.md 1.3) ----------------------------- */

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

export interface AttributeDefinition {
  readonly key: string;
  /** `list` はカンマ区切りの自由入力を受ける。 */
  readonly kind: "text" | "list";
}

/**
 * カテゴリごとに持てる属性。検証もフォームの項目もこの 1 か所から引く。
 *
 * ソケット名とメモリ規格は固定値リストを持たない。新規格が随時出るため
 * 自由文字列とする (`features.md` 1.3)。
 */
export const CATEGORY_ATTRIBUTES: Readonly<
  Record<PartCategory, readonly AttributeDefinition[]>
> = {
  cpu: [{ key: "socket", kind: "text" }],
  "cpu-cooler": [{ key: "supportedSockets", kind: "list" }],
  motherboard: [
    { key: "socket", kind: "text" },
    { key: "memoryStandard", kind: "text" },
    { key: "formFactor", kind: "text" },
  ],
  memory: [{ key: "memoryStandard", kind: "text" }],
  gpu: [],
  storage: [],
  "power-supply": [{ key: "formFactor", kind: "text" }],
  case: [
    { key: "supportedMotherboardFormFactors", kind: "list" },
    { key: "supportedPowerSupplyFormFactors", kind: "list" },
  ],
  "case-fan": [],
  "expansion-card": [],
  other: [],
  uncategorized: [],
};

/** 安定した既知規格。互換性判定の入力候補として提示するだけで、強制はしない。 */
export const MOTHERBOARD_FORM_FACTORS = [
  "E-ATX",
  "ATX",
  "Micro-ATX",
  "Mini-ITX",
] as const;

export const POWER_SUPPLY_FORM_FACTORS = ["ATX", "SFX", "SFX-L"] as const;

/* --- 値の二層構造 (features.md 1.2) ------------------------------------- */

/**
 * 自動取得された元表記と、利用者が確認した確定値を分離して保持する。
 * 互換性判定は `confirmed` だけを見る。`original` があるだけでは使わない。
 */
const sourcedValue = <T extends z.ZodType>(confirmed: T) =>
  z.object({
    original: z.string().nullable(),
    confirmed: confirmed.optional(),
  });

const sourcedText = sourcedValue(z.string());
const sourcedList = sourcedValue(z.array(z.string()));

export type SourcedText = z.infer<typeof sourcedText>;
export type SourcedList = z.infer<typeof sourcedList>;
export type SourcedAttribute = SourcedText | SourcedList;

/* --- 価格とソース (features.md 1.4 / 1.5) -------------------------------- */

const money = z.object({
  amount: z.number(),
  /** 取得元ページの表記を尊重する。取得できなければ推測しない。 */
  currency: z.string().min(1),
});

export type Money = z.infer<typeof money>;

export const SOURCE_KINDS = ["retail", "manufacturer"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

const candidateSource = z.object({
  id: z.string().min(1),
  url: z.url(),
  kind: z.enum(SOURCE_KINDS),
  /** UTC の ISO 8601。 */
  capturedAt: z.string(),
  price: money.nullable(),
  primary: z.boolean(),
});

export type CandidateSource = z.infer<typeof candidateSource>;

/* --- 候補パーツ ---------------------------------------------------------- */

const candidatePart = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** 唯一の必須項目。ほかは欠損したままで正常。 */
  name: z.string().min(1),
  manufacturer: sourcedText.nullable(),
  modelNumber: sourcedText.nullable(),
  category: z.enum(PART_CATEGORIES),
  attributes: z.record(z.string(), z.union([sourcedText, sourcedList])),
  sources: z.array(candidateSource),
});

export type CandidatePart = z.infer<typeof candidatePart>;

const project = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string(),
});

export type Project = z.infer<typeof project>;

/**
 * `chrome.storage.local` に単一キーで置くルート。書き込みはこの単位で
 * 原子的に置換する (`features.md` 6.1)。
 */
export const localDataRootSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  selectedProjectId: z.string().nullable(),
  projects: z.array(project),
  candidateParts: z.array(candidatePart),
});

export type LocalDataRoot = z.infer<typeof localDataRootSchema>;

export const createInitialRoot = (): LocalDataRoot => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 0,
  selectedProjectId: null,
  projects: [],
  candidateParts: [],
});

/* --- 表示のための派生 ---------------------------------------------------- */

export const primarySource = (part: CandidatePart): CandidateSource | null =>
  part.sources.find((source) => source.primary) ?? null;

/**
 * 通貨は取得したものをそのまま添える。ロケール別の書式は対象外なので
 * 桁区切りだけを固定で入れ、記号への変換はしない (`features.md` 1.4 / 7.6)。
 */
export const formatMoney = (value: Money): string =>
  `${value.amount.toLocaleString("en-US")} ${value.currency}`;

/** 未入力の項目数。0 なら「揃っている」。 */
export const missingFieldCount = (part: CandidatePart): number => {
  const confirmed = (value: SourcedAttribute | null): boolean =>
    value?.confirmed !== undefined;
  let missing = 0;
  if (!confirmed(part.manufacturer)) missing += 1;
  if (!confirmed(part.modelNumber)) missing += 1;
  if (part.category === "uncategorized") missing += 1;
  if (primarySource(part)?.price == null) missing += 1;
  for (const definition of CATEGORY_ATTRIBUTES[part.category])
    if (!confirmed(part.attributes[definition.key] ?? null)) missing += 1;
  return missing;
};
