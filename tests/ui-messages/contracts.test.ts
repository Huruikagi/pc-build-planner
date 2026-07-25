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
import { message } from "../../src/ui-messages/resolver.js";

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

function _messageDescriptorNominalTypeCheck(): void {
  const alias = { key: "common.save" };
  // 明示的な型assertion（特に`as unknown as`）はTypeScript自体の意図的なescape hatchであり、ここでは防止対象にしない。
  // @ts-expect-error MessageDescriptorはmessage()以外から直接構築できない。
  const direct: MessageDescriptor = { key: "common.save" };
  // @ts-expect-error 構造互換のaliasもMessageDescriptorとして扱えない。
  const aliased: MessageDescriptor = alias;
  // @ts-expect-error 配列要素を介した構造的代入も拒否する。
  const array: readonly MessageDescriptor[] = [alias];
  // @ts-expect-error satisfiesでもbrandなしのobjectは拒否する。
  const checked = { key: "common.save" } satisfies MessageDescriptor;
  void [direct, aliased, array, checked];
}
void _messageDescriptorNominalTypeCheck;

test("MessageDescriptor はキーと任意のparamsだけを保持する", () => {
  const params: MessageParams = { name: "CPU" };
  const descriptor = message("candidate.editCandidateAction", params);
  assert.equal(descriptor.key, "candidate.editCandidateAction");
  assert.deepEqual(descriptor.params, { name: "CPU" });

  const withoutParams = message("common.save");
  assert.equal(withoutParams.params, undefined);
});
