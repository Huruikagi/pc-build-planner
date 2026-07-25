import assert from "node:assert/strict";
import test from "node:test";
import type { MessageCatalogShape } from "../../src/ui-messages/catalog/index.js";
import { MESSAGES } from "../../src/ui-messages/catalog/index.js";
import type { ParamsArgsFor } from "../../src/ui-messages/resolver.js";
import {
  createMessageResolver,
  flattenNamespace,
  message,
} from "../../src/ui-messages/resolver.js";

/** Type-level equality check: fails to compile when `A` and `B` diverge. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// Synthetic catalog exercising placeholder-carrying keys, since the real MESSAGES
// currently has none (task 3.x will add them). Verifies ParamsArgsFor generically.
const SAMPLE = {
  common: { save: "保存" },
  candidate: { editButton: "{name}を編集" },
  backup: {
    restored: {
      forms: { other: "{count}件復元しました", one: "1件復元しました" },
    },
  },
} as const;

// No placeholders → no arguments accepted.
type _NoParams = Expect<Equal<ParamsArgsFor<typeof SAMPLE, "common.save">, []>>;
// A placeholder → a single required params object with that key.
type _WithParams = Expect<
  Equal<
    ParamsArgsFor<typeof SAMPLE, "candidate.editButton">,
    [params: Readonly<Record<"name", string | number>>]
  >
>;

// Plural definitions require `count`. Demonstrated by assignability rather than
// exact tuple equality, since the derived intersection's printed form is an
// implementation detail. `callPlural` is ambient (erased); the calls below are
// wrapped in a never-invoked function so only the type checker sees them.
declare function callPlural(
  ...params: ParamsArgsFor<typeof SAMPLE, "backup.restored">
): void;
function _pluralParamsTypeCheck(): void {
  callPlural({ count: 3 });
  // @ts-expect-error omitting the required `count` param must fail.
  callPlural();
  // @ts-expect-error `count` must be typed as `number` for form selection.
  callPlural({ count: "3" });
}
void _pluralParamsTypeCheck;

test("存在しないキーの参照とパラメータの過不足はコンパイルエラーになる", () => {
  const catalog = flattenNamespace(MESSAGES) as unknown as MessageCatalogShape;
  const resolver = createMessageResolver(catalog);
  // @ts-expect-error "does.not.exist" is not a real MessageKey.
  resolver("does.not.exist");
  // @ts-expect-error "does.not.exist" is not a real MessageKey.
  message("does.not.exist");
  // @ts-expect-error common.save takes no params.
  resolver("common.save", { extra: "value" });
  assert.equal(resolver("common.save"), "保存");
});

test("createMessageResolverはキーを解決し、未知キーはキー文字列を返す", () => {
  const catalog = flattenNamespace(MESSAGES) as unknown as MessageCatalogShape;
  const resolver = createMessageResolver(catalog);
  assert.equal(resolver("common.save"), "保存");
  assert.equal(
    resolver.resolveDescriptor({ key: "does.not.exist" }),
    "does.not.exist",
  );
});

test("resolveDescriptorはparams付きの記述子を解決する", () => {
  const catalog = flattenNamespace({
    candidate: { editButton: "{name}を編集" },
  }) as unknown as MessageCatalogShape;
  const resolver = createMessageResolver(catalog);
  assert.equal(
    resolver.resolveDescriptor({
      key: "candidate.editButton",
      params: { name: "CPU" },
    }),
    "CPUを編集",
  );
});

test("messageは型安全な記述子を作る唯一の手段であり、paramsが無ければ省略する", () => {
  const descriptor = message("common.save");
  assert.deepEqual(descriptor, { key: "common.save" });
  assert.equal("params" in descriptor, false);
});

test("flattenNamespaceは入れ子の名前空間をドット区切りの平坦なキーへ変換する", () => {
  const flat = flattenNamespace({
    common: { save: "保存" },
    category: { cpu: "CPU" },
  });
  assert.deepEqual(flat, { "common.save": "保存", "category.cpu": "CPU" });
});
