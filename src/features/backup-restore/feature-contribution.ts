import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type { BackupRestorePublicApi } from "./public.js";
import { createBackupRestoreFeatureRegistration } from "./registration.js";

export const backupRestoreContributionKey = "backupRestore";

export type BackupRestoreContribution = FeatureContribution<
  typeof backupRestoreContributionKey,
  BackupRestorePublicApi
>;

/**
 * 置換・保守capabilityを含む完全portをcontextの専用供給から受け取る。
 * 既定の絞り込みport（`context.data`）はassessReplacement/replaceRoot/runMaintenanceを持たない。
 */
export const createBackupRestoreContribution = (
  context: FeatureCompositionContext,
): BackupRestoreContribution => ({
  key: backupRestoreContributionKey,
  registration: createBackupRestoreFeatureRegistration({
    data: context.fullDataPort,
  }),
});
