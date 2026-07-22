import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import type {
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/validation.js";
import type { CandidateDraft } from "../../../src/features/candidate-management/contracts.js";
import { createCandidateFeatureRegistration } from "../../../src/features/candidate-management/registration.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
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
import { createInMemoryRootWriteLock } from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import { createWriteAuthority } from "../../../src/persistence/write-authority.js";

const storageKey = "localDataRoot";
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000061" as Uuid as ProjectId;
let requestSequence = 0;

const nextRequest = (): RequestId =>
  `20000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}` as Uuid as RequestId;

const createFoundationPort = () => {
  const state = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  const storage = createInMemoryStorageAdapter(state);
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
  return {
    storageState: state,
    data: createWriteAuthority({
      repository: createLocalDataRepository(storage, migrations),
      runner,
      pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
    }),
  };
};

test("架空Foundation・shell・UIを通じて候補管理の作成、分類補正、編集、削除、再読込を完了できる", async () => {
  const { data, storageState } = createFoundationPort();
  const service = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
    createCandidateId: () =>
      "30000000-0000-4000-8000-000000000061" as Uuid as never,
  });
  let revision = 0;
  const state = createManagementState({
    query: service,
    service,
    createMutationContext: () => ({
      requestId: nextRequest(),
      expectedRevision: revision as Revision,
    }),
  });
  const registration = createCandidateFeatureRegistration({
    data,
    query: service,
    capture: {
      createCandidate: (draft) =>
        service.createCandidate(draft, {
          requestId: nextRequest(),
          expectedRevision: 0 as Revision,
        }),
    },
    state,
  });
  const container = document.createElement("div");
  const handle = await registration.mount({
    container,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });

  await act(async () => state.createProject("架空統合プロジェクト"));
  revision = 1;
  await act(async () =>
    state.renameProject(projectId, "改名した架空統合プロジェクト"),
  );
  revision = 2;
  await act(async () => state.selectProject(projectId));
  const uncategorized: CandidateDraft = {
    projectId,
    category: "uncategorized",
    product: {
      name: { original: "架空の未分類候補", confirmed: "SYN-CANDIDATE" },
      manufacturer: { original: "架空メーカー", confirmed: "SYNTHETIC" },
    },
    sourceInfo: {
      pageUrl: "https://catalog.example.invalid/management-flow",
      capturedAt: timestamp,
    },
    sourceSnapshot: {
      name: "取得時の架空候補名",
      manufacturer: "取得時の架空メーカー",
    },
    normalizedAttributes: { category: "uncategorized" },
  };
  await act(async () => state.beginCreate(uncategorized));
  await act(async () => state.saveEditor());
  revision = 3;
  assert.match(container.textContent ?? "", /SYN-CANDIDATE/);

  const candidateId = state.value.candidates[0]?.id;
  if (candidateId === undefined) throw new Error("候補が作成されていません");
  await act(async () =>
    state.beginEdit(candidateId, {
      ...uncategorized,
      category: "cpu",
      normalizedAttributes: {
        category: "cpu",
        socket: { original: "架空ソケット", confirmed: "SYN-CPU" },
      },
    }),
  );
  await act(async () => state.saveEditor());
  revision = 4;
  await act(async () => state.selectCategory("cpu"));
  assert.match(container.textContent ?? "", /CPU/);
  const buildEligible = await service.listBuildEligible(projectId);
  assert.equal(buildEligible.ok, true);
  if (!buildEligible.ok) throw new Error("分類済み候補を照会できません");
  assert.deepEqual(buildEligible.value[0]?.product, uncategorized.product);
  assert.deepEqual(
    buildEligible.value[0]?.sourceInfo,
    uncategorized.sourceInfo,
  );
  assert.deepEqual(
    buildEligible.value[0]?.sourceSnapshot,
    uncategorized.sourceSnapshot,
  );
  assert.deepEqual(buildEligible.value[0]?.normalizedAttributes, {
    category: "cpu",
    socket: { original: "架空ソケット", confirmed: "SYN-CPU" },
  });

  await act(async () => handle.unmount());
  assert.equal(container.textContent, "");

  const reopenedState = createManagementState({
    query: service,
    service,
    createMutationContext: () => ({
      requestId: nextRequest(),
      expectedRevision: revision as Revision,
    }),
  });
  const reopenedContainer = document.createElement("div");
  const reopenedHandle = await createCandidateFeatureRegistration({
    data,
    query: service,
    capture: {
      createCandidate: (draft) =>
        service.createCandidate(draft, {
          requestId: nextRequest(),
          expectedRevision: revision as Revision,
        }),
    },
    state: reopenedState,
  }).mount({
    container: reopenedContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  await act(async () => reopenedState.load());
  assert.match(
    reopenedContainer.textContent ?? "",
    /改名した架空統合プロジェクト/,
  );
  assert.match(reopenedContainer.textContent ?? "", /SYN-CANDIDATE/);
  await act(async () =>
    reopenedState.requestDeletion({ kind: "project", projectId }),
  );
  assert.match(reopenedContainer.textContent ?? "", /所属する候補も削除/);
  await act(async () => reopenedState.confirmDeletion());
  revision = 5;
  await act(async () => reopenedHandle.unmount());

  const finalState = createManagementState({
    query: service,
    service,
    createMutationContext: () => ({
      requestId: nextRequest(),
      expectedRevision: revision as Revision,
    }),
  });
  await finalState.load();
  assert.equal(finalState.value.projects.length, 0);
  assert.equal(finalState.value.candidates.length, 0);
  assert.equal(storageState.entries.has(storageKey), true);
});
