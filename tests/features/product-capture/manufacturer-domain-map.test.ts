import assert from "node:assert/strict";
import test from "node:test";
import {
  createManufacturerDomainMap,
  type ManufacturerDomainEntry,
} from "../../../src/features/product-capture/manufacturer-domain-map.js";

const entry = (
  overrides: Partial<ManufacturerDomainEntry> = {},
): ManufacturerDomainEntry => ({
  registrableDomain: "maker.example",
  manufacturer: "架空メーカー",
  evidenceUrl: "https://maker.example/about",
  reviewedAt: "2026-07-28",
  owner: "test-owner",
  ...overrides,
});

const map = (...entries: ManufacturerDomainEntry[]) => {
  const result = createManufacturerDomainMap(entries);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected valid map");
  return result.value;
};

test("登録domainの完全一致とdot-boundaryサブドメインを照合する", () => {
  const domainMap = map(entry());

  assert.deepEqual(domainMap.findManufacturer("https://maker.example/item"), {
    ok: true,
    value: {
      manufacturer: "架空メーカー",
      sourceLabel: "maker.example",
    },
  });
  assert.deepEqual(
    domainMap.findManufacturer("https://store.maker.example/item"),
    {
      ok: true,
      value: {
        manufacturer: "架空メーカー",
        sourceLabel: "maker.example",
      },
    },
  );
});

test("未知domainとsuffix類似domainは候補なしにする", () => {
  const domainMap = map(entry());

  assert.deepEqual(
    domainMap.findManufacturer("https://retailer.example/item"),
    { ok: true, value: undefined },
  );
  assert.deepEqual(
    domainMap.findManufacturer("https://notmaker.example/item"),
    { ok: true, value: undefined },
  );
});

test("不正なページURLをtyped errorとして拒否する", () => {
  const domainMap = map(entry());

  assert.deepEqual(domainMap.findManufacturer("not a URL"), {
    ok: false,
    error: { kind: "invalid-page-url" },
  });
});

test("不正entryと重複domainをmap構築時に拒否する", () => {
  assert.deepEqual(
    createManufacturerDomainMap([entry({ evidenceUrl: "http://unsafe.test" })]),
    { ok: false, error: { kind: "invalid-entry", index: 0 } },
  );
  assert.deepEqual(createManufacturerDomainMap([entry(), entry()]), {
    ok: false,
    error: { kind: "duplicate-domain", registrableDomain: "maker.example" },
  });
});

test("非canonical domain、空label、IP、非ASCIIをentryとして拒否する", () => {
  const invalidDomains = [
    "maker..example",
    "maker.example/path",
    "maker.example:443",
    "-maker.example",
    "maker-.example",
    "127.0.0.1",
    "māker.example",
    "Maker.example",
  ];

  for (const registrableDomain of invalidDomains) {
    assert.deepEqual(
      createManufacturerDomainMap([entry({ registrableDomain })]),
      { ok: false, error: { kind: "invalid-entry", index: 0 } },
      registrableDomain,
    );
  }
});
