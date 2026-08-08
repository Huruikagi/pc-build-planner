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

test("2.5: frozen public facade は read / commands / guards / replacement を分離する", () => {
  const id = "11111111-1111-4111-8111-111111111111" as ProjectId;
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id,
            name: "架空",
            updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  const api = createProjectContextPublicApi({ service });
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.read), true);
  assert.equal(Object.isFrozen(api.commands), true);
  assert.equal(Object.isFrozen(api.guards), true);
  assert.equal(Object.isFrozen(api.replacementGuard), true);
  assert.equal("service" in api, false);
  assert.equal(typeof api.read.getSnapshot, "function");
  assert.equal(typeof api.commands.select, "function");
  assert.equal(typeof api.guards.register, "function");
  assert.equal(typeof api.replacementGuard.prepare, "function");
});
