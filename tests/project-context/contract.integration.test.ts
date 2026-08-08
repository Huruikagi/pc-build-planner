import assert from "node:assert/strict";
import test from "node:test";

import {
  err,
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import type { ProjectCatalogItem } from "../../src/project-context/contracts.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { createProjectContextService } from "../../src/project-context/service.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;
const item = (id: ProjectId, name: string): ProjectCatalogItem => ({
  id,
  name,
  updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
});

test("4.1: 複数consumerは再初期化・削除・failure recoveryを通じて同じ確定snapshotだけを受け取る", async () => {
  let entries: readonly ProjectCatalogItem[] = [
    item(A, "架空A"),
    item(B, "架空B"),
  ];
  let unavailable = false;
  const preference = createInMemoryProjectPreferencePort();
  const createApi = () =>
    createProjectContextPublicApi({
      service: createProjectContextService({
        catalog: createProjectCatalogProjection({
          async list() {
            return unavailable
              ? err({ kind: "source-unavailable" })
              : ok(entries);
          },
        }),
        preference,
      }),
    });
  const api = createApi();
  const first: string[] = [];
  const second: string[] = [];
  api.read.subscribe((snapshot) =>
    first.push(`${snapshot.generation}:${snapshot.selectedProjectId}`),
  );
  api.read.subscribe((snapshot) =>
    second.push(`${snapshot.generation}:${snapshot.selectedProjectId}`),
  );
  await api.commands.refresh();
  await api.commands.select(B);
  entries = [item(A, "架空A")];
  await api.commands.refresh();
  unavailable = true;
  await api.commands.refresh();
  unavailable = false;
  await api.commands.refresh();
  assert.deepEqual(first, second);
  assert.deepEqual(api.read.getSnapshot(), {
    status: "ready",
    generation: 5,
    catalog: [item(A, "架空A")],
    selectedProjectId: A,
  });

  const reopened = createApi();
  await reopened.commands.refresh();
  assert.equal(reopened.read.getSnapshot().selectedProjectId, A);
});

test("4.1: replacement permitは失敗・取消・staleでは通知せず成功だけを一回通知する", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([item(A, "架空A")]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  let notifications = 0;
  service.registerGuard({
    id: "observer",
    async evaluate() {
      return ok({ kind: "allow" });
    },
    notifyForced() {
      notifications += 1;
    },
  });
  const api = createProjectContextPublicApi({ service });
  const first = await api.replacementGuard.prepare();
  assert.ok(first.ok && first.value.kind === "permitted");
  if (!first.ok || first.value.kind !== "permitted") return;
  assert.ok(api.replacementGuard.begin(first.value.permit.id).ok);
  assert.ok(
    (await api.replacementGuard.complete(first.value.permit.id, "failed")).ok,
  );

  const second = await api.replacementGuard.prepare();
  assert.ok(second.ok && second.value.kind === "permitted");
  if (!second.ok || second.value.kind !== "permitted") return;
  assert.ok(api.replacementGuard.begin(second.value.permit.id).ok);
  assert.ok(
    (await api.replacementGuard.complete(second.value.permit.id, "cancelled"))
      .ok,
  );

  const stale = await api.replacementGuard.prepare();
  assert.ok(stale.ok && stale.value.kind === "permitted");
  if (!stale.ok || stale.value.kind !== "permitted") return;
  await api.commands.refresh();
  assert.deepEqual(api.replacementGuard.begin(stale.value.permit.id), {
    ok: false,
    error: { kind: "permit-stale" },
  });

  const succeeded = await api.replacementGuard.prepare();
  assert.ok(succeeded.ok && succeeded.value.kind === "permitted");
  if (!succeeded.ok || succeeded.value.kind !== "permitted") return;
  assert.ok(api.replacementGuard.begin(succeeded.value.permit.id).ok);
  assert.ok(
    (
      await api.replacementGuard.complete(
        succeeded.value.permit.id,
        "succeeded",
      )
    ).ok,
  );
  assert.equal(notifications, 1);
});
