// @ts-nocheck Node 26のtype strippingでTypeScript sourceを直接検証する。
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { maintenancePolicy } from "../../src/persistence/maintenance.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createRootTransactionRunner } from "../../src/persistence/root-transaction-runner.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInitialRoot } from "../../src/persistence/schema.ts";

const migrations = createMigrationRegistry(1, [], schemaValidator);
const now = "2026-07-19T00:00:00Z";

const createHarness = (options = {}) => {
  const root = Object.hasOwn(options, "root")
    ? options.root
    : createInitialRoot();
  const {
    lock,
    fail,
    migrationRegistry = migrations,
    initialRoot = createInitialRoot,
  } = options;
  let stored = structuredClone(root);
  const events = [];
  let writes = 0;
  const storage = {
    async readRoot() {
      events.push("read");
      if (fail === "read")
        return { ok: false, error: { code: "storage-unavailable" } };
      return { ok: true, value: structuredClone(stored) };
    },
    async bytesInUse() {
      events.push("bytes");
      if (fail === "bytes")
        return { ok: false, error: { code: "storage-unavailable" } };
      return { ok: true, value: 321 };
    },
    quotaBytes() {
      events.push("quota");
      return 10_000;
    },
    async writeRoot(candidate) {
      events.push("write:start");
      writes += 1;
      if (fail === "write")
        return { ok: false, error: { code: "storage-unavailable" } };
      stored = structuredClone(candidate);
      events.push("write:done");
      return { ok: true, value: undefined };
    },
    async restrictToTrustedContexts() {
      return { ok: true, value: undefined };
    },
  };
  const rootLock = lock ?? {
    async runExclusive(operation) {
      events.push("lock:start");
      const value = await operation();
      events.push("lock:end");
      return { ok: true, value };
    },
  };
  const runner = createRootTransactionRunner({
    storage,
    lock: rootLock,
    migrations: migrationRegistry,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    now: () => now,
    initialRoot,
  });
  return {
    runner,
    events,
    getStored: () => structuredClone(stored),
    getWrites: () => writes,
  };
};

test("未保存時は現行初期rootをtransaction snapshotにする", async () => {
  let initialRootCalls = 0;
  const harness = createHarness({
    root: undefined,
    initialRoot() {
      initialRootCalls += 1;
      return createInitialRoot();
    },
  });
  const result = await harness.runner.run(
    successfulOperation(0, ({ snapshot }) => {
      assert.deepEqual(snapshot, createInitialRoot());
    }),
  );
  assert.deepEqual(result, { ok: true, value: "committed" });
  assert.equal(initialRootCalls, 1);
  assert.equal(harness.getStored().revision, 1);
});

test("旧schemaを現行rootへ移行・全体検証してからoperationへ渡す", async () => {
  const oldRoot = { schemaVersion: 0, legacyRevision: 7 };
  const migrationRegistry = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate(input) {
          assert.deepEqual(input, oldRoot);
          return {
            ok: true,
            value: { ...createInitialRoot(), revision: input.legacyRevision },
          };
        },
      },
    ],
    schemaValidator,
  );
  const harness = createHarness({ root: oldRoot, migrationRegistry });

  const result = await harness.runner.run(
    successfulOperation(7, ({ snapshot }) => {
      assert.deepEqual(snapshot, { ...createInitialRoot(), revision: 7 });
    }),
  );

  assert.deepEqual(result, { ok: true, value: "committed" });
  assert.equal(harness.getStored().schemaVersion, 1);
  assert.equal(harness.getStored().revision, 8);
  assert.equal(harness.getWrites(), 1);
});

test("不正なmigration出力をoperationへ渡さずwriteしない", async () => {
  const migrationRegistry = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate() {
          return {
            ok: true,
            value: { ...createInitialRoot(), revision: -1 },
          };
        },
      },
    ],
    schemaValidator,
  );
  const harness = createHarness({
    root: { schemaVersion: 0 },
    migrationRegistry,
  });
  let called = false;

  const result = await harness.runner.run(
    successfulOperation(0, () => {
      called = true;
    }),
  );

  assert.deepEqual(result, { ok: false, error: { code: "corrupt-data" } });
  assert.equal(called, false);
  assert.equal(harness.getWrites(), 0);
  assert.deepEqual(harness.getStored(), { schemaVersion: 0 });
});

const successfulOperation = (expectedRevision, inspect = () => undefined) => ({
  expectedRevision,
  async execute(context) {
    inspect(context);
    assert.equal("storage" in context, false);
    return {
      ok: true,
      value: {
        root: { ...context.snapshot, projects: [] },
        value: "committed",
      },
    };
  },
});

test("lock取得後の最新snapshotとcapacity値をoperationへ渡し、一回だけcommitする", async () => {
  const initial = { ...createInitialRoot(), revision: 4 };
  const harness = createHarness({ root: initial });
  const result = await harness.runner.run(
    successfulOperation(4, ({ snapshot, currentBytes, quotaBytes }) => {
      assert.equal(snapshot.revision, 4);
      assert.equal(currentBytes, 321);
      assert.equal(quotaBytes, 10_000);
    }),
  );

  assert.deepEqual(result, { ok: true, value: "committed" });
  assert.equal(harness.getStored().revision, 5);
  assert.equal(harness.getWrites(), 1);
  assert.deepEqual(harness.events, [
    "lock:start",
    "read",
    "bytes",
    "quota",
    "write:start",
    "write:done",
    "lock:end",
  ]);
});

test("expected revision競合とactive maintenanceをwrite前にtyped拒否する", async () => {
  const initial = { ...createInitialRoot(), revision: 2 };
  const conflict = createHarness({ root: initial });
  assert.deepEqual(await conflict.runner.run(successfulOperation(1)), {
    ok: false,
    error: { code: "revision-conflict" },
  });
  assert.equal(conflict.getWrites(), 0);

  const active = {
    ...initial,
    maintenance: {
      active: true,
      generation: 1,
      ownerId: "11111111-1111-4111-8111-111111111111",
      leaseExpiresAt: "2026-07-19T00:01:00Z",
    },
  };
  const fenced = createHarness({ root: active });
  assert.deepEqual(await fenced.runner.run(successfulOperation(2)), {
    ok: false,
    error: { code: "maintenance-active" },
  });
  assert.equal(fenced.getWrites(), 0);
});

test("候補rootを最終検証し、operationがrevisionを変更しても二重増分を許さない", async () => {
  const harness = createHarness();
  const invalid = await harness.runner.run({
    expectedRevision: 0,
    async execute({ snapshot }) {
      return {
        ok: true,
        value: { root: { ...snapshot, projects: [{}] }, value: null },
      };
    },
  });
  assert.deepEqual(invalid, { ok: false, error: { code: "validation" } });
  assert.equal(harness.getWrites(), 0);

  const changedRevision = await harness.runner.run({
    expectedRevision: 0,
    async execute({ snapshot }) {
      return {
        ok: true,
        value: { root: { ...snapshot, revision: 1 }, value: null },
      };
    },
  });
  assert.deepEqual(changedRevision, {
    ok: false,
    error: { code: "revision-conflict" },
  });
  assert.equal(harness.getWrites(), 0);
});

test("lock・storage失敗では成功せず旧rootを保持する", async () => {
  const lockFailure = createHarness({
    lock: {
      async runExclusive() {
        return { ok: false, error: { code: "lock-unavailable" } };
      },
    },
  });
  assert.deepEqual(await lockFailure.runner.run(successfulOperation(0)), {
    ok: false,
    error: { code: "lock-unavailable" },
  });

  for (const failure of ["read", "bytes", "write"]) {
    const harness = createHarness({ fail: failure });
    const before = harness.getStored();
    assert.deepEqual(await harness.runner.run(successfulOperation(0)), {
      ok: false,
      error: { code: "storage-unavailable" },
    });
    assert.deepEqual(harness.getStored(), before);
  }
});

test("破損または未対応snapshotをoperationへ渡さず旧rootを保持する", async () => {
  for (const root of [
    { schemaVersion: 99 },
    { schemaVersion: 1, revision: -1 },
  ]) {
    const harness = createHarness({ root });
    let called = false;
    const result = await harness.runner.run(
      successfulOperation(0, () => {
        called = true;
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(
      result.error.code,
      root.schemaVersion === 99 ? "unsupported-version" : "corrupt-data",
    );
    assert.equal(called, false);
    assert.equal(harness.getWrites(), 0);
  }
});
