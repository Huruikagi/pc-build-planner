import assert from "node:assert/strict";
import test from "node:test";
import type { Product, WithContext } from "schema-dts";
import type { ExtractionCandidate } from "../../../src/features/product-capture/contracts.js";
import { createGenericExtractor } from "../../../src/features/product-capture/extractor.js";
import { createManufacturerDomainMap } from "../../../src/features/product-capture/manufacturer-domain-map.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";

const parse = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

const extractor = createGenericExtractor();

const domainMapResult = createManufacturerDomainMap([
  {
    registrableDomain: "maker.example",
    manufacturer: "架空メーカー",
    evidenceUrl: "https://maker.example/about",
    reviewedAt: "2026-07-28",
    owner: "test-owner",
  },
]);
assert.equal(domainMapResult.ok, true);
if (!domainMapResult.ok) throw new Error("expected valid synthetic domain map");
const extractorWithDomainMap = createGenericExtractor({
  manufacturerDomainMap: domainMapResult.value,
});

const extract = (document: Document, pageUrl: string) =>
  extractor.extract(document, pageUrl).candidates;
const extractWithDomainMap = (document: Document, pageUrl: string) =>
  extractorWithDomainMap.extract(document, pageUrl).candidates;

const byField = (candidates: readonly ExtractionCandidate[], field: string) =>
  candidates.filter((candidate) => candidate.field === field);

test("documentOrder付与のために全DOM要素を列挙しない", () => {
  const document = parse(
    "<!doctype html><html><body><h1>bounded</h1></body></html>",
  );
  const querySelectorAll = document.querySelectorAll.bind(document);
  document.querySelectorAll = ((selector: string) => {
    if (selector === "*") throw new Error("unbounded full DOM scan");
    return querySelectorAll(selector);
  }) as typeof document.querySelectorAll;
  const candidates = extract(document, "https://shop.example.invalid/bounded");
  assert.equal(byField(candidates, "name")[0]?.rawValue, "bounded");
});

test("JSON-LD Productから共通商品項目と主要スペックを収集する", () => {
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "架空CPU X100",
    category: "CPU",
    brand: { "@type": "Brand", name: "架空メーカー" },
    mpn: "X100-JP",
    url: "/products/x100",
    offers: {
      "@type": "Offer",
      price: "42800",
      priceCurrency: "JPY",
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "ソケット", value: "AM5" },
    ],
  } satisfies WithContext<Product>;
  const document = parse(`<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify(productJsonLd)}</script>
  </body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/1");

  const name = byField(candidates, "name");
  assert.equal(name.length, 1);
  assert.deepEqual(name[0], {
    field: "name",
    rawValue: "架空CPU X100",
    source: "json-ld",
    sourceLabel: "JSON-LD name",
    documentOrder: 0,
  });

  assert.equal(byField(candidates, "category")[0]?.rawValue, "CPU");
  assert.equal(
    byField(candidates, "manufacturer")[0]?.rawValue,
    "架空メーカー",
  );
  assert.equal(byField(candidates, "modelNumber")[0]?.rawValue, "X100-JP");
  assert.equal(byField(candidates, "price")[0]?.rawValue, "42800 JPY");
  assert.equal(
    byField(candidates, "url")[0]?.rawValue,
    "https://shop.example.invalid/products/x100",
  );

  const spec = byField(candidates, "spec:ソケット");
  assert.equal(spec.length, 1);
  assert.deepEqual(spec[0], {
    field: "spec:ソケット",
    rawValue: "AM5",
    source: "json-ld",
    sourceLabel: "JSON-LD ソケット",
    documentOrder: 0,
  });
});

test("JSON-LDの@graphを有界な深さまで辿ってProductノードを見つける", () => {
  const document = parse(`<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "WebPage", name: "架空ページ" },
        { "@type": "Product", name: "架空GPU Z", offers: { price: "98000" } },
      ],
    })}</script>
  </body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/2");

  assert.equal(byField(candidates, "name")[0]?.rawValue, "架空GPU Z");
  assert.equal(byField(candidates, "price")[0]?.rawValue, "98000");
});

test("meta情報から商品名・URL・価格・メーカーを収集する", () => {
  const document = parse(`<!doctype html><html><head>
    <meta property="og:title" content="架空メモリ 32GB">
    <meta property="og:url" content="/products/memory-32">
    <meta property="product:brand" content="架空パーツ">
    <meta property="product:price:amount" content="15800">
    <meta property="product:price:currency" content="JPY">
  </head><body></body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/3");

  assert.equal(byField(candidates, "name")[0]?.rawValue, "架空メモリ 32GB");
  assert.equal(
    byField(candidates, "url")[0]?.rawValue,
    "https://shop.example.invalid/products/memory-32",
  );
  assert.equal(byField(candidates, "manufacturer")[0]?.rawValue, "架空パーツ");
  assert.equal(byField(candidates, "price")[0]?.rawValue, "15800 JPY");
  assert.deepEqual(
    candidates.map((candidate) => [candidate.field, candidate.source]),
    [
      ["name", "open-graph"],
      ["url", "open-graph"],
      ["manufacturer", "product-meta"],
      ["price", "product-meta"],
    ],
  );
});

test("見出しとパンくずから商品名とカテゴリを収集する", () => {
  const document = parse(`<!doctype html><html><body>
    <h1>架空マザーボードA1</h1>
    <nav aria-label="Breadcrumb">
      <ol>
        <li>トップ</li>
        <li>マザーボード</li>
        <li>架空マザーボードA1</li>
      </ol>
    </nav>
  </body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/4");

  const name = byField(candidates, "name");
  assert.equal(name.length, 1);
  assert.equal(name[0]?.rawValue, "架空マザーボードA1");
  assert.equal(name[0]?.source, "heading");

  const category = byField(candidates, "category");
  assert.equal(category.length, 1);
  assert.equal(category[0]?.rawValue, "マザーボード");
  assert.equal(category[0]?.source, "breadcrumb");
});

test("表と定義リストから主要スペック候補を収集する", () => {
  const document = parse(`<!doctype html><html><body>
    <table>
      <tr><th>ソケット</th><td>LGA1700</td></tr>
      <tr><th>コア数</th><td>16</td></tr>
    </table>
    <dl>
      <dt>フォームファクタ</dt><dd>ATX</dd>
    </dl>
  </body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/5");

  const socket = byField(candidates, "spec:ソケット");
  assert.equal(socket.length, 1);
  assert.equal(socket[0]?.rawValue, "LGA1700");
  assert.equal(socket[0]?.source, "table");

  const cores = byField(candidates, "spec:コア数");
  assert.equal(cores[0]?.rawValue, "16");

  const formFactor = byField(candidates, "spec:フォームファクタ");
  assert.equal(formFactor.length, 1);
  assert.equal(formFactor[0]?.rawValue, "ATX");
  assert.equal(formFactor[0]?.source, "definition-list");
});

test("表由来のspec fieldとsourceLabelを同じ上限へ正規化する", () => {
  const longLabel = "x".repeat(100);
  const document = parse(`<!doctype html><html><body>
    <table><tr><th>${longLabel}</th><td>value</td></tr></table>
  </body></html>`);

  const candidates = extract(
    document,
    "https://shop.example.invalid/item/bounded-label",
  );

  assert.deepEqual(candidates, [
    {
      field: `spec:${"x".repeat(80)}`,
      rawValue: "value",
      source: "table",
      sourceLabel: "x".repeat(80),
      documentOrder: 0,
    },
  ]);
});

test("tableとdefinition-listの同順位候補はcollector順でなく実DOM順で採用する", () => {
  const document = parse(`<!doctype html><html><body>
    <dl><dt>ソケット</dt><dd>earlier-definition</dd></dl>
    <table><tr><th>ソケット</th><td>later-table</td></tr></table>
  </body></html>`);
  const candidates = extract(
    document,
    "https://shop.example.invalid/item/dom-order",
  );
  const normalized = candidates
    .filter((candidate) => candidate.field === "spec:ソケット")
    .map((candidate) => createCaptureNormalizer().normalize(candidate))
    .filter((result) => result.ok)
    .map((result) => result.value);
  const draft = createCandidateRanker().select(normalized);
  assert.equal(draft.fields[0]?.normalizedValue, "earlier-definition");
  assert.ok(normalized[0] && normalized[1]);
  assert.notEqual(normalized[0].documentOrder, normalized[1].documentOrder);
});

test("崩れたJSON-LDや未知の構造があっても他ソースの抽出は失敗しない", () => {
  const document = parse(`<!doctype html><html><head>
    <script type="application/ld+json">{ not valid json </script>
    <script type="application/ld+json">${JSON.stringify({
      "@type": ["Thing", "SomethingElse"],
      weird: { deeply: { nested: { structure: "架空" } } },
    })}</script>
    <meta property="og:title" content="架空SSD 1TB">
  </head><body>
    <h1>架空SSD 1TB 見出し</h1>
  </body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/6");

  assert.equal(
    byField(candidates, "name").some((c) => c.rawValue === "架空SSD 1TB"),
    true,
  );
  assert.equal(
    byField(candidates, "name").some(
      (c) => c.rawValue === "架空SSD 1TB 見出し",
    ),
    true,
  );
});

test("DOMノード、生HTML、画像を候補として返さない", () => {
  const document = parse(`<!doctype html><html><body>
    <h1>架空ケースファンF1</h1>
    <img src="https://cdn.example.invalid/photo.png" alt="架空ケースファンF1">
    <table><tr><th>羽根枚数</th><td>3<img src="inline.png"></td></tr></table>
  </body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/7");

  for (const candidate of candidates) {
    assert.equal(typeof candidate.rawValue, "string");
    assert.doesNotMatch(candidate.rawValue, /<[a-z][\s\S]*>/i);
  }
  assert.equal(
    candidates.some((candidate) => candidate.rawValue.includes(".png")),
    false,
  );
});

test("大量ノードや深い入れ子でも有界な走査で部分結果を返す", () => {
  const manyItems = Array.from(
    { length: 5_000 },
    (_, index) => `<li>階層${index}</li>`,
  ).join("");
  const deepGraph = Array.from({ length: 50 }, () => ({
    "@graph": [],
  })).reduceRight<Record<string, unknown>>(
    (inner, outer) => ({ ...outer, "@graph": [inner] }),
    {
      "@type": "Product",
      name: "架空深階層品",
    },
  );

  const document = parse(`<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify(deepGraph)}</script>
    <nav aria-label="breadcrumb"><ol>${manyItems}</ol></nav>
  </body></html>`);

  const started = Date.now();
  const candidates = extract(document, "https://shop.example.invalid/item/8");
  const elapsedMs = Date.now() - started;

  assert.ok(
    elapsedMs < 2_000,
    `expected bounded extraction, took ${elapsedMs}ms`,
  );
  assert.ok(candidates.length <= 200);
});

test("抽出候補は既定の上限件数を超えない", () => {
  const manyTerms = Array.from(
    { length: 500 },
    (_, index) => `<dt>項目${index}</dt><dd>値${index}</dd>`,
  ).join("");
  const document = parse(
    `<!doctype html><html><body><dl>${manyTerms}</dl></body></html>`,
  );

  const candidates = extract(document, "https://shop.example.invalid/item/9");

  assert.ok(candidates.length <= 200);
});

test("manufacturer欠損時だけdomain map候補を最下位sourceとして追加する", () => {
  const document = parse(
    "<!doctype html><html><head><meta property='og:title' content='架空GPU'></head></html>",
  );

  const candidates = extractWithDomainMap(
    document,
    "https://store.maker.example/products/gpu",
  );

  assert.deepEqual(byField(candidates, "manufacturer"), [
    {
      field: "manufacturer",
      rawValue: "架空メーカー",
      source: "domain-map",
      sourceLabel: "maker.example",
      documentOrder: Number.MAX_SAFE_INTEGER,
    },
  ]);
});

test("ページ由来manufacturerがある場合はdomain map候補を生成しない", () => {
  const document = parse(
    "<!doctype html><html><head><meta property='product:brand' content='ページ明示メーカー'></head></html>",
  );

  const candidates = extractWithDomainMap(
    document,
    "https://maker.example/products/gpu",
  );

  assert.deepEqual(byField(candidates, "manufacturer"), [
    {
      field: "manufacturer",
      rawValue: "ページ明示メーカー",
      source: "product-meta",
      sourceLabel: "product:brand",
      documentOrder: 0,
    },
  ]);
});

test("定義リストの共通メーカー項目を優先してdomain候補を生成しない", () => {
  const document = parse(
    "<!doctype html><html><body><dl><dt>メーカー</dt><dd>ページ明示メーカー</dd></dl></body></html>",
  );

  const candidates = extractWithDomainMap(
    document,
    "https://maker.example/products/gpu",
  );

  assert.deepEqual(byField(candidates, "manufacturer"), [
    {
      field: "manufacturer",
      rawValue: "ページ明示メーカー",
      source: "definition-list",
      sourceLabel: "メーカー",
      documentOrder: 0,
    },
  ]);
  assert.equal(
    candidates.some((candidate) => candidate.source === "domain-map"),
    false,
  );
});

test("表の共通manufacturer項目を優先してdomain候補を生成しない", () => {
  const document = parse(
    "<!doctype html><html><body><table><tr><th>Manufacturer</th><td>Page Maker</td></tr></table></body></html>",
  );

  const candidates = extractWithDomainMap(
    document,
    "https://maker.example/products/gpu",
  );

  assert.deepEqual(byField(candidates, "manufacturer"), [
    {
      field: "manufacturer",
      rawValue: "Page Maker",
      source: "table",
      sourceLabel: "Manufacturer",
      documentOrder: 0,
    },
  ]);
  assert.equal(
    candidates.some((candidate) => candidate.source === "domain-map"),
    false,
  );
});

test("未知domainではmanufacturerを推測しない", () => {
  const document = parse(
    "<!doctype html><html><body><h1>架空GPU</h1></body></html>",
  );

  const candidates = extractWithDomainMap(
    document,
    "https://retailer.example/products/gpu",
  );

  assert.deepEqual(byField(candidates, "manufacturer"), []);
});

test("候補上限へ達してもdomain mapのmanufacturer枠を確保する", () => {
  const lists = Array.from({ length: 4 }, (_, listIndex) => {
    const terms = Array.from(
      { length: 50 },
      (_, itemIndex) =>
        `<dt>項目${listIndex}-${itemIndex}</dt><dd>値${itemIndex}</dd>`,
    ).join("");
    return `<dl>${terms}</dl>`;
  }).join("");
  const document = parse(`<!doctype html><html><body>${lists}</body></html>`);

  const candidates = extractWithDomainMap(
    document,
    "https://maker.example/products/gpu",
  );

  assert.ok(candidates.length <= 200);
  assert.equal(byField(candidates, "manufacturer")[0]?.source, "domain-map");
});

test("allowlistへ列挙されたmetadata property以外を候補にしない", () => {
  const document = parse(`<!doctype html><html><head>
    <meta property="og:title" content="架空SSD 1TB">
    <meta property="og:description" content="採用してはならない説明">
    <meta property="og:image" content="https://shop.example.invalid/img.png">
    <meta property="og:type" content="product">
    <meta name="twitter:description" content="採用してはならない説明">
    <meta name="twitter:image" content="https://shop.example.invalid/t.png">
    <meta property="product:category" content="採用してはならないカテゴリ">
    <meta property="og:title:alt" content="採用してはならない別名">
    <meta property="xog:title" content="採用してはならない偽装名">
    <meta name="description" content="採用してはならない概要">
    <meta name="keywords" content="採用してはならない語">
  </head><body></body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/10");

  assert.deepEqual(candidates, [
    {
      field: "name",
      rawValue: "架空SSD 1TB",
      source: "open-graph",
      sourceLabel: "og:title",
      documentOrder: 0,
    },
  ]);
});

test("3 metadata familyを区別したprovenanceで収集する", () => {
  const document = parse(`<!doctype html><html><head>
    <meta name="twitter:title" content="架空ケース T1">
    <meta property="product:brand" content="架空ケースメーカー">
    <meta property="product:retailer_item_id" content="CASE-T1">
    <meta property="og:url" content="https://shop.example.invalid/case-t1">
  </head><body></body></html>`);

  const candidates = extract(document, "https://shop.example.invalid/item/11");

  assert.deepEqual(
    candidates.map(({ field, source, sourceLabel }) => ({
      field,
      source,
      sourceLabel,
    })),
    [
      { field: "name", source: "twitter-card", sourceLabel: "twitter:title" },
      {
        field: "manufacturer",
        source: "product-meta",
        sourceLabel: "product:brand",
      },
      {
        field: "modelNumber",
        source: "product-meta",
        sourceLabel: "product:retailer_item_id",
      },
      { field: "url", source: "open-graph", sourceLabel: "og:url" },
    ],
  );
});

test("og:site_nameを商品fieldと分離した任意候補として収集する", () => {
  const document = parse(`<!doctype html><html><head>
    <meta property="og:site_name" content="  架空ショップ  ">
    <meta property="og:title" content="架空電源 750W">
  </head><body></body></html>`);

  const extraction = extractor.extract(
    document,
    "https://shop.example.invalid/item/12",
  );

  assert.deepEqual(extraction.siteName, {
    rawValue: "  架空ショップ  ",
    source: "open-graph",
    sourceLabel: "og:site_name",
    documentOrder: 0,
  });
  assert.deepEqual(
    extraction.candidates.map((candidate) => candidate.field),
    ["name"],
  );
});

test("og:site_nameが無い場合はhostnameやtitleからサイト名を推測しない", () => {
  const document = parse(`<!doctype html><html><head>
    <title>架空ショップ | 通販</title>
    <meta property="og:title" content="架空クーラー C1">
  </head><body></body></html>`);

  const extraction = extractor.extract(
    document,
    "https://shop.example.invalid/item/13",
  );

  assert.equal(extraction.siteName, undefined);
  assert.equal(extraction.candidates.length, 1);
});

test("site nameだけを持つページでも商品候補の収集は独立して続く", () => {
  const document = parse(`<!doctype html><html><head>
    <meta property="og:site_name" content="架空ショップ">
  </head><body><h1>架空ファン F1</h1></body></html>`);

  const extraction = extractor.extract(
    document,
    "https://shop.example.invalid/item/14",
  );

  assert.equal(extraction.siteName?.rawValue, "架空ショップ");
  assert.deepEqual(
    extraction.candidates.map((candidate) => [
      candidate.field,
      candidate.source,
    ]),
    [["name", "heading"]],
  );
});

test("property属性が無いmetadataもname属性の対応規則だけで収集する", () => {
  const document = parse(`<!doctype html><html><head>
    <meta name="og:site_name" content="架空ショップ">
    <meta name="twitter:title" content="架空HDD 4TB">
    <meta name="twitter:card" content="summary">
  </head><body></body></html>`);

  const extraction = extractor.extract(
    document,
    "https://shop.example.invalid/item/15",
  );

  assert.equal(extraction.siteName?.rawValue, "架空ショップ");
  assert.deepEqual(
    extraction.candidates.map((candidate) => candidate.sourceLabel),
    ["twitter:title"],
  );
});

test("空・空白だけのmetadata contentは候補にしない", () => {
  const document = parse(`<!doctype html><html><head>
    <meta property="og:title" content="">
    <meta property="og:site_name" content="   ">
    <meta property="product:brand">
  </head><body></body></html>`);

  const extraction = extractor.extract(
    document,
    "https://shop.example.invalid/item/16",
  );

  assert.deepEqual(extraction.candidates, []);
  assert.equal(extraction.siteName, undefined);
});
