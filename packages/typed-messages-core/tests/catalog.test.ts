import assert from "node:assert/strict";
import test from "node:test";

import { flattenCatalog } from "../src/catalog.js";

test("flattens nested namespaces to dot keys without changing leaf values", () => {
  const plural = {
    forms: {
      one: "{count} item",
      other: "{count} items",
    },
  } as const;
  const multiPlural = {
    selectors: ["visible", "total"],
    forms: {
      "one|one": "{visible} of {total} item",
      other: "{visible} of {total} items",
    },
  } as const;
  const catalog = {
    navigation: {
      home: "Home",
      summary: {
        count: plural,
        ratio: multiPlural,
      },
    },
  } as const;

  const flattened = flattenCatalog(catalog);

  assert.deepEqual(flattened, {
    "navigation.home": "Home",
    "navigation.summary.count": plural,
    "navigation.summary.ratio": multiPlural,
  });
  assert.deepEqual(catalog, {
    navigation: {
      home: "Home",
      summary: {
        count: plural,
        ratio: multiPlural,
      },
    },
  });
});

test("recurses into a namespace whose segment is named forms", () => {
  const catalog = {
    section: {
      forms: {
        label: "Ready",
      },
    },
  } as const;

  assert.deepEqual(flattenCatalog(catalog), {
    "section.forms.label": "Ready",
  });
});

test("treats structured definitions as leaves before object recursion", () => {
  const catalog = {
    status: {
      forms: {
        zero: "No results",
        other: "{count} results",
      },
    },
  } as const;

  assert.deepEqual(flattenCatalog(catalog), { status: catalog.status });
});

test("omits empty namespaces and returns deterministic results", () => {
  const catalog = {
    empty: {},
    nested: {
      empty: {},
      label: "Ready",
    },
  } as const;

  const first = flattenCatalog(catalog);
  const second = flattenCatalog(catalog);

  assert.deepEqual(first, { "nested.label": "Ready" });
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first), ["nested.label"]);
});
