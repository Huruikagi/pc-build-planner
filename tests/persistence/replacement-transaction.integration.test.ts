// @ts-nocheck Node 26 の type stripping で TypeScript source を直接検証する。
import assert from "node:assert/strict";
import test from "node:test";

import { schemaValidator } from "../../src/domain/validation.ts";
import { maintenancePolicy } from "../../src/persistence/maintenance.ts";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
import { createReplacementCoordinator } from "../../src/persistence/replacement.ts";
import { createRootTransactionRunner } from "../../src/persistence/root-transaction-runner.ts";
import { createInMemoryRootWriteLock } from "../../src/persistence/root-write-lock.ts";
import { createInitialRoot } from "../../src/persistence/schema.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-19T00:00:00Z";

const createHarness = ({ quota = 10_000, failWrite = false } = {}) => {
  let runtimeQuota = 10_000;
  let runtimeFailWrite = false;
  let stored = createInitialRoot();
  let writes = 0;
  const storage = {
    async readRoot() {
      return { ok: true, value: structuredClone(stored) };
    },
    async bytesInUse() {
      return { ok: true, value: JSON.stringify(stored).length };
    },
    quotaBytes() {
      return runtimeQuota;
    },
    async writeRoot(root) {
      writes += 1;
      if (runtimeFailWrite)
        return { ok: false, error: { code: "storage-unavailable" } };
      stored = structuredClone(root);
      return { ok: true, value: undefined };
    },
    async restrictToTrustedContexts() {
      return { ok: true, value: undefined };
    },
  };
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const replacement = createReplacementCoordinator(migrations, schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement,
    now: () => NOW,
    initialRoot: createInitialRoot,
  });
  return {
    runner,
    replacement,
    getRoot: () => structuredClone(stored),
    getWrites: () => writes,
    applyRuntimeFailure: () => {
      runtimeQuota = quota;
      runtimeFailWrite = failWrite;
    },
    setQuota: (value) => {
      runtimeQuota = value;
    },
  };
};

const acquireAndAssess = async (harness, candidate = createInitialRoot()) => {
  const acquired = await harness.runner.runMaintenance({
    type: "acquire",
    ownerId: OWNER,
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  const current = harness.getRoot();
  const assessment = await harness.replacement.assessReplacement(candidate, {
    currentBytes: JSON.stringify(current).length,
    quotaBytes: 10_000,
    revision: current.revision,
    maintenance: current.maintenance,
  });
  assert.equal(assessment.ok, true);
  return {
    candidate,
    assessment: assessment.value,
    fence: acquired.value.fence,
  };
};

test("評価済み候補だけを revision 一増分・一 write で置換する", async () => {
  const harness = createHarness();
  const candidate = { ...createInitialRoot(), projects: [] };
  const command = await acquireAndAssess(harness, candidate);
  const writesBefore = harness.getWrites();
  const result = await harness.runner.replaceRoot(command);
  assert.equal(result.ok, true);
  assert.equal(harness.getWrites(), writesBefore + 1);
  assert.equal(harness.getRoot().revision, command.fence.revision + 1);
  assert.deepEqual(harness.getRoot().projects, candidate.projects);
  assert.deepEqual(harness.getRoot().maintenance, {
    active: true,
    generation: command.fence.generation,
    ownerId: OWNER,
    leaseExpiresAt: "2026-07-19T00:01:00.000Z",
  });
  assert.equal(
    result.value.afterBytes,
    new TextEncoder().encode(
      JSON.stringify({ localDataRoot: harness.getRoot() }),
    ).byteLength,
  );
});

test("token・候補・fence・revision 不一致では旧 root を保持する", async () => {
  for (const mutate of [
    (command) => ({
      ...command,
      assessment: {
        ...command.assessment,
        token: `${command.assessment.token[0] === "0" ? "1" : "0"}${command.assessment.token.slice(1)}`,
      },
    }),
    (command) => ({
      ...command,
      assessment: { ...command.assessment, candidateDigest: "0".repeat(64) },
    }),
    (command) => ({
      ...command,
      candidate: {
        ...command.candidate,
        requestDedupe: [
          {
            requestId: "44444444-4444-4444-8444-444444444444",
            payloadDigest: "sha256:changed",
            committedRevision: 0,
          },
        ],
      },
    }),
    (command) => ({
      ...command,
      assessment: { ...command.assessment, sourceSchemaVersion: 0 },
    }),
    (command) => ({
      ...command,
      assessment: { ...command.assessment, targetSchemaVersion: 2 },
    }),
    (command) => ({
      ...command,
      assessment: {
        ...command.assessment,
        requiredBytes: command.assessment.requiredBytes + 1,
      },
    }),
    (command) => ({
      ...command,
      fence: { ...command.fence, ownerId: OTHER_OWNER },
    }),
    (command) => ({
      ...command,
      fence: { ...command.fence, generation: command.fence.generation + 1 },
    }),
    (command) => ({
      ...command,
      fence: { ...command.fence, revision: command.fence.revision - 1 },
    }),
    (command) => ({
      ...command,
      assessment: {
        ...command.assessment,
        cursor: {
          ...command.assessment.cursor,
          revision: command.assessment.cursor.revision - 1,
        },
      },
    }),
  ]) {
    const harness = createHarness();
    const command = await acquireAndAssess(harness);
    const before = harness.getRoot();
    const result = await harness.runner.replaceRoot(mutate(command));
    assert.equal(result.ok, false);
    assert.ok(["stale-assessment", "stale-fence"].includes(result.error.code));
    assert.deepEqual(harness.getRoot(), before);
  }
});

test("候補の maintenance 注入を無視し保存する正確な形状を評価する", async () => {
  const harness = createHarness();
  const candidate = {
    ...createInitialRoot(),
    revision: 999,
    maintenance: { active: false, generation: 999 },
  };
  const command = await acquireAndAssess(harness, candidate);
  const result = await harness.runner.replaceRoot(command);
  assert.equal(result.ok, true);
  assert.equal(harness.getRoot().revision, 2);
  assert.equal(harness.getRoot().maintenance.active, true);
  assert.equal(
    command.assessment.requiredBytes,
    new TextEncoder().encode(
      JSON.stringify({ localDataRoot: harness.getRoot() }),
    ).byteLength,
  );
});

test("revision・maintenance overlay 後の正確な bytes で quota を拒否する", async () => {
  const harness = createHarness();
  const command = await acquireAndAssess(harness);
  const rawBytes = new TextEncoder().encode(
    JSON.stringify({ localDataRoot: command.candidate }),
  ).byteLength;
  assert.ok(command.assessment.requiredBytes > rawBytes);
  harness.setQuota(rawBytes);
  const before = harness.getRoot();
  assert.deepEqual(await harness.runner.replaceRoot(command), {
    ok: false,
    error: { code: "quota-exceeded" },
  });
  assert.deepEqual(harness.getRoot(), before);
});

test("容量不足と storage 失敗では旧 root を保持する", async () => {
  for (const options of [{ quota: 1 }, { failWrite: true }]) {
    const harness = createHarness(options);
    const command = await acquireAndAssess(harness);
    harness.applyRuntimeFailure();
    const before = harness.getRoot();
    const result = await harness.runner.replaceRoot(command);
    assert.equal(result.ok, false);
    assert.equal(
      result.error.code,
      options.quota ? "quota-exceeded" : "storage-unavailable",
    );
    assert.deepEqual(harness.getRoot(), before);
  }
});
