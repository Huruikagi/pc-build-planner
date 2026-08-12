import assert from "node:assert/strict";
import test from "node:test";

import type {
  DefinitionAt,
  MessageDefinition,
  MessageKeyOf,
  MessageNamespace,
} from "../src/contracts.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const catalog = {
  greeting: "Hello",
  inbox: {
    forms: {
      one: "One message",
      other: "{count} messages",
    },
  },
  dashboard: {
    summary: {
      selectors: ["visible", "selected"],
      forms: {
        "one|one": "One visible and selected item",
        other: "{visible} visible and {selected} selected items",
      },
    },
    empty: "Nothing here",
  },
} as const satisfies MessageNamespace;

type Catalog = typeof catalog;
type CatalogKeys = MessageKeyOf<Catalog>;

type _AllLeafKeys = Expect<
  Equal<CatalogKeys, "greeting" | "inbox" | "dashboard.summary" | "dashboard.empty">
>;
type _PlainLookup = Expect<Equal<DefinitionAt<Catalog, "greeting">, "Hello">>;
type _PluralLookup = Expect<
  Equal<DefinitionAt<Catalog, "inbox">, (typeof catalog)["inbox"]>
>;
type _MultiPluralLookup = Expect<
  Equal<
    DefinitionAt<Catalog, "dashboard.summary">,
    (typeof catalog)["dashboard"]["summary"]
  >
>;
type _UnknownLookup = Expect<Equal<DefinitionAt<Catalog, "missing.key">, never>>;

const acceptCatalogKey = (_key: CatalogKeys): void => {};

acceptCatalogKey("greeting");
acceptCatalogKey("dashboard.summary");
// @ts-expect-error unknown catalog keys must fail consumer type checking
acceptCatalogKey("dashboard.missing");

const definitions: readonly MessageDefinition[] = [
  "Plain",
  { forms: { one: "One", other: "Other" } },
  {
    selectors: ["first", "second"],
    forms: { "one|one": "Both one", other: "Other" },
  },
];

test("synthetic catalog supports every definition shape", () => {
  assert.equal(definitions.length, 3);
  assert.deepEqual(catalog.dashboard.summary.selectors, ["visible", "selected"]);
});
