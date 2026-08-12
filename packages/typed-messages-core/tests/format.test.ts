import assert from "node:assert/strict";
import test from "node:test";

import { formatMessage } from "../src/format.js";

test("plain messageを変更せず返す", () => {
  assert.equal(formatMessage("Build ready"), "Build ready");
});

test("stringとnumber parameterを補間する", () => {
  assert.equal(
    formatMessage("{builder} has {count} parts", {
      builder: "Alex",
      count: 3,
    }),
    "Alex has 3 parts",
  );
});

test("single pluralはzero、one、otherを選び、専用form欠落時はotherへfallbackする", () => {
  const complete = {
    forms: {
      zero: "no parts",
      one: "one part",
      other: "{count} parts",
    },
  } as const;
  const fallbackOnly = { forms: { other: "{count} parts" } } as const;

  assert.equal(formatMessage(complete, { count: 0 }), "no parts");
  assert.equal(formatMessage(complete, { count: 1 }), "one part");
  assert.equal(formatMessage(complete, { count: 4 }), "4 parts");
  assert.equal(formatMessage(fallbackOnly, { count: 0 }), "0 parts");
  assert.equal(formatMessage(fallbackOnly, { count: 1 }), "1 parts");
});

test("multi pluralはselector宣言順のcategory combinationを選ぶ", () => {
  const definition = {
    selectors: ["buildCount", "partCount"] as const,
    forms: {
      "one|zero": "one build with no parts",
      "zero|one": "no builds and one part",
      other: "{buildCount} builds and {partCount} parts",
    },
  };

  assert.equal(
    formatMessage(definition, { buildCount: 1, partCount: 0 }),
    "one build with no parts",
  );
  assert.equal(
    formatMessage(definition, { buildCount: 0, partCount: 1 }),
    "no builds and one part",
  );
});

test("selector、combination、parameter欠落時はotherと未解決placeholderへfallbackする", () => {
  const definition = {
    selectors: ["buildCount", "partCount"] as const,
    forms: {
      "one|one": "one build and one part",
      other: "{buildCount} builds and {partCount} parts",
    },
  };

  assert.doesNotThrow(() => formatMessage(definition));
  assert.equal(
    formatMessage(definition, { buildCount: 1 }),
    "1 builds and {partCount} parts",
  );
  assert.equal(
    formatMessage(definition, { buildCount: 2, partCount: 2 }),
    "2 builds and 2 parts",
  );
  assert.equal(formatMessage("Hello {name}"), "Hello {name}");
});

test("同じ入力から同じ結果を返しdefinitionとparamsを変更しない", () => {
  const definition = {
    selectors: ["buildCount", "partCount"] as const,
    forms: {
      "one|one": "{owner}: one build and one part",
      other: "{owner}: {buildCount} builds and {partCount} parts",
    },
  };
  const params = { owner: "Sam", buildCount: 1, partCount: 1 };
  const definitionBefore = structuredClone(definition);
  const paramsBefore = structuredClone(params);

  const first = formatMessage(definition, params);
  const second = formatMessage(definition, params);

  assert.equal(first, "Sam: one build and one part");
  assert.equal(second, first);
  assert.deepEqual(definition, definitionBefore);
  assert.deepEqual(params, paramsBefore);
});
