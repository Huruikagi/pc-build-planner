// @ts-nocheck 複数clientとworker再生成を公開facade経由で回帰検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only project sources are type-stripped. A package resolves its own
    // `.js` specifiers against the files it actually ships.
    const typeStripped =
      specifier.endsWith(".js") &&
      !(context.parentURL ?? "").includes("/node_modules/");
    return nextResolve(
      typeStripped ? `${specifier.slice(0, -3)}.ts` : specifier,
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
const { referenceRepairPolicy } = await import(
  "../../src/persistence/reference-repair-policy.ts"
);
const { createLocalDataRepository } = await import(
  "../../src/persistence/repository.ts"
);
const { createRootTransactionRunner } = await import(
  "../../src/persistence/root-transaction-runner.ts"
);
const { createInitialRoot } = await import("../../src/persistence/schema.ts");
const { createWebLocksAdapter } = await import(
  "../../src/persistence/web-locks-adapter.ts"
);
const { createWriteAuthority } = await import(
  "../../src/persistence/write-authority.ts"
);

const NOW = "2026-07-19T00:00:00Z";
const OWNER = "11111111-1111-4111-8111-111111111111";

const createLockService = () => {
  const tails = new Map();
  let active = 0;
  let maximumActive = 0;
  let waitedRequests = 0;
  return {
    async request(name, _options, callback) {
      const previous = tails.get(name) ?? Promise.resolve();
      if (tails.has(name)) waitedRequests += 1;
      let release: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(name, current);
      await previous;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        return await callback();
      } finally {
        active -= 1;
        release();
        if (tails.get(name) === current) tails.delete(name);
      }
    },
    metrics: () => ({ maximumActive, waitedRequests }),
  };
};

const createHarness = () => {
  const durableState = createInMemoryStorageState({ quotaBytes: 100_000 });
  const lockService = createLockService();
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const createAuthority = () => {
    const storage = createInMemoryStorageAdapter(durableState);
    const runner = createRootTransactionRunner({
      storage,
      lock: createWebLocksAdapter(lockService),
      migrations,
      validator: schemaValidator,
      maintenance: maintenancePolicy,
      now: () => NOW,
      initialRoot: createInitialRoot,
    });
    return createWriteAuthority({
      repository: createLocalDataRepository(storage, migrations),
      runner,
      pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
    });
  };
  return { createAuthority, lockService };
};

const createProjectCommand = (index, expectedRevision = index) => ({
  requestId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  expectedRevision,
  operation: {
    kind: "create",
    entity: "project",
    value: {
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `架空並行構成${index}`,
      createdAt: NOW,
      updatedAt: NOW,
    },
  },
});

test("別authorityの同時mutationはlock待機しrevisionを単調増加させる", async () => {
  const harness = createHarness();
  const authorities = [
    harness.createAuthority(),
    harness.createAuthority(),
    harness.createAuthority(),
  ];
  const results = await Promise.all(
    authorities.map((authority, index) =>
      authority.mutate(createProjectCommand(index)),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.ok && result.value.committedRevision),
    [1, 2, 3],
  );
  assert.deepEqual(harness.lockService.metrics(), {
    maximumActive: 1,
    waitedRequests: 2,
  });
  assert.deepEqual(
    await harness.createAuthority().query((root) => ({
      revision: root.revision,
      projectNames: root.projects.map((project) => project.name),
    })),
    {
      ok: true,
      value: {
        revision: 3,
        projectNames: ["架空並行構成0", "架空並行構成1", "架空並行構成2"],
      },
    },
  );
});

for (const finish of ["release", "abort"]) {
  test(`worker再生成後もretryとactive fenceを再読込し${finish}後だけ再開する`, async () => {
    const harness = createHarness();
    const original = harness.createAuthority();
    const command = createProjectCommand(7, 0);
    const committed = await original.mutate(command);
    assert.equal(committed.ok, true);
    const acquired = await original.runMaintenance({
      type: "acquire",
      ownerId: OWNER,
      leaseMs: 60_000,
    });
    assert.equal(acquired.ok, true);

    // 新authorityは新storage/repository/runner/lock adapterを持ち、module queueを共有しない。
    const recreated = harness.createAuthority();
    assert.deepEqual(await recreated.mutate(command), {
      ok: true,
      value: { committedRevision: 1, replayed: true },
    });
    const rejected = await recreated.mutate(createProjectCommand(8, 2));
    assert.deepEqual(rejected, {
      ok: false,
      error: { code: "maintenance-active" },
    });
    await recreated.runMaintenance({
      type: finish,
      fence: acquired.value.fence,
    });
    const resumed = await harness
      .createAuthority()
      .mutate(createProjectCommand(8, 3));
    assert.equal(resumed.ok, true);
    assert.equal(resumed.value.committedRevision, 4);
  });
}
