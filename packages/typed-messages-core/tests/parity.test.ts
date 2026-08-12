import assert from "node:assert/strict";
import test from "node:test";

import type { MessageNamespace } from "../src/contracts.js";
import {
  type CatalogParityViolations,
  validateCatalogParity,
} from "../src/parity.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const sourceShape = {
  stable: "Hello, {name}",
  changed: { forms: { one: "One {item}", other: "Many {items}" } },
  missing: "Source only",
} as const satisfies MessageNamespace;

const compatibleShape = {
  stable: "Welcome, {name}",
  changed: { forms: { one: "Single {item}", other: "Several {items}" } },
  missing: "Present",
} as const satisfies MessageNamespace;

const incompatibleShape = {
  stable: "Welcome, {name}",
  changed: { forms: { one: "Single {item}", other: "Several {count}" } },
  extra: "Target only",
} as const satisfies MessageNamespace;

type _Compatible = Expect<
  Equal<CatalogParityViolations<typeof sourceShape, typeof compatibleShape>, never>
>;
type _IncompatibleKeys = Expect<
  Equal<
    CatalogParityViolations<typeof sourceShape, typeof incompatibleShape>,
    "changed" | "missing" | "extra"
  >
>;

const acceptParity = <Source, Target>(
  _result: CatalogParityViolations<Source, Target> extends never ? true : never,
): void => {};

acceptParity<typeof sourceShape, typeof compatibleShape>(true);
// @ts-expect-error catalogs with mismatching keys and placeholders are rejected
acceptParity<typeof sourceShape, typeof incompatibleShape>(true);

test("reports missing and placeholder issues before target-only excess keys", () => {
  const issues = validateCatalogParity(
    {
      stable: "Hello, {name}",
      missing: "Source only",
      plural: {
        forms: {
          zero: "No {items}",
          one: "One {item}",
          other: "Many {items}",
        },
      },
      multi: {
        selectors: ["visible", "selected"],
        forms: {
          "one|one": "{visible} visible, {selected} selected",
          other: "{visible} visible from {total}",
        },
      },
    },
    {
      stable: "Hi, {name}",
      plural: {
        forms: {
          zero: "None {items}",
          one: "One {item}",
          other: "Many {count}",
        },
      },
      multi: {
        selectors: ["visible", "selected"],
        forms: {
          "one|one": "{selected} selected, {visible} visible",
          other: "{visible} visible from {maximum}",
        },
      },
      extra: "Target only",
    },
  );

  assert.deepEqual(issues, [
    { code: "missing-key", key: "missing" },
    { code: "placeholder-mismatch", key: "plural" },
    { code: "placeholder-mismatch", key: "multi" },
    { code: "excess-key", key: "extra" },
  ]);
});

test("treats placeholder ordering and duplicates as the same set", () => {
  assert.deepEqual(
    validateCatalogParity(
      { message: "{first} then {second} and {first}" },
      { message: "{second} before {first}" },
    ),
    [],
  );
});

test("returns only generic structural issue fields", () => {
  const issues = validateCatalogParity(
    { release: "Settings 設定 {value}" },
    { release: "{value}", extra: "untranslated" },
  );

  assert.deepEqual(issues, [{ code: "excess-key", key: "extra" }]);
  assert.deepEqual(Object.keys(issues[0] ?? {}).sort(), ["code", "key"]);
});
