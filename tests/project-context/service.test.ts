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
const C = "33333333-3333-4333-8333-333333333333" as ProjectId;
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
      return ok([item(A, "架空A"), item(B, "架空B")]);
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

test("2.4: select は guard confirmation、永続化後の commit、cancel と stale を直列化する", async () => {
  const source: ProjectCatalogSource = {
    async list() {
      return ok([item(A, "架空A"), item(B, "架空B")]);
    },
  };
  const preference = createInMemoryProjectPreferencePort();
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference,
  });
  await service.initialize();
  service.registerGuard({
    id: "draft",
    async evaluate() {
      return ok({ kind: "confirmation-required" });
    },
  });

  const selected = await service.select(B);
  assert.ok(selected.ok && selected.value.kind === "confirmation-required");
  if (!selected.ok || selected.value.kind !== "confirmation-required") return;
  assert.equal(service.getSnapshot().selectedProjectId, A);
  assert.deepEqual(service.cancel(selected.value.confirmation.id), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(await service.confirm(selected.value.confirmation.id), {
    ok: false,
    error: { kind: "confirmation-stale" },
  });

  const next = await service.select(B);
  assert.ok(next.ok && next.value.kind === "confirmation-required");
  if (!next.ok || next.value.kind !== "confirmation-required") return;
  const confirmed = await service.confirm(next.value.confirmation.id);
  assert.ok(confirmed.ok && confirmed.value.status === "ready");
  assert.equal(service.getSnapshot().selectedProjectId, B);
  assert.equal(service.getSnapshot().generation, 2);
  assert.deepEqual(await preference.read(), {
    ok: true,
    value: { kind: "valid", selectedProjectId: B },
  });
});

test("2.4: unknown と同値 select は不変で、保存失敗時は以前の snapshot を保つ", async () => {
  const source: ProjectCatalogSource = {
    async list() {
      return ok([item(A, "架空A"), item(B, "架空B")]);
    },
  };
  const preference: ProjectPreferencePort = {
    async read() {
      return ok({ kind: "valid", selectedProjectId: A });
    },
    async write() {
      return err({ kind: "storage-write-failed" });
    },
    async clear() {
      return ok(undefined);
    },
  };
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference,
  });
  await service.initialize();
  const generation = service.getSnapshot().generation;
  assert.deepEqual(await service.select(C), {
    ok: false,
    error: { kind: "project-not-found" },
  });
  assert.deepEqual(await service.select(A), {
    ok: true,
    value: { kind: "selected", snapshot: service.getSnapshot() },
  });
  assert.equal(service.getSnapshot().generation, generation);
  assert.deepEqual(await service.select(B), {
    ok: false,
    error: { kind: "preference-write-failed" },
  });
  assert.equal(service.getSnapshot().generation, generation);
});

test("2.5: listener 例外は隔離し、unsubscribe 後には確定 snapshot を通知しない", async () => {
  const source: ProjectCatalogSource = {
    async list() {
      return ok([item(A, "架空A"), item(B, "架空B")]);
    },
  };
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(source),
    preference: createInMemoryProjectPreferencePort(),
  });
  const observed: number[] = [];
  service.subscribe(() => {
    throw new Error("observer failure");
  });
  const unsubscribe = service.subscribe((snapshot) =>
    observed.push(snapshot.generation),
  );
  await service.initialize();
  unsubscribe();
  await service.select(B);
  assert.deepEqual(observed, [1]);
  assert.equal(service.getSnapshot().selectedProjectId, B);
});

test("2.4: refresh で catalog が変わると保留 confirmation は stale となり、直列化された最後の選択だけが残る", async () => {
  let entries: readonly ProjectCatalogItem[] = [
    item(A, "架空A"),
    item(B, "架空B"),
  ];
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok(entries);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  service.registerGuard({
    id: "draft",
    async evaluate() {
      return ok({ kind: "confirmation-required" });
    },
  });
  const pending = await service.select(B);
  assert.ok(pending.ok && pending.value.kind === "confirmation-required");
  if (!pending.ok || pending.value.kind !== "confirmation-required") return;
  entries = [item(A, "架空A")];
  await service.refresh();
  assert.deepEqual(await service.confirm(pending.value.confirmation.id), {
    ok: false,
    error: { kind: "confirmation-stale" },
  });
  assert.equal(service.getSnapshot().selectedProjectId, A);
});

test("2.4: rapid select は一つの queue で直列化され、最後の確定選択だけを公開する", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([item(A, "架空A"), item(B, "架空B")]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  await Promise.all([service.select(B), service.select(A)]);
  assert.equal(service.getSnapshot().selectedProjectId, A);
  assert.equal(service.getSnapshot().generation, 3);
});
