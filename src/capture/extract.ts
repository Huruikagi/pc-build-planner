/**
 * ページ側で走る抽出。**DOM だけを見て、判断はしない。**
 *
 * ここが返すのは「こう書いてあった」という生の候補であり、検証も採否も
 * しない。検証は `normalize.ts` が、採否は最終的に利用者が行う。
 *
 * サイト固有のセレクタを持たない。使う手掛かりは `rules.ts` が列挙した
 * 汎用のものだけで、結果として国・言語に依存しない
 * (`docs/reverse/features.md` 2.2)。
 */

import { manufacturerDomainMatchForUrl } from "./manufacturer-domain-map.js";
import {
  fieldForLabel,
  findMetadataRule,
  JSON_LD_OFFER_KEYS,
  JSON_LD_PRODUCT_KEYS,
  LIMITS,
  METADATA_SOURCE,
} from "./rules.js";
import type { CaptureField, CapturePayload, RawCandidate } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const typeMatches = (value: unknown, expected: string): boolean =>
  value === expected ||
  (Array.isArray(value) && value.some((entry) => entry === expected));

class Sink {
  readonly candidates: RawCandidate[] = [];

  get full(): boolean {
    return this.candidates.length >= LIMITS.candidates;
  }

  push(
    field: CaptureField | null,
    rawValue: string | null | undefined,
    source: RawCandidate["source"],
    sourceLabel: string,
  ): void {
    if (this.full || field === null) return;
    const trimmed = (rawValue ?? "").trim();
    if (trimmed === "") return;
    /** 極端に長い値はここで切る。検証は normalize 側で改めて行う。 */
    this.candidates.push({
      field,
      rawValue: trimmed.slice(0, LIMITS.rawValueLength),
      source,
      sourceLabel,
    });
  }
}

/* --- JSON-LD ------------------------------------------------------------ */

function* productNodes(
  node: unknown,
  depth: number,
  budget: { visited: number },
): Generator<Record<string, unknown>> {
  if (depth > LIMITS.jsonLdDepth) return;
  if (budget.visited >= LIMITS.jsonLdNodesPerScript) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (budget.visited >= LIMITS.jsonLdNodesPerScript) return;
      yield* productNodes(item, depth + 1, budget);
    }
    return;
  }
  if (!isRecord(node)) return;
  budget.visited += 1;
  if (typeMatches(node["@type"], "Product")) yield node;
  if (Array.isArray(node["@graph"]))
    yield* productNodes(node["@graph"], depth + 1, budget);
}

const collectProductNode = (
  node: Record<string, unknown>,
  sink: Sink,
): void => {
  sink.push(
    "name",
    asString(node[JSON_LD_PRODUCT_KEYS.name]),
    "json-ld",
    "JSON-LD name",
  );
  sink.push(
    "category",
    asString(node[JSON_LD_PRODUCT_KEYS.category]),
    "json-ld",
    "JSON-LD category",
  );

  const brandValue = node[JSON_LD_PRODUCT_KEYS.brand];
  sink.push(
    "manufacturer",
    isRecord(brandValue) ? asString(brandValue.name) : asString(brandValue),
    "json-ld",
    "JSON-LD brand",
  );

  sink.push(
    "modelNumber",
    asString(node[JSON_LD_PRODUCT_KEYS.mpn]) ??
      asString(node[JSON_LD_PRODUCT_KEYS.sku]) ??
      asString(node[JSON_LD_PRODUCT_KEYS.model]),
    "json-ld",
    "JSON-LD mpn/sku/model",
  );

  sink.push(
    "url",
    asString(node[JSON_LD_PRODUCT_KEYS.url]),
    "json-ld",
    "JSON-LD url",
  );

  const offersValue = node[JSON_LD_PRODUCT_KEYS.offers];
  const offers = Array.isArray(offersValue)
    ? offersValue
    : offersValue === undefined
      ? []
      : [offersValue];
  for (const offer of offers.slice(0, LIMITS.offersPerNode)) {
    if (!isRecord(offer)) continue;
    const price = asString(offer[JSON_LD_OFFER_KEYS.price]);
    if (price === undefined) continue;
    const currency = asString(offer[JSON_LD_OFFER_KEYS.priceCurrency]);
    sink.push(
      "price",
      currency === undefined ? price : `${price} ${currency}`,
      "json-ld",
      "JSON-LD offers.price",
    );
  }
};

const collectJsonLd = (document: Document, sink: Sink): void => {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  ).slice(0, LIMITS.jsonLdScripts);

  for (const script of scripts) {
    if (sink.full) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      /** 壊れた JSON-LD はこのスクリプトだけ飛ばす。ページ全体は諦めない。 */
      continue;
    }
    for (const node of productNodes(parsed, 0, { visited: 0 })) {
      if (sink.full) return;
      collectProductNode(node, sink);
    }
  }
};

/* --- meta --------------------------------------------------------------- */

const collectMetadata = (document: Document, sink: Sink): void => {
  const elements = Array.from(document.querySelectorAll("meta")).slice(
    0,
    LIMITS.metaElements,
  );
  let pendingPrice: string | undefined;
  let pendingCurrency: string | undefined;

  for (const element of elements) {
    if (sink.full) return;
    const property =
      element.getAttribute("property") ?? element.getAttribute("name");
    if (property === null) continue;
    const rule = findMetadataRule(property);
    if (rule === undefined) continue;
    const content = element.getAttribute("content");
    if (content === null) continue;

    if (rule.target === "price") {
      pendingPrice = content;
      continue;
    }
    if (rule.target === "priceCurrency") {
      pendingCurrency = content;
      continue;
    }
    sink.push(rule.target, content, METADATA_SOURCE[rule.namespace], property);
  }

  /** 金額と通貨は別 meta に分かれているので、揃ったところで 1 候補にする。 */
  if (pendingPrice !== undefined)
    sink.push(
      "price",
      pendingCurrency === undefined
        ? pendingPrice
        : `${pendingPrice} ${pendingCurrency}`,
      "product-meta",
      "product:price",
    );
};

/* --- 見出し・パンくず・表・定義リスト ------------------------------------ */

const BREADCRUMB_SELECTOR =
  '[itemtype*="BreadcrumbList" i] li, nav[aria-label*="breadcrumb" i] li, ol.breadcrumb li, ul.breadcrumb li';

const collectStructure = (document: Document, sink: Sink): void => {
  const heading = document.querySelector("h1");
  sink.push("name", heading?.textContent, "heading", "h1");

  const crumbs = Array.from(
    document.querySelectorAll(BREADCRUMB_SELECTOR),
  ).slice(0, LIMITS.breadcrumbItems);
  for (const crumb of crumbs) {
    if (sink.full) return;
    sink.push("category", crumb.textContent, "breadcrumb", "breadcrumb");
  }

  const lists = Array.from(document.querySelectorAll("dl")).slice(
    0,
    LIMITS.definitionLists,
  );
  for (const list of lists) {
    if (sink.full) return;
    const terms = Array.from(list.querySelectorAll("dt")).slice(
      0,
      LIMITS.definitionTermsPerList,
    );
    for (const term of terms) {
      const label = term.textContent?.trim();
      if (label === undefined || label === "") continue;
      const definition = term.nextElementSibling;
      if (definition?.tagName !== "DD") continue;
      sink.push(
        fieldForLabel(label),
        definition.textContent,
        "definition-list",
        label,
      );
    }
  }

  const rows = Array.from(document.querySelectorAll("table tr")).slice(
    0,
    LIMITS.tableRows,
  );
  for (const row of rows) {
    if (sink.full) return;
    const cells = Array.from(row.querySelectorAll("th, td"));
    const label = cells[0]?.textContent?.trim();
    const value = cells[1]?.textContent;
    if (label === undefined || label === "") continue;
    sink.push(fieldForLabel(label), value, "table", label);
  }
};

/**
 * メーカー公式サイトなら、構造化データが省略された場合の最後の候補を出す。
 * この collector は他のすべての手掛かりの後に呼ぶため、通常の抽出結果を
 * 上書きしない。
 */
const collectManufacturerDomain = (url: string, sink: Sink): void => {
  const match = manufacturerDomainMatchForUrl(url);
  if (match === undefined) return;
  sink.push(
    "manufacturer",
    match.entry.manufacturer,
    "domain-map",
    match.domain,
  );
};

/**
 * ページから取得可能な手掛かりを集める。ここでは何も確定させない。
 */
export const extractFromDocument = (
  document: Document,
  url: string,
): CapturePayload => {
  const sink = new Sink();
  collectJsonLd(document, sink);
  collectMetadata(document, sink);
  collectStructure(document, sink);
  collectManufacturerDomain(url, sink);
  return {
    url,
    title: document.title,
    candidates: sink.candidates,
  };
};
