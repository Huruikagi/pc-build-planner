import assert from "node:assert/strict";
import test from "node:test";

import type {
  DefinitionAt,
  MessageDescriptor,
  MessageKeyOf,
  MessageNamespace,
  MessageParams,
  PlaceholderNames,
} from "../../src/ui-messages/contracts.js";

/** Type-level equality check: fails to compile when `A` and `B` diverge. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const SAMPLE = {
  common: {
    save: "保存",
  },
  candidate: {
    editButton: "{name}を編集",
  },
} as const satisfies MessageNamespace;

type SampleKey = MessageKeyOf<typeof SAMPLE>;

// Dot-joined key union is derived from nested namespace segments only.
type _KeyCheck = Expect<
  Equal<SampleKey, "common.save" | "candidate.editButton">
>;

// A leaf key resolves to its literal definition, not a widened `string`.
type _DefinitionCheck = Expect<
  Equal<DefinitionAt<typeof SAMPLE, "candidate.editButton">, "{name}を編集">
>;

// Placeholder extraction finds `{name}` and yields `never` when there is none.
type _PlaceholderCheck = Expect<
  Equal<PlaceholderNames<"{name}を編集">, "name">
>;
type _NoPlaceholderCheck = Expect<Equal<PlaceholderNames<"保存">, never>>;

test("MessageDescriptor はキーと任意のparamsだけを保持する", () => {
  const params: MessageParams = { name: "CPU" };
  const descriptor: MessageDescriptor = {
    key: "candidate.editButton",
    params,
  };
  assert.equal(descriptor.key, "candidate.editButton");
  assert.deepEqual(descriptor.params, { name: "CPU" });

  const withoutParams: MessageDescriptor = { key: "common.save" };
  assert.equal(withoutParams.params, undefined);
});
