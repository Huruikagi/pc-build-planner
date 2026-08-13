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
} from "../../src/domain/public.js";
import { schemaValidator } from "../../src/domain/public.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../src/persistence/mutation-pipeline.js";
import { referenceRepairPolicy } from "../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../src/persistence/root-transaction-runner.js";
import {
  createInMemoryRootWriteLock,
  createInMemoryRootWriteLockState,
} from "../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../src/persistence/schema.js";
import {
  createScopedDataPort,
  createWriteAuthority,
} from "../../src/persistence/write-authority.js";
import { createFoundationProjectLifecycleDataPort } from "../../src/project-context/lifecycle-data-port.js";

const timestamp = "2026-08-13T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuildId;
const requestId = "50000000-0000-4000-8000-000000000001" as Uuid as RequestId;

const initialRoot = (): LocalDataRoot => ({
  ...createInitialRoot(),
  projects: [
    {
      id: projectId,
      name: "Synthetic build",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  candidateParts: [
    {
      id: candidateId,
      projectId,
      category: "cpu",
      product: { name: { original: "Synthetic CPU" } },
      sources: [],
      normalizedAttributes: { category: "cpu" },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  currentBuilds: [
    {
      id: buildId,
      projectId,
      items: [{ candidatePartId: candidateId, quantity: 1 as PositiveInteger }],
      updatedAt: timestamp,
    },
  ],
});

test("project delete delegates once and foundation repairs all references in the same commit", async () => {
  const state = createInMemoryStorageState({ quotaBytes: 100_000 });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(initialRoot());
  const writes: LocalDataRoot[] = [];
  const storage = {
    readRoot: () => adapter.readRoot(),
    readRecoveryControl: () => adapter.readRecoveryControl(),
    writeRecoveryControl: (control: unknown) =>
      adapter.writeRecoveryControl(control),
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
    now: () => timestamp,
    initialRoot: createInitialRoot,
  });
  const foundation = createScopedDataPort(
    createWriteAuthority({
      repository: createLocalDataRepository(storage as never, migrations),
      runner,
      pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
    }),
  );
  const port = createFoundationProjectLifecycleDataPort(
    foundation,
    () => requestId,
  );

  const result = await port.mutate(
    { kind: "delete", projectId },
    { requestId, expectedRevision: 0 as Revision },
  );

  assert.deepEqual(result, {
    ok: true,
    value: { revision: 1, replayed: false },
  });
  assert.equal(writes[0]?.revision, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.projects, []);
  assert.deepEqual(writes[0]?.candidateParts, []);
  assert.deepEqual(writes[0]?.currentBuilds, []);

  const missing = await port.mutate(
    { kind: "delete", projectId },
    {
      requestId: "50000000-0000-4000-8000-000000000002" as Uuid as RequestId,
      expectedRevision: 1 as Revision,
    },
  );
  assert.deepEqual(missing, { ok: false, error: { kind: "not-found" } });
  assert.equal(writes.length, 1, "not-found must not create a second write");
});
