import assert from "node:assert/strict";
import test from "node:test";

import {
  createMessageDescriptorFactory,
  type MessageDescriptorFactory,
} from "../src/descriptor.js";
import type { MessageNamespace } from "../src/contracts.js";

const syntheticCatalog = {
  status: {
    ready: "Ready",
    owner: "Owned by {name}",
  },
  resultCount: {
    forms: {
      one: "One result",
      other: "{count} results",
    },
  },
} as const satisfies MessageNamespace;

type SyntheticCatalog = typeof syntheticCatalog;

const describeMessage = createMessageDescriptorFactory<SyntheticCatalog>();
const factoryContract: MessageDescriptorFactory<SyntheticCatalog> = describeMessage;

if (false) {
  describeMessage("status.ready");
  describeMessage("status.owner", { name: "Ada" });
  describeMessage("resultCount", { count: 2 });
  // @ts-expect-error unknown keys are rejected
  describeMessage("status.missing");
  // @ts-expect-error required placeholder parameters cannot be omitted
  describeMessage("status.owner");
  // @ts-expect-error parameter-free messages do not accept parameters
  describeMessage("status.ready", {});
  // @ts-expect-error extra parameters are rejected
  describeMessage("status.owner", { name: "Ada", language: "en" });
  // @ts-expect-error plural selectors must be numeric
  describeMessage("resultCount", { count: "two" });
}

test("parameter-free descriptors contain only their key", () => {
  const descriptor = describeMessage("status.ready");

  assert.deepEqual(descriptor, { key: "status.ready" });
  assert.deepEqual(Object.keys(descriptor), ["key"]);
});

test("parameterized descriptors contain only their key and params", () => {
  const descriptor = describeMessage("status.owner", { name: "Ada" });

  assert.deepEqual(descriptor, {
    key: "status.owner",
    params: { name: "Ada" },
  });
  assert.deepEqual(Object.keys(descriptor), ["key", "params"]);
});

test("descriptors preserve their plain data shape through JSON round trips", () => {
  const descriptor = describeMessage("resultCount", { count: 3 });

  assert.deepEqual(JSON.parse(JSON.stringify(descriptor)), {
    key: "resultCount",
    params: { count: 3 },
  });
});

test("the factory is configured only by a generic catalog type", () => {
  assert.equal(createMessageDescriptorFactory.length, 0);
  assert.equal(factoryContract("status.ready").key, "status.ready");
  assert.equal("language" in factoryContract("status.ready"), false);
  assert.equal("catalog" in factoryContract("status.ready"), false);
});
