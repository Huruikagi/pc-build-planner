import type {
  FeatureMountContext,
  FeatureMountHandle,
} from "../../application-shell/public.js";
import type { BackupRestoreSectionMount } from "../backup-restore/public.js";

export interface SettingsSectionHostRoot {
  readonly backupRestoreHost: HTMLElement;
  unmount(): void;
}

/**
 * Acquires the public backup section after the settings host root and releases
 * both resources in reverse order. The backup feature remains the sole owner
 * of its state, services, and nested-root cleanup.
 */
export async function mountSettingsSectionResources(
  root: SettingsSectionHostRoot,
  backupRestore: BackupRestoreSectionMount,
  context: FeatureMountContext,
): Promise<FeatureMountHandle> {
  let backupHandle: FeatureMountHandle;
  try {
    backupHandle = await backupRestore.mount({
      ...context,
      container: root.backupRestoreHost,
    });
  } catch (error) {
    try {
      root.unmount();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Settings section mount rollback failed",
      );
    }
    throw error;
  }

  let backupUnmounted = false;
  let rootUnmounted = false;
  return {
    async unmount() {
      const failures: unknown[] = [];
      if (!backupUnmounted) {
        try {
          await backupHandle.unmount();
          backupUnmounted = true;
        } catch (error) {
          failures.push(error);
        }
      }
      if (!rootUnmounted) {
        try {
          root.unmount();
          rootUnmounted = true;
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, "Settings section cleanup failed");
    },
  };
}
