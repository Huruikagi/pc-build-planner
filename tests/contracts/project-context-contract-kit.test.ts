import assert from "node:assert/strict";
import test from "node:test";

import {
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { createProjectContextService } from "../../src/project-context/service.js";
import {
  collectProjectContextSnapshotViolations,
  collectReplacementContractViolations,
} from "./project-context-contract-kit.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;

test("project-context contract kitは公開read portだけでready/empty/unavailableを検証する", async () => {
  let entries: readonly {
    id: ProjectId;
    name: string;
    updatedAt: UtcTimestamp;
  }[] = [
    {
      id: A,
      name: "架空プロジェクト",
      updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
    },
  ];
  let unavailable = false;
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return unavailable
          ? { ok: false, error: { kind: "source-unavailable" as const } }
          : ok(entries);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  const api = createProjectContextPublicApi({ service });
  await service.initialize();
  assert.deepEqual(
    collectProjectContextSnapshotViolations(api, {
      status: "ready",
      selectedProjectId: A,
      minimumGeneration: 1,
    }),
    [],
  );
  entries = [];
  await api.commands.refresh();
  assert.deepEqual(
    collectProjectContextSnapshotViolations(api, {
      status: "empty",
      selectedProjectId: null,
      minimumGeneration: 2,
    }),
    [],
  );
  unavailable = true;
  await api.commands.refresh();
  assert.deepEqual(
    collectProjectContextSnapshotViolations(api, {
      status: "unavailable",
      selectedProjectId: null,
      minimumGeneration: 3,
    }),
    [],
  );
});

test("project-context contract kitはreplacement成功後だけ独立refreshを要求する", async () => {
  let refreshes = 0;
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空プロジェクト",
            updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  assert.deepEqual(
    await collectReplacementContractViolations({
      replacementGuard: api.replacementGuard,
      async commitReplacement() {
        return "succeeded";
      },
      async refresh() {
        refreshes += 1;
        await api.commands.refresh();
      },
    }),
    [],
  );
  assert.equal(refreshes, 1);
});
