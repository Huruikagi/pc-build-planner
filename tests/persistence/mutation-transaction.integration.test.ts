// @ts-nocheck MutationPipelineとRootTransactionRunnerのtransaction境界を検証する。
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

const { schemaValidator } = await import("../../src/domain/validation.ts");
const { createInMemoryStorageAdapter, createInMemoryStorageState } =
  await import("../../src/persistence/in-memory-storage-adapter.ts");
const { maintenancePolicy } = await import(
  "../../src/persistence/maintenance.ts"
);
const { createMigrationRegistry } = await import(
  "../../src/persistence/migration-registry.ts"
);
const { createMutationPipeline } = await import(
  "../../src/persistence/mutation-pipeline.ts"
);
const { createMutationTransaction } = await import(
  "../../src/persistence/mutation-transaction.ts"
);
const { referenceRepairPolicy } = await import(
  "../../src/persistence/reference-repair-policy.ts"
);
const { createRootTransactionRunner } = await import(
  "../../src/persistence/root-transaction-runner.ts"
);
const { createInMemoryRootWriteLock, createInMemoryRootWriteLockState } =
  await import("../../src/persistence/root-write-lock.ts");
const { createInitialRoot } = await import("../../src/persistence/schema.ts");

const now = "2026-07-19T00:00:00.000Z";
const project = (id, name) => ({ id, name, createdAt: now, updatedAt: now });
const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  candidate: "00000000-0000-4000-8000-000000000002",
  build: "00000000-0000-4000-8000-000000000003",
};
const candidate = {
  id: ids.candidate,
  projectId: ids.project,
  category: "cpu",
  product: { name: { original: "架空CPU" } },
  sourceInfo: { pageUrl: "https://example.invalid/item", capturedAt: now },
  normalizedAttributes: { category: "cpu", socket: { original: "架空Socket" } },
  createdAt: now,
  updatedAt: now,
};
const initialRoot = () => ({
  ...createInitialRoot(),
  projects: [project(ids.project, "架空PC")],
  candidateParts: [candidate],
  currentBuilds: [
    {
      id: ids.build,
      projectId: ids.project,
      items: [{ candidatePartId: ids.candidate, quantity: 1 }],
      updatedAt: now,
    },
  ],
});

const harness = async ({ quotaBytes = 10_000, failWrite = false } = {}) => {
  const state = createInMemoryStorageState({ quotaBytes });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(initialRoot());
  const writes = [];
  const storage = {
    readRoot: () => adapter.readRoot(),
    bytesInUse: () => adapter.bytesInUse(),
    quotaBytes: () => adapter.quotaBytes(),
    restrictToTrustedContexts: () => adapter.restrictToTrustedContexts(),
    async writeRoot(root) {
      writes.push(structuredClone(root));
      return adapter.writeRoot(root);
    },
  };
  if (failWrite) state.failNext("write");
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(createInMemoryRootWriteLockState()),
    migrations: createMigrationRegistry(1, [], schemaValidator),
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    now: () => now,
    initialRoot: createInitialRoot,
  });
  return {
    storage,
    writes,
    mutate: createMutationTransaction(
      runner,
      createMutationPipeline(schemaValidator, referenceRepairPolicy),
    ),
  };
};

test("candidate削除と参照修復を中間不整合なしの一回のcommitにする", async () => {
  const { storage, writes, mutate } = await harness();
  const result = await mutate({
    expectedRevision: 0,
    operation: { kind: "delete", entity: "candidatePart", id: ids.candidate },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.revision, 1);
  const stored = (await storage.readRoot()).value;
  assert.equal(stored.revision, 1);
  assert.deepEqual(stored.candidateParts, []);
  assert.deepEqual(stored.currentBuilds[0].items, []);
  assert.equal(schemaValidator.validateRoot(stored).ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], stored);
});

test("revision競合、quota超過、storage失敗をtyped failureにして旧rootを保持する", async () => {
  const operation = {
    kind: "create",
    entity: "project",
    value: project("00000000-0000-4000-8000-000000000004", "予備"),
  };
  for (const [options, expected] of [
    [{}, "revision-conflict"],
    [{ quotaBytes: 1 }, "quota-exceeded"],
    [{ failWrite: true }, "storage-unavailable"],
  ]) {
    const { storage, mutate } = await harness(options);
    const before = (await storage.readRoot()).value;
    const result = await mutate({
      expectedRevision: expected === "revision-conflict" ? 9 : 0,
      operation,
    });
    assert.deepEqual(result, { ok: false, error: { code: expected } });
    assert.deepEqual((await storage.readRoot()).value, before);
  }
});

test("共有lock上の並行mutationは最新snapshotを読み直してlost updateしない", async () => {
  const state = createInMemoryStorageState({ quotaBytes: 10_000 });
  const storage = createInMemoryStorageAdapter(state);
  await storage.writeRoot(initialRoot());
  const lockState = createInMemoryRootWriteLockState();
  const pipeline = createMutationPipeline(
    schemaValidator,
    referenceRepairPolicy,
  );
  const makeMutate = () =>
    createMutationTransaction(
      createRootTransactionRunner({
        storage,
        lock: createInMemoryRootWriteLock(lockState),
        migrations: createMigrationRegistry(1, [], schemaValidator),
        validator: schemaValidator,
        maintenance: maintenancePolicy,
        now: () => now,
        initialRoot: createInitialRoot,
      }),
      pipeline,
    );
  const first = makeMutate();
  const second = makeMutate();
  const results = await Promise.all([
    first({
      expectedRevision: 0,
      operation: {
        kind: "create",
        entity: "project",
        value: project("00000000-0000-4000-8000-000000000004", "A"),
      },
    }),
    second({
      expectedRevision: 1,
      operation: {
        kind: "create",
        entity: "project",
        value: project("00000000-0000-4000-8000-000000000005", "B"),
      },
    }),
  ]);
  assert.equal(
    results.every((result) => result.ok),
    true,
  );
  const stored = (await storage.readRoot()).value;
  assert.equal(stored.revision, 2);
  assert.deepEqual(
    stored.projects.map(({ name }) => name),
    ["架空PC", "A", "B"],
  );
});
