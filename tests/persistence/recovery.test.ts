import assert from "node:assert/strict";
import test from "node:test";
import { schemaValidator } from "../../src/domain/validation.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../src/persistence/mutation-pipeline.js";
import {
  createRecoveryCoordinator,
  type RecoveryAssessment,
} from "../../src/persistence/recovery.js";
import { referenceRepairPolicy } from "../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../src/persistence/root-transaction-runner.js";
import { createInMemoryRootWriteLock } from "../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../src/persistence/schema.js";
import type { BackupRestoreAssessmentTicket } from "../../src/persistence/write-authority.js";
import {
  createBackupRestoreDataPort,
  createWriteAuthority,
} from "../../src/persistence/write-authority.js";

const coordinatorFor = (raw: unknown, quotaBytes = 100_000) => {
  const state = createInMemoryStorageState({ quotaBytes });
  state.entries.set("localDataRoot", raw);
  const storage = createInMemoryStorageAdapter(state);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  return createRecoveryCoordinator(
    storage,
    migrations,
    createReplacementCoordinator(migrations, schemaValidator),
  );
};

const validCandidate = {
  schemaVersion: 1,
  revision: 0,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
};

test("破損rootはraw値を公開せず安定fingerprint付きで分類し、評価は保存値を変えない", async () => {
  const raw = { schemaVersion: 1, revision: "broken" };
  const coordinator = coordinatorFor(raw);
  const first = await coordinator.assessRecovery(validCandidate);
  const second = await coordinator.assessRecovery(validCandidate);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.cursor.current, second.value.cursor.current);
  assert.equal(first.value.cursor.current.code, "corrupt-data");
  assert.equal(JSON.stringify(first.value).includes("broken"), false);
});

test("未対応schemaはversionだけを安全に分類し、候補不正はcurrent anomalyと別fieldで返す", async () => {
  const coordinator = coordinatorFor({
    schemaVersion: 99,
    opaque: "synthetic",
  });
  const result = await coordinator.assessRecovery({ schemaVersion: 1 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "recovery-candidate-rejected");
  if (result.error.code !== "recovery-candidate-rejected") return;
  assert.deepEqual(result.error.current.code, "unsupported-version");
  assert.equal(result.error.current.version, 99);
  assert.notEqual(result.error.candidate.code, "unsupported-version");
});

for (const rejection of [
  {
    name: "候補の未対応schema",
    candidate: { ...validCandidate, schemaVersion: 99 },
    coordinator: () => coordinatorFor({ schemaVersion: 1, revision: "broken" }),
    expected: "unsupported-version",
  },
  {
    name: "候補の容量超過",
    candidate: validCandidate,
    coordinator: () =>
      coordinatorFor({ schemaVersion: 1, revision: "broken" }, 1),
    expected: "quota-exceeded",
  },
] as const) {
  test(`${rejection.name}はcurrent anomalyと分離して拒否しraw rootを変更しない`, async () => {
    const coordinator = rejection.coordinator();
    const result = await coordinator.assessRecovery(rejection.candidate);
    assert.equal(result.ok, false);
    if (result.ok || result.error.code !== "recovery-candidate-rejected")
      return;
    assert.equal(result.error.current.code, "corrupt-data");
    assert.equal(result.error.candidate.code, rejection.expected);
  });
}

test("評価済み回復候補はcontrol fenceとraw fingerprintを再照合して一回だけrootを置換する", async () => {
  const state = createInMemoryStorageState({ quotaBytes: 100_000 });
  state.entries.set("localDataRoot", { schemaVersion: 1, revision: "broken" });
  const storage = createInMemoryStorageAdapter(state);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const replacement = createReplacementCoordinator(migrations, schemaValidator);
  const recovery = createRecoveryCoordinator(storage, migrations, replacement);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement,
    recovery,
    now: () => "2026-08-09T00:00:00.000Z" as never,
    initialRoot: createInitialRoot,
  });
  const assessment = await recovery.assessRecovery(validCandidate);
  assert.equal(assessment.ok, true);
  if (!assessment.ok) return;
  const acquired = await runner.runRecoveryMaintenance({
    type: "acquire",
    ownerId: "recovery-owner",
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  if (!acquired.ok || acquired.value.fence === undefined) return;

  const result = await runner.replaceFromRecovery({
    candidate: validCandidate,
    assessment: assessment.value,
    fence: acquired.value.fence,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(state.entries.get("localDataRoot"), {
    ...validCandidate,
    revision: 1,
  });

  const pending = await runner.findPendingRecoveryFinalization();
  assert.equal(pending.ok, true);
  if (!pending.ok || pending.value === null) return;
  const finalized = await runner.finalizeRecovery(pending.value);
  assert.deepEqual(finalized, { ok: true, value: { revision: 1 } });
  assert.deepEqual(state.entries.get("foundationRecoveryControl"), {
    generation: acquired.value.fence.generation,
    active: false,
  });
  assert.deepEqual(state.entries.get("localDataRoot"), {
    ...validCandidate,
    revision: 1,
  });
});

const createRecoveryPortHarness = (
  options: {
    readonly failControlWrite?: number;
    readonly failControlRead?: number;
    readonly failRootWrite?: number;
    readonly root?: unknown;
    readonly mutateRootAfterControlWrite?: {
      readonly write: number;
      readonly root: unknown;
    };
  } = {},
) => {
  const state = createInMemoryStorageState({ quotaBytes: 100_000 });
  state.entries.set(
    "localDataRoot",
    options.root ?? { schemaVersion: 1, revision: "broken" },
  );
  const base = createInMemoryStorageAdapter(state);
  let rootWrites = 0;
  let controlWrites = 0;
  let controlReads = 0;
  const storage = {
    readRoot: () => base.readRoot(),
    bytesInUse: () => base.bytesInUse(),
    quotaBytes: () => base.quotaBytes(),
    async readRecoveryControl() {
      controlReads += 1;
      if (controlReads === options.failControlRead)
        return {
          ok: false as const,
          error: { code: "storage-unavailable" as const },
        };
      return base.readRecoveryControl();
    },
    restrictToTrustedContexts: () => base.restrictToTrustedContexts(),
    async writeRoot(root: unknown) {
      rootWrites += 1;
      if (rootWrites === options.failRootWrite)
        return {
          ok: false as const,
          error: { code: "storage-unavailable" as const },
        };
      return base.writeRoot(root as never);
    },
    async writeRecoveryControl(control: unknown) {
      controlWrites += 1;
      if (controlWrites === options.failControlWrite)
        return {
          ok: false as const,
          error: { code: "storage-unavailable" as const },
        };
      const result = await base.writeRecoveryControl(control);
      if (controlWrites === options.mutateRootAfterControlWrite?.write)
        state.entries.set(
          "localDataRoot",
          structuredClone(options.mutateRootAfterControlWrite.root),
        );
      return result;
    },
  };
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const replacement = createReplacementCoordinator(migrations, schemaValidator);
  const lock = createInMemoryRootWriteLock();
  const createRunner = () => {
    const recovery = createRecoveryCoordinator(
      storage,
      migrations,
      replacement,
    );
    return createRootTransactionRunner({
      storage,
      lock,
      migrations,
      validator: schemaValidator,
      maintenance: maintenancePolicy,
      replacement,
      recovery,
      now: () => "2026-08-09T00:00:00.000Z" as never,
      initialRoot: createInitialRoot,
    });
  };
  const createPort = () => createBackupRestoreDataPort(createRunner());
  const createDataPort = () => {
    const runner = createRunner();
    return createWriteAuthority({
      repository: createLocalDataRepository(storage, migrations),
      runner,
      pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
    });
  };
  return {
    state,
    createPort,
    createRunner,
    createDataPort,
    getRootWrites: () => rootWrites,
  };
};

for (const staleCase of [
  {
    name: "candidate digest",
    assessment: (value: RecoveryAssessment): RecoveryAssessment => ({
      ...value,
      cursor: { ...value.cursor, candidateDigest: "0".repeat(64) },
    }),
    expected: "stale-assessment",
  },
  {
    name: "target schema",
    assessment: (value: RecoveryAssessment): RecoveryAssessment => ({
      ...value,
      cursor: { ...value.cursor, targetSchemaVersion: 2 as never },
    }),
    expected: "stale-assessment",
  },
  {
    name: "required bytes",
    assessment: (value: RecoveryAssessment): RecoveryAssessment => ({
      ...value,
      cursor: {
        ...value.cursor,
        requiredBytes: value.cursor.requiredBytes + 1,
      },
    }),
    expected: "stale-assessment",
  },
] as const) {
  test(`回復commitはstale ${staleCase.name}をroot write 0件で拒否する`, async () => {
    const harness = createRecoveryPortHarness();
    const runner = harness.createRunner();
    const assessed = await runner.assessRecovery(validCandidate);
    assert.equal(assessed.ok, true);
    if (!assessed.ok) return;
    const acquired = await runner.runRecoveryMaintenance({
      type: "acquire",
      ownerId: "assessment-owner",
      leaseMs: 30_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok || acquired.value.fence === undefined) return;

    const result = await runner.replaceFromRecovery({
      candidate: validCandidate,
      assessment: staleCase.assessment(assessed.value),
      fence: acquired.value.fence,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, staleCase.expected);
    assert.equal(harness.getRootWrites(), 0);
  });
}

for (const staleFence of [
  {
    name: "control owner",
    change: (fence: {
      generation: number;
      ownerId: string;
      leaseExpiresAt: string;
    }) => ({
      ...fence,
      ownerId: "different-owner",
    }),
  },
  {
    name: "control generation",
    change: (fence: {
      generation: number;
      ownerId: string;
      leaseExpiresAt: string;
    }) => ({
      ...fence,
      generation: fence.generation + 1,
    }),
  },
  {
    name: "control lease",
    change: (fence: {
      generation: number;
      ownerId: string;
      leaseExpiresAt: string;
    }) => ({
      ...fence,
      leaseExpiresAt: "2026-08-09T00:00:01.000Z",
    }),
  },
] as const) {
  test(`回復commitはstale ${staleFence.name}をroot write 0件で拒否する`, async () => {
    const harness = createRecoveryPortHarness();
    const runner = harness.createRunner();
    const assessed = await runner.assessRecovery(validCandidate);
    assert.equal(assessed.ok, true);
    if (!assessed.ok) return;
    const acquired = await runner.runRecoveryMaintenance({
      type: "acquire",
      ownerId: "fence-owner",
      leaseMs: 30_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok || acquired.value.fence === undefined) return;

    const result = await runner.replaceFromRecovery({
      candidate: validCandidate,
      assessment: assessed.value,
      fence: staleFence.change(acquired.value.fence),
    });
    assert.deepEqual(result, {
      ok: false,
      error: { code: "stale-recovery-state" },
    });
    assert.equal(harness.getRootWrites(), 0);
  });
}

test("pre-commit cleanup中断は同じopaque assessment ticketだけがworker再生成後にroot write 0件で再開する", async () => {
  const harness = createRecoveryPortHarness({ failControlWrite: 2 });
  const original = harness.createPort();
  const assessed = await original.assessRecovery(validCandidate);
  assert.equal(assessed.ok, true, JSON.stringify(assessed));
  if (!assessed.ok) return;

  harness.state.entries.set("localDataRoot", {
    schemaVersion: 1,
    revision: "changed-broken",
  });
  const interrupted = await original.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "recovery",
  });
  assert.deepEqual(interrupted, {
    ok: false,
    error: { code: "precommit-cleanup-pending" },
  });
  assert.equal(harness.getRootWrites(), 0);

  const recreated = harness.createPort();
  const otherTicket = crypto.randomUUID() as BackupRestoreAssessmentTicket;
  assert.deepEqual(
    await recreated.commit({
      candidate: validCandidate,
      assessment: otherTicket,
      expectedMode: "recovery",
    }),
    { ok: false, error: { code: "stale-assessment" } },
  );
  assert.equal(
    (
      harness.state.entries.get("foundationRecoveryControl") as {
        active: boolean;
      }
    ).active,
    true,
  );

  assert.deepEqual(
    await recreated.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "recovery",
    }),
    { ok: false, error: { code: "stale-assessment" } },
  );
  assert.equal(harness.getRootWrites(), 0);
  assert.equal(
    (
      harness.state.entries.get("foundationRecoveryControl") as {
        active: boolean;
      }
    ).active,
    false,
  );
});

test("post-commit cleanup中断はopaque ticketを再発見しfinalize-only retryでrootを再書込みしない", async () => {
  const harness = createRecoveryPortHarness({ failControlWrite: 3 });
  const original = harness.createPort();
  const assessed = await original.assessRecovery(validCandidate);
  assert.equal(assessed.ok, true, JSON.stringify(assessed));
  if (!assessed.ok) return;
  const committed = await original.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "recovery",
  });
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.value.kind, "committed-finalization-required");
  if (committed.value.kind !== "committed-finalization-required") return;
  assert.equal(typeof committed.value.finalization, "string");
  assert.equal(harness.getRootWrites(), 1);

  const recreated = harness.createPort();
  const pending = await recreated.findPendingFinalization();
  assert.deepEqual(pending, {
    ok: true,
    value: committed.value.finalization,
  });
  if (!pending.ok || pending.value === null) return;
  assert.deepEqual(await recreated.finalize(pending.value), {
    ok: true,
    value: { mode: "recovery", revision: 1 },
  });
  assert.equal(harness.getRootWrites(), 1);
  assert.deepEqual(await recreated.findPendingFinalization(), {
    ok: true,
    value: null,
  });
});

test("回復finalize後は通常queryとmutationが公開data portで再開する", async () => {
  const harness = createRecoveryPortHarness({ failControlWrite: 3 });
  const backup = harness.createPort();
  const assessed = await backup.assessRecovery(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  const committed = await backup.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "recovery",
  });
  assert.equal(committed.ok, true);
  if (
    !committed.ok ||
    committed.value.kind !== "committed-finalization-required"
  )
    return;

  const recreated = harness.createPort();
  const pending = await recreated.findPendingFinalization();
  assert.equal(pending.ok, true);
  if (!pending.ok || pending.value === null) return;
  assert.equal((await recreated.finalize(pending.value)).ok, true);

  const data = harness.createDataPort();
  assert.deepEqual(await data.query((root) => root.revision), {
    ok: true,
    value: 1,
  });
  const mutation = await data.mutate({
    requestId: "20000000-0000-4000-8000-000000000001" as never,
    expectedRevision: 1 as never,
    operation: {
      kind: "create",
      entity: "project",
      value: {
        id: "10000000-0000-4000-8000-000000000001",
        name: "回復後の架空構成",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
    } as never,
  });
  assert.equal(mutation.ok, true, JSON.stringify(mutation));
  assert.deepEqual(
    await data.query((root) => ({
      revision: root.revision,
      names: root.projects.map((project) => project.name),
    })),
    { ok: true, value: { revision: 2, names: ["回復後の架空構成"] } },
  );
});

test("root write後のpending再読取失敗を通常errorへ戻さずfinalization要求として返す", async () => {
  const harness = createRecoveryPortHarness({ failControlRead: 5 });
  const port = harness.createPort();
  const assessed = await port.assessRecovery(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  const committed = await port.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "recovery",
  });
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.value.kind, "committed-finalization-required");
  assert.equal(harness.getRootWrites(), 1);
});

test("正常置換もpersistent controlでpost-commit finalizationを別consumerから再開しrootを再書込みしない", async () => {
  const harness = createRecoveryPortHarness({
    failControlWrite: 3,
    root: createInitialRoot(),
  });
  const original = harness.createPort();
  const assessed = await original.assessReplacement(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  const committed = await original.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "normal",
  });
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.value.kind, "committed-finalization-required");
  if (committed.value.kind !== "committed-finalization-required") return;
  assert.equal(harness.getRootWrites(), 1);

  const recreated = harness.createPort();
  const pending = await recreated.findPendingFinalization();
  assert.deepEqual(pending, {
    ok: true,
    value: committed.value.finalization,
  });
  if (!pending.ok || pending.value === null) return;
  assert.deepEqual(await recreated.finalize(pending.value), {
    ok: true,
    value: { mode: "normal", revision: 1 },
  });
  assert.equal(harness.getRootWrites(), 1);
});

test("正常置換のpre-commit cleanup中断も同じticketだけが再生成後にroot write 0件で再開する", async () => {
  const harness = createRecoveryPortHarness({
    failControlWrite: 2,
    root: createInitialRoot(),
    mutateRootAfterControlWrite: {
      write: 1,
      root: { ...createInitialRoot(), revision: 1 },
    },
  });
  const original = harness.createPort();
  const assessed = await original.assessReplacement(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  assert.deepEqual(
    await original.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "normal",
    }),
    { ok: false, error: { code: "precommit-cleanup-pending" } },
  );
  assert.equal(harness.getRootWrites(), 0);

  const recreated = harness.createPort();
  assert.deepEqual(
    await recreated.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "normal",
    }),
    { ok: false, error: { code: "stale-assessment" } },
  );
  assert.equal(harness.getRootWrites(), 0);
  assert.equal(
    (
      harness.state.entries.get("foundationRecoveryControl") as {
        active: boolean;
      }
    ).active,
    false,
  );
});

test("回復pre-commit cleanup後の再評価が同一なら同じticketでcommitまで継続する", async () => {
  const harness = createRecoveryPortHarness({
    failControlWrite: 3,
    failRootWrite: 1,
  });
  const original = harness.createPort();
  const assessed = await original.assessRecovery(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;

  assert.deepEqual(
    await original.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "recovery",
    }),
    { ok: false, error: { code: "precommit-cleanup-pending" } },
  );
  assert.equal(harness.getRootWrites(), 1);
  assert.deepEqual(harness.state.entries.get("localDataRoot"), {
    schemaVersion: 1,
    revision: "broken",
  });

  const recreated = harness.createPort();
  const resumed = await recreated.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "recovery",
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.getRootWrites(), 2);
  assert.deepEqual(harness.state.entries.get("localDataRoot"), {
    ...validCandidate,
    revision: 1,
  });
});

test("正常pre-commit cleanup後の再評価が同一なら同じticketでcommitまで継続する", async () => {
  const harness = createRecoveryPortHarness({
    failControlWrite: 3,
    failRootWrite: 1,
    root: createInitialRoot(),
  });
  const original = harness.createPort();
  const assessed = await original.assessReplacement(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;

  assert.deepEqual(
    await original.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "normal",
    }),
    { ok: false, error: { code: "precommit-cleanup-pending" } },
  );
  assert.equal(harness.getRootWrites(), 1);
  assert.deepEqual(
    harness.state.entries.get("localDataRoot"),
    createInitialRoot(),
  );

  const recreated = harness.createPort();
  const resumed = await recreated.commit({
    candidate: validCandidate,
    assessment: assessed.value.ticket,
    expectedMode: "normal",
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.getRootWrites(), 2);
  assert.deepEqual(harness.state.entries.get("localDataRoot"), {
    ...validCandidate,
    revision: 1,
  });
});

test("回復root write失敗は異常rootを保持しcontrolだけをcleanupする", async () => {
  const harness = createRecoveryPortHarness({ failRootWrite: 1 });
  const before = structuredClone(harness.state.entries.get("localDataRoot"));
  const port = harness.createPort();
  const assessed = await port.assessRecovery(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  assert.deepEqual(
    await port.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "recovery",
    }),
    { ok: false, error: { code: "storage-unavailable" } },
  );
  assert.deepEqual(harness.state.entries.get("localDataRoot"), before);
  assert.equal(
    (
      harness.state.entries.get("foundationRecoveryControl") as {
        active: boolean;
      }
    ).active,
    false,
  );
});

test("正常root write失敗は旧rootを保持しcontrolだけをcleanupする", async () => {
  const harness = createRecoveryPortHarness({
    failRootWrite: 1,
    root: createInitialRoot(),
  });
  const before = structuredClone(harness.state.entries.get("localDataRoot"));
  const port = harness.createPort();
  const assessed = await port.assessReplacement(validCandidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  assert.deepEqual(
    await port.commit({
      candidate: validCandidate,
      assessment: assessed.value.ticket,
      expectedMode: "normal",
    }),
    { ok: false, error: { code: "storage-unavailable" } },
  );
  assert.deepEqual(harness.state.entries.get("localDataRoot"), before);
  assert.equal(
    (
      harness.state.entries.get("foundationRecoveryControl") as {
        active: boolean;
      }
    ).active,
    false,
  );
});
