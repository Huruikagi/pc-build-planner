import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicApiRegistry,
  type PublicApiCompositionError,
} from "../../src/application-shell/public-api-registry.js";

test("feature単位の公開契約を型と参照を保ったreadonly rootへ合成する", () => {
  const registry = createPublicApiRegistry<{
    readonly catalog: { readonly find: (id: string) => string };
    readonly build: { readonly count: () => number };
  }>();
  const catalog = { find: (id: string) => `part:${id}` };
  const build = { count: () => 2 };

  const root = registry.compose({ catalog, build });

  assert.equal(root.catalog, catalog);
  assert.equal(root.build, build);
  assert.equal(root.catalog.find("cpu"), "part:cpu");
  assert.equal(Object.isFrozen(root), true);
  assert.equal(Reflect.set(root, "extra", {}), false);
});

test("動的entry列の重複keyを安定した合成errorで拒否する", () => {
  const registry = createPublicApiRegistry();

  const result = registry.composeEntries([
    { key: "catalog", publicApi: { find: () => "first" } },
    { key: "catalog", publicApi: { find: () => "second" } },
  ] as const);

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "duplicate_public_api_key", key: "catalog" },
  } satisfies {
    readonly ok: false;
    readonly error: PublicApiCompositionError;
  });
});

test("未信頼の公開契約を境界で検証し入力値をdiagnosticへ漏らさない", () => {
  const registry = createPublicApiRegistry();

  assert.deepEqual(registry.composeUnknown(null), {
    ok: false,
    error: {
      kind: "invalid_public_api",
      detail: "entries: array is required",
    },
  });
  assert.deepEqual(
    registry.composeUnknown([{ key: "catalog", publicApi: [] }]),
    {
      ok: false,
      error: {
        kind: "invalid_public_api",
        detail: "entries[0].publicApi: object is required",
      },
    },
  );
});

test("動的entry列から合成したrootもreadonlyになる", () => {
  const registry = createPublicApiRegistry();
  const result = registry.composeEntries([
    { key: "catalog", publicApi: { find: (id: string) => `part:${id}` } },
    { key: "build", publicApi: { count: () => 2 } },
  ] as const);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.catalog.find("cpu"), "part:cpu");
  assert.equal(result.value.build.count(), 2);
  assert.equal(Object.isFrozen(result.value), true);
});

test("予約済みproperty名もprototypeを変更せずown keyとして合成する", () => {
  const registry = createPublicApiRegistry();
  const protoApi = { read: () => "proto" };
  const constructorApi = { read: () => "constructor" };
  const prototypeApi = { read: () => "prototype" };

  const result = registry.composeEntries([
    { key: "__proto__", publicApi: protoApi },
    { key: "constructor", publicApi: constructorApi },
    { key: "prototype", publicApi: prototypeApi },
  ] as const);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.getPrototypeOf(result.value), null);
  assert.equal(Object.hasOwn(result.value, "__proto__"), true);
  assert.equal(
    Object.getOwnPropertyDescriptor(result.value, "__proto__")?.value,
    protoApi,
  );
  assert.equal(result.value.constructor, constructorApi);
  assert.equal(result.value.prototype, prototypeApi);
});

test("予約済みproperty名でも重複keyを拒否する", () => {
  const registry = createPublicApiRegistry();

  const result = registry.composeUnknown([
    { key: "__proto__", publicApi: { read: () => "first" } },
    { key: "__proto__", publicApi: { read: () => "second" } },
  ]);

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "duplicate_public_api_key", key: "__proto__" },
  });
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});
