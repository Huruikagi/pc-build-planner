import assert from "node:assert/strict";
import test from "node:test";
import { identifyCandidateSourceUrl } from "../../src/candidate-sources/url-identity.js";

const validCases = [
  [
    "scheme/host case",
    "HTTPS://SHOP.Example.INVALID/item",
    "https://shop.example.invalid/item",
  ],
  [
    "default HTTPS port",
    "https://shop.example.invalid:443/item",
    "https://shop.example.invalid/item",
  ],
  [
    "default HTTP port",
    "http://shop.example.invalid:80/item",
    "http://shop.example.invalid/item",
  ],
  [
    "non-default port",
    "https://shop.example.invalid:8443/item",
    "https://shop.example.invalid:8443/item",
  ],
  [
    "empty path",
    "https://shop.example.invalid",
    "https://shop.example.invalid/",
  ],
  [
    "fragment",
    "https://shop.example.invalid/item#details",
    "https://shop.example.invalid/item",
  ],
  [
    "userinfo",
    "https://user:secret@shop.example.invalid/item",
    "https://shop.example.invalid/item",
  ],
  [
    "query order",
    "https://shop.example.invalid/item?sku=2&color=red",
    "https://shop.example.invalid/item?sku=2&color=red",
  ],
  [
    "tracking query",
    "https://shop.example.invalid/item?utm_source=mail&sku=2",
    "https://shop.example.invalid/item?utm_source=mail&sku=2",
  ],
] as const;

test("標準URL規則だけでsource URL identityを決定する", () => {
  for (const [label, input, expected] of validCases) {
    const result = identifyCandidateSourceUrl(input);
    assert.equal(result.ok, true, label);
    if (result.ok) assert.equal(result.value, expected, label);
  }
});

const invalidCases = [
  ["missing undefined", undefined, "missing-url"],
  ["missing empty", "", "missing-url"],
  ["malformed", "not a url", "invalid-url"],
  ["relative", "/item/1", "invalid-url"],
  ["ftp", "ftp://shop.example.invalid/item", "unsafe-scheme"],
  ["javascript", "javascript:alert(1)", "unsafe-scheme"],
  ["file", "file:///item/1", "unsafe-scheme"],
] as const;

test("欠損・不正・unsafe URLをtyped validation failureにする", () => {
  for (const [label, input, reason] of invalidCases) {
    assert.deepEqual(
      identifyCandidateSourceUrl(input),
      { ok: false, error: { kind: "source-identity-failure", reason } },
      label,
    );
  }
});

test("pathとqueryを商品identity規則で変更しない", () => {
  const distinct = [
    "https://shop.example.invalid/item/",
    "https://shop.example.invalid/item",
    "https://shop.example.invalid/item?b=2&a=1",
    "https://shop.example.invalid/item?a=1&b=2",
  ];
  const identities = distinct.map((value) => identifyCandidateSourceUrl(value));
  assert.equal(
    identities.every((result) => result.ok),
    true,
  );
  assert.deepEqual(
    identities.map((result) => (result.ok ? result.value : undefined)),
    distinct,
  );
});
