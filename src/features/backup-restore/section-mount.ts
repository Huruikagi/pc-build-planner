import type {
  FeatureMountContext,
  FeatureMountHandle,
} from "../../application-shell/public.js";
import type { FoundationDataPort } from "../../persistence/public.js";
import { fileGateway } from "./file-gateway.js";
import { mountBackupRestoreReactRoot } from "./react-root.js";
import { createBackupService, createRestoreService } from "./service.js";
import { type BackupRestoreState, createBackupRestoreState } from "./state.js";

export interface BackupRestoreSectionMount {
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
}

export interface BackupRestoreSectionDependencies {
  readonly data: FoundationDataPort;
  /** テスト・合成専用。productionではmountごとに新しいidle stateを生成する。 */
  readonly state?: BackupRestoreState;
}

export const createBackupRestoreSectionMount = (
  dependencies: BackupRestoreSectionDependencies,
): BackupRestoreSectionMount => ({
  async mount(context) {
    const state =
      dependencies.state ??
      createBackupRestoreState({
        backupService: createBackupService({ data: dependencies.data }),
        restoreService: createRestoreService({ data: dependencies.data }),
        fileGateway,
      });
    state.resetForMount();

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
        unmounted = true;
        root?.unmount();
      },
    };
  },
});
