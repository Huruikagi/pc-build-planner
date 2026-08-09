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
import type { MutationContext } from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import type { BuildMutationContext } from "../../../src/features/current-build/contracts.js";
import { createCurrentBuildQuery } from "../../../src/features/current-build/query.js";
import { createBuildService } from "../../../src/features/current-build/service.js";
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
const otherCpuCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId;
const uncategorizedCandidateId =
  "30000000-0000-4000-8000-000000000004" as Uuid as CandidatePartId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuildId;

const cpuCandidate = (id: CandidatePartId, name: string) => ({
  id,
  projectId,
  category: "cpu" as const,
  product: { name: { original: name } },
  sources: [] as const,
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
  sources: [] as const,
  normalizedAttributes: {
    category: "memory" as const,
    memoryStandard: { original: "架空規格" },
  },
  createdAt: now,
  updatedAt: now,
});

const uncategorizedCandidate = (id: CandidatePartId, name: string) => ({
  id,
  projectId,
  category: "uncategorized" as const,
  product: { name: { original: name } },
  sources: [] as const,
  normalizedAttributes: { category: "uncategorized" as const },
  createdAt: now,
  updatedAt: now,
});

const baseRoot = (): LocalDataRoot =>
  ({
    ...createInitialRoot(),
    projects: [
      { id: projectId, name: "架空PC構成", createdAt: now, updatedAt: now },
    ],
    candidateParts: [
      cpuCandidate(cpuCandidateId, "架空CPU"),
      cpuCandidate(otherCpuCandidateId, "架空CPU 別モデル"),
      memoryCandidate(memoryCandidateId, "架空メモリ"),
      uncategorizedCandidate(uncategorizedCandidateId, "架空未分類パーツ"),
    ],
    currentBuilds: [],
  }) as LocalDataRoot;

/**
 * Wires the real foundation graph (schema validation, migrations, mutation
 * pipeline, transaction runner) so CurrentBuildQuery is exercised against
 * genuine persisted state rather than a hand-rolled fake data port.
 */
const harness = async (root: LocalDataRoot = baseRoot()) => {
  const state = createInMemoryStorageState({ quotaBytes: 200_000 });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(root);
  const writes: LocalDataRoot[] = [];
  const storage = {
    readRoot: () => adapter.readRoot(),
    readRecoveryControl: () => adapter.readRecoveryControl(),
    writeRecoveryControl: (control: unknown) =>
      adapter.writeRecoveryControl(control),
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
  const policy = createCategoryPolicy();
  const candidateService = createCandidateManagementService({ data });
  const buildQuery = createCurrentBuildQuery({ data, policy });
  const buildService = createBuildService({
    data,
    policy,
    candidates: candidateService,
    query: buildQuery,
    now: () => now,
    createBuildId: () => buildId,
  });
  const stored = async (): Promise<LocalDataRoot> => {
    const read = await adapter.readRoot();
    assert.equal(read.ok, true);
    return read.value as LocalDataRoot;
  };
  return {
    adapter,
    buildQuery,
    buildService,
    candidateService,
    writes,
    stored,
  };
};

const managementContext = (expectedRevision: number): MutationContext => ({
  requestId:
    `50000000-0000-4000-8000-${String(expectedRevision + 1).padStart(12, "0")}` as Uuid as RequestId,
  expectedRevision: expectedRevision as Revision,
});

const buildContext = (expectedRevision: number): BuildMutationContext => ({
  requestId:
    `60000000-0000-4000-8000-${String(expectedRevision + 1).padStart(12, "0")}` as Uuid as RequestId,
  expectedRevision: expectedRevision as Revision,
});

test("候補削除後の再照会は追加writeなしで修復済み構成を返す", async () => {
  const { buildQuery, buildService, candidateService, writes } =
    await harness();

  const selected = await buildService.execute(
    { type: "select", projectId, candidatePartId: cpuCandidateId },
    buildContext(0),
  );
  assert.equal(selected.ok, true);
  assert.equal(writes.length, 1);

  const deleted = await candidateService.deleteCandidate(
    cpuCandidateId,
    managementContext(1),
  );
  assert.equal(deleted.ok, true);
  assert.equal(writes.length, 2, "候補削除は上流commit一回だけで完結する");

  const requeried = await buildQuery.getByProject(projectId);
  assert.equal(writes.length, 2, "再照会はwriteを発行しない");
  assert.equal(requeried.ok, true);
  if (!requeried.ok) return;
  assert.deepEqual(requeried.value.currentBuild?.items, []);
});

test("管理画面の再表示を模した新しいqueryも保存済みの候補参照と数量を復元する", async () => {
  const { adapter, buildService } = await harness();

  const selected = await buildService.execute(
    { type: "select", projectId, candidatePartId: memoryCandidateId },
    buildContext(0),
  );
  assert.equal(selected.ok, true);

  // A freshly constructed query against the same underlying storage stands
  // in for reopening the management panel: no in-memory state is reused.
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const reopenedRepository = createLocalDataRepository(adapter, migrations);
  const reopenedAuthority = createWriteAuthority({
    repository: reopenedRepository,
    runner: createRootTransactionRunner({
      storage: adapter as never,
      lock: createInMemoryRootWriteLock(createInMemoryRootWriteLockState()),
      migrations,
      validator: schemaValidator,
      maintenance: maintenancePolicy,
      replacement: createReplacementCoordinator(migrations, schemaValidator),
      now: () => now,
      initialRoot: createInitialRoot,
    }),
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
  const reopenedQuery = createCurrentBuildQuery({
    data: createScopedDataPort(reopenedAuthority),
    policy: createCategoryPolicy(),
  });

  const restored = await reopenedQuery.getByProject(projectId);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(restored.value.currentBuild?.items, [
    { candidatePartId: memoryCandidateId, quantity: 1 },
  ]);
});

test("同一projectに複数の現在構成が存在するFoundation検証済みrootはcorrupt-dataとして操作を停止する", async () => {
  const duplicated = baseRoot();
  const rootWithDuplicateBuilds: LocalDataRoot = {
    ...duplicated,
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
        ],
        updatedAt: now,
      },
      {
        id: "40000000-0000-4000-8000-000000000002" as Uuid as CurrentBuildId,
        projectId,
        items: [],
        updatedAt: now,
      },
    ],
  };
  assert.equal(
    schemaValidator.validateRoot(rootWithDuplicateBuilds).ok,
    true,
    "Foundationのschema検証はproject別の構成上限を知らないため通過する",
  );

  const { buildQuery, writes } = await harness(rootWithDuplicateBuilds);
  const result = await buildQuery.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
  assert.equal(writes.length, 0);
});

test("Foundation検証済みrootの重複候補項目はcorrupt-dataとして操作を停止する", async () => {
  const rootWithDuplicateItem: LocalDataRoot = {
    ...baseRoot(),
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          {
            candidatePartId: memoryCandidateId,
            quantity: 1 as PositiveInteger,
          },
          {
            candidatePartId: memoryCandidateId,
            quantity: 2 as PositiveInteger,
          },
        ],
        updatedAt: now,
      },
    ],
  };
  assert.equal(
    schemaValidator.validateRoot(rootWithDuplicateItem).ok,
    true,
    "Foundationのschema検証はbuild内の重複候補IDを知らないため通過する",
  );

  const { buildQuery, writes } = await harness(rootWithDuplicateItem);
  const result = await buildQuery.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
  assert.equal(writes.length, 0);
});

test("Foundation検証済みrootの未分類候補参照はcorrupt-dataとして操作を停止する", async () => {
  const rootWithUncategorizedItem: LocalDataRoot = {
    ...baseRoot(),
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          {
            candidatePartId: uncategorizedCandidateId,
            quantity: 1 as PositiveInteger,
          },
        ],
        updatedAt: now,
      },
    ],
  };
  assert.equal(
    schemaValidator.validateRoot(rootWithUncategorizedItem).ok,
    true,
    "Foundationのschema検証は候補の採用可否を知らないため通過する",
  );

  const { buildQuery, writes } = await harness(rootWithUncategorizedItem);
  const result = await buildQuery.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
  assert.equal(writes.length, 0);
});

test("Foundation検証済みrootの単一選択カテゴリ違反はcorrupt-dataとして操作を停止する", async () => {
  const rootWithSingleCategoryConflict: LocalDataRoot = {
    ...baseRoot(),
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
          {
            candidatePartId: otherCpuCandidateId,
            quantity: 1 as PositiveInteger,
          },
        ],
        updatedAt: now,
      },
    ],
  };
  assert.equal(
    schemaValidator.validateRoot(rootWithSingleCategoryConflict).ok,
    true,
    "Foundationのschema検証はカテゴリ別の選択数上限を知らないため通過する",
  );

  const { buildQuery, writes } = await harness(rootWithSingleCategoryConflict);
  const result = await buildQuery.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
  assert.equal(writes.length, 0);
});

test("非対応schema versionの保存rootは既存データを変更せず識別可能なerrorを返す", async () => {
  const unsupported = {
    ...baseRoot(),
    schemaVersion: 2,
  } as unknown as LocalDataRoot;
  const { buildQuery, adapter, writes } = await harness(baseRoot());
  await adapter.writeRoot(unsupported);

  const result = await buildQuery.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unsupported-data");
  assert.equal(writes.length, 0);
  const untouched = await adapter.readRoot();
  assert.equal(untouched.ok, true);
  if (untouched.ok) assert.deepEqual(untouched.value, unsupported);
});

test("存在しない候補を参照する保存rootはFoundationのschema検証で既に拒否され識別可能なerrorとなる", async () => {
  const nonexistentCandidateId =
    "30000000-0000-4000-8000-000000000099" as Uuid as CandidatePartId;
  const rootWithMissingReference: LocalDataRoot = {
    ...baseRoot(),
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          {
            candidatePartId: nonexistentCandidateId,
            quantity: 1 as PositiveInteger,
          },
        ],
        updatedAt: now,
      },
    ],
  };
  assert.equal(
    schemaValidator.validateRoot(rootWithMissingReference).ok,
    false,
    "存在しない候補参照はFoundationのroot検証で既に拒否される",
  );

  const { buildQuery, writes } = await harness(rootWithMissingReference);
  const result = await buildQuery.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
  assert.equal(writes.length, 0);
});

test("別projectの候補を参照する保存rootはFoundationのschema検証で既に拒否され識別可能なerrorとなる", async () => {
  const otherProjectId =
    "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
  const rootWithForeignReference: LocalDataRoot = {
    ...baseRoot(),
    projects: [
      ...baseRoot().projects,
      {
        id: otherProjectId,
        name: "架空別構成",
        createdAt: now,
        updatedAt: now,
      },
    ],
    currentBuilds: [
      {
        id: buildId,
        projectId: otherProjectId,
        items: [
          { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
        ],
        updatedAt: now,
      },
    ],
  };
  assert.equal(
    schemaValidator.validateRoot(rootWithForeignReference).ok,
    false,
    "別projectの候補参照はFoundationのroot検証で既に拒否される",
  );

  const { buildQuery, writes } = await harness(rootWithForeignReference);
  const result = await buildQuery.getByProject(otherProjectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
  assert.equal(writes.length, 0);
});
