// @ts-nocheck 公開FoundationDataPortだけを観測する基盤回帰。
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
const { referenceRepairPolicy } = await import(
  "../../src/persistence/reference-repair-policy.ts"
);
const { createReplacementCoordinator } = await import(
  "../../src/persistence/replacement.ts"
);
const { createLocalDataRepository } = await import(
  "../../src/persistence/repository.ts"
);
const { createRootTransactionRunner } = await import(
  "../../src/persistence/root-transaction-runner.ts"
);
const { createInMemoryRootWriteLock } = await import(
  "../../src/persistence/root-write-lock.ts"
);
const { createInitialRoot } = await import("../../src/persistence/schema.ts");
const { createWriteAuthority } = await import(
  "../../src/persistence/write-authority.ts"
);
const { createDataWorkerRegistration } = await import(
  "../../src/persistence/public.ts"
);
const { buildFoundationRoot } = await import("../fixtures/foundation.ts");

const NOW = "2026-07-19T00:00:00.000Z";
const OWNER = "70000000-0000-4000-8000-000000000001";
const STORAGE_KEY = "localDataRoot";
const requestId = (index) =>
  `80000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const errorCode = (result) => (result.ok ? undefined : result.error.code);

const createHarness = ({
  quotaBytes = 10_000_000,
  stored,
  migrations,
  storage: injectedStorage,
} = {}) => {
  const state = createInMemoryStorageState({ quotaBytes });
  if (stored !== undefined)
    state.entries.set(STORAGE_KEY, structuredClone(stored));
  const storage = injectedStorage ?? createInMemoryStorageAdapter(state);
  const registry =
    migrations ?? createMigrationRegistry(1, [], schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations: registry,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement: createReplacementCoordinator(registry, schemaValidator),
    now: () => NOW,
    initialRoot: createInitialRoot,
  });
  return {
    state,
    port: createWriteAuthority({
      repository: createLocalDataRepository(storage, registry),
      runner,
      pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
    }),
  };
};

test("公開composition factoryが実authorityへcommandをrouteしunknownを境界で拒否する", async () => {
  const { port } = createHarness({ stored: buildFoundationRoot() });
  const listeners = [];
  const registration = createDataWorkerRegistration({
    data: port,
    restrictAccess: async () => ({ ok: true, value: undefined }),
    decoder: {
      decode(input) {
        return input?.kind === "query-root" && Object.keys(input).length === 1
          ? { ok: true, value: input }
          : { ok: false, error: { code: "unexpected-field", path: "$" } };
      },
    },
    authorize: (caller) => caller.kind === "trusted-extension",
  });
  const registered = await registration.register({
    addHandler(handler) {
      listeners.push(handler);
      return () => {};
    },
  });
  assert.equal(registered.ok, true);
  const result = await listeners[0](
    { kind: "query-root" },
    { kind: "trusted-extension" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.revision, 1);
  assert.deepEqual(
    await listeners[0]({ kind: "unknown" }, { kind: "trusted-extension" }),
    {
      ok: false,
      error: { code: "invalid-message" },
    },
  );
});

test("公開facadeでproject CRUDとcandidate削除時の参照修復を一貫して観測できる", async () => {
  const { port } = createHarness({ stored: buildFoundationRoot() });
  const project = {
    id: "10000000-0000-4000-8000-000000000099",
    name: "架空追加構成",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const created = await port.mutate({
    requestId: requestId(1),
    expectedRevision: 1,
    operation: { kind: "create", entity: "project", value: project },
  });
  assert.equal(created.ok, true);
  const updated = await port.mutate({
    requestId: requestId(2),
    expectedRevision: 2,
    operation: {
      kind: "update",
      entity: "project",
      value: { ...project, name: "架空更新構成" },
    },
  });
  assert.equal(updated.ok, true);
  const deleted = await port.mutate({
    requestId: requestId(3),
    expectedRevision: 3,
    operation: { kind: "delete", entity: "project", id: project.id },
  });
  assert.equal(deleted.ok, true);

  const beforeRepair = await port.query((root) => ({
    revision: root.revision,
    candidateId: root.candidateParts[0].id,
    itemCount: root.currentBuilds[0].items.length,
  }));
  assert.equal(beforeRepair.ok, true);
  const repaired = await port.mutate({
    requestId: requestId(4),
    expectedRevision: 4,
    operation: {
      kind: "delete",
      entity: "candidatePart",
      id: beforeRepair.value.candidateId,
    },
  });
  assert.equal(repaired.ok, true);
  assert.deepEqual(
    await port.query((root) => ({
      projects: root.projects.map(({ name }) => name),
      candidateExists: root.candidateParts.some(
        ({ id }) => id === beforeRepair.value.candidateId,
      ),
      itemCount: root.currentBuilds[0].items.length,
    })),
    {
      ok: true,
      value: {
        projects: ["架空PC構成"],
        candidateExists: false,
        itemCount: beforeRepair.value.itemCount - 1,
      },
    },
  );
});

test("公開facadeが破損・容量不足・access拒否・request conflictをtyped failureにする", async () => {
  const corrupt = buildFoundationRoot();
  corrupt.currentBuilds[0].items[0].quantity = 0;
  assert.equal(
    errorCode(
      await createHarness({ stored: corrupt }).port.query((root) => root),
    ),
    "corrupt-data",
  );

  const quota = createHarness({ quotaBytes: 1, stored: createInitialRoot() });
  assert.equal(
    errorCode(
      await quota.port.mutate({
        requestId: requestId(10),
        expectedRevision: 0,
        operation: {
          kind: "create",
          entity: "project",
          value: buildFoundationRoot().projects[0],
        },
      }),
    ),
    "quota-exceeded",
  );

  const deniedStorage = {
    async readRoot() {
      return { ok: false, error: { code: "access-denied" } };
    },
    async writeRoot() {
      assert.fail("access拒否後にwriteしてはならない");
    },
    async bytesInUse() {
      assert.fail("access拒否後にbytesを読んではならない");
    },
    quotaBytes() {
      return 10_000_000;
    },
    async restrictToTrustedContexts() {
      return { ok: false, error: { code: "access-denied" } };
    },
  };
  const denied = createHarness({ storage: deniedStorage });
  assert.equal(
    errorCode(await denied.port.query((root) => root.revision)),
    "access-denied",
  );

  const conflict = createHarness();
  const value = buildFoundationRoot().projects[0];
  const first = await conflict.port.mutate({
    requestId: requestId(11),
    expectedRevision: 0,
    operation: { kind: "create", entity: "project", value },
  });
  assert.equal(first.ok, true);
  assert.equal(
    errorCode(
      await conflict.port.mutate({
        requestId: requestId(11),
        expectedRevision: 1,
        operation: { kind: "delete", entity: "project", id: value.id },
      }),
    ),
    "request-conflict",
  );
});

test("公開facadeのreadは移行成功を返し、経路欠落とstep失敗ではsourceを保持する", async () => {
  const legacy = { ...buildFoundationRoot(), schemaVersion: 0 };
  const successRegistry = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate: (input) => ({
          ok: true,
          value: { ...input, schemaVersion: 1 },
        }),
      },
    ],
    schemaValidator,
  );
  const success = createHarness({
    stored: legacy,
    migrations: successRegistry,
  });
  assert.deepEqual(await success.port.query((root) => root.schemaVersion), {
    ok: true,
    value: 1,
  });

  const missing = createHarness({ stored: legacy });
  assert.equal(
    errorCode(await missing.port.query((root) => root)),
    "migration-failed",
  );

  const failedRegistry = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate: () => ({
          ok: false,
          error: { code: "migration-path-missing", from: 0, target: 1 },
        }),
      },
    ],
    schemaValidator,
  );
  const failed = createHarness({ stored: legacy, migrations: failedRegistry });
  assert.equal(
    errorCode(await failed.port.query((root) => root)),
    "migration-failed",
  );
});

test("同一requestと同一payloadの再送はreplayされ二重mutationしない", async () => {
  const { port } = createHarness();
  const command = {
    requestId: requestId(30),
    expectedRevision: 0,
    operation: {
      kind: "create",
      entity: "project",
      value: buildFoundationRoot().projects[0],
    },
  };
  assert.equal((await port.mutate(command)).ok, true);
  assert.deepEqual(await port.mutate(command), {
    ok: true,
    value: { committedRevision: 1, replayed: true },
  });
  assert.deepEqual(
    await port.query((root) => ({
      revision: root.revision,
      count: root.projects.length,
    })),
    {
      ok: true,
      value: { revision: 1, count: 1 },
    },
  );
});

test("未来schemaはfresh facadeでも拒否され暗黙migration writeを行わない", async () => {
  const state = createInMemoryStorageState();
  state.entries.set(STORAGE_KEY, {
    ...buildFoundationRoot(),
    schemaVersion: 99,
  });
  const storage = createInMemoryStorageAdapter(state);
  const first = createHarness({ storage }).port;
  const second = createHarness({ storage }).port;
  assert.equal(
    errorCode(await first.query((root) => root)),
    "unsupported-version",
  );
  assert.equal(
    errorCode(await second.query((root) => root)),
    "unsupported-version",
  );
});

test("公開worker registrationはaccess restriction失敗とunauthorized callerをfail closedにする", async () => {
  const handlers = [];
  const target = {
    addHandler(handler) {
      handlers.push(handler);
      return () => {};
    },
  };
  const data = {
    async query() {
      assert.fail("拒否commandを処理してはならない");
    },
    async mutate() {
      assert.fail("拒否commandを処理してはならない");
    },
    async assessReplacement() {
      assert.fail("拒否commandを処理してはならない");
    },
    async replaceRoot() {
      assert.fail("拒否commandを処理してはならない");
    },
    async runMaintenance() {
      assert.fail("拒否commandを処理してはならない");
    },
  };
  const decoder = {
    decode: (input) => ({ ok: true, value: input }),
  };
  const denied = createDataWorkerRegistration({
    restrictAccess: async () => ({
      ok: false,
      error: { code: "access-denied" },
    }),
    decoder,
    authorize: () => true,
    data,
  });
  assert.deepEqual(await denied.register(target), {
    ok: false,
    error: { code: "access-denied" },
  });
  assert.equal(handlers.length, 0);
  const registered = createDataWorkerRegistration({
    restrictAccess: async () => ({ ok: true, value: undefined }),
    decoder,
    authorize: () => false,
    data,
  });
  assert.equal((await registered.register(target)).ok, true);
  assert.deepEqual(
    await handlers[0]({ kind: "query-root" }, { kind: "content-script" }),
    {
      ok: false,
      error: { code: "caller-denied" },
    },
  );
});

test("mutation write失敗時は公開queryで旧rootを観測できる", async () => {
  const harness = createHarness();
  harness.state.failNext("write");
  assert.equal(
    errorCode(
      await harness.port.mutate({
        requestId: requestId(31),
        expectedRevision: 0,
        operation: {
          kind: "create",
          entity: "project",
          value: buildFoundationRoot().projects[0],
        },
      }),
    ),
    "storage-unavailable",
  );
  assert.deepEqual(
    await harness.port.query((root) => ({
      revision: root.revision,
      count: root.projects.length,
    })),
    {
      ok: true,
      value: { revision: 0, count: 0 },
    },
  );
});

test("replacement validation/write失敗時は公開queryで旧rootを観測できる", async () => {
  const harness = createHarness();
  const acquired = await harness.port.runMaintenance({
    type: "acquire",
    ownerId: OWNER,
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  const view = (root) => ({
    revision: root.revision,
    count: root.projects.length,
  });
  const before = await harness.port.query(view);
  const invalid = structuredClone(buildFoundationRoot());
  invalid.currentBuilds[0].items[0].quantity = 0;
  assert.equal(
    errorCode(await harness.port.assessReplacement(invalid)),
    "validation",
  );
  assert.deepEqual(await harness.port.query(view), before);
  const candidate = buildFoundationRoot();
  const assessment = await harness.port.assessReplacement(candidate);
  assert.equal(assessment.ok, true);
  harness.state.failNext("write");
  assert.equal(
    errorCode(
      await harness.port.replaceRoot({
        candidate,
        assessment: assessment.value,
        fence: acquired.value.fence,
      }),
    ),
    "storage-unavailable",
  );
  assert.deepEqual(await harness.port.query(view), before);
});

test("公開facadeでmaintenance acquire・stale fence・release・abortを完結できる", async () => {
  const { port } = createHarness();
  const acquired = await port.runMaintenance({
    type: "acquire",
    ownerId: OWNER,
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  const stale = { ...acquired.value.fence, revision: 0 };
  assert.equal(
    errorCode(await port.runMaintenance({ type: "release", fence: stale })),
    "stale-fence",
  );
  assert.equal(
    errorCode(
      await port.mutate({
        requestId: requestId(20),
        expectedRevision: 1,
        operation: {
          kind: "create",
          entity: "project",
          value: buildFoundationRoot().projects[0],
        },
      }),
    ),
    "maintenance-active",
  );
  assert.equal(
    (
      await port.runMaintenance({
        type: "release",
        fence: acquired.value.fence,
      })
    ).ok,
    true,
  );

  const reacquired = await port.runMaintenance({
    type: "acquire",
    ownerId: OWNER,
    leaseMs: 60_000,
  });
  assert.equal(reacquired.ok, true);
  assert.equal(
    (
      await port.runMaintenance({
        type: "abort",
        fence: reacquired.value.fence,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await port.mutate({
        requestId: requestId(21),
        expectedRevision: 4,
        operation: {
          kind: "create",
          entity: "project",
          value: buildFoundationRoot().projects[0],
        },
      })
    ).ok,
    true,
  );
});

test("公開facadeでreplacement評価・成功置換・stale失敗・容量失敗を観測できる", async () => {
  const { port } = createHarness();
  const acquired = await port.runMaintenance({
    type: "acquire",
    ownerId: OWNER,
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  const candidate = buildFoundationRoot();
  const assessment = await port.assessReplacement(candidate);
  assert.equal(assessment.ok, true);
  const replaced = await port.replaceRoot({
    candidate,
    assessment: assessment.value,
    fence: acquired.value.fence,
  });
  assert.equal(replaced.ok, true);
  assert.deepEqual(
    await port.query((root) => ({
      revision: root.revision,
      projects: root.projects.length,
    })),
    {
      ok: true,
      value: { revision: 2, projects: 1 },
    },
  );
  assert.equal(
    errorCode(
      await port.replaceRoot({
        candidate,
        assessment: assessment.value,
        fence: acquired.value.fence,
      }),
    ),
    "stale-assessment",
  );

  const tiny = createHarness({ quotaBytes: 1 });
  assert.equal(
    errorCode(await tiny.port.assessReplacement(candidate)),
    "quota-exceeded",
  );
});
