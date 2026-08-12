import assert from "node:assert/strict";
import test from "node:test";

import {
  createMessageDescriptorFactory,
  createMessageResolver,
  type MessageNamespace,
  validateCatalogParity,
} from "@pc-build-planner/typed-messages-core";

const catalog = {
  plain: "Ready",
  greeting: "Hello, {name}!",
  items: {
    forms: {
      one: "One item",
      other: "{count} items",
    },
  },
  allocation: {
    selectors: ["used", "available"],
    forms: {
      "one|one": "One used, one available",
      other: "{used} used, {available} available",
    },
  },
} as const satisfies MessageNamespace;

test("package root export supports the complete synthetic runtime contract", () => {
  const resolve = createMessageResolver(catalog);
  const describe = createMessageDescriptorFactory<typeof catalog>();

  assert.equal(resolve("plain"), "Ready");
  assert.equal(resolve("greeting", { name: "Ada" }), "Hello, Ada!");
  assert.equal(resolve("items", { count: 1 }), "One item");
  assert.equal(resolve("items", { count: 0 }), "0 items");
  assert.equal(
    resolve("allocation", { used: 1, available: 1 }),
    "One used, one available",
  );
  assert.equal(
    resolve("allocation", { used: 2, available: 3 }),
    "2 used, 3 available",
  );

  const descriptor = describe("greeting", { name: "Lin" });
  assert.equal(resolve.resolveDescriptor(descriptor), "Hello, Lin!");

  const unsafeResolve = resolve as unknown as (key: string) => string;
  assert.equal(unsafeResolve("unknown.runtime.key"), "unknown.runtime.key");

  assert.deepEqual(
    validateCatalogParity(catalog, {
      ...catalog,
      greeting: "Welcome, {person}!",
    }),
    [{ code: "placeholder-mismatch", key: "greeting" }],
  );
  assert.deepEqual(validateCatalogParity(catalog, catalog), []);
});
