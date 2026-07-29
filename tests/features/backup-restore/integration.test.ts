import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  MaintenanceOwnerId,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/public.js";
import {
  createBackupService,
  createRestoreService,
} from "../../../src/features/backup-restore/service.js";
import type { CandidateDraft } from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import { createCurrentBuildQuery } from "../../../src/features/current-build/query.js";
import { createBuildService } from "../../../src/features/current-build/service.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
  type InMemoryStorageState,
} from "../../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../../src/persistence/mutation-pipeline.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";
import { referenceRepairPolicy } from "../../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../../src/persistence/root-transaction-runner.js";
import { createInMemoryRootWriteLock } from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import { createWriteAuthority } from "../../../src/persistence/write-authority.js";
import { buildFoundationRoot } from "../../fixtures/foundation.js";

const timestamp = "2026-07-25T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000101" as Uuid as ProjectId;
let requestSequence = 0;
const nextRequest = (): RequestId =>
  `20000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}` as Uuid as RequestId;

/** 常に最新revisionを読み直すことで、手動カウンタのずれを避ける。 */
const currentRevision = async (data: FoundationDataPort): Promise<Revision> => {
  const result = await data.query((root) => root.revision);
  if (!result.ok) throw new Error("revisionを取得できません");
  return result.value;
};

/** authorityから独立した`storageState`を共有すれば、再起動後の再読取を素直に模擬できる。 */
const createFoundationPortOn = (
  storageState: InMemoryStorageState,
): FoundationDataPort => {
  const storage = createInMemoryStorageAdapter(storageState);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement: createReplacementCoordinator(migrations, schemaValidator),
    now: () => timestamp,
    initialRoot: createInitialRoot,
  });
  return createWriteAuthority({
    repository: createLocalDataRepository(storage, migrations),
    runner,
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
};

test("全12カテゴリ候補と現在構成の往復、再起動後照会、通常CRUD、再バックアップが完了する", async () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  const data = createFoundationPortOn(storageState);

  const candidateService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
  });
  const created = await candidateService.createProject(
    { name: "架空全カテゴリ構成" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );
  assert.equal(created.ok, true);

  const fixtureRoot = buildFoundationRoot();
  const candidateIds: CandidatePartId[] = [];
  for (const fixtureCandidate of fixtureRoot.candidateParts) {
    const draft: CandidateDraft = {
      projectId,
      category: fixtureCandidate.category,
      product: fixtureCandidate.product,
      normalizedAttributes: fixtureCandidate.normalizedAttributes,
      sources: fixtureCandidate.sources,
      ...(fixtureCandidate.primarySourceId === undefined
        ? {}
        : { primarySourceId: fixtureCandidate.primarySourceId }),
      ...(fixtureCandidate.sourceSnapshot === undefined
        ? {}
        : { sourceSnapshot: fixtureCandidate.sourceSnapshot }),
    } as CandidateDraft;
    const result = await candidateService.createCandidate(draft, {
      requestId: nextRequest(),
      expectedRevision: await currentRevision(data),
    });
    assert.equal(result.ok, true, fixtureCandidate.category);
    if (result.ok) candidateIds.push(result.value.id);
  }
  assert.equal(candidateIds.length, 12);

  const policy = createCategoryPolicy();
  const buildQuery = createCurrentBuildQuery({ data, policy });
  const buildService = createBuildService({
    data,
    policy,
    candidates: {
      async listBuildEligible() {
        return {
          ok: true,
          value: fixtureRoot.candidateParts.map((candidate, index) => ({
            ...candidate,
            id: candidateIds[index] as CandidatePartId,
            projectId,
          })),
        };
      },
    },
    query: buildQuery,
  });

  // "uncategorized" is never build-eligible; every other category is
  // selectable, but only "multiple"-mode categories allow an explicit quantity
  // (single-mode categories are always exactly 1, set implicitly by select).
  let multipleQuantity = 2;
  let eligibleCount = 0;
  const expectedQuantitiesById = new Map<CandidatePartId, number>();
  for (const [index, candidateId] of candidateIds.entries()) {
    const category = fixtureRoot.candidateParts[index]?.category;
    if (category === undefined) continue;
    const mode = policy.modeFor(category);
    if (mode === "ineligible") continue;
    eligibleCount += 1;

    const selected = await buildService.execute(
      { type: "select", projectId, candidatePartId: candidateId },
      {
        requestId: nextRequest(),
        expectedRevision: await currentRevision(data),
      },
    );
    assert.equal(selected.ok, true, `select ${index}`);

    if (mode === "multiple") {
      const quantity = multipleQuantity;
      multipleQuantity += 1;
      const quantityResult = await buildService.execute(
        {
          type: "set-quantity",
          projectId,
          candidatePartId: candidateId,
          quantity,
        },
        {
          requestId: nextRequest(),
          expectedRevision: await currentRevision(data),
        },
      );
      assert.equal(quantityResult.ok, true, `quantity ${index}`);
      expectedQuantitiesById.set(candidateId, quantity);
    } else {
      expectedQuantitiesById.set(candidateId, 1);
    }
  }
  assert.equal(eligibleCount, 11);

  const beforeBuild = await buildQuery.getByProject(projectId);
  assert.equal(beforeBuild.ok, true);
  if (!beforeBuild.ok) return;
  assert.equal(beforeBuild.value.currentBuild?.items.length, eligibleCount);

  const backupService = createBackupService({ data, now: () => timestamp });
  const artifact = await backupService.create();
  assert.equal(artifact.ok, true);
  if (!artifact.ok) return;

  // Simulate changing local data after taking the backup. A fresh service
  // (no fixed createProjectId) is used so the new project gets its own id
  // instead of colliding with the seeded `projectId`.
  const mutatingCandidateService = createCandidateManagementService({
    data,
    now: () => timestamp,
  });
  const afterExportProject = await mutatingCandidateService.createProject(
    { name: "架空バックアップ後追加プロジェクト" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );
  assert.equal(afterExportProject.ok, true);

  const restoreService = createRestoreService({ data });
  const preflight = await restoreService.preflight({
    text: artifact.value.json,
    byteLength: artifact.value.byteLength,
  });
  assert.equal(preflight.ok, true);
  if (!preflight.ok) return;
  assert.equal(preflight.value.preview.partCount, candidateIds.length);

  const committed = await restoreService.commit(preflight.value);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.deepEqual(committed.value, {
    projectCount: 1,
    partCount: candidateIds.length,
    currentBuildCount: 1,
  });

  // "Restart": a fresh repository/runner pair reading the same persisted storage state.
  const restarted = createFoundationPortOn(storageState);
  const restartedCandidateQuery = {
    async listProjects() {
      return restarted.query((root) =>
        root.projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      );
    },
  };
  const projectsAfterRestart = await restartedCandidateQuery.listProjects();
  assert.equal(projectsAfterRestart.ok, true);
  if (projectsAfterRestart.ok)
    assert.deepEqual(
      projectsAfterRestart.value.map((project) => project.name),
      ["架空全カテゴリ構成"],
    );

  const restartedBuildQuery = createCurrentBuildQuery({
    data: restarted,
    policy,
  });
  const buildAfterRestart = await restartedBuildQuery.getByProject(projectId);
  assert.equal(buildAfterRestart.ok, true);
  if (buildAfterRestart.ok) {
    assert.equal(
      buildAfterRestart.value.currentBuild?.items.length,
      eligibleCount,
    );
    assert.deepEqual(
      buildAfterRestart.value.currentBuild?.items.map((item) => [
        item.candidatePartId,
        item.quantity,
      ]),
      Array.from(expectedQuantitiesById.entries()),
    );
  }

  const restartedCandidateService = createCandidateManagementService({
    data: restarted,
    now: () => timestamp,
  });
  const normalCrudAfterRestore = await restartedCandidateService.createProject(
    { name: "架空復元後追加プロジェクト" },
    {
      requestId: nextRequest(),
      expectedRevision: await currentRevision(restarted),
    },
  );
  assert.equal(normalCrudAfterRestore.ok, true);

  const rebackupService = createBackupService({
    data: restarted,
    now: () => timestamp,
  });
  const rebackup = await rebackupService.create();
  assert.equal(rebackup.ok, true);
});

test("不正JSON・旧開発形式・将来版・孤立参照の各経路でpreflightが復元前データを変更しない", async () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  const data = createFoundationPortOn(storageState);
  const candidateService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
  });
  await candidateService.createProject(
    { name: "架空保護対象構成" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );

  const restoreService = createRestoreService({ data });
  const beforeSnapshot = await data.query((root) => root);
  assert.equal(beforeSnapshot.ok, true);

  const scenarios: Array<{ name: string; text: string }> = [
    { name: "invalid json", text: "{not valid json" },
    {
      name: "future version",
      text: JSON.stringify({
        product: "pc-build-planner",
        formatVersion: 2,
        createdAt: timestamp,
        data: { projects: [], parts: [], currentBuilds: [] },
      }),
    },
    {
      name: "legacy format 1 candidate shape",
      text: JSON.stringify({
        product: "pc-build-planner",
        formatVersion: 1,
        createdAt: timestamp,
        data: {
          projects: [],
          parts: [
            {
              id: "30000000-0000-4000-8000-000000000001",
              projectId: "90000000-0000-4000-8000-000000000001",
              category: "cpu",
              product: {
                price: {
                  original: "12,345円",
                  confirmed: { amount: 12345, currency: "JPY" },
                },
              },
              sourceInfo: {
                pageUrl: "https://legacy.invalid/fictional-cpu",
              },
              normalizedAttributes: { category: "cpu" },
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          currentBuilds: [],
        },
      }),
    },
    {
      name: "orphan reference",
      text: JSON.stringify({
        product: "pc-build-planner",
        formatVersion: 1,
        createdAt: timestamp,
        data: {
          projects: [],
          parts: [
            {
              id: "30000000-0000-4000-8000-000000000001",
              projectId: "90000000-0000-4000-8000-000000000001",
              category: "cpu",
              product: {},
              sources: [],
              normalizedAttributes: { category: "cpu" },
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          currentBuilds: [],
        },
      }),
    },
  ];

  for (const scenario of scenarios) {
    const preflight = await restoreService.preflight({
      text: scenario.text,
      byteLength: new TextEncoder().encode(scenario.text).byteLength,
    });
    assert.equal(preflight.ok, false, scenario.name);

    const afterSnapshot = await data.query((root) => root);
    assert.equal(afterSnapshot.ok, true, scenario.name);
    if (beforeSnapshot.ok && afterSnapshot.ok)
      assert.deepEqual(
        afterSnapshot.value,
        beforeSnapshot.value,
        scenario.name,
      );
  }
});

test("容量境界を超える復元はwriteなしで拒否され既存データを保持する", async () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 2_000 });
  const data = createFoundationPortOn(storageState);
  const candidateService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
  });
  await candidateService.createProject(
    { name: "架空容量境界構成" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );

  const beforeSnapshot = await data.query((root) => root);
  assert.equal(beforeSnapshot.ok, true);

  const oversizedParts = Array.from({ length: 200 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    projectId,
    category: "cpu",
    product: {
      notes: {
        original: null,
        confirmed: "架空".repeat(200),
      },
    },
    sources: [],
    normalizedAttributes: { category: "cpu" },
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const oversizedText = JSON.stringify({
    product: "pc-build-planner",
    formatVersion: 1,
    createdAt: timestamp,
    data: {
      projects: [
        {
          id: projectId,
          name: "架空容量境界復元先",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      parts: oversizedParts,
      currentBuilds: [],
    },
  });

  const restoreService = createRestoreService({ data });
  const preflight = await restoreService.preflight({
    text: oversizedText,
    byteLength: new TextEncoder().encode(oversizedText).byteLength,
  });
  assert.equal(preflight.ok, false);
  if (!preflight.ok) assert.equal(preflight.error.code, "quota-exceeded");

  const afterSnapshot = await data.query((root) => root);
  assert.equal(afterSnapshot.ok, true);
  if (beforeSnapshot.ok && afterSnapshot.ok)
    assert.deepEqual(afterSnapshot.value, beforeSnapshot.value);
});

test("復元中はFoundationの保守acquireにより他featureのmutationが拒否されread-only照会は継続し、終了後に再開する", async () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  const data = createFoundationPortOn(storageState);
  const candidateService = createCandidateManagementService({
    data,
    now: () => timestamp,
  });
  const candidateQuery = {
    async listProjects() {
      return data.query((root) =>
        root.projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      );
    },
  };

  const beforeAcquire = await candidateService.createProject(
    { name: "架空保守前プロジェクト" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );
  assert.equal(beforeAcquire.ok, true);

  const ownerId =
    "10000000-0000-4000-8000-000000000201" as Uuid as MaintenanceOwnerId;
  const acquired = await data.runMaintenance({
    type: "acquire",
    ownerId,
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  if (!acquired.ok || acquired.value.fence === undefined) return;
  const fence = acquired.value.fence;

  // A competing acquire (e.g. a second concurrent restore session) must be rejected.
  const competingOwnerId =
    "10000000-0000-4000-8000-000000000202" as Uuid as MaintenanceOwnerId;
  const competingAcquire = await data.runMaintenance({
    type: "acquire",
    ownerId: competingOwnerId,
    leaseMs: 60_000,
  });
  assert.equal(competingAcquire.ok, false);
  if (!competingAcquire.ok)
    assert.equal(competingAcquire.error.code, "maintenance-active");

  // Other features' mutations are rejected while maintenance is active...
  const mutationDuringMaintenance = await candidateService.createProject(
    { name: "架空保守中プロジェクト" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );
  assert.equal(mutationDuringMaintenance.ok, false);
  if (!mutationDuringMaintenance.ok)
    assert.equal(mutationDuringMaintenance.error.kind, "maintenance");

  // ...but read-only queries continue to succeed.
  const queryDuringMaintenance = await candidateQuery.listProjects();
  assert.equal(queryDuringMaintenance.ok, true);
  if (queryDuringMaintenance.ok)
    assert.deepEqual(
      queryDuringMaintenance.value.map((project) => project.name),
      ["架空保守前プロジェクト"],
    );

  const aborted = await data.runMaintenance({ type: "abort", fence });
  assert.equal(aborted.ok, true);

  // Mutations resume once the maintenance generation ends.
  const afterAbort = await candidateService.createProject(
    { name: "架空保守後プロジェクト" },
    { requestId: nextRequest(), expectedRevision: await currentRevision(data) },
  );
  assert.equal(afterAbort.ok, true);
});
