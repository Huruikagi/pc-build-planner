import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CoreErrorCode,
  LocalDataPolicy,
} from "@pc-build-planner/local-data";

import type {
  FoundationError,
  LocalDataRoot,
  MaintenanceState,
} from "../../src/domain/public.js";
import {
  adaptCoreError,
  productLocalDataAdapter,
  productLocalDataPolicy,
  productLocalDataStorageScope,
  productWorkerPolicy,
} from "../../src/persistence/product-local-data-adapter.js";
import type { RootOperation } from "../../src/persistence/public.js";
import { createInitialRoot } from "../../src/persistence/schema.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  candidate: "20000000-0000-4000-8000-000000000001",
  build: "30000000-0000-4000-8000-000000000001",
} as const;

test("product adapter maps every package error to the meaning-equivalent FoundationError", () => {
  const expected = {
    validation: "validation",
    migration: "migration-failed",
    repair: "repair-failed",
    "revision-conflict": "revision-conflict",
    "request-conflict": "request-conflict",
    "maintenance-active": "maintenance-active",
    "recovery-active": "recovery-active",
    "stale-fence": "stale-fence",
    "stale-assessment": "stale-assessment",
    "stale-recovery-state": "stale-recovery-state",
    "precommit-cleanup-pending": "precommit-cleanup-pending",
    "quota-exceeded": "quota-exceeded",
    "access-denied": "access-denied",
    "lock-unavailable": "lock-unavailable",
    "storage-unavailable": "storage-unavailable",
  } satisfies Record<CoreErrorCode, FoundationError["code"]>;

  for (const [code, foundationCode] of Object.entries(expected)) {
    assert.deepEqual(adaptCoreError({ code }), {
      ok: true,
      value: { code: foundationCode },
    });
  }

  const throwingGet = new Proxy(
    { code: "migration" },
    {
      get: () => {
        throw new Error("must not reread an untrusted property");
      },
    },
  );
  assert.deepEqual(adaptCoreError(throwingGet), {
    ok: true,
    value: { code: "migration-failed" },
  });
});

test("product adapter fails closed for unknown or incomplete runtime errors", () => {
  const accessorError = {};
  Object.defineProperty(accessorError, "code", {
    enumerable: true,
    get: () => {
      throw new Error("must not inspect an untrusted accessor");
    },
  });
  const throwingOwnKeys = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("must contain an untrusted ownKeys trap");
      },
    },
  );
  const throwingDescriptor = new Proxy(
    { code: "validation" },
    {
      getOwnPropertyDescriptor: () => {
        throw new Error("must contain an untrusted descriptor trap");
      },
    },
  );
  for (const input of [
    undefined,
    null,
    {},
    { code: "unknown" },
    { code: "validation", unexpected: true },
    { code: 1 },
    accessorError,
    throwingOwnKeys,
    throwingDescriptor,
  ]) {
    assert.deepEqual(adaptCoreError(input), {
      ok: false,
      error: { code: "validation" },
    });
  }
});

const referencedRoot = (): LocalDataRoot =>
  ({
    ...createInitialRoot(),
    projects: [
      {
        id: ids.project,
        name: "Fictional workstation",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    candidateParts: [
      {
        id: ids.candidate,
        projectId: ids.project,
        category: "cpu",
        product: {},
        normalizedAttributes: { category: "cpu" },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    currentBuilds: [
      {
        id: ids.build,
        projectId: ids.project,
        items: [{ candidatePartId: ids.candidate, quantity: 1 }],
        updatedAt: timestamp,
      },
    ],
  }) as unknown as LocalDataRoot;

test("product adapter configures every required PC local-data policy hook", () => {
  const policy: LocalDataPolicy<
    LocalDataRoot,
    RootOperation,
    MaintenanceState,
    unknown
  > = productLocalDataPolicy;
  const root = createInitialRoot();

  assert.deepEqual(policy.decodeAndMigrate(root), { ok: true, value: root });
  assert.equal(policy.revision(root), 0);
  assert.deepEqual(policy.control(root), root.maintenance);
  assert.deepEqual(policy.withRevision(root, 4), { ...root, revision: 4 });
  assert.deepEqual(policy.withControl(root, root.maintenance), root);
  assert.deepEqual(productLocalDataStorageScope, {
    root: "localDataRoot",
    control: "foundationRecoveryControl",
  });
  assert.equal(productLocalDataAdapter.schemaVersion, root.schemaVersion);
  assert.deepEqual(productLocalDataAdapter.createInitialRoot(), root);
});

test("product policy runs the canonical validator and rejects unsupported schema versions", () => {
  const invalid = productLocalDataPolicy.decodeAndMigrate({
    ...createInitialRoot(),
    projects: [{ id: "not-a-project-id" }],
  });
  assert.deepEqual(invalid, { ok: false, error: { code: "validation" } });

  const future = productLocalDataPolicy.decodeAndMigrate({
    ...createInitialRoot(),
    schemaVersion: 2,
  });
  assert.deepEqual(future, {
    ok: false,
    error: { code: "unsupported-version" },
  });
});

test("product policy applies PC operations, repairs references, and retains request records", () => {
  const root = createInitialRoot();
  const project = {
    id: "00000000-0000-4000-8000-000000000001" as never,
    name: "Fictional workstation",
    createdAt: "2026-01-01T00:00:00.000Z" as never,
    updatedAt: "2026-01-01T00:00:00.000Z" as never,
  };
  const created = productLocalDataPolicy.apply(root, {
    kind: "create",
    entity: "project",
    value: project,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const repaired = productLocalDataPolicy.repair(created.value, root);
  assert.deepEqual(repaired, { ok: true, value: created.value });

  const recorded = productLocalDataPolicy.withRequestRecord(created.value, {
    requestId: "00000000-0000-4000-8000-000000000002",
    digest: "fictional-operation-digest",
    revision: 1,
  });
  assert.deepEqual(
    productLocalDataPolicy.requestRecord(
      recorded,
      "00000000-0000-4000-8000-000000000002",
    ),
    {
      requestId: "00000000-0000-4000-8000-000000000002",
      digest: "fictional-operation-digest",
      revision: 1,
    },
  );
});

test("product policy repairs candidate deletion before the root is revalidated", () => {
  const before = referencedRoot();
  const applied = productLocalDataPolicy.apply(before, {
    kind: "delete",
    entity: "candidatePart",
    id: ids.candidate as never,
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.value.currentBuilds[0]?.items.length, 1);

  const repaired = productLocalDataPolicy.repair(applied.value, before);
  assert.equal(repaired.ok, true);
  if (!repaired.ok) return;
  assert.deepEqual(repaired.value.candidateParts, []);
  assert.deepEqual(repaired.value.currentBuilds[0]?.items, []);
  assert.deepEqual(productLocalDataPolicy.decodeAndMigrate(repaired.value), {
    ok: true,
    value: repaired.value,
  });
});

test("worker policy rejects active or invalid recovery control", () => {
  assert.deepEqual(
    productWorkerPolicy.authorizeMutation({ generation: 0, active: false }, 0),
    { ok: true, value: undefined },
  );
  assert.deepEqual(
    productWorkerPolicy.authorizeMutation(
      {
        generation: 1,
        active: true,
        ownerId: "fictional-worker",
        leaseExpiresAt: "2026-01-01T00:01:00.000Z",
      },
      0,
    ),
    { ok: false, error: { code: "recovery-active" } },
  );
  assert.deepEqual(productWorkerPolicy.authorizeMutation({}, 0), {
    ok: false,
    error: { code: "stale-fence" },
  });
});
