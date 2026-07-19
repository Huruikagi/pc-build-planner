// @ts-nocheck CapacityPolicyの公開契約をNode type strippingで直接検証する。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createCapacityPolicy } from "../../src/persistence/capacity-policy.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInitialRoot } from "../../src/persistence/schema.ts";

const encodedBytes = (root) =>
  new TextEncoder().encode(JSON.stringify({ localDataRoot: root })).byteLength;

test("通常域では保存前後と直列化後の必要bytesをwarningなしで返す", async () => {
  const state = createInMemoryStorageState({ quotaBytes: 10_000 });
  const storage = createInMemoryStorageAdapter(state);
  const before = createInitialRoot();
  await storage.writeRoot(before);
  const after = { ...before, revision: 1 };
  const result = await createCapacityPolicy(storage).assess(after);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    beforeBytes: encodedBytes(before),
    afterBytes: encodedBytes(after),
    requiredBytes: encodedBytes(after),
    quotaBytes: 10_000,
    warningThresholdBytes: 8_000,
    warnings: [],
  });
});

test("設定した警告比率の境界到達を成功metadataとして返す", async () => {
  const root = createInitialRoot();
  const requiredBytes = encodedBytes(root);
  const storage = createInMemoryStorageAdapter(
    createInMemoryStorageState({ quotaBytes: requiredBytes * 2 }),
  );
  const result = await createCapacityPolicy(storage, 0.5).assess(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.warnings, [
    { code: "capacity-warning", thresholdBytes: requiredBytes },
  ]);
});

test("実行時quotaを1 byteでも超える見込みを識別可能に拒否する", async () => {
  const root = createInitialRoot();
  const requiredBytes = encodedBytes(root);
  const storage = createInMemoryStorageAdapter(
    createInMemoryStorageState({ quotaBytes: requiredBytes - 1 }),
  );
  const result = await createCapacityPolicy(storage).assess(root);
  assert.deepEqual(result, { ok: false, error: { code: "quota-exceeded" } });
  assert.equal((await storage.readRoot()).value, undefined);
});
