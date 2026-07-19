import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { PART_CATEGORIES } from "../../src/domain/normalized-attributes.ts";

/** @type {import("../../src/domain/normalized-attributes.ts").CandidateProductValues} */
const productValues = {
  name: { original: "架空 CPU", confirmed: "架空 CPU Confirmed" },
  manufacturer: { original: null },
  modelNumber: { original: "SYN-100" },
  price: {
    original: "12,345円",
    confirmed: { amount: 12345, currency: "JPY" },
  },
};

/** @type {import("../../src/domain/normalized-attributes.ts").SourceInfo} */
const sourceInfo = {
  pageUrl: "https://example.invalid/products/synthetic-100",
  siteName: "架空ショップ",
  capturedAt:
    /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
      "2026-07-18T12:34:56.789Z"
    ),
};

/** @type {readonly import("../../src/domain/normalized-attributes.ts").NormalizedAttributes[]} */
const allAttributes = [
  { category: "cpu", socket: { original: "Socket A", confirmed: "socket-a" } },
  {
    category: "cpu-cooler",
    supportedSockets: {
      original: "Socket A / Socket B",
      confirmed: ["socket-a", "socket-b"],
    },
  },
  {
    category: "motherboard",
    socket: { original: "Socket A", confirmed: "socket-a" },
    memoryStandard: { original: "DDR-Z", confirmed: "ddr-z" },
    formFactor: { original: "ATX-Z", confirmed: "atx-z" },
  },
  {
    category: "memory",
    memoryStandard: { original: "DDR-Z", confirmed: "ddr-z" },
  },
  { category: "gpu" },
  { category: "storage" },
  {
    category: "power-supply",
    formFactor: { original: "PSU-Z", confirmed: "psu-z" },
  },
  {
    category: "case",
    supportedMotherboardFormFactors: {
      original: "ATX-Z / Mini-Z",
      confirmed: ["atx-z", "mini-z"],
    },
    supportedPowerSupplyFormFactors: {
      original: "PSU-Z",
      confirmed: ["psu-z"],
    },
  },
  { category: "case-fan" },
  { category: "expansion-card" },
  { category: "other" },
  { category: "uncategorized" },
];

test("全12カテゴリと欠損可能な商品情報をJSON往復できる", () => {
  assert.deepEqual(
    allAttributes.map(({ category }) => category),
    PART_CATEGORIES,
  );

  const value = {
    sourceInfo,
    productValues,
    normalizedAttributes: allAttributes,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  assert.equal(productValues.manufacturer?.original, null);
  assert.equal("confirmed" in productValues.manufacturer, false);
});
