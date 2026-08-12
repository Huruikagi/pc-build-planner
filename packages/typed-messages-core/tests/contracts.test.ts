import assert from "node:assert/strict";
import test from "node:test";

import type {
  DefinitionAt,
  MessageDefinition,
  MessageDescriptor,
  MessageKeyOf,
  MessageNamespace,
  ParamsArgsFor,
  ParamsForKey,
} from "../src/contracts.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const catalog = {
  greeting: "Hello, {name}! You have {total} items.",
  inbox: {
    forms: {
      one: "{owner} has one message",
      other: "{count} messages",
    },
  },
  dashboard: {
    summary: {
      selectors: ["visible", "selected"],
      forms: {
        "one|one": "{label}: one visible and selected item",
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
type _PlainLookup = Expect<
  Equal<DefinitionAt<Catalog, "greeting">, (typeof catalog)["greeting"]>
>;
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
type _PlaceholderParams = Expect<
  Equal<
    ParamsArgsFor<Catalog, "greeting">,
    [params: Readonly<{ name: string | number; total: string | number }>]
  >
>;
type _PluralParams = Expect<
  Equal<
    ParamsArgsFor<Catalog, "inbox">,
    [params: Readonly<{ count: number; owner: string | number }>]
  >
>;
type _MultiPluralParams = Expect<
  Equal<
    ParamsArgsFor<Catalog, "dashboard.summary">,
    [
      params: Readonly<{
        visible: number;
        selected: number;
        label: string | number;
      }>,
    ]
  >
>;
type _NoParams = Expect<Equal<ParamsArgsFor<Catalog, "dashboard.empty">, []>>;

const acceptCatalogKey = (_key: CatalogKeys): void => {};

acceptCatalogKey("greeting");
acceptCatalogKey("dashboard.summary");
// @ts-expect-error unknown catalog keys must fail consumer type checking
acceptCatalogKey("dashboard.missing");

const acceptParams = <
  Key extends CatalogKeys,
  const Params extends ParamsForKey<Catalog, Key> = ParamsForKey<Catalog, Key>,
>(
  _key: Key,
  ..._params: ParamsArgsFor<Catalog, Key, Params>
): void => {};

acceptParams("greeting", { name: "Ada", total: 3 });
const exactGreetingParams = { name: "Ada", total: 3 };
acceptParams("greeting", exactGreetingParams);
const widerGreetingParams = { name: "Ada", total: 3, language: "en" };
// @ts-expect-error extra parameters are rejected when passed through a variable
acceptParams("greeting", widerGreetingParams);
acceptParams("inbox", { count: 2, owner: "Ada" });
acceptParams("dashboard.summary", { visible: 4, selected: 1, label: "Selection" });
acceptParams("dashboard.empty");
// @ts-expect-error required placeholder parameter is missing
acceptParams("greeting", { name: "Ada" });
// @ts-expect-error extra parameters are rejected for object literals
acceptParams("inbox", { count: 2, owner: "Ada", extra: "no" });
// @ts-expect-error placeholders from a single plural dedicated form are required
acceptParams("inbox", { count: 2 });
// @ts-expect-error plural selectors must be numeric
acceptParams("dashboard.summary", { visible: "4", selected: 1, label: "Selection" });
// @ts-expect-error placeholders from a multi-plural combination form are required
acceptParams("dashboard.summary", { visible: 4, selected: 1 });
// @ts-expect-error parameter-free messages do not accept a params argument
acceptParams("dashboard.empty", {});

const describe = <
  Key extends CatalogKeys,
  const Params extends ParamsForKey<Catalog, Key> = ParamsForKey<Catalog, Key>,
>(
  key: Key,
  ...params: ParamsArgsFor<Catalog, Key, Params>
): MessageDescriptor<Catalog> =>
  (params.length === 0 ? { key } : { key, params: params[0] }) as unknown as MessageDescriptor<Catalog>;

const greetingDescriptor = describe("greeting", { name: "Ada", total: 3 });
describe("greeting", exactGreetingParams);
// @ts-expect-error descriptor helpers reject extra parameters from variables
describe("greeting", widerGreetingParams);
const emptyDescriptor = describe("dashboard.empty");
// @ts-expect-error descriptors retain their originating catalog nominally
const wrongCatalogDescriptor: MessageDescriptor<{ readonly other: "Other" }> =
  greetingDescriptor;
// @ts-expect-error descriptor creation enforces required parameters
describe("inbox");
// @ts-expect-error descriptor creation rejects extra parameters
describe("inbox", { count: 1, owner: "Ada", extra: 2 });

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

test("descriptor runtime data remains a JSON-safe key and optional params shape", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(greetingDescriptor)), {
    key: "greeting",
    params: { name: "Ada", total: 3 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(emptyDescriptor)), {
    key: "dashboard.empty",
  });
  void wrongCatalogDescriptor;
});
