import assert from "node:assert/strict";
import test from "node:test";
import { CAPTURE_CORE_FIELDS } from "../../../src/features/product-capture/contracts.js";
import {
  findMetadataPropertyRule,
  METADATA_PROPERTY_RULES,
  type MetadataPropertyRule,
  normalizeMetadataProperty,
} from "../../../src/features/product-capture/metadata-property-map.js";

/** Every combination the allowlist is allowed to adopt, stated independently of the module. */
const EXPECTED_RULES: ReadonlyArray<
  readonly [
    property: string,
    namespace: MetadataPropertyRule["namespace"],
    target: MetadataPropertyRule["target"],
  ]
> = [
  ["og:title", "open-graph", "name"],
  ["og:url", "open-graph", "url"],
  ["og:site_name", "open-graph", "source-site-name"],
  ["twitter:title", "twitter-card", "name"],
  ["product:brand", "product", "manufacturer"],
  ["product:retailer_item_id", "product", "modelNumber"],
  ["product:price:amount", "product", "price"],
  ["product:price:currency", "product", "price-currency"],
];

test("対応propertyはfamilyと取得先へ一意に対応付けられる", () => {
  for (const [property, namespace, target] of EXPECTED_RULES) {
    const rule = findMetadataPropertyRule(property);
    assert.deepEqual(
      rule,
      { namespace, property, target },
      `${property} の対応が期待と異なる`,
    );
  }
});

test("allowlistは対応組を過不足なく列挙する", () => {
  assert.deepEqual(
    METADATA_PROPERTY_RULES.map((rule) => rule.property).toSorted(),
    EXPECTED_RULES.map(([property]) => property).toSorted(),
  );
});

test("同じpropertyを二つの取得先へ対応付けない", () => {
  const properties = METADATA_PROPERTY_RULES.map((rule) => rule.property);
  assert.equal(new Set(properties).size, properties.length);
});

test("未列挙propertyはnamespace一致でも採用しない", () => {
  const unlisted = [
    "og:description",
    "og:image",
    "og:type",
    "twitter:description",
    "twitter:image",
    "twitter:card",
    "product:category",
    "product:price",
    "product:condition",
  ];

  for (const property of unlisted) {
    assert.equal(
      findMetadataPropertyRule(property),
      undefined,
      `${property} を採用してはならない`,
    );
  }
});

test("prefixまたはsuffixが一致するだけのpropertyは採用しない", () => {
  const nearMisses = [
    "og:title:alt",
    "xog:title",
    "og:titles",
    "og:tit",
    "twitter:title:secondary",
    "myproduct:brand",
    "product:brandx",
    "og",
    "og:",
    ":og:title",
    "og:site_name:ja",
  ];

  for (const property of nearMisses) {
    assert.equal(
      findMetadataPropertyRule(property),
      undefined,
      `${property} を採用してはならない`,
    );
  }
});

test("前後空白と大文字表記は正規化して一致させる", () => {
  assert.equal(normalizeMetadataProperty("  OG:Title  "), "og:title");
  assert.equal(findMetadataPropertyRule("  OG:Title  ")?.target, "name");
  assert.equal(
    findMetadataPropertyRule("TWITTER:TITLE")?.namespace,
    "twitter-card",
  );
});

test("空・制御文字・過長のpropertyは一致しない", () => {
  assert.equal(findMetadataPropertyRule(""), undefined);
  assert.equal(findMetadataPropertyRule("   "), undefined);
  assert.equal(findMetadataPropertyRule("og:tit\u0000le"), undefined);
  assert.equal(findMetadataPropertyRule("og:title\u0007"), undefined);
  assert.equal(findMetadataPropertyRule(`og:${"a".repeat(200)}`), undefined);
});

test("全角表記のpropertyを半角へ丸めて一致させない", () => {
  assert.equal(findMetadataPropertyRule("ｏｇ：ｔｉｔｌｅ"), undefined);
});

test("取得元サイト名は必須商品fieldへ混入しない", () => {
  assert.equal(
    (CAPTURE_CORE_FIELDS as readonly string[]).includes("source-site-name"),
    false,
  );

  const siteNameRules = METADATA_PROPERTY_RULES.filter(
    (rule) => rule.target === "source-site-name",
  );
  assert.deepEqual(
    siteNameRules.map((rule) => rule.property),
    ["og:site_name"],
  );
});

test("商品項目を対象とするruleはcore fieldか価格通貨修飾だけを指す", () => {
  const coreFields: readonly string[] = CAPTURE_CORE_FIELDS;
  for (const rule of METADATA_PROPERTY_RULES) {
    if (rule.target === "source-site-name") continue;
    assert.ok(
      coreFields.includes(rule.target) || rule.target === "price-currency",
      `${rule.property} の取得先が商品項目ではない`,
    );
  }
});
