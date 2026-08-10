import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createSidePanelFeatureContributions } from "../../../src/application-shell/side-panel-contributions.js";
import type {
  CandidatePartId,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/public.js";
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
import { createInMemoryRootWriteLock } from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import { createWriteAuthority } from "../../../src/persistence/write-authority.js";
import { detachedProjectContextDependencies } from "../../fixtures/project-context-ports.js";
import { idleTransientSurface } from "../../fixtures/transient-surface.js";

const timestamp = "2026-07-23T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000071" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000071" as Uuid as CandidatePartId;
let requestSequence = 0;

const nextRequest = (): RequestId =>
  `20000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}` as Uuid as RequestId;

const createFoundationPort = () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
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

const policy = { isAllowed: () => true, subscribe: () => () => {} };

/**
 * View click handlers fire `state.execute` without awaiting it, so the test
 * polls the real committed state instead of guessing a fixed number of
 * microtask hops through the in-memory Foundation write authority.
 */
const waitUntil = async (
  predicate: () => Promise<boolean>,
  attempts = 50,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition did not become true in time");
};

test("既存side panel host上でproject選択から採用・数量変更・解除・再表示までを完了し、root公開APIが同じ委託構成を返す", async () => {
  const data = createFoundationPort();

  // Seeds a project and a memory-category candidate through the same write
  // authority the side panel composition will share; this is test setup, not
  // current-build production code, so using the concrete service is fine.
  const seedService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
    createCandidateId: () => candidateId,
  });
  const created = await seedService.createProject(
    { name: "架空統合PC構成" },
    { requestId: nextRequest(), expectedRevision: 0 as Revision },
  );
  assert.equal(created.ok, true);
  const candidateCreated = await seedService.createCandidate(
    {
      projectId,
      category: "memory",
      product: {
        name: { original: "架空メモリ統合候補", confirmed: "SYN-MEMORY" },
      },
      normalizedAttributes: {
        category: "memory",
        memoryStandard: { original: "架空規格", confirmed: "SYN-DDR" },
      },
    },
    { requestId: nextRequest(), expectedRevision: 1 as Revision },
  );
  assert.equal(candidateCreated.ok, true);

  const contributions = createSidePanelFeatureContributions(
    {
      data,
      navigator: {
        async activate() {
          return { ok: true as const, value: undefined };
        },
      },
    },
    {
      backupRestoreData: data as never,
      ...detachedProjectContextDependencies(),
      transientSurface: idleTransientSurface,
    },
  );
  const [, currentBuild] = contributions;

  const container = document.createElement("div");
  const mounted: {
    current?: Awaited<ReturnType<typeof currentBuild.registration.mount>>;
  } = {};
  await act(async () => {
    mounted.current = await currentBuild.registration.mount({
      container,
      operationPolicy: policy,
      reportError: () => {},
    });
  });
  const handle = mounted.current;
  if (handle === undefined) throw new Error("mount handleを取得できません");
  assert.match(container.textContent ?? "", /SYN-MEMORY/);

  const addButton = container.querySelector(
    `[data-select-candidate-id='${candidateId}']`,
  ) as HTMLButtonElement;
  const buildQuery = currentBuild.registration.publicApi.query;
  await act(async () => {
    addButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return result.ok && result.value.currentBuild !== null;
    });
  });

  const afterAdd = await buildQuery.getByProject(projectId);
  assert.equal(afterAdd.ok, true);
  if (!afterAdd.ok) throw new Error("現在構成を照会できません");
  assert.deepEqual(afterAdd.value.currentBuild?.items, [
    { candidatePartId: candidateId, quantity: 1 },
  ]);

  const quantityInput = container.querySelector(
    `[data-quantity-input='${candidateId}']`,
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(quantityInput, "4");
    quantityInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  const confirmQuantity = container.querySelector(
    `[data-confirm-quantity='${candidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    confirmQuantity.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return result.ok && result.value.currentBuild?.items[0]?.quantity === 4;
    });
  });

  const afterQuantity = await buildQuery.getByProject(projectId);
  assert.equal(afterQuantity.ok, true);
  if (!afterQuantity.ok) throw new Error("現在構成を照会できません");
  assert.deepEqual(afterQuantity.value.currentBuild?.items, [
    { candidatePartId: candidateId, quantity: 4 },
  ]);

  await act(async () => handle.unmount());
  assert.equal(container.textContent, "");

  // Reopening (a fresh mount of the same production-shaped registration)
  // restores the persisted selection from the shared data port.
  const reopenedContainer = document.createElement("div");
  const reopened: {
    current?: Awaited<ReturnType<typeof currentBuild.registration.mount>>;
  } = {};
  await act(async () => {
    reopened.current = await currentBuild.registration.mount({
      container: reopenedContainer,
      operationPolicy: policy,
      reportError: () => {},
    });
  });
  const reopenedHandle = reopened.current;
  if (reopenedHandle === undefined)
    throw new Error("再mount handleを取得できません");
  assert.match(reopenedContainer.textContent ?? "", /SYN-MEMORY/);
  const reopenedQuantityInput = reopenedContainer.querySelector(
    `[data-quantity-input='${candidateId}']`,
  ) as HTMLInputElement;
  assert.equal(reopenedQuantityInput.value, "4");

  const removeButton = reopenedContainer.querySelector(
    `[data-remove-candidate-id='${candidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    removeButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return result.ok && result.value.currentBuild?.items.length === 0;
    });
  });

  const afterRemove = await buildQuery.getByProject(projectId);
  assert.equal(afterRemove.ok, true);
  if (!afterRemove.ok) throw new Error("現在構成を照会できません");
  assert.deepEqual(afterRemove.value.currentBuild?.items, []);

  await act(async () => reopenedHandle.unmount());
});
