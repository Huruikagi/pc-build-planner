// @ts-nocheck WriteAuthority の公開dispatchとworker内FIFOを検証する。
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

import { createWriteAuthority } from "../../src/persistence/write-authority.ts";

const ok = (value) => ({ ok: true, value });

test("queryはRepositoryへ、各commandはrunnerへdispatchする", async () => {
  const calls = [];
  const repository = {
    async readRoot() {
      assert.fail("query must use repository.query");
    },
    async query(query) {
      calls.push("query");
      return ok(query({ revision: 7 }));
    },
  };
  const runner = {
    async run() {
      assert.fail("mutation must use request-aware runner");
    },
    async runRequest(operation) {
      calls.push("mutate");
      const proposed = await operation.execute({
        snapshot: { revision: 7 },
        currentBytes: 10,
        quotaBytes: 100,
      });
      assert.equal(proposed.ok, true);
      return ok({
        committedRevision: 8,
        replayed: false,
        value: proposed.value.value,
      });
    },
    async assessReplacement(candidate) {
      calls.push("assess");
      return ok({ candidate });
    },
    async replaceRoot() {
      calls.push("replace");
      return ok({ revision: 9, beforeBytes: 10, afterBytes: 11 });
    },
    async runMaintenance() {
      calls.push("maintenance");
      return ok({});
    },
  };
  const pipeline = {
    apply(snapshot) {
      return ok({ root: snapshot, capacity: { warnings: [] } });
    },
  };
  const authority = createWriteAuthority({ repository, runner, pipeline });

  assert.deepEqual(await authority.query((root) => root.revision), ok(7));
  assert.equal(
    (
      await authority.mutate({
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedRevision: 7,
        operation: {
          kind: "delete",
          entity: "project",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      })
    ).ok,
    true,
  );
  assert.equal(
    (await authority.assessReplacement({ schemaVersion: 1 })).ok,
    true,
  );
  assert.equal((await authority.replaceRoot({})).ok, true);
  assert.equal(
    (await authority.runMaintenance({ type: "release", fence: {} })).ok,
    true,
  );
  assert.deepEqual(calls, [
    "query",
    "mutate",
    "assess",
    "replace",
    "maintenance",
  ]);
});

test("同一authorityのwriteはFIFOでrunnerへ渡し、並行要求を取りこぼさない", async () => {
  const entered = [];
  const releases = [];
  const runner = {
    async runRequest(operation) {
      entered.push(operation.expectedRevision);
      await new Promise((resolve) => releases.push(resolve));
      return ok({
        committedRevision: operation.expectedRevision + 1,
        replayed: false,
      });
    },
    async runMaintenance() {
      return ok({});
    },
    async assessReplacement() {
      return ok({});
    },
    async replaceRoot() {
      return ok({});
    },
  };
  const authority = createWriteAuthority({
    repository: { query: async () => ok(null) },
    runner,
    pipeline: { apply: () => assert.fail("not reached") },
  });
  const command = (revision) => ({
    requestId: `00000000-0000-4000-8000-${String(revision + 1).padStart(12, "0")}`,
    expectedRevision: revision,
    operation: {
      kind: "delete",
      entity: "project",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  });
  const pending = [
    authority.mutate(command(0)),
    authority.mutate(command(1)),
    authority.mutate(command(2)),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(entered, [0]);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(entered, [0, 1]);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  const results = await Promise.all(pending);
  assert.deepEqual(
    results.map((result) => result.value.committedRevision),
    [1, 2, 3],
  );
});

test("公開facadeからの並行mutationを一件ずつcommitしてlost updateを防ぐ", async () => {
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
  const { createLocalDataRepository } = await import(
    "../../src/persistence/repository.ts"
  );
  const { referenceRepairPolicy } = await import(
    "../../src/persistence/reference-repair-policy.ts"
  );
  const { createRootTransactionRunner } = await import(
    "../../src/persistence/root-transaction-runner.ts"
  );
  const { createInMemoryRootWriteLock } = await import(
    "../../src/persistence/root-write-lock.ts"
  );
  const { createInitialRoot } = await import("../../src/persistence/schema.ts");
  const storage = createInMemoryStorageAdapter(
    createInMemoryStorageState({ quotaBytes: 100_000 }),
  );
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    now: () => "2026-07-19T00:00:00Z",
    initialRoot: createInitialRoot,
  });
  const authority = createWriteAuthority({
    repository: createLocalDataRepository(storage, migrations),
    runner,
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
  const project = (index) => ({
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `架空構成${index}`,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
  });
  const results = await Promise.all(
    [0, 1, 2].map((revision) =>
      authority.mutate({
        requestId: `20000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
        expectedRevision: revision,
        operation: {
          kind: "create",
          entity: "project",
          value: project(revision),
        },
      }),
    ),
  );
  assert.equal(
    results.every((result) => result.ok),
    true,
  );
  assert.deepEqual(
    await authority.query((root) => ({
      revision: root.revision,
      names: root.projects.map(({ name }) => name),
    })),
    ok({ revision: 3, names: ["架空構成0", "架空構成1", "架空構成2"] }),
  );
});
