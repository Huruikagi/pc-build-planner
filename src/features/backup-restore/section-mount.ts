import type {
  FeatureMountContext,
  FeatureMountHandle,
} from "../../application-shell/public.js";
import type {
  BackupRestoreDataPort,
  FoundationScopedDataPort,
} from "../../persistence/public.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
} from "../../project-context/public.js";
import {
  createRestoreContextLifecycle,
  createRestorePostCommitCoordinator,
  createUnattachedProjectContextPorts,
} from "./context-lifecycle.js";
import { fileGateway } from "./file-gateway.js";
import { mountBackupRestoreReactRoot } from "./react-root.js";
import { createBackupService, createRestoreService } from "./service.js";
import { type BackupRestoreState, createBackupRestoreState } from "./state.js";

export interface BackupRestoreSectionMount {
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
}

export interface BackupRestoreSectionDependencies {
  readonly data: FoundationScopedDataPort;
  readonly restoreData?: BackupRestoreDataPort;
  readonly replacementGuard?: ProjectContextReplacementGuardPort;
  readonly projectContext?: Pick<ProjectContextCommandPort, "refresh">;
  /** テスト・合成専用。productionではmountごとに新しいidle stateを生成する。 */
  readonly state?: BackupRestoreState;
}

/** project-context capabilityが揃っている場合だけ実portでguard lifecycleを構成する。 */
const createSectionState = (
  dependencies: BackupRestoreSectionDependencies,
): BackupRestoreState => {
  const restoreService = createRestoreService({
    data: dependencies.restoreData as BackupRestoreDataPort,
    snapshot: { query: (query) => dependencies.data.query(query) },
  });
  const contextLifecycle = createRestoreContextLifecycle(
    dependencies.replacementGuard !== undefined &&
      dependencies.projectContext !== undefined
      ? {
          replacementGuard: dependencies.replacementGuard,
          projectContext: dependencies.projectContext,
        }
      : createUnattachedProjectContextPorts(),
  );
  return createBackupRestoreState({
    backupService: createBackupService({ data: dependencies.data }),
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
