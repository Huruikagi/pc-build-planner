import assert from "node:assert/strict";
import test from "node:test";
import {
  type CandidateSourceMutationDependencies,
  createCandidateSourceMutationService,
} from "../../src/candidate-sources/public.js";
import type {
  CandidatePartId,
  CandidateSourceId,
  RequestId,
} from "../../src/domain/public.js";
import { schemaValidator } from "../../src/domain/public.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../src/persistence/mutation-pipeline.js";
import type { FoundationScopedDataPort } from "../../src/persistence/public.js";
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
import { sourceRoot } from "../fixtures/candidate-source-root.js";

const candidateId = "20000000-0000-4000-8000-000000000001" as CandidatePartId;
const primaryId = "30000000-0000-4000-8000-000000000001" as CandidateSourceId;
const addedId = "30000000-0000-4000-8000-000000000099" as CandidateSourceId;

const harness = (options: { readonly failWrite?: boolean } = {}) => {
  let root = structuredClone(sourceRoot());
  let commits = 0;
  const data: FoundationScopedDataPort = {
    async query(project) {
      return { ok: true, value: project(root) };
    },
    async mutate(command) {
      if (options.failWrite)
        return { ok: false, error: { code: "storage-unavailable" } };
      assert.equal(command.operation.kind, "update");
      assert.equal(command.operation.entity, "candidatePart");
      if (
        command.operation.kind !== "update" ||
        command.operation.entity !== "candidatePart"
      )
        return { ok: false, error: { code: "storage-unavailable" } };
      commits += 1;
      const candidate = command.operation.value;
      root = {
        ...root,
        revision: (root.revision + 1) as never,
        candidateParts: root.candidateParts.map((item) =>
          item.id === candidate.id ? candidate : item,
        ),
      };
      return {
        ok: true,
        value: {
          requestId: command.requestId,
          committedRevision: root.revision,
          replayed: false,
          value: {
            capacity: {
              beforeBytes: 0,
              afterBytes: 0,
              requiredBytes: 0,
              quotaBytes: 1,
              warningThresholdBytes: 1,
              warnings: [],
            },
          },
        },
      };
    },
  };
  const classified: string[] = [];
  const dependencies: CandidateSourceMutationDependencies = {
    data,
    manufacturerDomains: {
      findManufacturer(pageUrl) {
        classified.push(pageUrl);
        try {
          const host = new URL(pageUrl).hostname;
          return {
            ok: true,
            value:
              host === "maker.example.invalid"
                ? { manufacturer: "架空メーカー", sourceLabel: host }
                : undefined,
          };
        } catch {
          return { ok: false, error: { kind: "invalid-page-url" } };
        }
      },
    },
    createRequestId: () => "90000000-0000-4000-8000-000000000001" as RequestId,
  };
  return {
    service: createCandidateSourceMutationService(dependencies),
    root: () => root,
    commits: () => commits,
    classified,
  };
};

const realFoundationHarness = async () => {
  const state = createInMemoryStorageState({ quotaBytes: 1_000_000 });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(sourceRoot());
  let commits = 0;
  const storage = {
    readRoot: () => adapter.readRoot(),
    readRecoveryControl: () => adapter.readRecoveryControl(),
    writeRecoveryControl: (control: unknown) =>
      adapter.writeRecoveryControl(control),
    bytesInUse: () => adapter.bytesInUse(),
    quotaBytes: () => adapter.quotaBytes(),
    restrictToTrustedContexts: () => adapter.restrictToTrustedContexts(),
    async writeRoot(root: Parameters<typeof adapter.writeRoot>[0]) {
      const result = await adapter.writeRoot(root);
      if (result.ok) commits += 1;
      return result;
    },
  };
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const authority = createWriteAuthority({
    repository: createLocalDataRepository(storage as never, migrations),
    runner: createRootTransactionRunner({
      storage: storage as never,
      lock: createInMemoryRootWriteLock(createInMemoryRootWriteLockState()),
      migrations,
      validator: schemaValidator,
      maintenance: maintenancePolicy,
      replacement: createReplacementCoordinator(migrations, schemaValidator),
      now: () => "2026-08-24T00:00:00.000Z" as never,
      initialRoot: createInitialRoot,
    }),
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
  const data = createScopedDataPort(authority);
  return {
    service: createCandidateSourceMutationService({
      data,
      manufacturerDomains: {
        findManufacturer: () => ({ ok: true, value: undefined }),
      },
      createRequestId: (() => {
        let sequence = 10;
        return () =>
          `90000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}` as RequestId;
      })(),
    }),
    data,
    commits: () => commits,
  };
};

test("実foundation scoped data portでも全mutationがaggregate単位で一回ずつcommitされる", async () => {
  const probe = await realFoundationHarness();
  assert.equal(
    (
      await probe.service.addSource({
        candidateId,
        source: {
          id: addedId,
          pageUrl: "https://shop.example.invalid/product/synthetic",
        },
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await probe.service.updateSource({
        candidateId,
        source: { id: addedId, siteName: "架空販売店2" },
      })
    ).ok,
    true,
  );
  assert.equal(
    (await probe.service.setPrimarySource({ candidateId, sourceId: addedId }))
      .ok,
    true,
  );
  assert.equal(
    (await probe.service.removeSource({ candidateId, sourceId: primaryId })).ok,
    true,
  );
  assert.equal(probe.commits(), 4);
  const stored = await probe.data.query((root) => root);
  assert.equal(stored.ok, true);
  if (stored.ok) {
    assert.deepEqual(
      stored.value.candidateParts[0]?.sources.map(({ id }) => id),
      [addedId],
    );
    assert.equal(stored.value.revision, 5);
  }
});

test("add/update/remove/setPrimaryはpolicyを通してcandidate aggregateを各1回だけ更新する", async () => {
  const probe = harness();
  const added = await probe.service.addSource({
    candidateId,
    source: {
      id: addedId,
      pageUrl: "https://maker.example.invalid/product/synthetic",
      siteName: "既存表示名称",
    },
  });
  assert.equal(added.ok, true);
  assert.equal(probe.commits(), 1);
  assert.deepEqual(probe.classified, [
    "https://maker.example.invalid/product/synthetic",
  ]);
  assert.equal(
    probe.root().candidateParts[0]?.sources[1]?.kind,
    "manufacturer",
  );

  const updated = await probe.service.updateSource({
    candidateId,
    source: { id: addedId, kind: "retail" },
  });
  assert.equal(updated.ok, true);
  assert.equal(probe.commits(), 2);
  assert.equal(probe.classified.length, 1);
  assert.equal(
    probe.root().candidateParts[0]?.sources[1]?.siteName,
    "既存表示名称",
  );

  const primary = await probe.service.setPrimarySource({
    candidateId,
    sourceId: addedId,
  });
  assert.equal(primary.ok, true);
  assert.equal(probe.commits(), 3);

  const removed = await probe.service.removeSource({
    candidateId,
    sourceId: primaryId,
  });
  assert.equal(removed.ok, true);
  assert.equal(probe.commits(), 4);
  assert.deepEqual(
    probe.root().candidateParts[0]?.sources.map(({ id }) => id),
    [addedId],
  );
});

test("classifier非一致はretail、明示kindは上書きせずclassifierを呼ばない", async () => {
  const retailProbe = harness();
  await retailProbe.service.addSource({
    candidateId,
    source: {
      id: addedId,
      pageUrl: "https://shop.example.invalid/product/synthetic",
    },
  });
  assert.equal(
    retailProbe.root().candidateParts[0]?.sources[1]?.kind,
    "retail",
  );

  const overrideProbe = harness();
  await overrideProbe.service.addSource({
    candidateId,
    source: {
      id: addedId,
      pageUrl: "https://maker.example.invalid/product/synthetic",
      kind: "retail",
    },
  });
  assert.equal(overrideProbe.classified.length, 0);
  assert.equal(
    overrideProbe.root().candidateParts[0]?.sources[1]?.kind,
    "retail",
  );
});

test("validation・primary-required・data failureは旧candidateを保持し暗黙retryしない", async () => {
  const invalid = harness();
  const beforeInvalid = structuredClone(invalid.root().candidateParts[0]);
  const validation = await invalid.service.addSource({
    candidateId,
    source: { id: addedId, pageUrl: "not a url", kind: "retail" },
  });
  assert.equal(validation.ok, false);
  assert.equal(!validation.ok && validation.error.kind, "source-validation");
  assert.equal(invalid.commits(), 0);
  assert.deepEqual(invalid.root().candidateParts[0], beforeInvalid);

  const primary = harness();
  await primary.service.addSource({
    candidateId,
    source: {
      id: addedId,
      pageUrl: "https://shop.example.invalid/product/synthetic",
      kind: "retail",
    },
  });
  const beforePrimary = structuredClone(primary.root().candidateParts[0]);
  const required = await primary.service.removeSource({
    candidateId,
    sourceId: primaryId,
  });
  assert.deepEqual(required, {
    ok: false,
    error: { kind: "primary-required" },
  });
  assert.equal(primary.commits(), 1);
  assert.deepEqual(primary.root().candidateParts[0], beforePrimary);

  const failed = harness({ failWrite: true });
  const beforeFailure = structuredClone(failed.root().candidateParts[0]);
  const result = await failed.service.setPrimarySource({
    candidateId,
    sourceId: primaryId,
  });
  assert.deepEqual(result, {
    ok: false,
    error: { kind: "data", error: { code: "storage-unavailable" } },
  });
  assert.equal(failed.commits(), 0);
  assert.deepEqual(failed.root().candidateParts[0], beforeFailure);
});
