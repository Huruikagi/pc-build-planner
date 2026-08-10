import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { createProjectContextAdapter } from "../../../src/features/candidate-management/project-context-adapter.js";
import type { ProjectContextSnapshot } from "../../../src/project-context/public.js";

const projectId = "10000000-0000-4000-8000-000000000061" as Uuid as ProjectId;

test("adapterはreadyだけを候補管理の作業対象とし、refresh結果へ追従する", async () => {
  let snapshot: ProjectContextSnapshot = {
    status: "empty",
    generation: 1,
    catalog: [],
    selectedProjectId: null,
  };
  const listeners = new Set<(snapshot: ProjectContextSnapshot) => void>();
  let refreshes = 0;
  const adapter = createProjectContextAdapter({
    read: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    commands: {
      async refresh() {
        refreshes += 1;
        snapshot = {
          status: "ready",
          generation: 2,
          catalog: [
            {
              id: projectId,
              name: "架空",
              updatedAt: "2026-08-10T00:00:00.000Z" as UtcTimestamp,
            },
          ],
          selectedProjectId: projectId,
        };
        for (const listener of listeners) listener(snapshot);
        return { ok: true as const, value: snapshot };
      },
    },
  });

  assert.deepEqual(adapter.getCurrentProject(), { status: "unresolved" });
  assert.deepEqual(await adapter.refresh?.(), {
    ok: true,
    value: { status: "resolved", projectId },
  });
  assert.equal(refreshes, 1);
  assert.deepEqual(adapter.getCurrentProject(), {
    status: "resolved",
    projectId,
  });
});
