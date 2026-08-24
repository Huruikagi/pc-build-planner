/**
 * 取り込みが採用してよい手掛かりの一覧。
 *
 * **サイト固有のロジックを持たない** (`docs/reverse/features.md` 2.2)。
 * ここを広げることは取得範囲を広げることなので、ページの表示が崩れた程度の
 * 理由で足さない。追加はセキュリティ方針と併せて判断する。
 *
 * 値は v0.4.0 の実装 (`salvage/extraction/`) から引き継いだもので、
 * 実サイトでの試行錯誤の結果を含む。
 */
import type { CaptureField, ExtractionSource } from "./types.js";

/* --- 走査量の上限。悪意あるページで固まらないための歯止め ---------------- */

export const LIMITS = {
  jsonLdScripts: 10,
  jsonLdNodesPerScript: 200,
  jsonLdDepth: 8,
  offersPerNode: 5,
  metaElements: 200,
  breadcrumbItems: 30,
  definitionLists: 20,
  definitionTermsPerList: 40,
  tableRows: 120,
  candidates: 200,
  rawValueLength: 2_000,
  urlLength: 2_048,
} as const;

/* --- JSON-LD ------------------------------------------------------------ */

export const JSON_LD_PRODUCT_KEYS = {
  name: "name",
  category: "category",
  brand: "brand",
  mpn: "mpn",
  sku: "sku",
  model: "model",
  url: "url",
  offers: "offers",
} as const;

export const JSON_LD_OFFER_KEYS = {
  price: "price",
  priceCurrency: "priceCurrency",
} as const;

/* --- meta の許可リスト -------------------------------------------------- */

export type MetadataNamespace = "open-graph" | "twitter-card" | "product";

interface MetadataRule {
  readonly namespace: MetadataNamespace;
  readonly property: string;
  readonly target: CaptureField | "priceCurrency";
}

/**
 * 採用してよい meta の組み合わせの全体。名前空間ごと採用することはせず、
 * プロパティ単位で列挙する。
 */
export const METADATA_RULES: readonly MetadataRule[] = [
  { namespace: "open-graph", property: "og:title", target: "name" },
  { namespace: "open-graph", property: "og:url", target: "url" },
  { namespace: "twitter-card", property: "twitter:title", target: "name" },
  { namespace: "product", property: "product:brand", target: "manufacturer" },
  {
    namespace: "product",
    property: "product:retailer_item_id",
    target: "modelNumber",
  },
  { namespace: "product", property: "product:price:amount", target: "price" },
  {
    namespace: "product",
    property: "product:price:currency",
    target: "priceCurrency",
  },
];

export const METADATA_SOURCE: Readonly<
  Record<MetadataNamespace, ExtractionSource>
> = {
  "open-graph": "open-graph",
  "twitter-card": "twitter-card",
  product: "product-meta",
};

const RULES_BY_PROPERTY = new Map(
  METADATA_RULES.map((rule) => [rule.property, rule]),
);

/**
 * ページが与えたプロパティ名を規則へ解決する。照合は正規化後の完全一致。
 * 接頭辞・接尾辞の一致や名前空間の一致だけでは採用しない。
 *
 * 大文字小文字と前後の空白だけを畳む。`NFKC` は使わない。全角の見た目が
 * 似た文字が許可リストの名前へ写ってしまい、偽装した属性が通る。
 */
export const findMetadataRule = (
  property: string,
): MetadataRule | undefined => {
  if (property.length > 100) return undefined;
  if (/\p{Cc}/u.test(property)) return undefined;
  return RULES_BY_PROPERTY.get(property.trim().toLowerCase());
};

/* --- 仕様表・定義リストの見出し ------------------------------------------ */

const MANUFACTURER_LABELS = new Set([
  "manufacturer",
  "brand",
  "maker",
  "メーカー",
  "製造元",
  "ブランド",
]);

const MODEL_NUMBER_LABELS = new Set([
  "model",
  "model number",
  "part number",
  "型番",
  "品番",
  "製品番号",
]);

/**
 * 表の行見出しから項目を決める。既知の見出しだけを採用し、それ以外の行は
 * 取り込まない。正規化属性 (ソケット等) の自動判定はしない。
 * 規格値は利用者が確認して確定させるものなので、ここで推測しない。
 */
export const fieldForLabel = (label: string): CaptureField | null => {
  const normalized = label.trim().normalize("NFKC").toLowerCase();
  if (MANUFACTURER_LABELS.has(normalized)) return "manufacturer";
  if (MODEL_NUMBER_LABELS.has(normalized)) return "modelNumber";
  return null;
};

/* --- 価格 ---------------------------------------------------------------- */

/**
 * ロケール固有の取り込み支援データ。**表示文言ではない**ので翻訳対象外。
 * 他ロケールでの動作を妨げない加算的な最適化として持つ
 * (`features.md` 7.5)。
 */
export const YEN_SUFFIX_PATTERN = /^([\d,]+(?:\.\d+)?)\s*円$/;

export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  "¥": "JPY",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};
