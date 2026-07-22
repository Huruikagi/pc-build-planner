import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  CurrentBuildId,
  LocalDataRoot,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  MutationContext,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../../src/persistence/mutation-pipeline.js";
import { referenceRepairPolicy } from "../../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../../src/persistence/root-transaction-runner.js";
import {
  createInMemoryRootWriteLock,
  createInMemoryRootWriteLockState,
} from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import {
  createScopedDataPort,
  createWriteAuthority,
} from "../../../src/persistence/write-authority.js";

const now = "2026-07-22T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const adoptedId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const buildId =
  "20000000-0000-4000-8000-000000000001" as Uuid as CurrentBuildId;

const candidate = (id: CandidatePartId, name: string) => ({
  id,
  projectId,
  category: "cpu" as const,
  product: { name: { original: name } },
  normalizedAttributes: {
    category: "cpu" as const,
    socket: { original: "架空ソケットSK1" },
  },
  createdAt: now,
  updatedAt: now,
});

const initialRoot = (): LocalDataRoot =>
  ({
    ...createInitialRoot(),
    projects: [
      { id: projectId, name: "架空PC構成", createdAt: now, updatedAt: now },
    ],
    candidateParts: [
      candidate(adoptedId, "架空CPU 採用済み"),
      candidate(otherId, "架空CPU 未採用"),
    ],
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [{ candidatePartId: adoptedId, quantity: 1 as never }],
        updatedAt: now,
      },
    ],
  }) as LocalDataRoot;

/** Builds the real foundation graph so the feature exercises one write authority. */
const harness = async () => {
  const state = createInMemoryStorageState({ quotaBytes: 100_000 });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(initialRoot());
  const writes: LocalDataRoot[] = [];
  const storage = {
    readRoot: () => adapter.readRoot(),
    bytesInUse: () => adapter.bytesInUse(),
    quotaBytes: () => adapter.quotaBytes(),
    restrictToTrustedContexts: () => adapter.restrictToTrustedContexts(),
    async writeRoot(root: LocalDataRoot) {
      writes.push(structuredClone(root));
      return adapter.writeRoot(root);
    },
  };
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const runner = createRootTransactionRunner({
    storage: storage as never,
    lock: createInMemoryRootWriteLock(createInMemoryRootWriteLockState()),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement: createReplacementCoordinator(migrations, schemaValidator),
    now: () => now,
    initialRoot: createInitialRoot,
  });
  const authority = createWriteAuthority({
    repository: createLocalDataRepository(storage as never, migrations),
    runner,
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
  const service = createCandidateManagementService({
    data: createScopedDataPort(authority),
  });
  const stored = async (): Promise<LocalDataRoot> => {
    const read = await adapter.readRoot();
    assert.equal(read.ok, true);
    return read.value as LocalDataRoot;
  };
  return { service, writes, stored };
};

const context = (expectedRevision: number): MutationContext => ({
  requestId:
    `40000000-0000-4000-8000-${String(expectedRevision + 1).padStart(12, "0")}` as Uuid as RequestId,
  expectedRevision: expectedRevision as Revision,
});

test("候補削除はFoundationの単一root mutationで参照修復され一度だけcommitされる", async () => {
  const { service, writes, stored } = await harness();

  const deleted = await service.deleteCandidate(adoptedId, context(0));

  assert.equal(deleted.ok, true);
  const root = await stored();
  assert.equal(root.revision, 1);
  assert.deepEqual(
    root.candidateParts.map((part) => part.id),
    [otherId],
  );
  // The CurrentBuild reference is repaired inside the same commit.
  assert.deepEqual(root.currentBuilds[0]?.items, []);
  assert.equal(schemaValidator.validateRoot(root).ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], root);
});

test("候補のカテゴリ変更もFoundationの単一root mutationで参照修復される", async () => {
  const { service, writes, stored } = await harness();
  const draft: CandidateDraft = {
    projectId,
    category: "memory",
    product: { name: { original: "架空CPU 採用済み" } },
    normalizedAttributes: {
      category: "memory",
      memoryStandard: { original: null, confirmed: "架空DDR規格" },
    },
  };

  const updated = await service.updateCandidate(
    { id: adoptedId, draft },
    context(0),
  );

  assert.equal(updated.ok, true);
  const root = await stored();
  assert.equal(root.revision, 1);
  const changed = root.candidateParts.find((part) => part.id === adoptedId);
  assert.equal(changed?.category, "memory");
  // Requirement 3.7 of local-data-foundation: a category change repairs the
  // stale adoption reference inside the very same commit, so no intermediate
  // inconsistent state is observable and no follow-up CurrentBuild write runs.
  assert.deepEqual(root.currentBuilds[0]?.items, []);
  assert.equal(schemaValidator.validateRoot(root).ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], root);
});

test("削除失敗時は既存rootとCurrentBuild参照をそのまま保持する", async () => {
  const { service, writes, stored } = await harness();

  // A stale expected revision must be rejected before any write.
  const conflicted = await service.deleteCandidate(adoptedId, context(7));

  assert.equal(conflicted.ok, false);
  if (!conflicted.ok) assert.equal(conflicted.error.kind, "conflict");
  const root = await stored();
  assert.equal(root.revision, 0);
  assert.equal(root.candidateParts.length, 2);
  assert.deepEqual(root.currentBuilds[0]?.items, [
    { candidatePartId: adoptedId, quantity: 1 },
  ]);
  assert.equal(writes.length, 0);
});
