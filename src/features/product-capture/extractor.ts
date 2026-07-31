import type {
  CaptureCoreField,
  CaptureField,
  ExtractionCandidate,
  ExtractionSource,
} from "./contracts.js";
import {
  type ManufacturerDomainMap,
  manufacturerDomainMap,
} from "./manufacturer-domain-map.js";

export interface GenericExtractor {
  extract(document: Document, pageUrl: string): readonly ExtractionCandidate[];
}

export interface GenericExtractorDependencies {
  readonly manufacturerDomainMap?: ManufacturerDomainMap;
}

const MAX_CANDIDATES = 200;
const MAX_VALUE_LENGTH = 500;
const MAX_LABEL_LENGTH = 80;
const MAX_JSON_LD_SCRIPTS = 20;
const MAX_JSON_LD_DEPTH = 6;
const MAX_JSON_LD_NODES_PER_SCRIPT = 30;
const MAX_LIST_ITEMS = 50;
const MAX_TABLE_ROWS = 100;
const MAX_DEFINITION_LISTS = 10;

interface CandidateSink {
  readonly items: ExtractionCandidate[];
  readonly pageUrl: string;
  readonly nodes: Array<Node | undefined>;
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

const specField = (label: string): CaptureField =>
  `spec:${label.slice(0, MAX_LABEL_LENGTH)}` as CaptureField;

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
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return;
  const resolved =
    field === "url" ? resolveUrl(trimmed, sink.pageUrl) : trimmed;
  sink.items.push({
    field,
    rawValue: resolved.slice(0, MAX_VALUE_LENGTH),
    source,
    sourceLabel,
    documentOrder: Number.MAX_SAFE_INTEGER,
  });
  sink.nodes.push(node);
};

const assignDocumentOrder = (sink: CandidateSink): void => {
  const nodes = [
    ...new Set(sink.nodes.filter((node): node is Node => node !== undefined)),
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
  const name = asString(node.name);
  if (name) push(sink, "name", name, "json-ld", "JSON-LD name", script);

  const category = asString(node.category);
  if (category)
    push(sink, "category", category, "json-ld", "JSON-LD category", script);

  const brand = isRecord(node.brand)
    ? asString(node.brand.name)
    : asString(node.brand);
  if (brand)
    push(sink, "manufacturer", brand, "json-ld", "JSON-LD brand", script);

  const model =
    asString(node.mpn) ?? asString(node.sku) ?? asString(node.model);
  if (model)
    push(
      sink,
      "modelNumber",
      model,
      "json-ld",
      "JSON-LD mpn/sku/model",
      script,
    );

  const url = asString(node.url);
  if (url) push(sink, "url", url, "json-ld", "JSON-LD url", script);

  const offers = Array.isArray(node.offers)
    ? node.offers
    : node.offers !== undefined
      ? [node.offers]
      : [];
  for (const offer of offers.slice(0, 5)) {
    if (isFull(sink)) return;
    if (!isRecord(offer)) continue;
    const price = asString(offer.price);
    const currency = asString(offer.priceCurrency);
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

  const additionalProperties = Array.isArray(node.additionalProperty)
    ? node.additionalProperty
    : [];
  for (const property of additionalProperties.slice(0, 20)) {
    if (isFull(sink)) return;
    if (!isRecord(property)) continue;
    const label = asString(property.name);
    const value = asString(property.value);
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

const META_FIELD_SELECTORS: ReadonlyArray<
  readonly [selector: string, field: CaptureCoreField]
> = [
  ['meta[property="og:title"]', "name"],
  ['meta[name="twitter:title"]', "name"],
  ['meta[property="product:brand"]', "manufacturer"],
  ['meta[property="og:url"]', "url"],
  ['meta[property="product:retailer_item_id"]', "modelNumber"],
];

const collectMeta = (document: Document, sink: CandidateSink): void => {
  for (const [selector, field] of META_FIELD_SELECTORS) {
    if (isFull(sink)) return;
    const node = document.querySelector(selector);
    const content = node?.getAttribute("content");
    if (content && node) push(sink, field, content, "meta", selector, node);
  }

  const priceNode = document.querySelector(
    'meta[property="product:price:amount"]',
  );
  const priceAmount = priceNode?.getAttribute("content");
  const priceCurrency = document
    .querySelector('meta[property="product:price:currency"]')
    ?.getAttribute("content");
  if (priceAmount) {
    push(
      sink,
      "price",
      priceCurrency ? `${priceAmount} ${priceCurrency}` : priceAmount,
      "meta",
      'meta[property="product:price:amount"]',
      priceNode ?? undefined,
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
  collectMeta,
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
    assignDocumentOrder(sink);
    return Object.freeze(sink.items.slice(0, MAX_CANDIDATES));
  },
});
