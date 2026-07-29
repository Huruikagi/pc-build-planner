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
    root.unmount();
    throw error;
  }

  let unmounted = false;
  return {
    async unmount() {
      if (unmounted) return;
      unmounted = true;
      try {
        await backupHandle.unmount();
      } finally {
        root.unmount();
      }
    },
  };
}
