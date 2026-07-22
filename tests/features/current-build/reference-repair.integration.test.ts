import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  CurrentBuildId,
  LocalDataRoot,
  PositiveInteger,
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
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import { createCurrentBuildQuery } from "../../../src/features/current-build/query.js";
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

const now = "2026-07-23T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const cpuCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuildId;

const cpuCandidate = (id: CandidatePartId, name: string) => ({
  id,
  projectId,
  category: "cpu" as const,
  product: { name: { original: name } },
  normalizedAttributes: {
    category: "cpu" as const,
    socket: { original: "架空ソケット" },
  },
  createdAt: now,
  updatedAt: now,
});

const memoryCandidate = (id: CandidatePartId, name: string) => ({
  id,
  projectId,
  category: "memory" as const,
  product: { name: { original: name } },
  normalizedAttributes: {
    category: "memory" as const,
    memoryStandard: { original: "架空規格" },
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
      cpuCandidate(cpuCandidateId, "架空CPU"),
      memoryCandidate(memoryCandidateId, "架空メモリ"),
    ],
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
          {
            candidatePartId: memoryCandidateId,
            quantity: 2 as PositiveInteger,
          },
        ],
        updatedAt: now,
      },
    ],
  }) as LocalDataRoot;

/**
 * Wires the real foundation graph so candidate-management (the upstream
 * mutator) and current-build's own query share one write authority, proving
 * repair happens inside the upstream commit rather than a follow-up write.
 */
const harness = async () => {
  const state = createInMemoryStorageState({ quotaBytes: 200_000 });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(initialRoot());
  const writes: LocalDataRoot[] = [];
  const storage = {
    readRoot: () => adapter.readRoot(),
    bytesInUse: () => adapter.bytesInUse(),
    quotaBytes: () => adapter.quotaBytes(),
    restrictToTrustedContexts: () => adapter.restrictToTrustedContexts(),
    async writeRoot(next: LocalDataRoot) {
      writes.push(structuredClone(next));
      return adapter.writeRoot(next);
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
  const data = createScopedDataPort(authority);
  const candidateService = createCandidateManagementService({ data });
  const buildQuery = createCurrentBuildQuery({
    data,
    policy: createCategoryPolicy(),
  });
  const stored = async (): Promise<LocalDataRoot> => {
    const read = await adapter.readRoot();
    assert.equal(read.ok, true);
    return read.value as LocalDataRoot;
  };
  return { candidateService, buildQuery, writes, stored };
};

const context = (expectedRevision: number): MutationContext => ({
  requestId:
    `50000000-0000-4000-8000-${String(expectedRevision + 1).padStart(12, "0")}` as Uuid as RequestId,
  expectedRevision: expectedRevision as Revision,
});

test("候補削除は上流commitと同じtransactionで参照を除去し無関係な選択を維持する", async () => {
  const { candidateService, buildQuery, writes, stored } = await harness();

  const deleted = await candidateService.deleteCandidate(
    cpuCandidateId,
    context(0),
  );

  assert.equal(deleted.ok, true);
  const root = await stored();
  assert.equal(root.revision, 1);
  assert.deepEqual(root.currentBuilds[0]?.items, [
    { candidatePartId: memoryCandidateId, quantity: 2 },
  ]);
  assert.equal(writes.length, 1, "current-buildからの追加writeが発生しない");

  const queried = await buildQuery.getByProject(projectId);
  assert.equal(queried.ok, true);
  if (!queried.ok) return;
  assert.equal(queried.value.revision, 1);
  assert.deepEqual(queried.value.currentBuild?.items, [
    { candidatePartId: memoryCandidateId, quantity: 2 },
  ]);
});

test("カテゴリ変更は上流commitと同じtransactionで参照を除去し既存の有効な単一選択を維持する", async () => {
  const { candidateService, buildQuery, writes, stored } = await harness();
  const draft: CandidateDraft = {
    projectId,
    category: "gpu",
    product: { name: { original: "架空メモリ" } },
    normalizedAttributes: { category: "gpu" },
  };

  const updated = await candidateService.updateCandidate(
    { id: memoryCandidateId, draft },
    context(0),
  );

  assert.equal(updated.ok, true);
  const root = await stored();
  assert.equal(root.revision, 1);
  // The changed candidate's own reference is dropped; the untouched CPU
  // single selection is preserved because repair only touches items that
  // reference the changed candidatePartId.
  assert.deepEqual(root.currentBuilds[0]?.items, [
    { candidatePartId: cpuCandidateId, quantity: 1 },
  ]);
  assert.equal(writes.length, 1);

  const queried = await buildQuery.getByProject(projectId);
  assert.equal(queried.ok, true);
  if (!queried.ok) return;
  assert.deepEqual(queried.value.currentBuild?.items, [
    { candidatePartId: cpuCandidateId, quantity: 1 },
  ]);
});

test("未分類化は同じ候補変更commitで現在構成から除外し他の選択を維持する", async () => {
  const { candidateService, buildQuery, writes, stored } = await harness();
  const draft: CandidateDraft = {
    projectId,
    category: "uncategorized",
    product: { name: { original: "架空CPU" } },
    normalizedAttributes: { category: "uncategorized" },
  };

  const updated = await candidateService.updateCandidate(
    { id: cpuCandidateId, draft },
    context(0),
  );

  assert.equal(updated.ok, true);
  const root = await stored();
  assert.deepEqual(root.currentBuilds[0]?.items, [
    { candidatePartId: memoryCandidateId, quantity: 2 },
  ]);
  assert.equal(writes.length, 1);

  const queried = await buildQuery.getByProject(projectId);
  assert.equal(queried.ok, true);
  if (!queried.ok) return;
  assert.deepEqual(queried.value.currentBuild?.items, [
    { candidatePartId: memoryCandidateId, quantity: 2 },
  ]);
});

test("project削除は同じcommitでその現在構成ごと除去し正常な空結果を返す", async () => {
  const { candidateService, buildQuery, writes, stored } = await harness();

  const deleted = await candidateService.deleteProject(projectId, context(0));

  assert.equal(deleted.ok, true);
  const root = await stored();
  assert.deepEqual(root.currentBuilds, []);
  assert.equal(writes.length, 1);

  const queried = await buildQuery.getByProject(projectId);
  assert.equal(queried.ok, true);
  if (!queried.ok) return;
  assert.equal(queried.value.currentBuild, null);
});
