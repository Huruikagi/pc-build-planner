import assert from "node:assert/strict";
import test from "node:test";
import {
  err,
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import type {
  ProjectCatalogItem,
  ProjectCatalogSource,
  ProjectPreferencePort,
} from "../../src/project-context/contracts.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextService } from "../../src/project-context/service.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;
const item = (id: ProjectId, name: string): ProjectCatalogItem => ({
  id,
  name,
  updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
});

test("2.3: initialize は valid preference を復元し、missing は先頭へ修復してから ready を公開する", async () => {
  let entries: readonly ProjectCatalogItem[] = [
    item(A, "架空A"),
    item(B, "架空B"),
  ];
  const source: ProjectCatalogSource = {
    async list() {
      return ok(entries);
    },
  };
  const preference = createInMemoryProjectPreferencePort();
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference,
  });
  const notices: number[] = [];
  service.subscribe((snapshot) => notices.push(snapshot.generation));
  const initialized = await service.initialize();
  assert.ok(initialized.ok && initialized.value.status === "ready");
  assert.equal(service.getSnapshot().selectedProjectId, A);
  assert.deepEqual(await preference.read(), {
    ok: true,
    value: { kind: "valid", selectedProjectId: A },
  });
  assert.deepEqual(notices, [1]);
  entries = [item(B, "架空B")];
  const refreshed = await service.refresh();
  assert.ok(refreshed.ok && refreshed.value.status === "ready");
  assert.equal(service.getSnapshot().selectedProjectId, B);
  assert.deepEqual(notices, [1, 2]);
});

test("2.3: empty は preference を消去し、catalog/preference failure は unavailable へ閉じて retry で回復する", async () => {
  let failure = true;
  const source: ProjectCatalogSource = {
    async list() {
      return failure ? err({ kind: "source-unavailable" }) : ok([]);
    },
  };
  const preference = createInMemoryProjectPreferencePort({
    version: 1,
    selectedProjectId: A,
  });
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference,
  });
  const first = await service.initialize();
  assert.ok(first.ok && first.value.status === "unavailable");
  failure = false;
  const retry = await service.refresh();
  assert.ok(retry.ok && retry.value.status === "empty");
  assert.deepEqual(await preference.read(), {
    ok: true,
    value: { kind: "missing" },
  });
  assert.equal(service.getSnapshot().generation, 2);
});

test("2.3: preference 読み取り・repair 書き込みの失敗では ready を公開しない", async () => {
  const source: ProjectCatalogSource = {
    async list() {
      return ok([item(A, "架空A")]);
    },
  };
  const unreadable: ProjectPreferencePort = {
    async read() {
      return err({ kind: "storage-unavailable" });
    },
    async write() {
      return ok(undefined);
    },
    async clear() {
      return ok(undefined);
    },
  };
  const unavailable = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference: unreadable,
  });
  await unavailable.initialize();
  assert.deepEqual(unavailable.getSnapshot(), {
    status: "unavailable",
    generation: 1,
    selectedProjectId: null,
    reason: "preference-unavailable",
  });

  const unrepairable: ProjectPreferencePort = {
    async read() {
      return ok({ kind: "missing" });
    },
    async write() {
      return err({ kind: "storage-write-failed" });
    },
    async clear() {
      return ok(undefined);
    },
  };
  const failedRepair = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference: unrepairable,
  });
  await failedRepair.initialize();
  assert.deepEqual(failedRepair.getSnapshot(), {
    status: "unavailable",
    generation: 1,
    selectedProjectId: null,
    reason: "preference-write-failed",
  });
});
