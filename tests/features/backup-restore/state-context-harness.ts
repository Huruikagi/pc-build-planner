import type {
  RestoreContextLifecycle,
  RestoreContextLifecycleDependencies,
  RestorePostCommitCoordinator,
} from "../../../src/features/backup-restore/context-lifecycle.js";
import {
  createRestoreContextLifecycle,
  createRestorePostCommitCoordinator,
} from "../../../src/features/backup-restore/context-lifecycle.js";
import type { BackupRestoreSectionDependencies } from "../../../src/features/backup-restore/public.js";
import { detachedProjectContextDependencies } from "../../fixtures/project-context-ports.js";

/**
 * project-context を合成しない test 用の guard/refresh port。
 * 保護すべき draft 所有者が居ないため prepare は permit を発行し、
 * 再検証対象の context も無いため refresh は `context-unavailable` を返す。
 */
export const detachedProjectContextPorts =
  (): RestoreContextLifecycleDependencies => {
    const ports = detachedProjectContextDependencies();
    return {
      replacementGuard: ports.projectReplacementGuard,
      projectContext: ports.projectRefresh,
    };
  };

/**
 * state を直接注入する section test 用の capability 一式。
 * factory が内部 service を組み立てないことを、呼ばれた時点の失敗で固定する。
 */
export const unusedSectionCapabilities = (): Pick<
  BackupRestoreSectionDependencies,
  "read" | "restore" | "replacementGuard" | "projectContext"
> => {
  const notExpected = (label: string) => (): never => {
    throw new Error(`must not call ${label}`);
  };
  const ports = detachedProjectContextPorts();
  return {
    read: { query: notExpected("read.query") },
    restore: {
      assessReplacement: notExpected("restore.assessReplacement"),
      assessRecovery: notExpected("restore.assessRecovery"),
      commit: notExpected("restore.commit"),
      findPendingFinalization: notExpected("restore.findPendingFinalization"),
      finalize: notExpected("restore.finalize"),
    },
    replacementGuard: ports.replacementGuard,
    projectContext: ports.projectContext,
  };
};

export const unattachedContextDependencies = (): {
  readonly contextLifecycle: RestoreContextLifecycle;
  readonly postCommit: RestorePostCommitCoordinator;
} => {
  const contextLifecycle = createRestoreContextLifecycle(
    detachedProjectContextPorts(),
  );
  return {
    contextLifecycle,
    postCommit: createRestorePostCommitCoordinator({
      lifecycle: contextLifecycle,
      restoreService: {
        finalize: async (_ticket, summary) =>
          summary === undefined
            ? { ok: false, error: { code: "storage-unavailable" } }
            : { ok: true, value: summary },
      },
    }),
  };
};
