import assert from "node:assert/strict";
import test from "node:test";

import type { MessageDescriptor, MessageNamespace } from "../src/contracts.js";
import { createMessageDescriptorFactory } from "../src/descriptor.js";
import {
  createMessageResolver,
  type MessageResolver,
} from "../src/resolver.js";

const syntheticCatalog = {
  navigation: {
    home: "Home",
    greeting: "Hello, {name}!",
  },
  itemCount: {
    forms: {
      zero: "No items",
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

type SyntheticCatalog = typeof syntheticCatalog;

const resolve = createMessageResolver(syntheticCatalog);
const describeMessage = createMessageDescriptorFactory<SyntheticCatalog>();
const resolverContract: MessageResolver<SyntheticCatalog> = resolve;

if (false) {
  const exactGreetingParams = { name: "Ada" };
  const widerGreetingParams = { name: "Ada", language: "en" };
  resolve("navigation.home");
  resolve("navigation.greeting", { name: "Ada" });
  resolve("navigation.greeting", exactGreetingParams);
  // @ts-expect-error extra parameters from variables are rejected
  resolve("navigation.greeting", widerGreetingParams);
  resolve("itemCount", { count: 2 });
  resolve("allocation", { used: 1, available: 3 });
  // @ts-expect-error unknown nested keys are rejected
  resolve("navigation.missing");
  // @ts-expect-error required placeholder parameters cannot be omitted
  resolve("navigation.greeting");
  // @ts-expect-error parameter-free messages do not accept parameters
  resolve("navigation.home", {});
  // @ts-expect-error extra parameters are rejected
  resolve("navigation.greeting", { name: "Ada", language: "en" });
  // @ts-expect-error single plural selectors must be numeric
  resolve("itemCount", { count: "two" });
  // @ts-expect-error every multi-plural selector is required
  resolve("allocation", { used: 1 });
  // @ts-expect-error multi-plural selectors must be numeric
  resolve("allocation", { used: 1, available: "three" });
}

test("resolves nested plain and interpolated messages", () => {
  assert.equal(resolverContract("navigation.home"), "Home");
  assert.equal(resolve("navigation.greeting", { name: "Ada" }), "Hello, Ada!");
});

test("resolves single and multi plural messages through the formatter", () => {
  assert.equal(resolve("itemCount", { count: 0 }), "No items");
  assert.equal(resolve("itemCount", { count: 1 }), "One item");
  assert.equal(resolve("itemCount", { count: 4 }), "4 items");
  assert.equal(
    resolve("allocation", { used: 1, available: 1 }),
    "One used, one available",
  );
  assert.equal(
    resolve("allocation", { used: 2, available: 3 }),
    "2 used, 3 available",
  );
});

test("descriptor and direct resolution use equivalent formatting", () => {
  const descriptor = describeMessage("navigation.greeting", { name: "Lin" });

  assert.equal(resolve.resolveDescriptor(descriptor), resolve("navigation.greeting", { name: "Lin" }));
});

test("returns an unknown runtime key without throwing", () => {
  const unsafeResolve = resolve as unknown as (
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ) => string;

  assert.doesNotThrow(() => unsafeResolve("runtime.unknown"));
  assert.equal(unsafeResolve("runtime.unknown"), "runtime.unknown");
});

test("accepts nominal descriptors while keeping runtime data plain", () => {
  const descriptor: MessageDescriptor<SyntheticCatalog> = describeMessage(
    "itemCount",
    { count: 2 },
  );

  assert.equal(resolve.resolveDescriptor(descriptor), "2 items");
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor)), {
    key: "itemCount",
    params: { count: 2 },
  });
});
