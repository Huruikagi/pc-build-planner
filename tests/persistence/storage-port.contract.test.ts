// @ts-nocheck storage portへ意図的な障害条件を注入するcontract test。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInitialRoot } from "../../src/persistence/schema.ts";

const createAdapter = createInMemoryStorageAdapter;

test("別instanceが単一keyのrootと永続制御stateを共有する", async () => {
  const state = createInMemoryStorageState({ quotaBytes: 2048 });
  const first = createAdapter(state);
  const root = {
    ...createInitialRoot(),
    maintenance: {
      generation: 4,
      active: true,
      ownerId: "00000000-0000-4000-8000-000000000099",
      leaseExpiresAt: "2035-01-01T00:00:00.000Z",
    },
  };
  assert.deepEqual(await first.writeRoot(root), { ok: true, value: undefined });

  const restarted = createAdapter(state);
  const read = await restarted.readRoot();
  assert.equal(read.ok, true);
  assert.deepEqual(read.value, root);
  assert.notEqual(read.value, root);
  assert.equal(state.entries.size, 1);
  assert.equal(state.entries.has("localDataRoot"), true);
});

test("bytes、runtime quota、trusted-context制限を決定的に返す", async () => {
  const state = createInMemoryStorageState({ quotaBytes: 4096 });
  const adapter = createAdapter(state);
  assert.equal(adapter.quotaBytes(), 4096);
  assert.deepEqual(await adapter.restrictToTrustedContexts(), {
    ok: true,
    value: undefined,
  });
  assert.equal(state.trustedContextsOnly, true);
  await adapter.writeRoot(createInitialRoot());
  const usage = await adapter.bytesInUse();
  assert.equal(usage.ok, true);
  assert.equal(usage.value > 0, true);
});

test("read/write/bytes/access失敗をtyped化しwrite失敗時は既存rootを保持する", async () => {
  const state = createInMemoryStorageState();
  const adapter = createAdapter(state);
  const original = createInitialRoot();
  assert.equal((await adapter.writeRoot(original)).ok, true);

  for (const operation of ["read", "bytes", "access"]) {
    state.failNext(operation);
    const result =
      operation === "read"
        ? await adapter.readRoot()
        : operation === "bytes"
          ? await adapter.bytesInUse()
          : await adapter.restrictToTrustedContexts();
    assert.equal(result.ok, false);
    assert.equal(
      result.error.code,
      operation === "access" ? "access-denied" : "storage-unavailable",
    );
  }

  state.failNext("write");
  const changed = { ...original, revision: 1 };
  const failedWrite = await adapter.writeRoot(changed);
  assert.equal(failedWrite.ok, false);
  assert.equal(failedWrite.error.code, "storage-unavailable");
  assert.deepEqual((await adapter.readRoot()).value, original);
});
