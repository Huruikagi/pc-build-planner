// @ts-nocheck Node 26のtype strippingでTypeScript sourceを直接検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.endsWith(".js") ? `${specifier.slice(0, -3)}.ts` : specifier,
      context,
    );
  },
});

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { maintenancePolicy } from "../../src/persistence/maintenance.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  createInitialRoot,
  REQUEST_DEDUPE_LIMIT,
} from "../../src/persistence/schema.ts";

const { createRootTransactionRunner } = await import(
  "../../src/persistence/root-transaction-runner.ts"
);

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

test("同一request IDとcanonical payloadの再試行は保存済みreceiptを返して再実行しない", async () => {
  const harness = createHarness();
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let executions = 0;
  const operation = {
    requestId,
    payload: { z: [1, { b: true, a: "same" }], a: null },
    expectedRevision: 0,
    async execute({ snapshot }) {
      executions += 1;
      return {
        ok: true,
        value: { root: snapshot, value: "fresh-only" },
      };
    },
  };

  assert.deepEqual(await harness.runner.runRequest(operation), {
    ok: true,
    value: { committedRevision: 1, replayed: false, value: "fresh-only" },
  });
  const recreated = createRootTransactionRunner({
    storage: {
      async readRoot() {
        return { ok: true, value: harness.getStored() };
      },
      async bytesInUse() {
        return { ok: true, value: 321 };
      },
      quotaBytes() {
        return 10_000;
      },
      async writeRoot() {
        assert.fail("replay must not write");
      },
      async restrictToTrustedContexts() {
        return { ok: true, value: undefined };
      },
    },
    lock: {
      async runExclusive(callback) {
        return { ok: true, value: await callback() };
      },
    },
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    now: () => now,
    initialRoot: createInitialRoot,
  });
  const replay = await recreated.runRequest({
    ...operation,
    payload: { a: null, z: [1, { a: "same", b: true }] },
  });
  assert.deepEqual(replay, {
    ok: true,
    value: { committedRevision: 1, replayed: true },
  });
  assert.equal(executions, 1);
  assert.equal(harness.getStored().requestDedupe.length, 1);
});

test("同じrequest IDの異payloadをrequest conflictとして拒否する", async () => {
  const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const root = {
    ...createInitialRoot(),
    revision: 3,
    requestDedupe: [
      { requestId, payloadDigest: "not-the-new-digest", committedRevision: 3 },
    ],
  };
  const harness = createHarness({ root });
  assert.deepEqual(
    await harness.runner.runRequest({
      requestId,
      payload: { changed: true },
      expectedRevision: 3,
      async execute() {
        assert.fail("conflicting request must not execute");
      },
    }),
    { ok: false, error: { code: "request-conflict" } },
  );
  assert.equal(harness.getWrites(), 0);
});

test("request記録を固定上限で古い順にevictし、保持外再送はexpected revisionで拒否する", async () => {
  const records = Array.from({ length: REQUEST_DEDUPE_LIMIT }, (_, index) => ({
    requestId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    payloadDigest: `digest-${index}`,
    committedRevision: index + 1,
  }));
  const harness = createHarness({
    root: { ...createInitialRoot(), revision: 100, requestDedupe: records },
  });
  await harness.runner.runRequest({
    requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    payload: { new: true },
    expectedRevision: 100,
    async execute({ snapshot }) {
      return { ok: true, value: { root: snapshot, value: null } };
    },
  });
  const stored = harness.getStored();
  assert.equal(stored.requestDedupe.length, REQUEST_DEDUPE_LIMIT);
  assert.equal(stored.requestDedupe[0].requestId, records[1].requestId);
  assert.equal(stored.requestDedupe.at(-1).committedRevision, 101);

  assert.deepEqual(
    await harness.runner.runRequest({
      requestId: records[0].requestId,
      payload: { old: true },
      expectedRevision: 0,
      async execute() {
        assert.fail("stale revision must reject before execution");
      },
    }),
    { ok: false, error: { code: "revision-conflict" } },
  );
});

test("operation候補のdedupe改変を無視しsnapshot履歴と新recordだけを同じcommitへ保存する", async () => {
  const prior = {
    requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    payloadDigest: "prior-digest",
    committedRevision: 1,
  };
  for (const forgedDedupe of [
    [],
    [
      {
        requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        payloadDigest: "forged",
        committedRevision: 99,
      },
    ],
  ]) {
    const harness = createHarness({
      root: {
        ...createInitialRoot(),
        revision: 1,
        requestDedupe: [prior],
      },
    });
    const result = await harness.runner.runRequest({
      requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      payload: { operation: "safe" },
      expectedRevision: 1,
      async execute({ snapshot }) {
        return {
          ok: true,
          value: {
            root: { ...snapshot, requestDedupe: forgedDedupe },
            value: null,
          },
        };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
      harness
        .getStored()
        .requestDedupe.map(({ requestId, committedRevision }) => ({
          requestId,
          committedRevision,
        })),
      [
        { requestId: prior.requestId, committedRevision: 1 },
        {
          requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          committedRevision: 2,
        },
      ],
    );
  }
});
