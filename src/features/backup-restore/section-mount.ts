import type {
  FeatureMountContext,
  FeatureMountHandle,
} from "../../application-shell/public.js";
import type { BackupRestoreDataPort } from "../../persistence/public.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
} from "../../project-context/public.js";
import {
  createRestoreContextLifecycle,
  createRestorePostCommitCoordinator,
} from "./context-lifecycle.js";
import type { BackupSnapshotReadPort } from "./contracts.js";
import { fileGateway } from "./file-gateway.js";
import { mountBackupRestoreReactRoot } from "./react-root.js";
import { createBackupService, createRestoreService } from "./service.js";
import { type BackupRestoreState, createBackupRestoreState } from "./state.js";

export interface BackupRestoreSectionMount {
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
}

/**
 * factoryが受け取る四つのcapabilityだけがsection内部へ入る。
 * 通常CRUD、raw root、Storage、guard registry、選択commandは到達しない。
 */
export interface BackupRestoreSectionDependencies {
  /** export参照とfinalize後の件数再構築だけに使う読取専用view。 */
  readonly read: BackupSnapshotReadPort;
  /** assessment ticket付きの置換・回復capability。 */
  readonly restore: BackupRestoreDataPort;
  /** commit前の置換guard lifecycle。 */
  readonly replacementGuard: ProjectContextReplacementGuardPort;
  /** commit後の現在プロジェクト再検証だけを行うrefresh capability。 */
  readonly projectContext: Pick<ProjectContextCommandPort, "refresh">;
  /** テスト・合成専用。productionではmountごとに新しいidle stateを生成する。 */
  readonly state?: BackupRestoreState;
}

const createSectionState = (
  dependencies: BackupRestoreSectionDependencies,
): BackupRestoreState => {
  const restoreService = createRestoreService({
    data: dependencies.restore,
    snapshot: dependencies.read,
  });
  const contextLifecycle = createRestoreContextLifecycle({
    replacementGuard: dependencies.replacementGuard,
    projectContext: dependencies.projectContext,
  });
  return createBackupRestoreState({
    backupService: createBackupService({ data: dependencies.read }),
    restoreService,
    fileGateway,
    contextLifecycle,
    postCommit: createRestorePostCommitCoordinator({
      lifecycle: contextLifecycle,
      restoreService: {
        finalize: (ticket, summary) =>
          restoreService.finalize === undefined
            ? Promise.resolve({
                ok: false as const,
                error: { code: "maintenance-active" as const },
              })
            : restoreService.finalize(ticket, summary),
      },
    }),
  });
};

export const createBackupRestoreSectionMount = (
  dependencies: BackupRestoreSectionDependencies,
): BackupRestoreSectionMount => ({
  async mount(context) {
    const state = dependencies.state ?? createSectionState(dependencies);
    state.resetForMount();
    /** 通常idleを描画する前に、Foundation所有のpending finalizationを再水和する。 */
    await state.rehydratePendingFinalization();

    let root: ReturnType<typeof mountBackupRestoreReactRoot> | undefined;
    try {
      root = mountBackupRestoreReactRoot(
        context.container,
        state,
        context.operationPolicy,
      );
    } catch (error) {
      root?.unmount();
      context.container.replaceChildren();
      throw error;
    }

    let unmounted = false;
    return {
      async unmount() {
        if (unmounted) return;
        root?.unmount();
        unmounted = true;
      },
    };
  },
});
