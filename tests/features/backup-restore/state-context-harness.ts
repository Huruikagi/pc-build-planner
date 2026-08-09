import type {
  RestoreContextLifecycle,
  RestorePostCommitCoordinator,
} from "../../../src/features/backup-restore/context-lifecycle.js";
import {
  createRestoreContextLifecycle,
  createRestorePostCommitCoordinator,
  createUnattachedProjectContextPorts,
} from "../../../src/features/backup-restore/context-lifecycle.js";

/**
 * project-context を合成しない test 用の guard/refresh 依存。
 * guard は permit を発行し、refresh は再検証対象が無いことを報告する。
 */
export const unattachedContextDependencies = (): {
  readonly contextLifecycle: RestoreContextLifecycle;
  readonly postCommit: RestorePostCommitCoordinator;
} => {
  const contextLifecycle = createRestoreContextLifecycle(
    createUnattachedProjectContextPorts(),
  );
  return {
    contextLifecycle,
    postCommit: createRestorePostCommitCoordinator({
      lifecycle: contextLifecycle,
      restoreService: {
        finalize: async (_ticket, summary) => ({ ok: true, value: summary }),
      },
    }),
  };
};
