// @ts-nocheck Chrome APIの最小stubでadapter境界を検証する。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createChromeStorageAdapter } from "../../src/persistence/chrome-storage-adapter.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInitialRoot } from "../../src/persistence/schema.ts";

const createChromeStub = ({ quotaBytes = 4096 } = {}) => {
  const entries = new Map();
  const calls = [];
  const failures = new Map();
  const failNext = (operation, error) => failures.set(operation, error);
  const maybeFail = (operation) => {
    const error = failures.get(operation);
    failures.delete(operation);
    if (error) throw error;
  };
  return {
    entries,
    calls,
    failNext,
    chromeStorageLocal: {
      QUOTA_BYTES: quotaBytes,
      async get(key) {
        calls.push(["get", key]);
        maybeFail("get");
        return entries.has(key)
          ? { [key]: structuredClone(entries.get(key)) }
          : {};
      },
      async set(items) {
        calls.push(["set", Object.keys(items)]);
        maybeFail("set");
        for (const [key, value] of Object.entries(items))
          entries.set(key, structuredClone(value));
      },
      async getBytesInUse(key) {
        calls.push(["bytes", key]);
        maybeFail("bytes");
        if (!entries.has(key)) return 0;
        return new TextEncoder().encode(
          JSON.stringify({ [key]: entries.get(key) }),
        ).byteLength;
      },
      async setAccessLevel(options) {
        calls.push(["access", options]);
        maybeFail("access");
      },
    },
  };
};

test("localDataRootだけをread/writeしruntime quotaとbytesを返す", async () => {
  const stub = createChromeStub({ quotaBytes: 8192 });
  stub.entries.set("unrelated", { retained: true });
  const adapter = createChromeStorageAdapter(stub.chromeStorageLocal);
  const root = createInitialRoot();
  assert.deepEqual(await adapter.readRoot(), { ok: true, value: undefined });
  assert.deepEqual(await adapter.writeRoot(root), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(await adapter.readRoot(), { ok: true, value: root });
  assert.equal((await adapter.bytesInUse()).ok, true);
  assert.equal(adapter.quotaBytes(), 8192);
  assert.deepEqual(stub.entries.get("unrelated"), { retained: true });
  assert.deepEqual(
    stub.calls.map(([operation]) => operation),
    ["get", "set", "get", "bytes"],
  );
});

test("raw rootとは別keyで回復controlを保持し、容量計測に両keyを含める", async () => {
  const stub = createChromeStub();
  const adapter = createChromeStorageAdapter(stub.chromeStorageLocal);
  const control = {
    generation: 1,
    active: true,
    ownerId: "synthetic-owner",
    leaseExpiresAt: "2026-08-09T00:00:00.000Z",
  };
  assert.deepEqual(await adapter.readRecoveryControl(), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(await adapter.writeRecoveryControl(control), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(await adapter.readRecoveryControl(), {
    ok: true,
    value: control,
  });
  assert.equal((await adapter.bytesInUse()).ok, true);
  assert.deepEqual(stub.entries.get("foundationRecoveryControl"), control);
});

test("アクセスをTRUSTED_CONTEXTSへ制限する", async () => {
  const stub = createChromeStub();
  const adapter = createChromeStorageAdapter(stub.chromeStorageLocal);
  assert.deepEqual(await adapter.restrictToTrustedContexts(), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(stub.calls, [
    ["access", { accessLevel: "TRUSTED_CONTEXTS" }],
  ]);
});

test("quota/access/一般例外をtyped failureへ正規化しwrite失敗時に旧rootを保持する", async () => {
  const stub = createChromeStub();
  const adapter = createChromeStorageAdapter(stub.chromeStorageLocal);
  const original = createInitialRoot();
  await adapter.writeRoot(original);

  stub.failNext("set", new Error("QUOTA_BYTES quota exceeded"));
  assert.deepEqual(await adapter.writeRoot({ ...original, revision: 1 }), {
    ok: false,
    error: { code: "quota-exceeded" },
  });
  assert.deepEqual(stub.entries.get("localDataRoot"), original);

  stub.failNext("access", new Error("Access denied"));
  assert.deepEqual(await adapter.restrictToTrustedContexts(), {
    ok: false,
    error: { code: "access-denied" },
  });

  for (const operation of ["get", "bytes", "set"]) {
    stub.failNext(operation, new Error("unexpected Chrome failure"));
    const result =
      operation === "get"
        ? await adapter.readRoot()
        : operation === "bytes"
          ? await adapter.bytesInUse()
          : await adapter.writeRoot(original);
    assert.deepEqual(result, {
      ok: false,
      error: { code: "storage-unavailable" },
    });
  }
});
