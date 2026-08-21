import {
  createUtcTimestamp,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import type { FoundationScopedDataPort } from "../../src/persistence/public.js";
import { createFoundationProjectLifecycleDataPort } from "../../src/project-context/lifecycle-data-port.js";
import { createProjectLifecycleService } from "../../src/project-context/lifecycle-service.js";
import type { ProjectLifecyclePort } from "../../src/project-context/public.js";

/** Canonical project lifecycle fixture for tests that also compose candidate management. */
export const createProjectLifecycleFixture = (input: {
  readonly data: FoundationScopedDataPort;
  readonly projectId: ProjectId;
  readonly now?: () => UtcTimestamp;
}): ProjectLifecyclePort =>
  createProjectLifecycleService({
    data: createFoundationProjectLifecycleDataPort(input.data),
    createProjectId: () => input.projectId,
    now: input.now ?? createUtcTimestamp,
    context: {
      // Seed-only fixtures do not own a live context. Tests that exercise
      // refresh behavior must compose the canonical context separately.
      async refresh() {
        return {
          ok: true,
          value: {
            status: "empty",
            generation: 0,
            catalog: [],
            selectedProjectId: null,
          },
        };
      },
    },
  });
