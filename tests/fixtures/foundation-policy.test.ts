// @ts-nocheck テストfixtureを意図的に変更し、違反検出境界を検証する。
import assert from "node:assert/strict";
import test from "node:test";
import {
  findFixtureAssetViolations,
  findFixtureValueViolations,
} from "../../scripts/validate-fixture-assets.mjs";
// @ts-expect-error Node 26のtype strippingでTypeScript fixtureを直接利用する。
import { schemaValidator } from "../../src/domain/validation.ts";

// @ts-expect-error Node 26のtype strippingでTypeScript fixtureを直接利用する。
const fixtureModule = await import("./foundation.ts");
const {
  buildCorruptFoundationRoots,
  buildFoundationRoot,
  buildMissingProductFieldsRoot,
  buildSourceMetadataCompatibilityRoot,
} = fixtureModule;

const jsonRoundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const candidateCategory = (candidate: { category: string }) =>
  candidate.category;

test("全12カテゴリを含む参照整合rootがJSON往復後もvalidatorを通る", () => {
  const root = jsonRoundTrip(buildFoundationRoot());
  assert.equal(root.candidateParts.length, 12);
  assert.deepEqual(root.candidateParts.map(candidateCategory), [
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
  ]);
  assert.equal(schemaValidator.validateRoot(root).ok, true);
  assert.equal(root.currentBuilds[0].items.length, 12);
});

test("欠損商品値と元表記・確認値を別々に表現するbuilderが有効である", () => {
  const complete = jsonRoundTrip(buildFoundationRoot());
  const missing = jsonRoundTrip(buildMissingProductFieldsRoot());
  assert.equal(
    complete.candidateParts[0].product.name.original,
    "架空CPU 原表記",
  );
  assert.equal(
    complete.candidateParts[0].product.name.confirmed,
    "架空CPU 確認値",
  );
  assert.deepEqual(missing.candidateParts[0].product, {});
  assert.equal(schemaValidator.validateRoot(missing).ok, true);
});

test("canonical取得元fixtureがJSON往復とroot検証後も欠損・nullを補完しない", () => {
  const canonical = jsonRoundTrip(buildFoundationRoot());
  assert.equal(schemaValidator.validateRoot(canonical).ok, true);
  assert.deepEqual(canonical.candidateParts[0].sources[0], {
    id: "40000000-0000-4000-8000-000000000001",
    pageUrl: "https://catalog.example.invalid/synthetic-part-1",
    siteName: "架空部品カタログ",
    capturedAt: "2026-07-19T00:00:00.000Z",
    price: {
      original: "架空価格",
      confirmed: { amount: 1000, currency: "SYN" },
    },
    kind: "retail",
  });

  const compatible = jsonRoundTrip(buildSourceMetadataCompatibilityRoot());
  const validated = schemaValidator.validateRoot(compatible);
  assert.equal(validated.ok, true);
  const [withoutSource, partialSource, withSnapshot] =
    validated.value.candidateParts;

  assert.deepEqual(withoutSource.sources, []);
  assert.equal("primarySourceId" in withoutSource, false);
  assert.equal("sourceSnapshot" in withoutSource, false);
  assert.equal(partialSource.sources[0].siteName, "架空部分取得元");
  assert.equal("pageUrl" in partialSource.sources[0], false);
  assert.equal("capturedAt" in partialSource.sources[0], false);
  assert.deepEqual(withSnapshot.sourceSnapshot, {
    name: "架空マザーボード 元表記",
    manufacturer: null,
  });
  assert.equal("modelNumber" in withSnapshot.sourceSnapshot, false);
  assert.equal(withSnapshot.sourceSnapshot.manufacturer, null);
});

test("破損root builderはJSON往復可能でvalidatorが期待した理由で拒否する", () => {
  for (const fixture of buildCorruptFoundationRoots()) {
    const result = schemaValidator.validateRoot(jsonRoundTrip(fixture.root));
    assert.equal(result.ok, false, fixture.name);
    assert.equal(result.error.code, fixture.expectedCode, fixture.name);
    assert.equal(result.error.path, fixture.expectedPath, fixture.name);
  }
});

test("foundation fixture sourceに実サイトassetや商品値を含まない", async () => {
  assert.deepEqual(await findFixtureAssetViolations("tests/fixtures"), []);
  assert.deepEqual(findFixtureValueViolations(buildFoundationRoot()), []);
  assert.deepEqual(
    findFixtureValueViolations(buildMissingProductFieldsRoot()),
    [],
  );
  assert.deepEqual(
    findFixtureValueViolations(buildSourceMetadataCompatibilityRoot()),
    [],
  );
});

test("合成markerを持たない任意の実商品名と型番をfail closedで拒否する", () => {
  const realProducts: ReadonlyArray<readonly [string, string]> = [
    ["Intel Core i9-14900K", "BX8071514900K"],
    ["GeForce RTX 5090 Founders Edition", "900-1G144-2530-000"],
  ];
  for (const [name, modelNumber] of realProducts) {
    const root = jsonRoundTrip(buildFoundationRoot());
    root.candidateParts[0].product.name = { original: name, confirmed: name };
    root.candidateParts[0].product.modelNumber = {
      original: modelNumber,
      confirmed: modelNumber,
    };
    assert.deepEqual(
      findFixtureValueViolations(root).map(({ rule }) => rule),
      ["non-synthetic-sourced-value", "non-synthetic-sourced-value"],
      name,
    );
  }
});

test("正規化属性のoriginal・confirmedも再帰的に実値を拒否する", () => {
  const root = jsonRoundTrip(buildFoundationRoot());
  root.candidateParts[0].normalizedAttributes.socket = {
    original: "LGA1700",
    confirmed: "LGA1700",
  };
  root.candidateParts[2].normalizedAttributes.memoryStandard = {
    original: "DDR5-5600",
    confirmed: "DDR5-5600",
  };
  root.candidateParts[6].normalizedAttributes.formFactor = {
    original: "ATX",
    confirmed: "ATX",
  };
  assert.deepEqual(findFixtureValueViolations(root), [
    {
      path: "$.candidateParts[0].normalizedAttributes.socket",
      rule: "non-synthetic-sourced-value",
    },
    {
      path: "$.candidateParts[2].normalizedAttributes.memoryStandard",
      rule: "non-synthetic-sourced-value",
    },
    {
      path: "$.candidateParts[6].normalizedAttributes.formFactor",
      rule: "non-synthetic-sourced-value",
    },
  ]);
});

test("asset policyはHTML、画像、data URL、実サイトURLを識別する", async () => {
  const violations = await findFixtureAssetViolations(undefined, [
    { path: "raw.txt", content: "<main>商品</main>" },
    { path: "photo.png", content: "synthetic bytes" },
    { path: "encoded.json", content: "data:image/png;base64,AAAA" },
    { path: "product.json", content: "https://www.amazon.co.jp/example" },
  ]);
  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ["raw-html", "image-file", "data-url", "non-synthetic-url"],
  );
});
