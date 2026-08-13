import assert from "node:assert/strict";
import test from "node:test";
import {
  createChromeStorageAdapter,
  type ChromeStorageApi,
  type ChromeStorageChange,
} from "../../src/chrome/storage-adapter.js";

interface Root {
  readonly revision: number;
}

interface Control {
  readonly generation: number;
}

const KEYS = { root: "synthetic-root", control: "synthetic-control" } as const;

const createStub = (quotaBytes = 10 * 1024 * 1024) => {
  const entries = new Map<string, unknown>();
  const calls: Array<readonly [string, unknown]> = [];
  const listeners = new Set<
    (changes: Readonly<Record<string, ChromeStorageChange>>, area: string) => void
  >();
  const failures = new Map<string, unknown>();
  let invalidGet = false;
  let invalidBytes = false;
  const failNext = (operation: string, cause: unknown) =>
    failures.set(operation, cause);
  const maybeFail = (operation: string) => {
    if (!failures.has(operation)) return;
    const cause = failures.get(operation);
    failures.delete(operation);
    throw cause;
  };
  const api: ChromeStorageApi = {
    local: {
      QUOTA_BYTES: quotaBytes,
      async get(key) {
        calls.push(["get", key]);
        maybeFail("get");
        if (invalidGet) return null as unknown as Record<string, unknown>;
        return entries.has(key) ? { [key]: structuredClone(entries.get(key)) } : {};
      },
      async set(items) {
        calls.push(["set", Object.keys(items)]);
        maybeFail("set");
        for (const [key, value] of Object.entries(items)) {
          entries.set(key, structuredClone(value));
        }
      },
      async getBytesInUse(keys) {
        calls.push(["bytes", keys]);
        maybeFail("bytes");
        if (invalidBytes) return Number.NaN;
        return new TextEncoder().encode(
          JSON.stringify(
            Object.fromEntries(
              keys
                .filter((key) => entries.has(key))
                .map((key) => [key, entries.get(key)]),
            ),
          ),
        ).byteLength;
      },
      async setAccessLevel(options) {
        calls.push(["access", options]);
        maybeFail("access");
      },
    },
    onChanged: {
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    },
  };
  return {
    api,
    calls,
    entries,
    failNext,
    invalidateGet: () => { invalidGet = true; },
    invalidateBytes: () => { invalidBytes = true; },
    emit: (changes: Readonly<Record<string, ChromeStorageChange>>, area = "local") => {
      for (const listener of listeners) listener(changes, area);
    },
    listenerCount: () => listeners.size,
  };
};

const open = async (stub: ReturnType<typeof createStub>) => {
  const opened = await createChromeStorageAdapter<Root, Control>(stub.api, KEYS);
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error("expected storage handle");
  return opened.value;
};

test("trusted access後だけhandleを公開し、指定root/control keyだけを扱う", async () => {
  const stub = createStub();
  stub.entries.set("unrelated", { retained: true });
  const storage = await open(stub);
  assert.equal(storage.quotaBytes(), 10 * 1024 * 1024);
  assert.deepEqual(await storage.writeRoot({ revision: 1 }), { ok: true, value: undefined });
  assert.deepEqual(await storage.writeControl({ generation: 2 }), { ok: true, value: undefined });
  assert.deepEqual(await storage.readRoot(), { ok: true, value: { revision: 1 } });
  assert.deepEqual(await storage.readControl(), { ok: true, value: { generation: 2 } });
  assert.equal((await storage.bytesInUse()).ok, true);
  assert.deepEqual(stub.entries.get("unrelated"), { retained: true });
  assert.deepEqual(stub.calls[0], ["access", { accessLevel: "TRUSTED_CONTEXTS" }]);
  assert.deepEqual(stub.calls.at(-1), ["bytes", [KEYS.root, KEYS.control]]);
});

test("quota rejectionを安定codeへ正規化し既存rootを保持する", async () => {
  const stub = createStub();
  const storage = await open(stub);
  await storage.writeRoot({ revision: 1 });
  stub.failNext("set", new DOMException("platform detail", "QuotaExceededError"));
  assert.deepEqual(await storage.writeRoot({ revision: 2 }), { ok: false, error: { code: "quota-exceeded" } });
  assert.deepEqual(stub.entries.get(KEYS.root), { revision: 1 });
});

test("access failureと不正platform responseをfail closedにする", async () => {
  const denied = createStub();
  denied.failNext("access", { privatePlatformValue: "must-not-leak" });
  assert.deepEqual(await createChromeStorageAdapter(denied.api, KEYS), { ok: false, error: { code: "access-denied" } });
  assert.deepEqual(denied.calls.map(([operation]) => operation), ["access"]);

  const invalid = createStub();
  const storage = await open(invalid);
  invalid.invalidateGet();
  assert.deepEqual(await storage.readRoot(), { ok: false, error: { code: "storage-unavailable" } });
  invalid.invalidateBytes();
  assert.deepEqual(await storage.bytesInUse(), { ok: false, error: { code: "storage-unavailable" } });

  const rejected = createStub();
  const rejectedStorage = await open(rejected);
  rejected.failNext("get", "unknown rejection");
  assert.deepEqual(await rejectedStorage.readControl(), { ok: false, error: { code: "storage-unavailable" } });
  rejected.failNext("bytes", { hidden: "platform value" });
  assert.deepEqual(await rejectedStorage.bytesInUse(), { ok: false, error: { code: "storage-unavailable" } });
  rejected.failNext("set", new Error("opaque write failure"));
  assert.deepEqual(await rejectedStorage.writeControl({ generation: 1 }), { ok: false, error: { code: "storage-unavailable" } });
});

test("不正quotaとkey scopeではplatform handleを公開しない", async () => {
  const invalidQuota = createStub(Number.NaN);
  assert.deepEqual(await createChromeStorageAdapter(invalidQuota.api, KEYS), { ok: false, error: { code: "storage-unavailable" } });
  assert.deepEqual(invalidQuota.calls, []);

  const duplicateKeys = createStub();
  assert.deepEqual(
    await createChromeStorageAdapter(duplicateKeys.api, { root: "same", control: "same" }),
    { ok: false, error: { code: "storage-unavailable" } },
  );
  assert.deepEqual(duplicateKeys.calls, []);
});

test("対象keyのchangeだけを通知しunsubscribeを冪等にする", async () => {
  const stub = createStub();
  const storage = await open(stub);
  const observed: unknown[] = [];
  const unsubscribe = storage.subscribe((change) => observed.push(change));
  stub.emit({ unrelated: { newValue: "ignored" } });
  stub.emit({ [KEYS.root]: { oldValue: { revision: 1 }, newValue: { revision: 2 } } }, "sync");
  stub.emit({ [KEYS.root]: { oldValue: { revision: 1 }, newValue: { revision: 2 } }, [KEYS.control]: { newValue: { generation: 1 } } });
  assert.deepEqual(observed, [
    { key: "root", oldValue: { revision: 1 }, newValue: { revision: 2 } },
    { key: "control", newValue: { generation: 1 } },
  ]);
  unsubscribe();
  unsubscribe();
  assert.equal(stub.listenerCount(), 0);
  stub.emit({ [KEYS.root]: { newValue: { revision: 3 } } });
  assert.equal(observed.length, 2);
});

test("platform failureと不正responseをconsoleへ出力しない", async () => {
  const calls: unknown[][] = [];
  const methods = ["debug", "error", "info", "log", "warn"] as const;
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]])) as Record<(typeof methods)[number], typeof console.log>;
  for (const method of methods) console[method] = (...values: unknown[]) => calls.push([method, ...values]);

  try {
    const access = createStub();
    access.failNext("access", { exception: "access-secret" });
    assert.deepEqual(await createChromeStorageAdapter(access.api, KEYS), { ok: false, error: { code: "access-denied" } });
    assert.deepEqual(calls, [], "access rejection must not be logged");

    const quota = createStub();
    const quotaStorage = await open(quota);
    const secretRoot = { revision: 987_654_321 };
    const quotaSecret = Object.assign(new Error("quota-secret"), { name: "QuotaExceededError", root: secretRoot });
    quota.failNext("set", quotaSecret);
    assert.deepEqual(await quotaStorage.writeRoot(secretRoot), { ok: false, error: { code: "quota-exceeded" } });
    assert.deepEqual(calls, [], "quota cause and root must not be logged");

    const malformed = createStub();
    const malformedStorage = await open(malformed);
    malformed.invalidateGet();
    assert.deepEqual(await malformedStorage.readRoot(), { ok: false, error: { code: "storage-unavailable" } });
    assert.deepEqual(calls, [], "malformed response must not be logged");

    const unknown = createStub();
    const unknownStorage = await open(unknown);
    unknown.failNext("get", { exception: "unknown-secret", value: secretRoot });
    assert.deepEqual(await unknownStorage.readControl(), { ok: false, error: { code: "storage-unavailable" } });
    assert.deepEqual(calls, [], "unknown rejection must not be logged");
  } finally {
    for (const method of methods) console[method] = originals[method];
  }
});
