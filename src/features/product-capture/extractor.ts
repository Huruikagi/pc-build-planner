import type { Brand, Offer, Product, PropertyValue } from "schema-dts";
import {
  type CaptureField,
  type ExtractionCandidate,
  type ExtractionSource,
  isCaptureField,
  MAX_CAPTURE_LABEL_LENGTH,
  SITE_NAME_SOURCE_LABEL,
  type SiteNameCandidate,
} from "./contracts.js";
import {
  type ManufacturerDomainMap,
  manufacturerDomainMap,
} from "./manufacturer-domain-map.js";
import {
  findMetadataPropertyRule,
  type MetadataNamespace,
} from "./metadata-property-map.js";

/**
 * One page's extraction output. The optional source site name travels beside
 * the product candidates rather than inside them, so it can never be counted
 * as a product item or reported as a missing core field.
 */
export interface PageExtraction {
  readonly candidates: readonly ExtractionCandidate[];
  readonly siteName?: SiteNameCandidate;
}

export interface GenericExtractor {
  extract(document: Document, pageUrl: string): PageExtraction;
}

export interface GenericExtractorDependencies {
  readonly manufacturerDomainMap?: ManufacturerDomainMap;
}

const MAX_CANDIDATES = 200;
const MAX_VALUE_LENGTH = 500;
const MAX_JSON_LD_SCRIPTS = 20;
const MAX_JSON_LD_DEPTH = 6;
const MAX_JSON_LD_NODES_PER_SCRIPT = 30;
const MAX_LIST_ITEMS = 50;
const MAX_TABLE_ROWS = 100;
const MAX_DEFINITION_LISTS = 10;

const JSON_LD_PRODUCT_KEYS = {
  additionalProperty: "additionalProperty",
  brand: "brand",
  category: "category",
  model: "model",
  mpn: "mpn",
  name: "name",
  offers: "offers",
  sku: "sku",
  url: "url",
} as const satisfies Record<string, keyof Product>;

const JSON_LD_OFFER_KEYS = {
  price: "price",
  priceCurrency: "priceCurrency",
} as const satisfies Record<string, keyof Offer>;

const JSON_LD_BRAND_KEYS = {
  name: "name",
} as const satisfies Record<string, keyof Brand>;

const JSON_LD_PROPERTY_VALUE_KEYS = {
  name: "name",
  value: "value",
} as const satisfies Record<string, keyof PropertyValue>;

interface CandidateSink {
  readonly items: ExtractionCandidate[];
  readonly pageUrl: string;
  readonly nodes: Array<Node | undefined>;
  siteName?: { readonly rawValue: string; readonly node: Node };
}

const isFull = (sink: CandidateSink): boolean =>
  sink.items.length >= MAX_CANDIDATES;

const resolveUrl = (value: string, pageUrl: string): string => {
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return value;
  }
};

const normalizeCandidateLabel = (label: string): string =>
  label
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CAPTURE_LABEL_LENGTH);

const specField = (label: string): CaptureField =>
  `spec:${normalizeCandidateLabel(label)}` as CaptureField;

const MANUFACTURER_LABELS: ReadonlySet<string> = new Set([
  "manufacturer",
  "brand",
  "maker",
  "メーカー",
  "製造元",
  "ブランド",
]);

const fieldForLabel = (label: string): CaptureField =>
  MANUFACTURER_LABELS.has(label.trim().normalize("NFKC").toLowerCase())
    ? "manufacturer"
    : specField(label);

const push = (
  sink: CandidateSink,
  field: CaptureField,
  rawValue: string,
  source: ExtractionSource,
  sourceLabel: string,
  node?: Node,
): void => {
  if (isFull(sink)) return;
  if (!isCaptureField(field)) return;
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return;
  const resolved =
    field === "url" ? resolveUrl(trimmed, sink.pageUrl) : trimmed;
  sink.items.push({
    field,
    rawValue: resolved.slice(0, MAX_VALUE_LENGTH),
    source,
    sourceLabel: normalizeCandidateLabel(sourceLabel) || source,
    documentOrder: Number.MAX_SAFE_INTEGER,
  });
  sink.nodes.push(node);
};

const assignDocumentOrder = (sink: CandidateSink): Map<Node, number> => {
  const nodes = [
    ...new Set(
      [...sink.nodes, sink.siteName?.node].filter(
        (node): node is Node => node !== undefined,
      ),
    ),
  ];
  nodes.sort((left, right) => {
    const position = left.compareDocumentPosition(right);
    if ((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return -1;
    if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return 1;
    return 0;
  });
  const order = new Map(nodes.map((node, index) => [node, index]));
  sink.items.forEach((candidate, index) => {
    sink.items[index] = {
      ...candidate,
      documentOrder:
        sink.nodes[index] === undefined
          ? Number.MAX_SAFE_INTEGER
          : (order.get(sink.nodes[index] as Node) ??
            Number.MAX_SAFE_INTEGER - 1),
    };
  });
  return order;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const typeMatches = (value: unknown, expected: string): boolean =>
  value === expected || (Array.isArray(value) && value.includes(expected));

interface NodeBudget {
  visited: number;
}

function* productNodes(
  node: unknown,
  depth: number,
  budget: NodeBudget,
): Generator<Record<string, unknown>> {
  if (
    depth > MAX_JSON_LD_DEPTH ||
    budget.visited >= MAX_JSON_LD_NODES_PER_SCRIPT
  )
    return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (budget.visited >= MAX_JSON_LD_NODES_PER_SCRIPT) return;
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

const collectJsonLd = (document: Document, sink: CandidateSink): void => {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  ).slice(0, MAX_JSON_LD_SCRIPTS);

  for (const script of scripts) {
    if (isFull(sink)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }

    for (const node of productNodes(parsed, 0, { visited: 0 })) {
      if (isFull(sink)) return;
      collectProductNode(node, sink, script);
    }
  }
};

const collectProductNode = (
  node: Record<string, unknown>,
  sink: CandidateSink,
  script: Element,
): void => {
  const name = asString(node[JSON_LD_PRODUCT_KEYS.name]);
  if (name) push(sink, "name", name, "json-ld", "JSON-LD name", script);

  const category = asString(node[JSON_LD_PRODUCT_KEYS.category]);
  if (category)
    push(sink, "category", category, "json-ld", "JSON-LD category", script);

  const brandValue = node[JSON_LD_PRODUCT_KEYS.brand];
  const brand = isRecord(brandValue)
    ? asString(brandValue[JSON_LD_BRAND_KEYS.name])
    : asString(brandValue);
  if (brand)
    push(sink, "manufacturer", brand, "json-ld", "JSON-LD brand", script);

  const model =
    asString(node[JSON_LD_PRODUCT_KEYS.mpn]) ??
    asString(node[JSON_LD_PRODUCT_KEYS.sku]) ??
    asString(node[JSON_LD_PRODUCT_KEYS.model]);
  if (model)
    push(
      sink,
      "modelNumber",
      model,
      "json-ld",
      "JSON-LD mpn/sku/model",
      script,
    );

  const url = asString(node[JSON_LD_PRODUCT_KEYS.url]);
  if (url) push(sink, "url", url, "json-ld", "JSON-LD url", script);

  const offersValue = node[JSON_LD_PRODUCT_KEYS.offers];
  const offers = Array.isArray(offersValue)
    ? offersValue
    : offersValue !== undefined
      ? [offersValue]
      : [];
  for (const offer of offers.slice(0, 5)) {
    if (isFull(sink)) return;
    if (!isRecord(offer)) continue;
    const price = asString(offer[JSON_LD_OFFER_KEYS.price]);
    const currency = asString(offer[JSON_LD_OFFER_KEYS.priceCurrency]);
    if (price) {
      push(
        sink,
        "price",
        currency ? `${price} ${currency}` : price,
        "json-ld",
        "JSON-LD offers.price",
        script,
      );
    }
  }

  const additionalPropertyValue = node[JSON_LD_PRODUCT_KEYS.additionalProperty];
  const additionalProperties = Array.isArray(additionalPropertyValue)
    ? additionalPropertyValue
    : [];
  for (const property of additionalProperties.slice(0, 20)) {
    if (isFull(sink)) return;
    if (!isRecord(property)) continue;
    const label = asString(property[JSON_LD_PROPERTY_VALUE_KEYS.name]);
    const value = asString(property[JSON_LD_PROPERTY_VALUE_KEYS.value]);
    if (label && value)
      push(
        sink,
        specField(label),
        value,
        "json-ld",
        `JSON-LD ${label}`,
        script,
      );
  }
};

const MAX_META_ELEMENTS = 200;

const METADATA_SOURCE: Readonly<Record<MetadataNamespace, ExtractionSource>> = {
  "open-graph": "open-graph",
  "twitter-card": "twitter-card",
  product: "product-meta",
};

interface PriceAmount {
  readonly rawValue: string;
  readonly source: ExtractionSource;
  readonly sourceLabel: string;
  readonly node: Element;
}

/**
 * Walks the page's `<meta>` elements and adopts only combinations the
 * allowlist names. The scan is driven by the rule table rather than by
 * per-property selectors, so widening what is collected requires editing the
 * reviewed allowlist and nothing else.
 */
const collectMetadata = (document: Document, sink: CandidateSink): void => {
  const elements = Array.from(document.querySelectorAll("meta")).slice(
    0,
    MAX_META_ELEMENTS,
  );
  const priceAmounts: PriceAmount[] = [];
  let priceCurrency: string | undefined;

  for (const element of elements) {
    if (isFull(sink)) break;
    /**
     * OpenGraph and the product extensions use `property`; Twitter Card uses
     * `name`. Only the attribute actually present is consulted, and never both
     * in turn, so a listed name cannot be reached through the other slot after
     * the first one failed to match.
     */
    const property =
      element.getAttribute("property") ?? element.getAttribute("name");
    if (property === null) continue;
    const rule = findMetadataPropertyRule(property);
    if (rule === undefined) continue;
    const content = element.getAttribute("content");
    if (content === null || content.trim().length === 0) continue;

    const source = METADATA_SOURCE[rule.namespace];
    if (rule.target === "price-currency") {
      priceCurrency ??= content.trim();
      continue;
    }
    if (rule.target === "source-site-name") {
      sink.siteName ??= { rawValue: content, node: element };
      continue;
    }
    if (rule.target === "price") {
      priceAmounts.push({
        rawValue: content.trim(),
        source,
        sourceLabel: rule.property,
        node: element,
      });
      continue;
    }
    push(sink, rule.target, content, source, rule.property, element);
  }

  /** Currency is a qualifier, so amounts are held back until it is known. */
  for (const amount of priceAmounts) {
    if (isFull(sink)) return;
    push(
      sink,
      "price",
      priceCurrency === undefined
        ? amount.rawValue
        : `${amount.rawValue} ${priceCurrency}`,
      amount.source,
      amount.sourceLabel,
      amount.node,
    );
  }
};

const collectHeading = (document: Document, sink: CandidateSink): void => {
  const heading = document.querySelector("h1");
  if (heading?.textContent)
    push(sink, "name", heading.textContent, "heading", "h1", heading);
};

const BREADCRUMB_SELECTOR =
  '[itemtype*="BreadcrumbList" i] li, nav[aria-label*="breadcrumb" i] li, ol.breadcrumb li, ul.breadcrumb li';

const collectBreadcrumb = (document: Document, sink: CandidateSink): void => {
  const items = Array.from(
    document.querySelectorAll(BREADCRUMB_SELECTOR),
  ).slice(0, MAX_LIST_ITEMS);
  if (items.length === 0) return;
  const categoryNode = items.length > 1 ? items[items.length - 2] : items[0];
  const text = categoryNode?.textContent;
  if (text)
    push(
      sink,
      "category",
      text,
      "breadcrumb",
      "breadcrumb category segment",
      categoryNode,
    );
};

const collectDefinitionLists = (
  document: Document,
  sink: CandidateSink,
): void => {
  const lists = Array.from(document.querySelectorAll("dl")).slice(
    0,
    MAX_DEFINITION_LISTS,
  );
  for (const list of lists) {
    if (isFull(sink)) return;
    const terms = Array.from(list.querySelectorAll("dt")).slice(
      0,
      MAX_LIST_ITEMS,
    );
    for (const term of terms) {
      if (isFull(sink)) return;
      const label = term.textContent?.trim();
      const definition = term.nextElementSibling;
      const value =
        definition?.tagName === "DD"
          ? (definition.textContent?.trim() ?? undefined)
          : undefined;
      if (label && value)
        push(sink, fieldForLabel(label), value, "definition-list", label, term);
    }
  }
};

const collectTables = (document: Document, sink: CandidateSink): void => {
  const rows = Array.from(document.querySelectorAll("table tr")).slice(
    0,
    MAX_TABLE_ROWS,
  );
  for (const row of rows) {
    if (isFull(sink)) return;
    const cells = Array.from(row.querySelectorAll("th, td"));
    if (cells.length < 2) continue;
    const label = cells[0]?.textContent?.trim();
    const value = cells[1]?.textContent?.trim();
    if (label && value)
      push(sink, fieldForLabel(label), value, "table", label, row);
  }
};

const COLLECTORS: ReadonlyArray<
  (document: Document, sink: CandidateSink) => void
> = [
  collectJsonLd,
  collectMetadata,
  collectHeading,
  collectBreadcrumb,
  collectDefinitionLists,
  collectTables,
];

export const createGenericExtractor = (
  dependencies: GenericExtractorDependencies = {},
): GenericExtractor => ({
  extract(document, pageUrl) {
    const sink: CandidateSink = { items: [], pageUrl, nodes: [] };
    for (const collect of COLLECTORS) {
      if (isFull(sink)) break;
      try {
        collect(document, sink);
      } catch {
        // An unknown or malformed page structure must not fail other sources.
      }
    }
    if (!sink.items.some((candidate) => candidate.field === "manufacturer")) {
      const match = (
        dependencies.manufacturerDomainMap ?? manufacturerDomainMap
      ).findManufacturer(pageUrl);
      if (match.ok && match.value !== undefined) {
        if (isFull(sink)) sink.items.pop();
        push(
          sink,
          "manufacturer",
          match.value.manufacturer,
          "domain-map",
          match.value.sourceLabel,
        );
      }
    }
    const order = assignDocumentOrder(sink);
    const siteName: SiteNameCandidate | undefined =
      sink.siteName === undefined
        ? undefined
        : {
            rawValue: sink.siteName.rawValue,
            source: "open-graph",
            sourceLabel: SITE_NAME_SOURCE_LABEL,
            documentOrder:
              order.get(sink.siteName.node) ?? Number.MAX_SAFE_INTEGER - 1,
          };
    return Object.freeze({
      candidates: Object.freeze(sink.items.slice(0, MAX_CANDIDATES)),
      ...(siteName === undefined ? {} : { siteName }),
    });
  },
});
